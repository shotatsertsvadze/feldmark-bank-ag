-- =====================================================================
--  Feldmark Bank AG — Auskunftsersuchen (StA/Ermittlungsbehoerden)
--  Schema + Testdaten
--
--  Eigene Tabelle statt Erweiterung von feldmark.pfaendung_faelle:
--  Auskunftsersuchen hat andere Kernfelder (Ermittlungsbehoerde + betroffene
--  Person statt Glaeubiger/Schuldner) und eine andere Fristlogik (14 Tage
--  nach § 161 StPO im Muster, nicht die ZPO-Fristen der Pfaendung).
--  feldmark.pfaendung_faelle und der bereits getestete n8n-Workflow dafuer
--  bleiben unveraendert.
--
--  Einmalig ausfuehren. Getestet gegen PostgreSQL 15/16.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

-- ---------------------------------------------------------------------
-- 1) Fallakte
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS feldmark.auskunftsersuchen_protokoll;
DROP TABLE IF EXISTS feldmark.auskunftsersuchen_faelle;

CREATE SEQUENCE IF NOT EXISTS feldmark.auskunftsersuchen_fall_seq;

CREATE TABLE feldmark.auskunftsersuchen_faelle (
    fall_id                       text PRIMARY KEY,
    aktenzeichen                  text        NOT NULL,
    ausstellende_behoerde         text        NOT NULL,
    betroffene_person_name        text        NOT NULL,
    betroffene_person_geburtsdatum date,
    tatvorwurf                    text,
    angefragte_punkte             text[]      NOT NULL DEFAULT '{}',
    vertraulich                   boolean     NOT NULL DEFAULT false,
    eingangsdatum                 date        NOT NULL,
    antwortfrist_tage             integer     NOT NULL,
    zustellkanal                  text        NOT NULL
                                  CHECK (zustellkanal IN ('Papier', 'eBO', 'E-Mail', 'Fax')),
    status                        text        NOT NULL
                                  CHECK (status IN ('Eingegangen',
                                                    'In Bearbeitung',
                                                    'Geprueft',
                                                    'Antwort versandt',
                                                    'Abgeschlossen',
                                                    'Abgeschlossen mit Fristversaeumnis')),
    -- Idempotenz, wie bei feldmark.pfaendung_faelle.
    erinnerungen_gesendet         text[]      NOT NULL DEFAULT '{}',
    bearbeiter_email              text        NOT NULL,
    vertretung_email              text,
    vorgesetzte_email             text,
    angelegt_am                   timestamptz NOT NULL DEFAULT now(),
    letzte_aktion_am              timestamptz
);

COMMENT ON COLUMN feldmark.auskunftsersuchen_faelle.eingangsdatum IS
    'Fristbeginn. Kommt ausschliesslich aus dem E-Mail-Header bzw. dem
     Scan-Eingangsstempel, nie aus dem Dokumenttext oder vom Modell erfunden -
     gleiches Prinzip wie zustelldatum in feldmark.pfaendung_faelle.';

COMMENT ON COLUMN feldmark.auskunftsersuchen_faelle.antwortfrist_tage IS
    'Aus dem Dokument extrahiert (Feld auskunftsersuchen.antwortfrist_tage im
     Klassifikationsschema). Fehlt dieser Wert, sollte der Fall NICHT
     automatisch angelegt werden, sondern in die Sichtpruefung gehen - ohne
     Frist keine Fristueberwachung moeglich.';

-- ---------------------------------------------------------------------
-- 2) Protokoll — gleiches Muster wie feldmark.pfaendung_protokoll.
--    Traegt auch die Vier-Augen-Pflicht (konfidenz_betrag entfaellt hier,
--    aber z.B. niedrige Extraktionsguete kann als eigenes Ereignis
--    vermerkt werden), damit keine der beiden Faelle-Tabellen fuer sowas
--    eigene Spalten braucht.
-- ---------------------------------------------------------------------
CREATE TABLE feldmark.auskunftsersuchen_protokoll (
    id         bigserial PRIMARY KEY,
    fall_id    text        NOT NULL REFERENCES feldmark.auskunftsersuchen_faelle (fall_id),
    ereignis   text        NOT NULL,
    fristende  date        NOT NULL,
    rest_tage  integer     NOT NULL,
    empfaenger text,
    prioritaet text,
    erzeugt_am timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ae_protokoll_fall ON feldmark.auskunftsersuchen_protokoll (fall_id, erzeugt_am DESC);
CREATE INDEX idx_ae_protokoll_ereignis ON feldmark.auskunftsersuchen_protokoll (ereignis, erzeugt_am DESC);

-- ---------------------------------------------------------------------
-- 3) Testdaten — je ein Vertreter pro Entscheidungspfad, analog zu
--    feldmark_pfaendung_schema.sql. antwortfrist_tage=14 wie im Muster
--    Auskunftsersuchen_StA_fiktiv.html. Eingangsdaten relativ zu
--    CURRENT_DATE, damit alle Zweige unabhaengig vom Ausfuehrungsdatum feuern.
-- ---------------------------------------------------------------------
INSERT INTO feldmark.auskunftsersuchen_faelle
    (fall_id, aktenzeichen, ausstellende_behoerde, betroffene_person_name,
     betroffene_person_geburtsdatum, tatvorwurf, angefragte_punkte, vertraulich,
     eingangsdatum, antwortfrist_tage, zustellkanal, status, erinnerungen_gesendet,
     bearbeiter_email, vertretung_email, vorgesetzte_email)
VALUES
    -- heute eingegangen, noch nichts passiert                    -> Erinnerung 1
    ('AE-2026-0118', '512 Js 4471/26', 'Staatsanwaltschaft Feldenau', 'Tobias Ahlgrimm',
     '1988-11-03', 'Betrug (§ 263 StGB)', ARRAY['Kontobestand', 'Kontostand', 'Kontobewegungen', 'Verfuegungsberechtigte'],
     true, CURRENT_DATE - 0, 14, 'E-Mail', 'Eingegangen', '{}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 8 Tagen, Erinnerung 1 lief bereits (Halbzeit bei 14 Tagen)  -> Erinnerung 2
    ('AE-2026-0107', '318 Js 2290/26', 'Staatsanwaltschaft Duisburg', 'Marlene Schäfer',
     '1975-06-21', 'Geldwäsche (§ 261 StGB)', ARRAY['Kontobewegungen', 'Verfuegungsberechtigte'],
     true, CURRENT_DATE - 8, 14, 'eBO', 'In Bearbeitung', '{erinnerung_1}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 11 Tagen, beide Erinnerungen liefen                    -> Eskalation
    ('AE-2026-0099', '77 Js 5510/26', 'Staatsanwaltschaft Bochum', 'Kerem Yılmaz',
     '1990-02-14', 'Untreue (§ 266 StGB)', ARRAY['Kontobestand', 'Kontostand'],
     false, CURRENT_DATE - 11, 14, 'Papier', 'Geprueft', '{erinnerung_1,erinnerung_2}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 15 Tagen, Frist gerissen (14 Tage ueberschritten)       -> Fristversaeumnis
    ('AE-2026-0084', '204 Js 1187/26', 'Staatsanwaltschaft Essen', 'Petra Lindgren',
     '1982-09-30', 'Betrug (§ 263 StGB)', ARRAY['Kontobewegungen'],
     true, CURRENT_DATE - 15, 14, 'Papier', 'In Bearbeitung', '{erinnerung_1,erinnerung_2,eskalation}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- Antwort raus                                                -> vom SELECT gar nicht geladen
    ('AE-2026-0110', '410 Js 3302/26', 'Staatsanwaltschaft Dortmund', 'Helena Vogt',
     '1979-12-05', 'Steuerhinterziehung (§ 370 AO)', ARRAY['Kontobestand', 'Kontobewegungen'],
     false, CURRENT_DATE - 6, 14, 'eBO', 'Antwort versandt', '{erinnerung_1}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 4 Tagen, noch Puffer                                    -> kein Handlungsbedarf
    ('AE-2026-0121', '88 Js 990/26', 'Staatsanwaltschaft Hagen', 'Jonas Brandt',
     '1995-04-17', 'Unterschlagung (§ 246 StGB)', ARRAY['Kontobestand'],
     false, CURRENT_DATE - 4, 14, 'E-Mail', 'In Bearbeitung', '{}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com');

-- =====================================================================
--  Nuetzliche Abfragen fuer den Test
-- =====================================================================

-- Was ein kuenftiger Fristüberwachungs-Workflow sehen würde:
--   SELECT fall_id, eingangsdatum, antwortfrist_tage, status, erinnerungen_gesendet
--   FROM   feldmark.auskunftsersuchen_faelle
--   WHERE  status NOT IN ('Antwort versandt','Abgeschlossen',
--                         'Abgeschlossen mit Fristversaeumnis')
--   ORDER  BY eingangsdatum;

-- Zuruecksetzen fuer einen erneuten Testlauf:
--   TRUNCATE feldmark.auskunftsersuchen_protokoll;
--   UPDATE feldmark.auskunftsersuchen_faelle
--   SET    erinnerungen_gesendet = CASE fall_id
--            WHEN 'AE-2026-0118' THEN '{}'::text[]
--            WHEN 'AE-2026-0107' THEN '{erinnerung_1}'::text[]
--            WHEN 'AE-2026-0099' THEN '{erinnerung_1,erinnerung_2}'::text[]
--            WHEN 'AE-2026-0084' THEN '{erinnerung_1,erinnerung_2,eskalation}'::text[]
--            ELSE '{erinnerung_1}'::text[] END,
--          status = CASE fall_id
--            WHEN 'AE-2026-0118' THEN 'Eingegangen'
--            WHEN 'AE-2026-0099' THEN 'Geprueft'
--            WHEN 'AE-2026-0110' THEN 'Antwort versandt'
--            ELSE 'In Bearbeitung' END,
--          letzte_aktion_am = NULL;
