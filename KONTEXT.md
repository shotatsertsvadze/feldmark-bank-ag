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

## Nächste sinnvolle Schritte
- Echten Versand-Kanal an die Platzhalter-Nodes hängen.
- UI fuer P-Konto/Drittschuldnererklaerung: vollstaendig verifiziert.
- Redesign Freigabe-/Versand-Trennung, Vier-Augen, Konfidenz-/Alters-
  Warnhinweise: **umgesetzt, getestet, siehe Eintrag unten (2026-08-13,
  autonomer Nacht-Loop).**
- Verbleibende Luecke aus dieser Nacht (bewusst nicht geloest, siehe unten):
  wird nach Freigabe/Versand eine NEUE Drittschuldnererklaerung fuer
  denselben Fall erzeugt (z.B. weil sich das Guthaben geaendert hat),
  bleibt `fall.status` auf "Erklaerung versandt"/"Erklaerung freigegeben"
  stehen, obwohl die neue Fassung wieder bei "erzeugt, nicht freigegeben"
  anfaengt (erklaerung_freigegeben_am/erklaerung_versendet_am werden zwar
  korrekt zurueckgesetzt, `fall.status` aber nicht - die volle
  Status-Wertemenge wird von n8n mitverwendet und war in dieser Session
  nicht vollstaendig genug bekannt, um sie gefahrlos anzufassen). Praktisch
  selten (Erklaerung wird normalerweise nicht nach Versand neu erzeugt),
  aber ein sauberer Fix waere: `fall.status` beim Erzeugen einer neuen
  Erklaerung ebenfalls zuruecksetzen, sobald der volle Status-Automat
  bekannt ist.

## Erledigt: Redesign Freigabe-/Versand-Trennung + Vier-Augen + Warnhinweise (2026-08-13, autonomer Nacht-Loop)
Auf Nutzerwunsch autonom über Nacht umgesetzt (`/loop`, dynamischer Modus,
kein Eingriff während der Arbeit), Konzept aus dem process-automation-toolkit
(Mode 2, siehe vorheriger Chat-Verlauf) vollständig implementiert und über
die echte Browser-UI getestet — nicht nur die API direkt.

**DB (additiv, live auf Supabase):**
- `feldmark_pfaendung_erweiterung`: drei neue Spalten —
  `guthaben_erfasst_von`, `erklaerung_versendet_von`, `erklaerung_versendet_am`.
- **Bewusste Ausnahme von der Regel "`feldmark_pfaendung_faelle` bleibt
  unveraendert"**: der CHECK-Constraint auf `status` musste um den neuen
  Wert `'Erklaerung freigegeben'` erweitert werden (Fund beim Testen, siehe
  unten) — reine Erweiterung der erlaubten Werteliste, keine Spalten-/
  Formaenderung, betrifft die `SELECT *`-Abfragen der n8n-Workflows nicht.

**Backend (`server/db.js`, `server/index.js`):**
- `gibErklaerungFrei()` setzt jetzt nur noch den Zwischenstatus "Erklaerung
  freigegeben" statt direkt "Erklaerung versandt". Neue Funktion
  `bestaetigeVersand()` + Route `POST /erklaerung/versenden` schließen den
  zweiten Schritt ab und setzen erst dann den Endstatus. Der Fall bleibt in
  der offenen Liste (`listeOffeneFaelle`), solange nur freigegeben, nicht
  versendet — geprüft im Test (Fallzahl ging von 9→8 erst nach "Versand
  bestätigen", nicht schon nach "Freigeben").
- Weiche Vier-Augen-Prüfung serverseitig (nicht nur im Frontend, damit ein
  direkter API-Aufruf sie nicht umgehen kann): `POST /erklaerung/freigeben`
  vergleicht `freigegeben_von` mit dem zuletzt gespeicherten
  `guthaben_erfasst_von`; bei Übereinstimmung ohne `vier_augen_bestaetigt:
  true` kommt ein 409 mit `vier_augen_warnung: true` zurück, das Frontend
  zeigt dann einen expliziten Bestätigungsschritt. Eine Übersteuerung wird
  als eigenes Protokoll-Ereignis (`vier_augen_erklaerung_uebersteuert`)
  geloggt, analog zum bestehenden Vier-Augen-Muster bei niedriger
  Betragskonfidenz.
- `speichereErklaerung()` setzt jetzt auch `erklaerung_versendet_von/am`
  einer evtl. vorherigen Fassung zurück (Bug beim Bauen entdeckt: sonst
  hätte eine neu erzeugte Erklärung fälschlich als "bereits versendet"
  gegolten, wenn die alte Fassung schon versendet war). `fall.status`
  bleibt dabei aus dem oben genannten Grund unangetastet — siehe Lücke bei
  "Nächste sinnvolle Schritte".

**Frontend (`PfaendungErweiterung.jsx`, `index.css`):**
- Neues Feld "Erfasst von" bei der Guthaben-Eingabe.
- Nicht blockierende Warnhinweise vor "Drittschuldnererklärung erzeugen":
  Konfidenz < 85 (`SCHWELLE_KONFIDENZ_BETRAG`, gleicher Wert wie in
  `mistral.js`) und Guthaben älter als 24 Stunden. Bewusste Vereinfachung
  gegenüber dem Konzept ("1 Werktag"): reine Stundenschwelle statt
  Wochenend-/Feiertagslogik, für einen reinen Hinweis nicht gerechtfertigt.
- Vier-Augen-Warnung mit explizitem "Trotzdem freigeben"-Button.
- Neuer Versand-Schritt nach Freigabe (eigenes Formular + Bestätigungs-
  Banner), finaler Erfolgs-Banner zeigt beide Nachweise (freigegeben +
  versendet) zusammen.
- Styling erweitert das bestehende Farbtoken-System (ochre = Hinweis,
  oxblood = Vier-Augen-Warnung, slate = Zwischenstatus, moss =
  abgeschlossen) statt einer neuen Designsprache — passend zur
  frontend-design-Skill-Leitlinie, hier bewusst keine große Neugestaltung,
  sondern präzise Erweiterung eines bereits distinktiven Systems.

**Beim Testen gefundener und behobener Bug (echter Fehler, nicht kosmetisch):**
Der erste Live-Test des Vier-Augen-Override ("Trotzdem freigeben") schlug
mit HTTP 500 fehl: `new row for relation "feldmark_pfaendung_faelle"
violates check constraint "feldmark_pfaendung_faelle_status_check"` — der
neue Status-Wert war im CHECK-Constraint nicht freigegeben. Migration
nachgezogen (siehe oben), danach erfolgreich erneut getestet.

**Test-Vorgehen**: PF-2026-0455 temporär präpariert (niedrige Konfidenz,
Forderungsbetrag, `guthaben_erfasst_am` künstlich auf vor 30h gesetzt), alle
neuen Zustände über die echte Browser-UI durchgeklickt (Konfidenz-Warnung,
Alters-Warnung, Vier-Augen-Konflikt + Override inkl. Protokoll-Eintrag,
Freigabe→Versand-Zwischenstatus→Endstatus). Danach alle Testwerte
zurückgesetzt (`feldmark_pfaendung_erweiterung`-Zeile, `fall.status`, und
das Test-Protokoll-Ereignis wieder gelöscht — Audit-Log soll keine
Testartefakte enthalten).

**Git**: Auf ausdrücklichen Nutzerwunsch diesmal committed (vorherige
Session-Regel "nicht committen" war zeitlich begrenzt gültig, wurde in
dieser Session vom Nutzer aufgehoben) — lokal, kein Push.

## Erledigt: UI-Verifikation P-Konto/Drittschuldnererklaerung (2026-08-13, Fortsetzung)
Dev-Server neu gestartet, Fallübersicht → PF-2026-0455 aufgeklappt, kompletten
Flow durchgeklickt (Guthaben eingeben, Speichern, Drittschuldnererklärung
erzeugen, Freigeben & Fall abschließen) — alles über die echte UI, nicht nur API.
- **Wichtiger Befund dabei**: Das Forderung-Feld im Formular ist bewusst
  `disabled`/read-only (`PfaendungErweiterung.jsx:136`) und zeigt nur
  `erw.forderung_gesamt_eur` an — es laesst sich nicht manuell befuellen.
  Passt zum Kernprinzip "nie vom Nutzer, nur aus Klassifikation". Folge: bei
  allen bestehenden Seed-Faellen (vor dem `legePfaendungsfallAn()`-Fix
  angelegt) ist `forderung_gesamt_eur` NULL, die Erklaerung-Erzeugung schlaegt
  darum korrekt mit 422 fehl ("Forderungshoehe fehlt") — das ist
  beabsichtigtes fail-closed-Verhalten, kein Bug. Fuer den UI-Test wurde
  `forderung_gesamt_eur`/`konfidenz_betrag` bei PF-2026-0455 temporaer per
  SQL gesetzt (2000 EUR / 90), danach Flow getestet, danach alles
  (`feldmark_pfaendung_erweiterung`-Zeile + `feldmark_pfaendung_faelle.status`)
  wieder auf sauberen Ausgangszustand zurueckgesetzt.
- Generierter Erklaerungstext (1.500 EUR Guthaben ggue. 2.000 EUR Forderung →
  Teilbetrag-Fall) war inhaltlich korrekt und vollstaendig.
- Freigabe-Flow bestaetigt den fruehren Bug-Fix: `status` wechselte korrekt
  zu "Erklaerung versandt" nach Freigabe.
- **Nebenbefund**: In der DB stand bei PF-2026-0455 noch `p_konto_benachrichtigt_am`
  von der vorherigen (abgebrochenen) Testsession — war beim Session-Ende
  nicht zurueckgesetzt worden. Jetzt mitkorrigiert. Alle anderen Seed-Faelle
  waren unberuehrt/sauber.
- Diese Aenderungen betreffen nur Testdaten in Supabase, keine Code-Aenderungen.
  Der P-Konto/Drittschuldnererklaerung-Baustein selbst ist weiterhin NICHT
  committed (Code lokal, auf Nutzerwunsch).

## Erledigt: P-Konto + automatisierte Drittschuldnererklaerung, Backend (2026-08-13)
Umgesetzt aus `Pfaendung_PKonto_Drittschuldnererklaerung_Ergaenzung.html`
(liegt nur lokal, nicht committed - siehe unten):
- Neue Tabelle `feldmark_pfaendung_erweiterung` (1:1 zu
  `feldmark_pfaendung_faelle`, additiv - die Faelle-Tabelle selbst bleibt
  laut fruehrer Entscheidung unveraendert). Migration bereits auf Supabase
  angewendet.
- `feldmark_app/server/pkonto_drittschuldner.js`: `berechnePfaendbarenBetrag()`
  und `erzeugeDrittschuldnererklaerung()` - rein deterministisch, KEIN LLM
  (Begruendung: die Erklaerung ist die rechtsverbindliche Aussage der Bank,
  nicht ein Zwischenergebnis mit nachgelagerter Sichtpruefung wie bei der
  Klassifikation). Deckt 3 der 4 im Ergaenzungskonzept beschriebenen
  Zustaende ab (voll/teilweise/kein pfaendbares Guthaben) - die vierte
  (Datendiskrepanz-Negativerklaerung) ist im aktuellen Routing nicht
  erreichbar, da solche Faelle in die Sichtpruefung gehen, nie in
  `feldmark_pfaendung_faelle` landen.
- `legePfaendungsfallAn()` speichert jetzt `forderung_gesamt_eur` und
  `konfidenz_betrag` aus der Klassifikation (wurden vorher verworfen).
- Neue REST-Endpunkte: `GET/PUT /api/faelle/:id/erweiterung`,
  `POST /api/faelle/:id/erklaerung`, `POST /api/faelle/:id/erklaerung/freigeben`.
- Beim erstmaligen Setzen von `ist_p_konto=false` loest das System die
  P-Konto-Benachrichtigung automatisch aus (Zeitstempel als Nachweis) -
  das ist der eigentliche Automatisierungsgewinn, siehe Ergaenzungskonzept.
- Bug waehrend des Testens gefunden + behoben: Freigabe einer Erklaerung
  setzte den Fall-Status nicht auf "Erklaerung versandt" - der n8n-Sweep
  haette den Fall trotz versandter Erklaerung weiter als offen gefuehrt.
- Backend vollstaendig gegen echte Testdaten verifiziert (4 Szenarien inkl.
  Mehrfachpfaendung mit korrekter Rangberechnung, 2 Fehlerfaelle). Testdaten
  danach zurueckgesetzt, Seed-Zustand unveraendert.
- **Noch keine UI** - nur Backend/API. Alle Aenderungen (Schema-Datei, neues
  Modul, db.js/index.js-Erweiterungen) sind lokal, NICHT committed, auf
  Nutzerwunsch ("kontext ist fuer uns").

## Projektrichtung geklärt (2026-08-13): Fokus bleibt Pfändung/Auskunftsersuchen
Auf Nachfrage nach "App-Erstellung" (größere Feldmark-Projekt-App) hat der
Nutzer klargestellt: Vision ist ein internes Firmenportal, ABER er kennt aus
eigener Fintech-Praxis nur die Pfändungs-/Auskunftsersuchen-Prozesse und
deren Probleme — deshalb bewusst NICHT in die Breite gehen (kein
Mitarbeiterverzeichnis, Ticketing etc.), sondern in dieser einen
Prozessfamilie in die Tiefe. Ziel: ein Prozess-Projekt, das zeigt, wie
Finanzdienstleister/Fintechs genau diese Prozesse vereinfachen,
automatisieren, digitalisieren koennen (Kursinhalte: Reifegradmodell,
Pareto, Ishikawa, 5-Why als praxisnahes Tool statt reiner Theorie).

Der Nutzer hat den realen Ist-Prozess ("Nickel") ausführlich beschrieben
(Bus-Faktor bei Krankheit, chaotische Papierablage, Kündigung wegen
Überlastung, heute 4 Personen statt 1 für dasselbe Volumen). Dabei stellte
sich heraus: **Ist-/Soll-Analyse plus BPMN v5 existieren bereits**
(`Pfaendungsprozess_Analyse_Sollkonzept.html`, `Pfaendungsprozess_BPMN_v5_1.html`,
vermutlich aus einer früheren Session desselben Tages) und behandeln exakt
dieselbe Aufgabenstellung inkl. derselben zwei ausgeklammerten Themen
(P-Konto-Benachrichtigung, automatisierte Drittschuldnererklärung). Diese
zwei offenen Themen wurden daraufhin als Ergänzungskonzept ausgearbeitet
(siehe oben) statt die bestehende Analyse zu duplizieren.

## Konfidenzschwellen-Kalibrierung: Ergebnis (2026-08-13)
Alle 4 Musterdateien real durch die Pipeline geschickt (echte Mistral-API-
Calls) und Konfidenzwerte protokolliert:

| Datei | dokumenttyp | konfidenz_typ | konfidenz_betrag | ocr_confidence.min | Routing-Grund |
|---|---|---|---|---|---|
| PfUeB.jpg | pfaendungsschreiben | 98 | 0 | 24.5 | OCR-Konfidenz + Betrag unter Schwelle |
| Auskunftsersuchen_StA_fiktiv.pdf | auskunftsersuchen | 99 | - | 92.3 | Duplikat-Verdacht (nicht Schwellenwert) |
| Antwort_ZIS_2016.jpeg (Falle 1) | auskunftsersuchen | 95 | - | 53.2 | plausibilitaet_ok=false + OCR-Konfidenz |
| Wahllisten-Datei (Falle 2) | sonstiges | 95 | - | 52.1 | plausibilitaet_ok=false, dokumenttyp=sonstiges |

**Befund: mit n=4 lässt sich seriös nichts kalibrieren.** In keinem Fall war
`konfidenz_typ` (70) oder `konfidenz_betrag` (85) der eigentlich
ausschlaggebende Grenzwert - `konfidenz_typ` liegt in allen 4 Faellen bei
95-99 (weit ueber der Schwelle, auch bei den beiden Plausibilitaets-Fallen,
wo `plausibilitaet_ok` bzw. `dokumenttyp=sonstiges` die eigentliche Bremse
sind), und `konfidenz_betrag` fiel beim einzigen Pfaendungsschreiben auf 0
(schlechte OCR-Qualitaet dieses konkreten Scans, min. Seitenkonfidenz nur
24.5%) - weit unter jeder plausiblen Schwelle, liefert also keinen
Anhaltspunkt fuer den genauen Wert 85. Einzig `SCHWELLE_OCR_KONFIDENZ` (60)
liegt sinnvoll zwischen den beobachteten Werten (24.5/52.1/53.2 vs. 92.3),
aber auch das ist mit 4 Punkten kein Kalibrierungslauf, nur eine grobe
Plausibilitaetspruefung. **Entscheidung: Schwellen unveraendert gelassen**
(70/85/60 bleiben Startwerte) - eine echte Kalibrierung braucht deutlich
mehr reale Dokumente mit Werten näher an den Grenzen, idealerweise aus
echtem Betrieb gesammelt, nicht aus 4 Handverlesenen Mustern.
Test-Sichtpruefungs-Eintraege aus diesem Lauf wieder aus der DB entfernt.

## Erledigt: Prozessanalyse-Fixes Routing + n8n-Workflows (2026-08-13)
Mit dem process-automation-toolkit-Skill analysiert und behoben:
- `bestimmeRouting()` in `feldmark_app/server/mistral.js` ist jetzt fail-closed:
  fehlendes `konfidenz_typ` oder `konfidenz_betrag` vom Modell zaehlt als
  "keine Konfidenz" (`?? 0`) statt durch `undefined < Schwelle` unbemerkt als
  "Schwelle eingehalten" durchzugehen. Fehlt `ocrConfidence` komplett, wird
  ebenfalls in Sichtpruefung geroutet statt der Check stillschweigend
  uebersprungen. `wurde_gekuerzt` erzwingt Sichtpruefung jetzt auch fuer
  `auskunftsersuchen`, nicht mehr nur fuer den Pfaendungsblock.
- Beide n8n-Workflows (`Ix9jAYFWgh73fPv9`, `vAHlgWXDJXIS2cps`): Empfaenger-
  Felder in "Erinnerung 1/2 aufbereiten" und "Eskalation aufbereiten" nutzen
  jetzt `.filter(Boolean).join(', ')` statt roher String-Interpolation -
  verhindert literales `"null"` bzw. Leerstring-Kommas bei fehlenden
  E-Mail-Feldern, relevant sobald ein echter Versand-Node drankommt.
  Sticky Note mit Feiertage-Pflegehinweis ergaenzt (`FEIERTAGE`-Liste ist
  hart auf 2026 codiert, ab 2027 unbemerkt keine Feiertagsverschiebung mehr).
- **Beide Workflows sind jetzt aktiviert** (vorher `active: false` - liefen
  nur ueber "Manuell testen", der taegliche Schedule-Trigger 07:00/07:15 Uhr
  griff nicht).
- Nachtraeglich (2026-08-13, zweiter Durchgang): beide Workflows live
  ausgefuehrt (Executions 26117/26118, Status success, alle offenen Faelle
  korrekt auf "Kein Handlungsbedarf" - Idempotenz haelt weiterhin). Den
  Empfaenger-Filter zusaetzlich gezielt mit synthetischem Testfall
  (`test_workflow`, `vertretung_email: null`) durchlaufen lassen - Ergebnis
  `empfaenger: "bearbeiter@example.com"`, kein `"null"`, kein Leerkomma.
  Test schlug danach absichtlich an der FK-Constraint fehl (Test-Fall-ID
  existiert nicht in `feldmark_pfaendung_faelle`), also kein echter DB-Schreibvorgang.

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
