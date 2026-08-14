# Feldmark Bank AG — Projektkontext (Stand 2026-08-14)

## Neu: Datendiskrepanz-Sweep in n8n verkabelt (2026-08-14)
Direkter Folgeauftrag zum Eintrag darunter: Nutzer bestätigte "ja" auf die
Frage, ob der fertige `POST /api/sweep/datendiskrepanz`-Endpunkt in n8n
verkabelt werden soll.

**Blocker entdeckt, bevor irgendwas gebaut wurde**: `feldmark_app` ist
nirgends deployed (kein Procfile/vercel.json/render.yaml, nur lokale
`.env`) — n8n läuft in der Cloud und kann `localhost` nicht erreichen. Der
bestehende Fristüberwachungs-Sweep funktioniert nur, weil er direkt gegen
Postgres arbeitet (öffentlich über den Supabase-Pooler erreichbar), nicht
über die Express-API. Frage dem Nutzer gestellt statt einfach zu
duplizieren oder einfach zu deployen — beides sind Entscheidungen, die ihm
gehören. **Antwort: Sweep-Logik nach n8n duplizieren** (Postgres+Code-Node,
gleiches Muster wie der bestehende Sweep), Deployment bewusst nicht
gewählt.

**Umgesetzt**: neuer paralleler Zweig im bestehenden Workflow
`Ix9jAYFWgh73fPv9` ("Nickel — Pfaendung: Fristueberwachung (Postgres)"),
ab denselben zwei Triggern (`Taeglich 07:00 Uhr`, `Manuell testen`):
Postgres-Query lädt offene Datendiskrepanz-Fälle → Code-Node
("Datendiskrepanz-Aktion bestimmen", dupliziert bewusst
`feldmark_app/server/datendiskrepanz.js` — MUSS bei Änderungen dort
manuell nachgezogen werden, siehe Sticky Note im Workflow) → Switch mit
5 Ausgängen → Postgres-UPDATE-Ketten je Aktion (Nachfassung 1/2,
fristwahrende Erklärung, 30-Tage-Schließung, keine).

**Zwei echte Bugs beim Live-Testen gefunden + gefixt** (nicht kosmetisch,
beide über `execute_workflow`, nicht `test_workflow`, da letzteres
Postgres-Nodes pinnt und die echte SQL-Ausführung gar nicht geprüft
hätte):
1. Postgres-Node mit `queryBatching: independently` gibt nach dem UPDATE
   `{success:true}` zurück, NICHT die `RETURNING`-Spalten — `$json.fall_id`
   war in der zweiten Node einer Kette leer. Fix: wie im bestehenden
   Workflow per Namen auf den Ursprungs-Node zurückreferenzieren
   (`$('Datendiskrepanz-Aktion bestimmen').item.json.fall_id`) statt auf
   `$json` zu vertrauen.
2. Die mehrzeilige fristwahrende Erklärung als zweiter Parameter neben
   `fall_id` per komma-getrenntem `queryReplacement`-String übergeben ließ
   das UPDATE `{success:true}` melden, aber **0 Zeilen aktualisieren** —
   `erklaerung_text` blieb `NULL`, obwohl kein Fehler auftrat. Die
   Fehlermeldung des ersten Fixversuchs nannte selbst die Lösung: n8n
   akzeptiert für `queryReplacement` auch ein Array
   (`={{ [$json.text, $json.fall_id] }}`) statt eines komma-getrennten
   Strings — robuster gegenüber Kommas/Zeilenumbrüchen in Textwerten.
   Auf alle neuen Nodes umgestellt.

**Getestet**: alle vier Zweige (Nachfassung 1, Nachfassung 2, fristwahrende
Erklärung inkl. korrekt geschriebenem `erklaerung_text`, 30-Tage-
Schließung) einzeln über echte `execute_workflow`-Läufe gegen einen realen
Testfall, mit künstlich zurückdatierten Zeitständen (gleiche Technik wie
beim Node-Backend-Test). Idempotenz bestätigt (fünfter Lauf: Fall bereits
geschlossen, verschwindet korrekt aus der Query, landet auf "Kein
Handlungsbedarf"). Workflow anschließend **published** (Draft-Änderungen
wirken erst nach Publish auf den produktiven Schedule-Trigger). Testfall
danach vollständig aus allen vier Tabellen gelöscht.

**Offen**: die Duplizierung (Punkt oben) ist eine bewusste, dokumentierte
Abweichung vom Prinzip "eine Quelle der Wahrheit" — sauberer wäre ein
HTTP-Request-Node auf den Sweep-Endpunkt, sobald `feldmark_app` deployed
ist. Kein Code im Repo geändert (der Workflow lebt nur in n8n).

Portfolio-/Abschlussprojekt Digitalisierungsmanager-Bootcamp. Fiktive Bank
klassifiziert eingehende Schreiben (Pfändung, Auskunftsersuchen etc.) und
speist eine Fristüberwachung. **Dieser Baustein ist fertig, getestet, committed
und gepusht.** Ordner: `Digitalisierungsmanager/projekte/Final Project Preperation/`.

`feldmark_klassifikation/` wurde zu `feldmark_app/` — der eigenständigen App
gehört jetzt eine App-Shell mit Sidebar-Navigation, sodass sie als erste von
perspektivisch mehreren Features der größeren Feldmark-Projekt-App fungiert
(siehe Architektur unten).

## Neu fürs Wiedereinsteigen: Datendiskrepanz-Workflow gebaut (2026-08-14, morgens)
Nutzer war morgens wieder da (nicht mehr autonome Nachtarbeit, normale
Session) und bat direkt: "Datendiskrepanz-Workflow bauen" — als Reaktion auf
den wichtigsten Fund aus dem Methodik-Dokument (siehe Eintrag darunter):
Sollkonzept 3.1 (Ast A), selbst als bestes Aufwand-Nutzen-Verhältnis im
ganzen Konzept bezeichnet, war nicht implementiert.

**Scope-Präzisierung gegenüber dem Sollkonzept** (transparent kommuniziert,
nicht stillschweigend vereinfacht): Die im Sollkonzept beschriebene
Trefferhierarchie (IBAN/Kontonummer, Name+Geburtsdatum+Adresse gegen einen
Kernbank-Kundenstamm) setzt eine Kernbank-API voraus, die dieses Projekt
nicht hat (Annahme A7). Umgesetzt wurde der in diesem System tatsächlich
erreichbare Fall: `pfaendung.schuldner_name` fehlt in der Extraktion,
während Aktenzeichen und Gläubiger vorhanden sind (ohne die beiden ist
keine sinnvolle Rückfrage möglich — "unser Aktenzeichen, sein
Aktenzeichen"). Begründung ausführlich in
`feldmark_pfaendung_datendiskrepanz_schema.sql`.

**Architektonischer Kern-Fix**: `legePfaendungsfallAn()` hat den strukturellen
Fehler des Ist-Prozesses bisher unbeabsichtigt REPRODUZIERT — fehlende
Felder führten zu keinem Fallobjekt, also lief keine Frist, also blockierte
die Klärung faktisch doch (derselbe Fehler, den das Sollkonzept am
Ist-Prozess kritisiert). Fix: bei "nur Schuldnername fehlt" wird jetzt
TROTZDEM ein Fallobjekt angelegt (Platzhalter-Schuldner, NOT-NULL-Spalte
bewusst nicht aufgeweicht), die Frist läuft sofort, die Klärung läuft
parallel dazu — das ist der eigentliche Kern von "die Klärung darf die
Frist nicht blockieren".

**Elegante Wiederverwendung entdeckt und genutzt**: Die fristwahrende
Erklärung (A3, Sollkonzept 3.1) ist exakt die vierte Drittschuldnererklärung-
Variante, die im P-Konto-Baustein der letzten Nacht bereits im Docstring
als "hier nicht implementiert, weil aktuell kein erreichbarer Zustand"
vermerkt war. Statt einer zweiten, parallelen Freigabe-/Versand-Pipeline
nur für diesen Fall nutzt der Sweep `db.speichereErklaerung()` — dieselbe
Funktion, dieselbe UI (Freigeben/Versenden), gleiche Vier-Augen-Logik.
Kein neuer Code fuer Freigabe/Versand noetig.

**Neue Dateien**: `feldmark_pfaendung_datendiskrepanz_schema.sql` (additive
1:1-Tabelle, gleiches Muster wie die P-Konto-Erweiterung),
`feldmark_app/server/datendiskrepanz.js` (deterministische Textbausteine:
Rückfrage, 2× Nachfassung, fristwahrende Erklärung — kein LLM, gleiches
Prinzip wie `pkonto_drittschuldner.js`),
`feldmark_app/src/features/.../components/DatendiskrepanzFall.jsx` (UI,
rendert nichts wenn kein Eintrag existiert - reines Geschwisterelement zu
PfaendungErweiterung, kein Ersatz).

**Neuer Status-Wert**: `'Klaerung offen - fristwahrend erklaert'` (CHECK-
Constraint live UND in `feldmark_pfaendung_schema.sql` synchron ergänzt —
diesmal sofort, nicht erst nach einem Fund im Review wie in der Nacht
zuvor).

**Sweep-Endpunkt** `POST /api/sweep/datendiskrepanz`: bewusste Abweichung
vom bestehenden n8n-Fristüberwachungs-Sweep-Muster (der macht alles direkt
in Postgres-/Code-Nodes in n8n) — hier lebt die Terminerkennung UND die
Text-Erzeugung im Node-Backend, damit die fristwahrende-Erklärung-Logik
nicht ein zweites Mal in einem n8n-Code-Node dupliziert werden muss (genau
das Duplizierungsrisiko, das der Code-Review der Vornacht bei anderen
Konstanten bereits gefunden hatte). **n8n-Wiring noch NICHT vorgenommen** —
der Endpunkt ist fertig und getestet, müsste nur taeglich aufgerufen werden
(ein HTTP-Request-Node im bestehenden Workflow, analog zum 07:00/07:15-
Schedule-Trigger).

**Getestet** (Node-Skript mit synthetischer Klassifikation statt echtem
Mistral-Aufruf, da eine reale OCR-Erkennung mit GENAU fehlendem
Schuldnernamen bei sonst vollständigen Daten nicht zuverlässig provozierbar
ist): Fallanlage mit Platzhalter ✓, Sweep-Pfade Nachfassung 1/2/fristwahrende
Erklärung/30-Tage-Schließung je einzeln über künstlich zurückdatierte
Zeitstempel ✓, Idempotenz (Sweep zweimal hintereinander, keine Doppel-
Aktion) ✓, UI-Anzeige inkl. Cross-Reference zur wiederverwendeten
Drittschuldnererklärung ✓, Reaktivierung über die echte UI (Schuldner
nachtragen, Status korrekt zurück auf "Geprueft") ✓. Alle drei Test-Fälle
danach komplett gelöscht (Neuanlagen, nicht modifizierte Seed-Daten -
Löschen statt Zurücksetzen war hier der korrekte "Reset").

**Bewusst nicht gebaut / offen**:
- n8n-Wiring des Sweep-Endpunkts (siehe oben).
- Kein Gläubigerverzeichnis (war schon im Sollkonzept als eigener Quick
  Win Q3 vorgesehen) — Rückfrage-"Kanal" bleibt wie der übrige Versand in
  diesem Projekt ein Textbaustein-Platzhalter, kein echter E-Mail-Versand.
- Kein UI-Weg, einen Fall zu finden, der die Datendiskrepanz-Route NICHT
  genommen hat, weil ihm auch Aktenzeichen oder Gläubiger fehlten (bleibt
  bewusst in der normalen Sichtprüfung, siehe Scope-Präzisierung oben).

## Neu fürs Wiedereinsteigen: Methodik-Dokument (2026-08-13/14, zweite Nacht autonomer Arbeit)
Nutzer bat explizit, mit dem Projekt autonom weiterzuarbeiten (zweite Nacht in Folge,
`/loop` dynamisch, Check-in 07:45), und fragte nach meiner Einschätzung zur Projektrichtung.
Befund: Code + Sollkonzept sind bereits sehr weit (siehe unten), aber die vier
Kursmethoden, die der Nutzer explizit als Ziel genannt hatte — **Reifegradmodell,
Pareto, Ishikawa, 5-Why** — kamen in keinem der bestehenden Dokumente wörtlich vor
(per grep verifiziert). Das war die am höchsten priorisierte Lücke für ein
Digitalisierungsmanager-Abschlussprojekt — mehr Code hätte diese Lücke nicht geschlossen.

**Neu erstellt: `Pfaendungsprozess_Methodenanwendung.html`** — dockt an
`Pfaendungsprozess_Analyse_Sollkonzept.html` an, dupliziert dessen Mengengerüst/KPI-Arbeit
nicht, sondern verdichtet dieselben echten Zahlen mit den vier benannten Methoden:
- **Reifegradmodell**: 5-Stufen-Skala, je Prozessschritt Ist/Ziel/tatsächlich Erreicht
  bewertet — **ehrlich, nicht schönredend**: 5 von 8 Schritten erreichen den
  Sollkonzept-Zielreifegrad (inkl. der heute Nacht redesignten Drittschuldnererklärung),
  3 nicht (Datendiskrepanz-Klärungs-Workflow, echter Versand-Kanal, KPI-Messung).
- **Pareto**: zwei Lesarten. (1) Fallvolumen der vier Sonderaufwands-Kategorien
  (Nullguthaben/Teilguthaben/Polizei-StA/Datendiskrepanz) — echte SVG-Pareto-Grafik,
  Top-2-Ursachen = 66,3 % des Sonderaufwands. (2) Fristbudget-Verlust — hier eine
  **eigene, klar gekennzeichnete Verdichtung** (Papierkanal-Latenz × Volumen ≈ 158–473
  Fall-Tage/Monat), die nahelegt, dass die Papierkanal-Latenz den vom Sollkonzept selbst
  als „teuersten Befund" bezeichneten Datendiskrepanz-Block (95 Fall-Tage/Monat) sogar
  übertreffen könnte — als offene, zu messende Frage markiert, nicht als Fakt behauptet.
- **Ishikawa**: Fischgrätdiagramm (SVG) zu „Prozess ohne Reserve", 4 Äste
  (Mensch/Prozess/System/Umfeld), 8 Teilursachen — alle aus Sollkonzept Abschnitt 2 bzw.
  P-Konto-Ergänzung übernommen, keine neu erfundenen Ursachen.
- **5-Why**: konkreter Fristausfall-Fall (Bus-Faktor bei Krankheit) 5 Ebenen tief bis zur
  strukturellen Wurzel („kein Fallobjekt mit Vertretungsfähigkeit"), explizit verknüpft
  mit dem, was der gebaute Baustein davon bereits löst (bearbeiter_email/vertretung_email/
  vorgesetzte_email + n8n-Eskalation).
- **Wichtigster inhaltlicher Fund dabei**: Der Datendiskrepanz-Workflow (Sollkonzept 3.1,
  A1–A4), den das Sollkonzept selbst als „mit Abstand bestes Aufwand-Nutzen-Verhältnis im
  gesamten Konzept" bezeichnet (Abschnitt 7, Q1), ist **nicht im Code umgesetzt** (per grep
  verifiziert) — taucht sowohl im Reifegradmodell als auch in der Pareto-Analyse als
  einzige verbleibende Lücke auf. Klare Kandidat für den nächsten Bau-Schritt, falls als
  nächstes wieder Code statt Analyse gefragt ist.
- Design: exakt dieselbe CSS/Typografie wie die bestehenden Analyse-Dokumente
  übernommen (kein neuer Look) — bewusste Entscheidung, kein Rebrand.
- Ein echter Rendering-Bug beim Bauen gefunden+behoben: die Ishikawa-SVG-Beschriftungen
  liefen anfangs über den viewBox-Rand hinaus (zu lange Labels, zu wenig Randabstand) —
  im Browser sichtbar geprüft, mit kürzeren Labels und breiterem viewBox neu gebaut,
  danach im Browser bestätigt fehlerfrei.
- Committed (lokal, kein Push, wie die ganze Nacht zuvor).

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
- Der Status-Reset-Bug beim Neu-Erzeugen einer Erklaerung (siehe direkt
  unten, Code-Review-Eintrag) ist **behoben**, nicht mehr offen.
- Verbleibend offen (siehe Code-Review-Eintrag fuer Details, bewusst nicht
  in derselben Nacht geloest): P-Konto-Benachrichtigung feuert beim
  allerersten Speichern jedes Falls (nicht erst bei bewusster "kein
  P-Konto"-Bestaetigung) - braucht eine Produktentscheidung, kein
  Code-Fix; `aktualisiereErweiterung()` kann `guthaben_eur`/
  `p_konto_freibetrag_erhoehung` nicht per leerem Feld zuruecksetzen
  (COALESCE-Falle); `P_KONTO_GRUNDFREIBETRAG_EUR`/`SCHWELLE_KONFIDENZ_BETRAG`
  sind Frontend/Backend dupliziert statt vom Server bereitgestellt.

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

## Erledigt: Selbst-Code-Review nach dem Redesign (2026-08-13, autonomer Nacht-Loop, Fortsetzung)
Nach dem ersten Commit noch in derselben Nacht: `/code-review` (medium,
8 Finder-Winkel parallel als Subagents) auf den eigenen Diff angesetzt,
bevor der Nutzer morgens draufschaut. 5 der 8 gemeldeten Befunde behoben,
3 bewusst nur dokumentiert (siehe unten). Alle Fixes erneut über die echte
Browser-UI bzw. direkten API-Aufruf getestet, Testdaten wieder
zurückgesetzt, Build+Syntax-Check grün, zweiter Commit.

**Behoben:**
1. **`speichereErklaerung()` setzte `fall.status` nie zurück** beim
   Neu-Erzeugen einer Erklärung für einen Fall, der schon bei "Erklaerung
   freigegeben"/"Erklaerung versandt" stand (3 von 7 Review-Agents fanden
   das unabhängig voneinander — stärkster Befund der Nacht). Konsequenz war
   schlimmer als nur ein falsches Status-Label: der Fall verschwand aus
   `listeOffeneFaelle()` (Dashboard + n8n-Fristüberwachung) UND aus
   `findeAndereOffenePfaendungen()`, wodurch die Pflichtangabe-3-Liste
   (§ 840 ZPO, "andere Gläubiger") in der Erklärung eines GANZ ANDEREN
   Falls desselben Schuldners zu kurz geraten wäre. Fix: `speichereErklaerung()`
   setzt `fall.status` jetzt zusätzlich auf 'Geprueft' zurück, wenn er bei
   einem der beiden fortgeschrittenen Werte stand — möglich, weil die
   Session inzwischen die volle gültige Status-Wertemenge kennt (aus dem
   CHECK-Constraint, den sie selbst erweitert hat). Live getestet: Fall
   künstlich bis "Erklaerung versandt" durchlaufen lassen (verschwindet
   korrekt aus der offenen Liste), dann per direktem API-Aufruf neu erzeugt
   (kein UI-Pfad zurück zu einem bereits versandten Fall — selbst ein
   Nebenbefund, siehe unten) — Status sprang korrekt zurück auf "Geprueft",
   Fall tauchte in der Fallübersicht wieder auf.
2. **`feldmark_pfaendung_schema.sql` (die ORIGINALE Bootstrap-Datei, nicht
   die Erweiterungs-Schema-Datei) war nie um den neuen Statuswert
   "Erklaerung freigegeben" ergänzt worden** — 3 von 7 Agents fanden das
   unabhängig. Genau der Fehler, der heute Nacht schon einmal live auf
   Supabase auftrat (siehe oben), wäre bei jeder Neu-Provisionierung aus
   dieser Datei erneut aufgetreten. Nachgezogen.
3. **Vier-Augen-Warnung ließ sich trivial umgehen**: das Feld "Erfasst von"
   ist bewusst optional, aber wenn es leer blieb, wertete der Server das
   als "andere Person" statt als "unbekannt" — Leerlassen war der bequemste
   Weg, die Kontrolle zu umgehen. Fix: ein fehlendes `guthaben_erfasst_von`
   löst jetzt ebenfalls die 409-Bestätigung aus, mit eigener Meldung
   ("... ohne 'Erfasst von'-Angabe gespeichert ..."). Das Formularfeld
   bleibt bewusst optional (keine erzwungene Pflichtfeld-UX-Änderung) — nur
   die Prüfung selbst behandelt "unbekannt" nicht mehr als "unbedenklich".
   Live getestet (409 korrekt ausgelöst, Override protokolliert).
4. **`erklaerungErstellen()` ignorierte, ob `speichern()` erfolgreich war**
   — bei einem fehlgeschlagenen Speichern wäre trotzdem eine Erklärung aus
   dem zuletzt gespeicherten (nicht dem gerade eingegebenen) Guthaben
   erzeugt worden, ohne dass der generische Fehlerbanner das erkennen ließe.
   `speichern()` gibt jetzt `{ ok, p_konto_benachrichtigung_ausgeloest }`
   zurück statt eines mehrdeutigen rohen Booleans; `erklaerungErstellen()`
   bricht bei `!ok` sauber ab.
5. Toter No-Op-Zweig (`if (p_konto_benachrichtigung_ausgeloest) { setFehler(null); }`
   — setzte einen bereits `null`-Wert erneut auf `null`) entfernt.

**Bewusst nur dokumentiert, nicht gefixt (mit Begründung):**
- P-Konto-Benachrichtigung feuert beim allerersten Speichern jedes Falls,
  nicht erst bei bewusster "kein P-Konto"-Bestätigung (`ist_p_konto`
  defaultet auf `false`, Checkbox startet ungecheckt) — **vorbestehendes
  Verhalten**, nicht heute Nacht eingeführt, nur die Funktion wurde
  angefasst (neuer Parameter). Ein Fix braucht eine Produktentscheidung
  (z.B. tri-state Feld "geprüft/ja/nein" statt Boolean), keine einseitige
  Code-Änderung mitten in der Nacht.
- `aktualisiereErweiterung()`: COALESCE verhindert, `guthaben_eur`/
  `p_konto_freibetrag_erhoehung` per leerem Feld + Speichern zurück auf
  leer/0 zu setzen (leeres Feld sendet `null`, COALESCE behält den alten
  Wert). Ebenfalls vorbestehend. Ein sauberer Fix bräuchte eine explizite
  "loeschen vs. nicht anfassen"-Unterscheidung im API-Vertrag (z.B. ein
  extra Flag) — Scope-Erweiterung, die besser mit Rücksprache entschieden
  wird als um Mitternacht allein.
- `P_KONTO_GRUNDFREIBETRAG_EUR` und `SCHWELLE_KONFIDENZ_BETRAG` sind
  Frontend/Backend dupliziert (Backend-Wert ist bereits exportiert, wird
  aber nicht vom Server ausgeliefert). Beide ändern sich laut Kommentar im
  eigenen Code periodisch per Gesetz/Kalibrierung — sauberster Fix wäre,
  sie Teil der `GET /erweiterung`-Antwort zu machen, statt sie im Frontend
  zu duplizieren. Kosmetisch/Drift-Risiko, kein akuter Bug, daher
  zurückgestellt.

**Nebenbefund beim Testen** (nicht Teil des Reviews, aber real): sobald ein
Fall den Status "Erklaerung versandt" erreicht, verschwindet er aus der
Fallübersicht — es gibt aktuell **keinen UI-Weg zurück** zu ihm, falls doch
einmal eine Korrektur nötig wird (z.B. der hier getestete
Regenerierungsfall). Der Test dafür lief über einen direkten
`fetch()`-Aufruf in der Browser-Konsole, nicht über einen Klick. Für den
seltenen Korrekturfall aktuell nur über direkten DB-/API-Zugriff lösbar —
kein Bug, aber eine bewusste Lücke, die dem Nutzer hier explizit
transparent gemacht wird statt sie zu verstecken.

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
