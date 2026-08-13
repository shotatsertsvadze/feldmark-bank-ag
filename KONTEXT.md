# Feldmark Bank AG — Projektkontext (Stand 2026-08-13)

Portfolio-/Abschlussprojekt Digitalisierungsmanager-Bootcamp. Fiktive Bank
klassifiziert eingehende Schreiben (Pfändung, Auskunftsersuchen etc.) und
speist eine Fristüberwachung. **Dieser Baustein ist fertig, getestet, committed
und gepusht.** Ordner: `Digitalisierungsmanager/projekte/Final Project Preperation/`.

`feldmark_klassifikation/` wurde zu `feldmark_app/` — der eigenständigen App
gehört jetzt eine App-Shell mit Sidebar-Navigation, sodass sie als erste von
perspektivisch mehreren Features der größeren Feldmark-Projekt-App fungiert
(siehe Architektur unten).

## Repo & Cloud-Ressourcen
- GitHub (privat): https://github.com/shotatsertsvadze/feldmark-bank-ag — eigenständiges Repo, NICHT im Home-Verzeichnis-Repo (das zeigt auf ein anderes Projekt, `fintech-fraud-detection-pipeline` — nicht anfassen).
- Supabase-Projekt: **„shotatsertsvadze's Project"** (`ziwzymarlakoxrgdesvw`), Region eu-west-2. Enthält auch den Fintech-Reifegrad-Checker (andere Tabellen, kein Konflikt).
- n8n: `https://n8n.skill-sprinters.de`. Drei relevante Workflows:
  - `Ix9jAYFWgh73fPv9` — „Nickel — Pfaendung: Fristueberwachung (Postgres)" (Name historisch, Tabellen sind `feldmark_*`)
  - `vAHlgWXDJXIS2cps` — „Feldmark Bank AG — Auskunftsersuchen: Fristueberwachung (Postgres)"
  - `VASVi0WFdgXR2OSb` — „Feldmark Bank AG — Fristueberwachung: Fehler-Alert" (an beide oben als Error-Workflow gehängt)
  - Postgres-Credential in n8n: „Postgres account 6" — nutzt Supabase **Session Pooler** (`aws-0-eu-west-2.pooler.supabase.com:5432`, User `postgres.ziwzymarlakoxrgdesvw`), NICHT die direkte Verbindung — die braucht IPv6, n8n-Host hat nur IPv4.

## Architektur
```
feldmark_app/                    Express + React (Vite), eine App mit Sidebar-Shell + Features
  server/mistral.js                OCR + Klassifikation (6-Wege-Schema) + Routing-Logik
  server/db.js                     Postgres-Schreib-/Lesefunktionen
  server/index.js                  REST-Endpunkte (/api/klassifizieren, /api/faelle, /api/sichtpruefung)
  src/App.jsx                      Router-Shell (react-router-dom), rendert Sidebar + aktives Feature
  src/app/Sidebar.jsx              Bank-Branding + Feature-Navigation (aktuell 1 Eintrag, wächst organisch)
  src/features/pfaendung-auskunftsersuchen/   Erstes Feature (bisheriges React-UI: Posteingang + Fallübersicht)
  .env                              MISTRAL_API_KEY, DATABASE_URL (Session Pooler!) — lokal, gitignored
feldmark_pfaendung_schema.sql      Postgres-Schema Pfändung (bereits vor diesem Baustein bestehend)
feldmark_auskunftsersuchen_schema.sql   Postgres-Schema Auskunftsersuchen (neu)
feldmark_sichtpruefung_schema.sql       Generische Sichtprüfungs-Warteschlange (neu, typübergreifend)
klassifikations_schema.md         System-Prompt + JSON-Schema-Doku fürs Klassifikationsmodell
muster_dateien/                   Testdateien (PfÜB, Auskunftsersuchen, 2 Plausibilitäts-Fallen)
belegerkennung/                   NUR lokale Referenzkopie eines anderen Moduls, NICHT im Git-Repo
```

## Datenfluss
Upload → Mistral OCR → ein Chat-Call (JSON-Mode) klassifiziert + extrahiert →
`bestimmeRouting()` (reine Funktion, Konfidenz/Plausibilität) → Autofall
(Postgres-Fallanlage) ODER Sichtprüfungs-Warteschlange. Erinnerungsschreiben
werden gegen bestehende Aktenzeichen gematcht statt neuen Fall anzulegen.
Zwei n8n-Sweeps (täglich) lösen Erinnerung 1/2, Eskalation, Fristversäumnis aus,
mit Idempotenz-Sperre.

## Wichtige Entscheidungen (mit Grund)
- **Drei getrennte Tabellen statt einer generischen**: `feldmark_pfaendung_faelle` (unverändert, schont den bereits getesteten alten n8n-Workflow), `feldmark_auskunftsersuchen_faelle` (eigene Fristlogik, StPO statt ZPO), `feldmark_sichtpruefung_warteschlange` (typübergreifend, da der Typ bei Sichtprüfung ja gerade unsicher ist).
- **`zustelldatum`/`eingangsdatum` nie vom Modell** — kommt ausschließlich aus Upload-Metadaten, nie aus dem Dokumenttext (Kernprinzip aus `klassifikations_schema.md`).
- **Vier-Augen-Pflicht** bei niedriger Betragskonfidenz wird als Protokoll-Ereignis geloggt, nicht als eigene Spalte (schont das bestehende Pfändungs-Schema).

## Getestet & bestätigt funktionierend
- Alle 4 Musterdateien (inkl. der 2 Plausibilitäts-Fallen) korrekt klassifiziert.
- End-to-End Pfändung + Auskunftsersuchen: Fallanlage, Sichtprüfungs-Fallback bei fehlenden Pflichtfeldern, Erinnerungsschreiben-Matching, Duplikat-Erkennung.
- Beide n8n-Sweeps: alle Aktionspfade (Erinnerung 1/2, Eskalation, Fristversäumnis, kein Handlungsbedarf) inkl. Wochenend-Verschiebung, zweimal hintereinander gelaufen ohne Duplikate (Idempotenz bestätigt).
- React-Dashboard in Desktop- und Mobile-Breite.

## Zwei echte Bugs gefunden + gefixt (nicht kosmetisch)
1. `node-pg` liefert `date`-Spalten als ISO-Timestamp mit Zeitzonen-Shift → `to_char(..., 'YYYY-MM-DD')` in allen SQL-Abfragen erzwungen.
2. n8n Postgres-INSERT batcht mehrere gleichzeitige Items standardmäßig → zerstört `pairedItem`-Zuordnung → `queryBatching: independently` in beiden Sweeps gesetzt.

## Aus der Prozessanalyse ergänzt (alle umgesetzt)
Duplikat-Erkennung vor Fallanlage · Batch-Zustelldatum-Warnhinweis im UI ·
Kürzungs-Flag bei >12.000 Zeichen OCR-Text (erzwingt Sichtprüfung) ·
n8n-Fehler-Workflow bei komplettem Sweep-Ausfall · OCR-Konfidenz jetzt Teil
des Routings · Aktenzeichen-Präzisierung im Prompt · Whitespace-normalisierter
Aktenzeichen-Abgleich.

## Bewusst offen / nicht gebaut
- Versand ist Platzhalter in beiden n8n-Workflows (empfänger/betreff/nachricht fertig aufbereitet, kein echter E-Mail-Node).
- Einziehungsverfügung/Überweisungsverfügung-Felder sind ungeprüfte Annahme A11 (keine echten Muster vorhanden).
- Konfidenzschwellen (70/85/60) sind ungemessene Startwerte, kein echter Kalibrierungs-Lauf.
- Kein Auth/Login, keine Multi-User-Rollen.
- Batch-Zustelldatum: nur Warnhinweis gebaut, kein Datums-Override pro Datei (bewusste Kleinstlösung).

## Nächste sinnvolle Schritte (nicht begonnen)
- Echten Versand-Kanal an die Platzhalter-Nodes hängen.
- Konfidenzschwellen mit echten Testläufen kalibrieren.

## Erledigt: Baustein in Haupt-App eingepackt (2026-08-13)
`feldmark_klassifikation/` → `feldmark_app/` umbenannt (git mv, History erhalten).
Neue App-Shell: `src/App.jsx` (react-router-dom) + `src/app/Sidebar.jsx` mit
Feldmark-Bank-AG-Branding und Feature-Navigation. Bisheriger App-Inhalt liegt
jetzt unter `src/features/pfaendung-auskunftsersuchen/` (Komponenten, api.js,
dokumenttypen.js, fristlogik.js — Relativpfade unverändert, da als Ganzes
verschoben). Sidebar zeigt aktuell nur dieses eine Feature; weitere Bausteine
werden später einfach als zusätzliche Route + Sidebar-Eintrag ergänzt, keine
Registry o.Ä. vorgebaut. In Desktop- und Mobile-Breite getestet (Sidebar
stapelt sich mobil über den Inhalt), API-Calls über Vite-Proxy funktionieren
unverändert. `.claude/launch.json` für `npm run dev` (Port 5291) angelegt.
Noch offen: `.env`/`.env.example`-Kommentare und Skript-Namen im Detail
verweisen teils noch auf den alten Namen "Feldmark-Klassifikations-Server"
(server/index.js Log-Ausgabe) — kosmetisch, nicht funktionsrelevant.
