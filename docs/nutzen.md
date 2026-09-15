# Nutzen — was das System messbar bringt

Aufgeteilt in **gemessen** (aus dem laufenden System, mit Datum) und
**gerechnet** (Modellrechnung auf einer offen genannten Annahme). Was nicht
gemessen ist, steht hier auch nicht als Messung.

## 1. Gemessen: Durchlaufzeit Upload → Fallakte

Aufgenommen am 2026-09-15 gegen die echte Pipeline (lokaler Server, Mistral
OCR, Supabase), Dateien aus `muster_dateien/`:

| Schritt | Messwert |
|---|---|
| OCR-Aufruf (`mistral-ocr-latest`) | 0,31 s / 0,36 s / 1,23 s / 1,81 s / 1,86 s (fünf Läufe, ein- bis zweiseitige Dokumente) |
| Klassifikation + Extraktion (ein Chat-Aufruf) | an diesem Tag nicht messbar: der Mistral-Account lief in ein dauerhaftes Rate-Limit (HTTP 429), siehe Abschnitt 4 |
| Fallanlage in Postgres (3–5 Statements, eine Transaktion) | nicht einzeln gemessen — im Integrationstest nicht von Serverstart und HTTP-Overhead getrennt; gegenüber den API-Aufrufen vernachlässigbar |
| **Gesamt Upload → Fallakte** | **wenige Sekunden**, dominiert von den zwei API-Aufrufen |

Die ehrliche Aussage für die Präsentation lautet deshalb: *Sekunden statt
Minuten* — die genaue Sekundenzahl hängt am Modellanbieter, nicht am System.

## 2. Gerechnet: Aufwand pro Schreiben

**Annahme (nicht gemessen, offen deklariert):** manuelle Erfassung eines
Schreibens — Umschlag öffnen, lesen, Aktenzeichen/Gläubiger/Schuldner/Betrag
in eine Liste tippen, Frist im Kopf oder im Kalender notieren — dauert
**8 Minuten**. Das ist eine Schätzung aus der Prozessbeschreibung in
`docs/IST-PROZESS.md`, keine Zeitmessung am realen Arbeitsplatz.

**Mengengerüst** (fiktive Baseline, `docs/IST-PROZESS.md`): 525 Fälle/Monat.

| Größe | Ist (manuell) | Soll (mit System) |
|---|---|---|
| Erfassung pro Schreiben | 8 min | ~10 s Upload + Metadaten (Zustelldatum, Kanal, Bearbeiter) |
| Erfassung 525 Fälle/Monat | ~70 h | ~1,5 h Upload + Sichtprüfung der Ausreißer |
| Fristüberwachung | Gedächtnis + persönliche Liste, nicht bezifferbar | 2 Sweeps/Tag, 0 Personenminuten |

Die Entlastung entsteht **nicht** dadurch, dass die KI den Fall bearbeitet —
Guthaben erfassen, § 907 ZPO prüfen, freigeben und versenden bleiben beim
Menschen. Sie entsteht beim Erfassen und beim Erinnern.

## 3. Nicht in Stunden messbar, aber der eigentliche Punkt

| Ist-Risiko (`docs/IST-PROZESS.md`) | Was das System dagegen setzt | Belegt durch |
|---|---|---|
| Frist wird am **Scandatum** verankert statt am Zustelldatum → jede Frist systematisch zu lang, und der Fehler verdeckt sich selbst | Der Fristanker kommt ausschließlich aus dem Upload-Formular. Das Feld existiert nicht im JSON-Schema des Modells — strukturell unmöglich, nicht nur verboten | `server/mistral.js` (Schema), `klassifikations_schema.md` Regel 6 |
| Erkennungsfehler laufen als scheinbar korrekte Daten weiter | Fail-closed-Routing: zu niedrige Konfidenz, unplausibler Inhalt, schlechte OCR-Seite, gekürzter Text oder fehlende Konfidenz → Sichtprüfung statt Autofall | `bestimmeRouting()`, 17 Tests in `server/mistral.routing.test.js` |
| Bearbeitungsstand liegt im Kopf einer Person | Jeder Statuswechsel erzeugt eine Protokollzeile mit Fristende und Restlaufzeit; Fall-Verlauf und Aktivitätsfeed lesen daraus | `feldmark.*_protokoll`, `server/db.audit-trail.test.js` |
| Erinnern hängt an einem Menschen | Zwei tägliche n8n-Sweeps mit Erinnerung 1/2, Eskalation und Fristversäumnis-Dokumentation, idempotent | `feldmark_fristueberwachung_postgres.json`, Testmatrix E1–E6, E11 |
| Die Datendiskrepanz-Klärung lief ohne jede Spur im Fall-Verlauf | Nachfassung 1/2, fristwahrende Erklärung und die 30-Tage-Schließung schreiben seit 2026-09-15 Protokollzeilen — in drei echten Sweep-Läufen belegt | Testmatrix, Abschnitt „n8n-Sweeps" |
| Rechtsverbindliche Erklärung mit ungeprüften Angaben | Fail-closed 422: ohne alle fünf § 840-ZPO-Angaben wird kein Text erzeugt | `pkonto_drittschuldner.js`, 16 Tests |

**Fehlerquote:** bewusst keine Zahl. Dafür bräuchte es einen ausgewerteten
Parallelbetrieb (manuell vs. System über dieselben Schreiben); den gab es
nicht. Was stattdessen belegbar ist: kein Schreiben verlässt die Pipeline
unsichtbar — selbst ein API-Fehler landet seit 2026-09-15 in der
Sichtprüfungs-Warteschlange statt im Nichts.

## 4. Kosten

| Posten | Betrag |
|---|---|
| Mistral OCR + ein Chat-Aufruf pro Dokument | zwei API-Aufrufe je Schreiben; im Testbetrieb auf dem kostenlosen Tarif gelaufen, der am 2026-09-15 in ein Rate-Limit lief (HTTP 429) |
| n8n Cloud | zwei Cron-Läufe/Tag plus ein Fehler-Workflow |
| Supabase Postgres | Free-Tier ausreichend für dieses Volumen |

Das Rate-Limit ist kein Nebensatz, sondern der Grund für zwei
Konstruktionsentscheidungen: ein Timeout plus genau ein Wiederholungsversuch
mit Pause (`server/mistral.js`) und der Dead-Letter-Pfad in die Sichtprüfung.
Beides wurde am 2026-09-15 an genau diesem echten 429 verifiziert.

## 5. Was dieser Abschnitt bewusst nicht behauptet

- Keine gemessene Fehlerquote (kein Parallelbetrieb gefahren).
- Keine Personaleinsparung in Köpfen — die Rechnung oben ist Erfassungszeit,
  nicht Gesamtprozesszeit.
- Kein Versandnutzen: der Versandkanal ist Platzhalter, die Sweeps bereiten
  Erinnerungen vor, verschicken sie aber nicht (`README.md`, „Bewusste Grenzen").
