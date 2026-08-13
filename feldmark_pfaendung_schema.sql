-- =====================================================================
--  Feldmark Bank AG — Pfaendungsprozess, Pilot Fristueberwachung
--  Schema + Testdaten fuer den n8n-Workflow
--  "Feldmark Bank AG — Pfaendung: Fristueberwachung (Postgres)"
--
--  Einmalig ausfuehren, danach den Workflow importieren.
--  Getestet gegen PostgreSQL 15/16.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fallakte — der Bestand, ueber den der taegliche Sweep laeuft
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS feldmark_pfaendung_protokoll;
DROP TABLE IF EXISTS feldmark_pfaendung_faelle;

CREATE TABLE feldmark_pfaendung_faelle (
    fall_id               text PRIMARY KEY,
    aktenzeichen          text        NOT NULL,
    glaeubiger            text        NOT NULL,
    schuldner             text        NOT NULL,
    zustelldatum          date        NOT NULL,
    zustellkanal          text        NOT NULL
                          CHECK (zustellkanal IN ('Papier', 'eBO', 'E-Mail', 'Fax')),
    status                text        NOT NULL
                          -- 'Erklaerung freigegeben' kam mit dem Freigabe-/
                          -- Versand-Trennung-Redesign hinzu (siehe KONTEXT.md)
                          -- - live auf Supabase per ALTER TABLE nachgezogen,
                          -- hier ebenfalls ergaenzt, damit eine frische
                          -- Provisionierung aus dieser Datei nicht denselben
                          -- CHECK-Constraint-Fehler reproduziert.
                          CHECK (status IN ('Eingegangen',
                                            'In Bearbeitung',
                                            'Geprueft',
                                            'Erklaerung freigegeben',
                                            'Erklaerung versandt',
                                            'Abgeschlossen',
                                            'Abgeschlossen mit Fristversaeumnis')),
    -- Das Feld traegt die Idempotenz: was hier drinsteht, wird nicht wiederholt.
    erinnerungen_gesendet text[]      NOT NULL DEFAULT '{}',
    bearbeiter_email      text        NOT NULL,
    vertretung_email      text,
    vorgesetzte_email     text,
    angelegt_am           timestamptz NOT NULL DEFAULT now(),
    letzte_aktion_am      timestamptz
);

COMMENT ON COLUMN feldmark_pfaendung_faelle.zustelldatum IS
    'Fristbeginn nach § 840 ZPO. Papier = Eingangsstempel, eBO = Zustellzeitpunkt.
     Verbindliche Festlegung steht noch aus (offener Punkt fuer Legal).';

-- ---------------------------------------------------------------------
-- 2) Protokoll — Nachweis je Ereignis, zugleich die KPI-Basis
-- ---------------------------------------------------------------------
CREATE TABLE feldmark_pfaendung_protokoll (
    id         bigserial PRIMARY KEY,
    fall_id    text        NOT NULL REFERENCES feldmark_pfaendung_faelle (fall_id),
    ereignis   text        NOT NULL,
    fristende  date        NOT NULL,
    rest_tage  integer     NOT NULL,
    empfaenger text,
    prioritaet text,
    erzeugt_am timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_protokoll_fall ON feldmark_pfaendung_protokoll (fall_id, erzeugt_am DESC);
CREATE INDEX idx_protokoll_ereignis ON feldmark_pfaendung_protokoll (ereignis, erzeugt_am DESC);

-- ---------------------------------------------------------------------
-- 3) Testdaten — je ein Vertreter pro Entscheidungspfad
--    Die Zustelldaten sind relativ zu CURRENT_DATE gesetzt, damit alle
--    Zweige feuern, egal wann du das Skript ausfuehrst.
-- ---------------------------------------------------------------------
INSERT INTO feldmark_pfaendung_faelle
    (fall_id, aktenzeichen, glaeubiger, schuldner, zustelldatum, zustellkanal,
     status, erinnerungen_gesendet, bearbeiter_email, vertretung_email, vorgesetzte_email)
VALUES
    -- heute zugestellt, noch nichts passiert            -> Erinnerung 1
    ('PF-2026-0481', '12 M 3341/26', 'Finanzamt Berlin-Mitte', 'M. Keller',
     CURRENT_DATE - 0,  'eBO',    'Eingegangen',    '{}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 11 Tagen, Erinnerung 1 lief bereits           -> Erinnerung 2
    ('PF-2026-0463', '7 M 1180/26',  'Stadtkasse Hamburg',    'A. Roth',
     CURRENT_DATE - 11, 'Papier', 'In Bearbeitung', '{erinnerung_1}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 13 Tagen, beide Erinnerungen liefen           -> Eskalation
    ('PF-2026-0455', '4 M 9021/26',  'Inkasso Nord GmbH',     'S. Braun',
     CURRENT_DATE - 13, 'E-Mail', 'Geprueft',       '{erinnerung_1,erinnerung_2}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 17 Tagen, Frist gerissen                      -> Fristversaeumnis
    ('PF-2026-0440', '9 M 4407/26',  'Hauptzollamt Berlin',   'T. Lang',
     CURRENT_DATE - 17, 'Papier', 'In Bearbeitung', '{erinnerung_1,erinnerung_2,eskalation}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- Erklaerung raus                                   -> vom SELECT gar nicht geladen
    ('PF-2026-0470', '2 M 7712/26',  'AOK Nordost',           'K. Diaz',
     CURRENT_DATE - 5,  'eBO',    'Erklaerung versandt', '{erinnerung_1}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com'),

    -- vor 8 Tagen, Erinnerung 1 raus, noch Puffer       -> kein Handlungsbedarf
    ('PF-2026-0462', '5 M 2298/26',  'Amtsgericht Potsdam',   'R. Vogt',
     CURRENT_DATE - 8,  'Papier', 'In Bearbeitung', '{erinnerung_1}',
     'bearbeiter@example.com', 'vertretung@example.com', 'teamlead@example.com');

-- =====================================================================
--  Nuetzliche Abfragen fuer den Test
-- =====================================================================

-- Was der Workflow sieht:
--   SELECT fall_id, zustelldatum, status, erinnerungen_gesendet
--   FROM   feldmark_pfaendung_faelle
--   WHERE  status NOT IN ('Erklaerung versandt','Abgeschlossen',
--                         'Abgeschlossen mit Fristversaeumnis')
--   ORDER  BY zustelldatum;

-- Was der Workflow geschrieben hat:
--   SELECT * FROM feldmark_pfaendung_protokoll ORDER BY erzeugt_am DESC;

-- KPI: Fristeinhaltungsquote ueber alle abgeschlossenen Faelle
--   SELECT round(100.0 * count(*) FILTER (
--            WHERE status <> 'Abgeschlossen mit Fristversaeumnis')
--          / nullif(count(*), 0), 1) AS fristeinhaltung_prozent
--   FROM   feldmark_pfaendung_faelle
--   WHERE  status IN ('Erklaerung versandt','Abgeschlossen',
--                     'Abgeschlossen mit Fristversaeumnis');

-- Zuruecksetzen fuer einen erneuten Testlauf:
--   TRUNCATE feldmark_pfaendung_protokoll;
--   UPDATE feldmark_pfaendung_faelle
--   SET    erinnerungen_gesendet = CASE fall_id
--            WHEN 'PF-2026-0481' THEN '{}'::text[]
--            WHEN 'PF-2026-0463' THEN '{erinnerung_1}'::text[]
--            WHEN 'PF-2026-0455' THEN '{erinnerung_1,erinnerung_2}'::text[]
--            WHEN 'PF-2026-0440' THEN '{erinnerung_1,erinnerung_2,eskalation}'::text[]
--            ELSE '{erinnerung_1}'::text[] END,
--          status = CASE fall_id
--            WHEN 'PF-2026-0481' THEN 'Eingegangen'
--            WHEN 'PF-2026-0455' THEN 'Geprueft'
--            WHEN 'PF-2026-0470' THEN 'Erklaerung versandt'
--            ELSE 'In Bearbeitung' END,
--          letzte_aktion_am = NULL;
