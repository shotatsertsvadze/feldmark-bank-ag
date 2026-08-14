-- =====================================================================
--  Feldmark Bank AG — Pfaendungsprozess, Datendiskrepanz-Workflow
--  (Sollkonzept Abschnitt 3.1, "Ast A — Datendiskrepanz, parallel zur Frist")
--
--  Scope-Praezisierung gegenueber dem Sollkonzept: die dort beschriebene
--  Trefferhierarchie (IBAN/Kontonummer, Name+Geburtsdatum+Adresse, ...)
--  setzt einen Abgleich gegen einen echten Kernbank-Kundenstamm voraus,
--  den dieses Projekt nicht hat (kein Kernbank-API angebunden, siehe
--  KONTEXT.md/Sollkonzept Annahme A7). Die hier umgesetzte Version deckt
--  den in diesem System tatsaechlich erreichbaren Fall ab: ein Dokument
--  ist mit ausreichender Konfidenz ein Pfaendungsschreiben (o.ae.), hat
--  Aktenzeichen UND Glaeubiger, aber `pfaendung.schuldner_name` fehlt in
--  der Extraktion. Faelle mit fehlendem Aktenzeichen oder Glaeubiger
--  bleiben unveraendert in der generischen Sichtpruefung, weil ohne diese
--  beiden Angaben keine sinnvolle Rueckfrage an den Glaeubiger moeglich
--  ist (Rueckfrage braucht "unser Aktenzeichen, sein Aktenzeichen").
--
--  Additive 1:1-Erweiterung zu feldmark.pfaendung_faelle, gleiches Muster
--  wie feldmark.pfaendung_erweiterung (P-Konto/Drittschuldnererklaerung) -
--  die Faelle-Tabelle selbst bleibt bis auf die bereits erweiterte
--  status-CHECK-Constraint unangetastet.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

CREATE TABLE IF NOT EXISTS feldmark.pfaendung_datendiskrepanz (
    fall_id                        text        PRIMARY KEY
                                    REFERENCES feldmark.pfaendung_faelle (fall_id),

    -- A1: sofortige strukturierte Rueckfrage an den Glaeubiger. Der
    -- eigentliche Versand ist Platzhalter (kein E-Mail-Kanal angebunden,
    -- gleiches Prinzip wie beim Drittschuldnererklaerung-Versand) - der
    -- Text wird vollstaendig erzeugt und gespeichert.
    rueckfrage_text                text        NOT NULL,
    rueckfrage_gesendet_am         timestamptz NOT NULL DEFAULT now(),

    -- A2: zwei automatische Nachfassungen, Tag 3 und Tag 6 nach der
    -- Rueckfrage (nicht nach Zustelldatum - siehe datendiskrepanz.js).
    nachfassung_1_text             text,
    nachfassung_1_gesendet_am      timestamptz,
    nachfassung_2_text             text,
    nachfassung_2_gesendet_am      timestamptz,

    -- A3: spaetestens Tag 10 der Gesamtfrist wird unabhaengig vom
    -- Klaerungsstand fristwahrend erklaert - die vierte, im urspruenglichen
    -- P-Konto-Baustein bewusst nicht implementierte Erklaerungsvariante
    -- (siehe Docstring-Kommentar in server/pkonto_drittschuldner.js), hier
    -- jetzt erreichbar. Der Text selbst landet NICHT hier, sondern wird
    -- ueber db.speichereErklaerung() in feldmark.pfaendung_erweiterung
    -- geschrieben - Wiederverwendung der bereits gebauten und getesteten
    -- Freigabe-/Versand-Pipeline statt einer zweiten, parallelen. Diese
    -- Spalte ist nur der Ausloese-Zeitstempel (Idempotenz: nicht zweimal
    -- pro Sweep-Lauf ausloesen).
    fristwahrend_erklaert_am       timestamptz,

    -- A4a: Antwort kommt (auch nach der fristwahrenden Erklaerung noch
    -- moeglich) - Fall wird reaktiviert, echter Schuldnername nachgetragen.
    geklaert_am                    timestamptz,
    geklaert_schuldner_name        text,
    geklaert_von                   text,

    -- A4b: keine Antwort innerhalb von 30 Tagen ab Rueckfrage - Fall wird
    -- geschlossen, Grund dokumentiert (Vermerk statt stiller Karteileiche).
    geschlossen_am                 timestamptz,
    geschlossen_grund              text
);

COMMENT ON TABLE feldmark.pfaendung_datendiskrepanz IS
    '1:1-Erweiterung zu feldmark.pfaendung_faelle fuer den Datendiskrepanz-
     Workflow (Sollkonzept 3.1, Ast A). Ein Fall mit einer offenen Zeile
     hier (geklaert_am UND geschlossen_am beide NULL) hat einen Platzhalter
     als schuldner in feldmark.pfaendung_faelle stehen und laeuft parallel
     zur normalen Fristueberwachung, statt sie zu blockieren.';

COMMENT ON COLUMN feldmark.pfaendung_datendiskrepanz.nachfassung_1_gesendet_am IS
    'Faellig 3 Tage nach rueckfrage_gesendet_am - Zeitanker ist die
     Rueckfrage, nicht das Zustelldatum des Ursprungsschreibens.';
