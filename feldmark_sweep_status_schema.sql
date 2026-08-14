-- =====================================================================
--  Feldmark Bank AG — Sweep-Status (n8n-Betriebsanzeige)
--
--  Zeigt in der App an, wann der taegliche n8n-Sweep zuletzt lief und ob
--  er erfolgreich war - ohne dass die App selbst eine Verbindung zur
--  n8n-API braucht. Stattdessen schreibt n8n direkt hierher, exakt
--  dasselbe Muster wie ueberall sonst im Projekt (n8n schreibt, die App
--  liest nur ueber Postgres).
--
--  Bewusst OPTIMISTISCH: Jeder Sweep (Pfaendung, Auskunftsersuchen)
--  schreibt "erfolgreich" direkt beim Start, parallel zur eigentlichen
--  Sweep-Logik - nicht erst am Ende, weil die bestehenden Workflows viele
--  parallele Endzweige haben (Erinnerung/Eskalation/Datendiskrepanz-
--  Aeste) und ein echter "alles fertig"-Knoten dafuer alle Zweige ueber
--  Merge-Nodes zusammenfuehren muesste - ein invasiver Umbau eines
--  bereits laufenden, taeglich aktiven Workflows fuer wenig Mehrwert.
--  Schlaegt der Lauf danach tatsaechlich fehl, ueberschreibt der
--  gemeinsame Fehler-Alert-Workflow (VASVi0WFdgXR2OSb, feuert ueber
--  n8ns Error-Trigger-Mechanismus bei jedem Fehler in einer der beiden
--  Sweeps) denselben Datensatz auf "fehler" - fuer einen einmal taeglich
--  laufenden Batch-Job ist die kurze Zeitspanne zwischen "gestartet" und
--  "wirklich fertig" praktisch vernachlaessigbar.
--
--  Einmalig ausfuehren. Getestet gegen PostgreSQL 15/16.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS feldmark;

CREATE TABLE IF NOT EXISTS feldmark.sweep_status (
    sweep_name          text PRIMARY KEY,
    status              text NOT NULL CHECK (status IN ('erfolgreich', 'fehler')),
    zuletzt_gelaufen_am timestamptz NOT NULL DEFAULT now(),
    meldung             text
);

COMMENT ON TABLE feldmark.sweep_status IS
    'Wird von den n8n-Sweeps selbst geschrieben (nicht von der App) - optimistisch
     "erfolgreich" direkt beim Start jedes Laufs, vom gemeinsamen Fehler-Alert-
     Workflow auf "fehler" ueberschrieben, falls der Lauf danach tatsaechlich
     abbricht.';

-- ---------------------------------------------------------------------
-- Nuetzliche Abfragen
-- ---------------------------------------------------------------------

-- Aktueller Stand beider Sweeps:
--   SELECT sweep_name, status, zuletzt_gelaufen_am, meldung
--   FROM   feldmark.sweep_status
--   ORDER  BY sweep_name;

-- Zuruecksetzen fuer einen Testlauf:
--   DELETE FROM feldmark.sweep_status;
