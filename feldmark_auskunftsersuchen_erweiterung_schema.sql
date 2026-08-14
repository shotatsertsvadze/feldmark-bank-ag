-- =====================================================================
--  Feldmark Bank AG — Auskunftsersuchen, Erweiterung Ast E
--  (Compliance-Einbindung, strukturierte Antwort, bedingte Kontosperre)
--
--  Umsetzung von Pfaendungsprozess_Analyse_Sollkonzept.html, Abschnitt 3.5
--  "Ast E — Polizei und Staatsanwaltschaft" (E1-E5). War spezifiziert, aber
--  nicht implementiert - der Auskunftsersuchen-Block hatte bisher keinen
--  vergleichbaren Bearbeitungsschritt wie die Drittschuldnererklaerung im
--  Pfaendungsblock (siehe KONTEXT.md fuer die Redesign-Analyse).
--
--  Separate Tabelle statt neuer Spalten in feldmark.auskunftsersuchen_faelle:
--  gleiches Muster wie feldmark.pfaendung_erweiterung - additiv, 1:1,
--  bestehende Tabelle/Abfragen bleiben unangetastet.
--
--  Wichtige fachliche Klarstellung (Sollkonzept 2.5, E5): eine Kontosperre
--  ist bei einem REINEN Auskunftsersuchen NICHT automatisch gerechtfertigt -
--  nur wenn das Schreiben selbst eine Beschlagnahme oder einen Arrest
--  traegt. Diese Tabelle bildet deshalb eine EXPLIZITE, protokollierte
--  Entscheidung ab (sperre_rechtsgrundlage_vorhanden, Default false), kein
--  automatisches Sperr-Kommando - das System hat ohnehin keine Kernbank-
--  Anbindung, die eine echte Sperre technisch ausloesen koennte (Annahme
--  A7/A8, wie an anderer Stelle im Projekt).
--
--  Einmalig ausfuehren. Getestet gegen PostgreSQL 15/16/17.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

CREATE TABLE IF NOT EXISTS feldmark.auskunftsersuchen_erweiterung (
    fall_id                          text        PRIMARY KEY
                                      REFERENCES feldmark.auskunftsersuchen_faelle (fall_id),

    -- Aus der Klassifikation uebernommen (kopf.rechtsgrundlage), bisher von
    -- legeAuskunftsersuchenFallAn() verworfen - wird jetzt mitgefuehrt, weil
    -- die Antwort sie zitieren muss (welche Vorschrift traegt das Ersuchen).
    rechtsgrundlage                  text[]      NOT NULL DEFAULT '{}',

    -- E2: Compliance wird bei Fallanlage informiert, nicht erst bei
    -- Bearbeitung - Zeitstempel wird sofort beim INSERT gesetzt (siehe
    -- server/db.js), nicht erst bei einer spaeteren Mitarbeiteraktion.
    -- Kein echter Benachrichtigungskanal, gleiches "Zeitstempel als
    -- Nachweis"-Prinzip wie ueberall sonst im Projekt.
    compliance_informiert_am         timestamptz,

    -- E3: Rechtsgrundlagenpruefung - bewusst manuell, Ermessensfrage.
    -- freizugebende_punkte ist eine Teilmenge von
    -- auskunftsersuchen_faelle.angefragte_punkte.
    freizugebende_punkte             text[],
    rechtsgrundlage_geprueft_von     text,
    rechtsgrundlage_geprueft_am      timestamptz,

    -- Antwortinhalte je angefragtem Punkt, manuell erfasst (keine Kernbank-
    -- API angebunden, Annahme A7 wie beim P-Konto-Ergaenzungskonzept).
    -- jsonb statt Kindtabelle: variable Punktzahl pro Fall, rein
    -- deterministische Weiterverarbeitung, kein Abfragebedarf einzelner
    -- Punkte ausserhalb dieses Falls.
    antwort_werte                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- E4: erzeugte Antwort + Freigabe-/Versand-Trennung mit Vier-Augen,
    -- exakt dasselbe Muster wie erklaerung_* in feldmark.pfaendung_erweiterung.
    antwort_text                     text,
    antwort_erzeugt_am               timestamptz,
    antwort_freigegeben_von          text,
    antwort_freigegeben_am           timestamptz,
    antwort_versendet_von            text,
    antwort_versendet_am             timestamptz,

    -- E5: Kontosperre nur bei eigener Rechtsgrundlage (Beschlagnahme/Arrest),
    -- nicht automatisch bei jedem Auskunftsersuchen. Default false ist
    -- bewusst der "sichere" Default - eine Sperre muss aktiv begruendet
    -- werden, keine Sperre braucht keine Begruendung.
    sperre_rechtsgrundlage_vorhanden boolean     NOT NULL DEFAULT false,
    sperre_begruendung               text,
    sperre_entschieden_von           text,
    sperre_entschieden_am            timestamptz
);

COMMENT ON TABLE feldmark.auskunftsersuchen_erweiterung IS
    '1:1-Erweiterung zu feldmark.auskunftsersuchen_faelle fuer Ast E
     (Compliance, strukturierte Antwort, bedingte Kontosperre). Siehe
     Pfaendungsprozess_Analyse_Sollkonzept.html Abschnitt 3.5.';

COMMENT ON COLUMN feldmark.auskunftsersuchen_erweiterung.sperre_rechtsgrundlage_vorhanden IS
    'Nur true, wenn das Schreiben selbst eine Beschlagnahme oder einen Arrest
     traegt - ein reines Auskunftsersuchen fuehrt zu keiner Sperre
     (Sollkonzept 2.5/E5, "Offener Punkt fuer Legal/Compliance"). Bildet nur
     die Entscheidung ab, loest keine echte Kontosperre aus - keine
     Kernbank-Anbindung vorhanden.';

COMMENT ON COLUMN feldmark.auskunftsersuchen_erweiterung.antwort_versendet_am IS
    'Zweiter Schritt nach Freigabe: Mitarbeiter bestaetigt manuell den
     tatsaechlichen Versand. Erst dieser Zeitstempel setzt fall.status auf
     "Antwort versandt" (Wert war im urspruenglichen CHECK-Constraint bereits
     vorgesehen, siehe feldmark_auskunftsersuchen_schema.sql).';

-- ---------------------------------------------------------------------
-- Status-CHECK-Constraint um den neuen Zwischenstatus erweitern, analog
-- zum bereits einmal gemachten Fix bei feldmark.pfaendung_faelle (siehe
-- KONTEXT.md, "Selbst-Code-Review nach dem Redesign") - diesmal direkt bei
-- der Einfuehrung nachgezogen statt erst nach einem Live-Fehler.
-- ---------------------------------------------------------------------
ALTER TABLE feldmark.auskunftsersuchen_faelle DROP CONSTRAINT IF EXISTS feldmark_auskunftsersuchen_faelle_status_check;
ALTER TABLE feldmark.auskunftsersuchen_faelle ADD CONSTRAINT feldmark_auskunftsersuchen_faelle_status_check
    CHECK (status IN ('Eingegangen',
                       'In Bearbeitung',
                       'Geprueft',
                       'Antwort freigegeben',
                       'Antwort versandt',
                       'Abgeschlossen',
                       'Abgeschlossen mit Fristversaeumnis'));

-- Bestehende Faelle ohne Erweiterungszeile nachziehen (Testdaten aus
-- feldmark_auskunftsersuchen_schema.sql), damit die Detailansicht fuer sie
-- funktioniert. compliance_informiert_am bewusst NICHT rueckwirkend
-- gesetzt - das waere ein falscher Nachweis fuer ein Ereignis, das nie
-- stattgefunden hat.
INSERT INTO feldmark.auskunftsersuchen_erweiterung (fall_id)
SELECT fall_id FROM feldmark.auskunftsersuchen_faelle
ON CONFLICT (fall_id) DO NOTHING;
