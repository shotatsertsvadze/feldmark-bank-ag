-- =====================================================================
--  Feldmark Bank AG — Sichtpruefungs-Warteschlange
--  Schema + Testdaten
--
--  Typ-unabhaengiger Sammelpunkt fuer alles, was laut Konfidenz-/
--  Plausibilitaets-Routing (klassifikations_schema.md) KEIN Autofall wird:
--  konfidenz_typ < 70, plausibilitaet_ok = false, dokumenttyp = sonstiges,
--  oder erinnerungsschreiben ohne auffindbares bezug_aktenzeichen.
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

DROP TABLE IF EXISTS feldmark.sichtpruefung_warteschlange;

CREATE TABLE feldmark.sichtpruefung_warteschlange (
    id                    uuid        PRIMARY KEY,
    dateiname             text        NOT NULL,
    dokumenttyp           text        NOT NULL
                          CHECK (dokumenttyp IN ('pfaendungsschreiben',
                                                  'auskunftsersuchen',
                                                  'einziehungsverfuegung',
                                                  'ueberweisungsverfuegung',
                                                  'erinnerungsschreiben',
                                                  'sonstiges')),
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
    geprueft_am           timestamptz,
    erzeugt_am            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sichtpruefung_status ON feldmark.sichtpruefung_warteschlange (status, erzeugt_am);

COMMENT ON COLUMN feldmark.sichtpruefung_warteschlange.eingangsdatum IS
    'Wie bei den Faelle-Tabellen: kommt aus Scan-/E-Mail-Metadaten, nie aus
     dem Dokumenttext oder vom Modell erfunden. Kann hier NULL sein, wenn
     der Upload das (noch) nicht mitliefert.';

-- ---------------------------------------------------------------------
-- Testdaten — je ein Vertreter pro Routing-Grund, plus die zwei echten
-- Testfaelle aus Schritt 2 (Betriebsrat-Wahlliste, Antwort_ZIS_2016).
-- ---------------------------------------------------------------------
INSERT INTO feldmark.sichtpruefung_warteschlange
    (id, dateiname, dokumenttyp, konfidenz_typ, plausibilitaet_ok,
     plausibilitaet_begruendung, routing_gruende, klassifikation,
     rohtext_auszug, eingangsdatum, status)
VALUES
    -- niedrige Typ-Konfidenz
    (gen_random_uuid(), 'unklarer_scan.jpg', 'pfaendungsschreiben', 55, true,
     'Stempel und Unterschrift teilweise unleserlich.',
     ARRAY['konfidenz_typ (55) unter Schwelle 70'],
     '{"dokumenttyp":"pfaendungsschreiben","konfidenz_typ":55}'::jsonb,
     'Amtsgericht ... (Rest schwer lesbar)', CURRENT_DATE - 1, 'offen'),

    -- Wortreffer ohne passende Struktur - der Betriebsrat-Testfall aus Schritt 2
    (gen_random_uuid(), 'auskunftsersuchen-beim-arbeitgeber-zur-aufstellung-der-wahlerliste.jpg',
     'sonstiges', 95, false,
     'Kein bankbezogenes Vollstreckungs- oder Ermittlungsersuchen erkennbar.',
     ARRAY['plausibilitaet_ok = false', 'dokumenttyp = sonstiges, nie Autofall'],
     '{"dokumenttyp":"sonstiges","konfidenz_typ":95,"plausibilitaet_ok":false}'::jsonb,
     'Muster: Auskunftsersuchen beim Arbeitgeber zur Aufstellung der Wählerliste ...',
     CURRENT_DATE - 2, 'offen'),

    -- zweiter Plausibilitaets-Testfall aus Schritt 2
    (gen_random_uuid(), 'Antwort_ZIS_2016.jpeg', 'sonstiges', 100, false,
     'Kein bankbezogener Vollstreckungs- oder Ermittlungsinhalt erkennbar, Absender ist eine Polizeibehörde ohne Bezug zu Bankangelegenheiten.',
     ARRAY['plausibilitaet_ok = false', 'dokumenttyp = sonstiges, nie Autofall'],
     '{"dokumenttyp":"sonstiges","konfidenz_typ":100,"plausibilitaet_ok":false}'::jsonb,
     'Landesamt für Zentrale Polizeiliche Dienste Nordrhein-Westfalen ...',
     CURRENT_DATE - 3, 'offen'),

    -- Erinnerungsschreiben ohne auffindbares Aktenzeichen im Bestand
    (gen_random_uuid(), 'erinnerung_unbekannt.pdf', 'erinnerungsschreiben', 90, true,
     'Formal ein Erinnerungsschreiben, Bezugsaktenzeichen aber in keiner Falltabelle vorhanden.',
     ARRAY['erinnerungsschreiben: Aktenzeichen-Abgleich gegen Bestand fehlt/erfolglos'],
     '{"dokumenttyp":"erinnerungsschreiben","konfidenz_typ":90,"erinnerung":{"bezug_aktenzeichen":"99 M 0000/26"}}'::jsonb,
     'Erinnerung an unser Schreiben vom ... Az. 99 M 0000/26', CURRENT_DATE - 1, 'offen'),

    -- bereits geprueft und uebernommen - zeigt den Abschluss-Zustand
    (gen_random_uuid(), 'geprueft_beispiel.jpg', 'pfaendungsschreiben', 60, true,
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
--   SELECT id, dateiname, dokumenttyp, plausibilitaet_ok, routing_gruende, erzeugt_am
--   FROM   feldmark.sichtpruefung_warteschlange
--   WHERE  status = 'offen'
--   ORDER  BY erzeugt_am;

-- Zuruecksetzen fuer einen erneuten Testlauf:
--   TRUNCATE feldmark.sichtpruefung_warteschlange;
--   (danach die INSERT/UPDATE-Bloecke oben erneut ausfuehren)
