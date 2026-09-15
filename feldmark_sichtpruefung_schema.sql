-- =====================================================================
--  Feldmark Bank AG — Sichtpruefungs-Warteschlange
--  Schema + Testdaten
--
--  Typ-unabhaengiger Sammelpunkt fuer alles, was laut Konfidenz-/
--  Plausibilitaets-Routing (klassifikations_schema.md) KEIN Autofall wird:
--  konfidenz_typ < 70, plausibilitaet_ok = false, dokumenttyp = sonstiges,
--  oder eine Pfaendungs-/Auskunftsersuchenerinnerung ohne auffindbares
--  (oder falsch zugeordnetes) bezug_aktenzeichen.
--
--  einordnung trennt zwei fachlich unterschiedliche Gruende, warum ein
--  Eintrag hier landet: 'niedrige_konfidenz' (echter Fall einer der vier
--  Prozesstypen, nur die Konfidenz reicht nicht) vs. 'nicht_zugeordnet'
--  (dokumenttyp = sonstiges oder plausibilitaet_ok = false - gehoert gar
--  nicht zu Pfaendung/Auskunftsersuchen). Vorher nur ueber dokumenttyp/
--  plausibilitaet_ok oder Freitext in routing_gruende erschliessbar.
--
--  Bewusst eine einzige Tabelle statt einer pro Dokumenttyp: an dieser
--  Stelle steht der Typ ja gerade NICHT sicher fest (das ist ja der Grund,
--  warum der Fall hier landet), ein Mitarbeiter prueft die volle
--  Klassifikation (jsonb) und entscheidet erst dann, ob und in welche
--  Faelle-Tabelle (feldmark.pfaendung_faelle oder
--  feldmark.auskunftsersuchen_faelle) daraus ein echter Fall wird.
--
--  Einmalig ausfuehren. Getestet gegen PostgreSQL 15/16.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

-- ACHTUNG: dieses DROP ist fuer die Erstanlage gedacht. Seit dem
-- Dead-Letter-Pfad (2026-09-15) enthaelt die Tabelle fristgebundene
-- Schreiben, die sonst nirgends erfasst sind - auf einer bestehenden
-- Installation NICHT die ganze Datei ausfuehren, sondern nur die
-- ALTER-Statements am Dateiende.
DROP TABLE IF EXISTS feldmark.sichtpruefung_warteschlange;

CREATE TABLE feldmark.sichtpruefung_warteschlange (
    id                    uuid        PRIMARY KEY,
    dateiname             text        NOT NULL,
    dokumenttyp           text        NOT NULL
                          CHECK (dokumenttyp IN ('pfaendungsschreiben',
                                                  'auskunftsersuchen',
                                                  'einziehungsverfuegung',
                                                  'ueberweisungsverfuegung',
                                                  'pfaendungserinnerung',
                                                  'auskunftsersuchenerinnerung',
                                                  'sonstiges')),
    -- 'verarbeitung_fehlgeschlagen' (2026-09-15): OCR oder Klassifikation
    -- sind hart gescheitert (API-Fehler, Timeout, unlesbare Datei). Das
    -- Schreiben hat trotzdem eine Frist, darf also nicht nur als Datei im
    -- uploads-Ordner liegen bleiben - siehe Dead-Letter-Pfad in
    -- server/index.js verarbeiteDatei().
    einordnung            text        NOT NULL DEFAULT 'niedrige_konfidenz'
                          CHECK (einordnung IN ('niedrige_konfidenz', 'nicht_zugeordnet', 'verarbeitung_fehlgeschlagen')),
    konfidenz_typ         integer,
    plausibilitaet_ok     boolean,
    plausibilitaet_begruendung text,
    routing_gruende       text[]      NOT NULL DEFAULT '{}',
    -- Volle Modellantwort (kopf/pfaendung/auskunftsersuchen/erinnerung) -
    -- der Mitarbeiter sieht bei der Pruefung alles, was extrahiert wurde,
    -- nicht nur die Metadaten oben.
    klassifikation        jsonb       NOT NULL,
    rohtext_auszug        text,
    ansicht_url           text,
    eingangsdatum          date,
    status                text        NOT NULL DEFAULT 'offen'
                          CHECK (status IN ('offen', 'uebernommen', 'verworfen')),
    -- Gefuellt, sobald ein Mitarbeiter den Fall bestaetigt und in
    -- feldmark.pfaendung_faelle oder feldmark.auskunftsersuchen_faelle
    -- angelegt hat - stellt die Nachvollziehbarkeit her.
    uebernommen_als_fall_id text,
    geprueft_von          text,
    -- Freitext-Begruendung der Sichtpruefungs-Entscheidung, vor allem beim
    -- Verwerfen (warum gehoert das Schreiben in keinen der zwei Prozesse).
    pruef_notiz           text,
    geprueft_am           timestamptz,
    erzeugt_am            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sichtpruefung_status ON feldmark.sichtpruefung_warteschlange (status, erzeugt_am);

-- Nachtraegliche Migrationen fuer eine bereits bestehende Tabelle
-- (2026-09-15, angewendet auf Supabase):
--   ALTER TABLE feldmark.sichtpruefung_warteschlange
--     ADD COLUMN IF NOT EXISTS pruef_notiz text;
--   ALTER TABLE feldmark.sichtpruefung_warteschlange
--     DROP CONSTRAINT sichtpruefung_warteschlange_einordnung_check;
--   ALTER TABLE feldmark.sichtpruefung_warteschlange
--     ADD CONSTRAINT sichtpruefung_warteschlange_einordnung_check
--     CHECK (einordnung IN ('niedrige_konfidenz', 'nicht_zugeordnet', 'verarbeitung_fehlgeschlagen'));
-- Rollback: Spalte droppen bzw. den CHECK ohne den dritten Wert neu setzen
-- (dann vorher betroffene Zeilen umschluesseln).

COMMENT ON COLUMN feldmark.sichtpruefung_warteschlange.eingangsdatum IS
    'Wie bei den Faelle-Tabellen: kommt aus Scan-/E-Mail-Metadaten, nie aus
     dem Dokumenttext oder vom Modell erfunden. Kann hier NULL sein, wenn
     der Upload das (noch) nicht mitliefert.';

-- ---------------------------------------------------------------------
-- Testdaten — je ein Vertreter pro Routing-Grund, plus die zwei echten
-- Testfaelle aus Schritt 2 (Betriebsrat-Wahlliste, Antwort_ZIS_2016).
-- ---------------------------------------------------------------------
INSERT INTO feldmark.sichtpruefung_warteschlange
    (id, dateiname, dokumenttyp, einordnung, konfidenz_typ, plausibilitaet_ok,
     plausibilitaet_begruendung, routing_gruende, klassifikation,
     rohtext_auszug, eingangsdatum, status)
VALUES
    -- niedrige Typ-Konfidenz - echter Pfaendungsfall, nur die Konfidenz reicht nicht
    (gen_random_uuid(), 'unklarer_scan.jpg', 'pfaendungsschreiben', 'niedrige_konfidenz', 55, true,
     'Stempel und Unterschrift teilweise unleserlich.',
     ARRAY['konfidenz_typ (55) unter Schwelle 70'],
     '{"dokumenttyp":"pfaendungsschreiben","konfidenz_typ":55}'::jsonb,
     'Amtsgericht ... (Rest schwer lesbar)', CURRENT_DATE - 1, 'offen'),

    -- Wortreffer ohne passende Struktur - gehoert nicht zu unseren Prozessen
    (gen_random_uuid(), 'auskunftsersuchen-beim-arbeitgeber-zur-aufstellung-der-wahlerliste.jpg',
     'sonstiges', 'nicht_zugeordnet', 95, false,
     'Kein bankbezogenes Vollstreckungs- oder Ermittlungsersuchen erkennbar.',
     ARRAY['plausibilitaet_ok = false', 'dokumenttyp = sonstiges, nie Autofall'],
     '{"dokumenttyp":"sonstiges","konfidenz_typ":95,"plausibilitaet_ok":false}'::jsonb,
     'Muster: Auskunftsersuchen beim Arbeitgeber zur Aufstellung der Wählerliste ...',
     CURRENT_DATE - 2, 'offen'),

    -- zweiter Plausibilitaets-Testfall - gehoert ebenfalls nicht zu unseren Prozessen
    (gen_random_uuid(), 'Antwort_ZIS_2016.jpeg', 'sonstiges', 'nicht_zugeordnet', 100, false,
     'Kein bankbezogener Vollstreckungs- oder Ermittlungsinhalt erkennbar, Absender ist eine Polizeibehörde ohne Bezug zu Bankangelegenheiten.',
     ARRAY['plausibilitaet_ok = false', 'dokumenttyp = sonstiges, nie Autofall'],
     '{"dokumenttyp":"sonstiges","konfidenz_typ":100,"plausibilitaet_ok":false}'::jsonb,
     'Landesamt für Zentrale Polizeiliche Dienste Nordrhein-Westfalen ...',
     CURRENT_DATE - 3, 'offen'),

    -- Pfaendungserinnerung ohne auffindbares Aktenzeichen im Bestand - echter Fall, nur ungeklaert
    (gen_random_uuid(), 'erinnerung_unbekannt.pdf', 'pfaendungserinnerung', 'niedrige_konfidenz', 90, true,
     'Formal eine Pfaendungserinnerung, Bezugsaktenzeichen aber in keiner Falltabelle vorhanden.',
     ARRAY['pfaendungserinnerung: bezug_aktenzeichen nicht im Bestand auffindbar'],
     '{"dokumenttyp":"pfaendungserinnerung","konfidenz_typ":90,"erinnerung":{"bezug_aktenzeichen":"99 M 0000/26"}}'::jsonb,
     'Erinnerung an unser Schreiben vom ... Az. 99 M 0000/26', CURRENT_DATE - 1, 'offen'),

    -- bereits geprueft und uebernommen - zeigt den Abschluss-Zustand
    (gen_random_uuid(), 'geprueft_beispiel.jpg', 'pfaendungsschreiben', 'niedrige_konfidenz', 60, true,
     'Nach Sichtpruefung als echter Fall bestaetigt.',
     ARRAY['konfidenz_typ (60) unter Schwelle 70'],
     '{"dokumenttyp":"pfaendungsschreiben","konfidenz_typ":60}'::jsonb,
     'Amtsgericht Bochum ...', CURRENT_DATE - 9, 'uebernommen');

UPDATE feldmark.sichtpruefung_warteschlange
SET    uebernommen_als_fall_id = 'PF-2026-9001',
       geprueft_von = 'bearbeiter@example.com',
       geprueft_am  = now() - interval '2 days'
WHERE  dateiname = 'geprueft_beispiel.jpg';

-- =====================================================================
--  Nuetzliche Abfragen fuer den Test
-- =====================================================================

-- Offene Warteschlange, aeltester Fall zuerst:
--   SELECT id, dateiname, dokumenttyp, einordnung, plausibilitaet_ok, routing_gruende, erzeugt_am
--   FROM   feldmark.sichtpruefung_warteschlange
--   WHERE  status = 'offen'
--   ORDER  BY erzeugt_am;

-- Zuruecksetzen fuer einen erneuten Testlauf:
--   TRUNCATE feldmark.sichtpruefung_warteschlange;
--   (danach die INSERT/UPDATE-Bloecke oben erneut ausfuehren)
