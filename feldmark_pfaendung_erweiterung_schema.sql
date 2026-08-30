-- =====================================================================
--  Feldmark Bank AG — Pfaendungsprozess, Erweiterung P-Konto +
--  automatisierte Drittschuldnererklaerung
--
--  Separate Tabelle statt neuer Spalten in feldmark.pfaendung_faelle:
--  Diese Tabelle bleibt laut fruehrer Entscheidung unveraendert, um den
--  bereits getesteten n8n-Fristueberwachungs-Workflow nicht anzufassen
--  (SELECT * dort wuerde neue Spalten zwar vertragen, aber das Risiko ist
--  unnoetig, wenn eine 1:1-Erweiterungstabelle denselben Zweck erfuellt).
--
--  Bewusst NICHT gespeichert: pfaendbarer_betrag, pfaendungsrang,
--  andere_offene_pfaendungen. Alle drei sind reine Funktionen anderer
--  Werte (guthaben_eur, ist_p_konto, Zustelldatum anderer offener Faelle
--  desselben Schuldners) und werden zur Laufzeit berechnet statt
--  gespeichert-und-synchronisiert — sonst entsteht genau die Art von
--  Stale-Data-Bug, die an anderer Stelle im Projekt bereits gefunden
--  und behoben wurde (siehe KONTEXT.md, "Zwei echte Bugs").
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

CREATE TABLE IF NOT EXISTS feldmark.pfaendung_erweiterung (
    fall_id                      text        PRIMARY KEY
                                  REFERENCES feldmark.pfaendung_faelle (fall_id),

    -- Aus der Klassifikation uebernommen, bisher von legePfaendungsfallAn()
    -- verworfen (siehe server/db.js) — wird jetzt hier mitgefuehrt, weil
    -- die Pfaendbarkeitsberechnung und die Erklaerung beides brauchen.
    forderung_gesamt_eur         numeric(12,2),
    konfidenz_betrag             integer,

    -- P-Konto (§§ 899 ff. ZPO)
    ist_p_konto                  boolean     NOT NULL DEFAULT false,
    -- Tri-State-Marker, getrennt von ist_p_konto: "noch nicht geprueft" ist
    -- ein eigener Zustand (Code-Review-Fund 2026-08-27 - vorher war ein
    -- unberuehrtes ist_p_konto=false ununterscheidbar von einer bewussten
    -- "kein P-Konto"-Entscheidung, wodurch das Speichern des Guthabens
    -- allein schon die P-Konto-Benachrichtigung ausloesen konnte).
    p_konto_geprueft             boolean     NOT NULL DEFAULT false,
    p_konto_freibetrag_erhoehung numeric(12,2) NOT NULL DEFAULT 0,
    p_konto_benachrichtigt_am    timestamptz,

    -- Guthaben: manuell erfasst, da keine echte Kernbank-API angebunden
    -- ist (siehe Sollkonzept, Annahme A7). In einer echten Umsetzung
    -- kaeme dieser Wert per API-Abfrage statt per Formular.
    guthaben_eur                 numeric(12,2),
    guthaben_erfasst_am          timestamptz,
    guthaben_erfasst_von         text,

    -- Unpfaendbarkeit nach § 907 ZPO und Kontoart (P-Konto/Gemeinschafts-
    -- konto) - zwei der fuenf nach § 840 Abs. 2 ZPO fuer Kontopfaendungen
    -- vorgeschriebenen Angaben, die bisher in der Erklaerung fehlten.
    -- Gleicher Tri-State-Aufbau wie p_konto_geprueft oben: "noch nicht
    -- geprueft" muss von einer bewussten Verneinung unterscheidbar sein,
    -- sonst kann die Erklaerung mit unbestaetigten Angaben generiert werden.
    unpfaendbarkeit_907_geprueft      boolean     NOT NULL DEFAULT false,
    unpfaendbarkeit_907_festgestellt_am date,
    gemeinschaftskonto_geprueft       boolean     NOT NULL DEFAULT false,
    ist_gemeinschaftskonto            boolean     NOT NULL DEFAULT false,

    -- Erzeugte Drittschuldnererklaerung (§ 840 ZPO) — Text plus
    -- Freigabe-/Versand-Nachweis (zwei getrennte Schritte seit dem
    -- Freigabe-/Versand-Trennung-Redesign, siehe KONTEXT.md), zusaetzlich
    -- Grundlage der weichen Vier-Augen-Warnung (guthaben_erfasst_von vs.
    -- erklaerung_freigegeben_von).
    erklaerung_text              text,
    erklaerung_erzeugt_am        timestamptz,
    erklaerung_freigegeben_von   text,
    erklaerung_freigegeben_am    timestamptz,
    erklaerung_versendet_von     text,
    erklaerung_versendet_am      timestamptz
);

COMMENT ON TABLE feldmark.pfaendung_erweiterung IS
    '1:1-Erweiterung zu feldmark.pfaendung_faelle fuer P-Konto-Pruefung und
     automatisierte Drittschuldnererklaerung (§ 840 ZPO).';

COMMENT ON COLUMN feldmark.pfaendung_erweiterung.unpfaendbarkeit_907_festgestellt_am IS
    'NULL = nicht festgestellt (oder noch nicht geprueft, siehe
     unpfaendbarkeit_907_geprueft). Ein Datum bedeutet: an diesem Tag wurde
     die Unpfaendbarkeit des Guthabens nach § 907 ZPO festgesetzt - "in den
     letzten zwoelf Monaten" wird bei Erzeugung der Erklaerung gegen das
     aktuelle Datum berechnet, nicht als eigenes Bool gespeichert (sonst
     wird der Wert nach zwoelf Monaten still falsch).';

COMMENT ON COLUMN feldmark.pfaendung_erweiterung.guthaben_erfasst_von IS
    'Kuerzel/E-Mail der Person, die das Guthaben zuletzt gespeichert hat.
     Grundlage fuer die weiche Vier-Augen-Warnung bei Freigabe (kein
     echtes Auth-System vorhanden, siehe KONTEXT.md).';

COMMENT ON COLUMN feldmark.pfaendung_erweiterung.erklaerung_versendet_am IS
    'Zweiter Schritt nach Freigabe: Mitarbeiter bestaetigt manuell den
     tatsaechlichen Versand (kein echter Versand-Kanal angebunden). Erst
     dieser Zeitstempel setzt fall.status auf "Erklaerung versandt".';

COMMENT ON COLUMN feldmark.pfaendung_erweiterung.p_konto_freibetrag_erhoehung IS
    'Summe der Erhoehungsbetraege ueber den Grundfreibetrag hinaus, aus
     geprueften Bescheinigungen (Unterhaltspflichten, Kindergeld etc.).
     Grundfreibetrag selbst (1.590,00 EUR ab 1.7.2026) ist Code-Konstante,
     nicht gespeichert, da er sich per Gesetz aendert und nicht pro Fall.';
