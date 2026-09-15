-- =====================================================================
--  Feldmark Bank AG — Sweep-Status (n8n-Betriebsanzeige)
--
--  Zeigt in der App an, wann der taegliche n8n-Sweep zuletzt lief und ob
--  er erfolgreich war - ohne dass die App selbst eine Verbindung zur
--  n8n-API braucht. Stattdessen schreibt n8n direkt hierher, exakt
--  dasselbe Muster wie ueberall sonst im Projekt (n8n schreibt, die App
--  liest nur ueber Postgres).
--
--  Wird am ENDE des Laufs geschrieben (seit 2026-09-15): der
--  Abschluss-Knoten haengt in beiden Sweeps an den Endknoten aller
--  Zweige (Erinnerung/Eskalation/Datendiskrepanz), nicht mehr parallel
--  am Trigger. Bis dahin war der Schreibvorgang bewusst optimistisch und
--  "erfolgreich" bedeutete faktisch nur "gestartet" - das war als
--  vertretbar eingestuft, ist aber fuer eine Betriebsanzeige irrefuehrend.
--  Damit der Status auch an einem Tag ohne offene Faelle geschrieben
--  wird, liefern die Loader-Knoten alwaysOutputData und beide Code-Nodes
--  haben einen Leerlauf-Zweig (aktion = 'keine').
--
--  Schlaegt ein Lauf fehl, ueberschreibt der gemeinsame Fehler-Alert-
--  Workflow (VASVi0WFdgXR2OSb, feuert ueber n8ns Error-Trigger bei jedem
--  Fehler in einer der beiden Sweeps) denselben Datensatz auf "fehler".
--  Bleibt zuletzt_gelaufen_am aelter als 26 Stunden, markiert die UI den
--  Lauf zusaetzlich als veraltet (SweepStatus.jsx) - das faengt den Fall
--  ab, dass ein Sweep gar nicht erst startet und deshalb weder Erfolg
--  noch Fehler meldet.
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
    'Wird von den n8n-Sweeps selbst geschrieben (nicht von der App). Seit
     2026-09-15 schreibt der Abschluss-Knoten am ENDE des Laufs - "erfolgreich"
     heisst damit auch erfolgreich. Vorher lief der Schreibvorgang parallel zum
     Trigger und bedeutete faktisch nur "gestartet". Bricht ein Lauf ab, setzt
     der gemeinsame Fehler-Alert-Workflow den Status auf "fehler"; ist
     zuletzt_gelaufen_am aelter als 26 Stunden, markiert die UI den Lauf als
     veraltet (SweepStatus.jsx).';

-- ---------------------------------------------------------------------
-- Nuetzliche Abfragen
-- ---------------------------------------------------------------------

-- Aktueller Stand beider Sweeps:
--   SELECT sweep_name, status, zuletzt_gelaufen_am, meldung
--   FROM   feldmark.sweep_status
--   ORDER  BY sweep_name;

-- Zuruecksetzen fuer einen Testlauf:
--   DELETE FROM feldmark.sweep_status;
