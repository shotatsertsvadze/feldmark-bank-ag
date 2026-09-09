# Feldmark Bank AG — Projektkontext (Stand 2026-08-27)

## Neu: Vollstaendiger Code-Review + Remediation (2026-08-27)
Nutzer bat um einen umfassenden Code-Review des gesamten Repos mit
schriftlichem Bericht (`/code-review`, Effort "high", 8 Finder-Winkel
parallel), danach explizit um die Behebung aller Critical/High/Medium-
Befunde samt erneutem Test. Bericht liegt unter
`docs/code_review/2026-08-27-full-repo-review.md` (10 Befunde, #10 als
einziger "Low" bewusst außen vor gelassen).

**Neun von zehn Befunden im Code behoben** (in einem Hintergrund-Fork mit
vollem Zugriff auf den bisherigen Sessionkontext):

1. **`dokumenttyp` war fuer JEDE Zeile in `feldmark.pfaendung_faelle` hart
   auf `'pfaendungsschreiben'` gesetzt** (`db.js`: `listeOffeneFaelle()`,
   `holeAktivitaetsfeed()`) — Einziehungs-/Ueberweisungsverfuegung wurden
   ueberall falsch beschriftet. Dabei zusaetzlich einen maskierten
   Zweitbug in `Falluebersicht.jsx:115` gefunden und mitbehoben (`===
   "pfaendungsschreiben"` statt `PFAENDUNGSBLOCK.includes(...)`, waere
   nach Fix des ersten Bugs sonst zu leeren Detail-Panels bei diesen
   Fallarten gefuehrt). Neue Spalte `dokumenttyp` in
   `feldmark_pfaendung_schema.sql` ergaenzt, `legePfaendungsfallAn()`
   persistiert jetzt `klassifikation.dokumenttyp`.
2. **P-Konto-Checkbox kannte keinen "noch nicht geprueft"-Zustand** —
   Speichern des Guthabens allein (bevor jemand den P-Konto-Status
   ueberhaupt geprueft hat) konnte die automatische "kein P-Konto"-
   Benachrichtigung ungewollt ausloesen, weil `ist_p_konto` NOT NULL
   DEFAULT false ist und die Checkbox denselben Default hat. Fix: neue,
   separate Spalte `p_konto_geprueft` (Tri-State, ruehrt NICHT an der
   bestehenden COALESCE-Logik von `guthaben_eur`/
   `p_konto_freibetrag_erhoehung` — siehe die bekannte, bewusst
   zurueckgestellte Einschraenkung weiter unten), Radio-Button-UI
   ("Noch nicht geprueft" / "Kein P-Konto" / "P-Konto vorhanden") in
   `PfaendungErweiterung.jsx`, Benachrichtigung feuert jetzt nur noch,
   wenn `p_konto_geprueft` in GENAU diesem Request von false auf true
   wechselt (per WITH-CTE in `db.aktualisiereErweiterung()` ermittelt).
3. Direkt mitbehoben: die Bestaetigungs-Banner-Anzeige nach ausgeloester
   P-Konto-Benachrichtigung nutzte in `index.js` den Zeilenstand VOR der
   Benachrichtigung — Banner erschien erst nach Neuladen. Jetzt wird der
   Zeitstempel in derselben Antwort nachgetragen.
4.–6., 9. **n8n-Export-Drift**: der eingecheckte
   `feldmark_fristueberwachung_postgres.json` war seit dem allerersten
   Commit nicht mehr aktualisiert worden (17 statt 31 Nodes — fehlte
   komplett der gesamte Datendiskrepanz-Zweig plus der Sweep-Status-Node).
   Direkt gegen den LIVEN Workflow (`Ix9jAYFWgh73fPv9`) per n8n-API
   verifiziert statt blind neu zu exportieren: `queryReplacement`
   (Array-Form), Tabellennamen (schema-qualifiziert) und die
   `empfaenger`-Bereinigung (`.filter(Boolean).join(', ')`) waren
   allesamt **bereits live gefixt** — KONTEXT.md hatte recht, nur der
   Datei-Export war stehengeblieben. `feldmark.sweep_status` wird ebenfalls
   bereits live von beiden Sweeps beschrieben (per SQL-Abfrage bestaetigt:
   frische Zeitstempel fuer `pfaendung` UND `auskunftsersuchen`). Datei
   komplett aus dem Live-Stand neu aufgebaut (dabei einen toten,
   doppelten `parameters.parameters`-Unterknoten in drei Postgres-Nodes
   entfernt — inertes Altlast-Datenfeld, nicht Teil des echten n8n-
   Parameterschemas, hat die Ausfuehrung nachweislich nicht beeinflusst:
   der Sweep lief heute frueh 06:16 Uhr erfolgreich gegen die
   schema-qualifizierten Tabellen). Nebenbefund: der Live-Workflow heisst
   inzwischen wieder `"Nickel — Pfaendung: Fristueberwachung (Postgres)"`
   statt des freundlicheren Namens aus dem alten Export — beim Sync
   uebernommen, aber hier vermerkt, falls das ungewollt war.

**Zwei Befunde bestaetigt ECHT, aber nicht behoben** (siehe unten, Blocker):
7. `fristversaeumnis`-Zweig im Code-Node "Fristen berechnen (§ 840 ZPO)"
   hat als einziger der vier Aktionszweige KEINE Idempotenz-Sperre (im
   Gegensatz zu `eskalation`/`erinnerung_2`) — bei einem Abbruch zwischen
   Protokoll-INSERT und Status-UPDATE wuerde der naechste Lauf einen
   zweiten Fristversaeumnis-Audit-Eintrag fuer dasselbe Ereignis anlegen.
   Live per n8n-API bestaetigt, NICHT nur im alten Export.
8. `neuer_status` ist fuer Erinnerung 1/2 und Eskalation ein No-Op
   (`{{ $json.status }}`) statt den Status wie in der Mock-Variante
   voranzutreiben — Faelle bleiben nach Sweep-Kontakt technisch auf
   "Eingegangen" stehen. Live per n8n-API bestaetigt. Geplanter Fix
   (vorbereitet, nicht angewendet): `Eingegangen → In Bearbeitung` beim
   ersten Sweep-Kontakt, aber bewusst OHNE Downgrade eines bereits
   fortgeschritteneren Status — eine reine 1:1-Uebernahme des Mock-Werts
   haette einen Fall, dessen Erklaerung schon erzeugt (Status "Geprueft")
   aber noch nicht versendet ist, bei einer zwischenzeitlichen Eskalation
   faelschlich auf "In Bearbeitung" zurueckgestuft — neue Regression statt
   Fix. `feldmark_pfaendung_faelle_status_check` erlaubt "In Bearbeitung"
   bereits, kein Constraint-Blocker.

**Blocker: zwei Kategorien von Live-Aenderungen wurden vom
Permission-Classifier der Session verweigert** — sowohl
`mcp__claude_ai_Supabase__apply_migration` (fuer #1 und #2/#3) als auch
`mcp__claude_ai_n8n__update_workflow` (fuer #7/#8) wurden mit "Blocked by
classifier" abgelehnt. Der Hintergrund-Fork lief autonom ohne Nutzer
greifbar fuer eine Freigabe-Rueckfrage — genau die Art von schwer
umkehrbarer/Live-System-Aktion, bei der die Session offenbar bewusst
keine automatische Zustimmung erlaubt. Beide Male NICHT versucht, das zu
umgehen (z.B. per rohem `execute_sql` statt `apply_migration`), sondern
sauber gestoppt und dokumentiert. Fertige SQL/Workflow-Operationen liegen
im Report an die Hauptsession vor und muessen dort (interaktiv, mit
Nutzer-Freigabe) nachgezogen werden:

```sql
ALTER TABLE feldmark.pfaendung_faelle
  ADD COLUMN dokumenttyp text NOT NULL DEFAULT 'pfaendungsschreiben'
    CHECK (dokumenttyp IN ('pfaendungsschreiben', 'einziehungsverfuegung', 'ueberweisungsverfuegung'));

ALTER TABLE feldmark.pfaendung_erweiterung
  ADD COLUMN p_konto_geprueft boolean NOT NULL DEFAULT false;
UPDATE feldmark.pfaendung_erweiterung
  SET p_konto_geprueft = true
  WHERE ist_p_konto = true OR p_konto_benachrichtigt_am IS NOT NULL;
```

**Wichtig — bis diese zwei Migrationen laufen, ist die App live kaputt**:
`GET /api/faelle`, `GET /api/aktivitaet`, neue Pfaendungsblock-Fallanlage
und `PUT /api/faelle/:id/erweiterung` schlagen fehl, weil der Code jetzt
Spalten selektiert/schreibt, die auf Supabase noch nicht existieren. Das
ist eine bewusst in Kauf genommene, aber dringend zu schliessende
Zwischen-Luecke — die Migrationen sollten zeitnah nachgezogen werden,
nicht auf unbestimmte Zeit liegen bleiben. Aus demselben Grund konnten
#1/#2/#3 NICHT gegen echte Daten getestet werden (kein Live-Test
moeglich, wenn die Spalte fehlt) — reiner Build-/Syntax-Check
(`node --check`, `npm run build`) ist gruen, ein echter Funktionstest
steht noch aus.

**Git**: nichts committed (Vorgabe: nur auf ausdruecklichen Nutzerwunsch
committen, hier nicht gegeben) — reine Arbeitsverzeichnis-Aenderungen.

## Neu: Remediation abgeschlossen, CLAUDE.md, zwei Plan-Luecken geschlossen (2026-08-27, Fortsetzung)
Direkte Fortsetzung des Eintrags direkt darueber (Code-Review-Fork war an
zwei Live-Schreibaktionen blockiert). Hauptsession hat von dort
uebernommen.

### Migrationen + n8n-Fixes nachgezogen, #1-#3 und #7/#8 jetzt echt getestet
Nutzer hat die beiden SQL-Migrationen selbst im Supabase SQL-Editor
ausgefuehrt (auf Nachfrage, da `apply_migration` fuer die Session
geblockt war) - per `execute_sql` verifiziert, dass beide Spalten korrekt
angelegt UND das Backfill korrekt lief (`p_konto_geprueft=true` genau bei
dem einen Fall mit vorhandenem `p_konto_benachrichtigt_am`).

n8n-Fixes fuer #7 (Fristversaeumnis-Idempotenz) und #8
(Status-Advancement) liess sich die Hauptsession selbst zutrauen -
`update_workflow` war NICHT geblockt (nur `apply_migration` war es), nach
einem Fehlversuch mit fragilem JSON-Pointer-Pfad (`/assignments/assignments/4/value`
schlug fehl, "cannot descend into non-object") auf `updateNodeParameters`
mit vollstaendigem Parameter-Objekt umgestellt - seitdem zuverlaessig.

**Dabei einen DRITTEN, bis dahin unbekannten Bug live gefunden**: die
Erinnerung-2/Erinnerung-1-Zweige pruefen nur ihren EIGENEN Marker in
`erinnerungen_gesendet`, nicht ob ein hoeherprioritaerer Marker
(`eskalation`) bereits gesetzt ist. Folge: einen Tag nach einer
Eskalation wuerde der Sweep zusaetzlich noch eine (niedriger
priorisierte) Erinnerung 2 nachschieben - Signal-Downgrade genau nach
einer Eskalation, plus ein doppelter Protokoll-Eintrag. Live reproduziert
(zwei Sweep-Laeufe hintereinander gegen `PF-TEST-CR08B`, zweiter Lauf
erzeugte tatsaechlich einen `erinnerung_2`-Eintrag NACH dem
`eskalation`-Eintrag). Nutzer nach Umfangserweiterung gefragt (Fund lag
ausserhalb des urspruenglichen Review-Berichts) - Zustimmung erhalten,
sofort mitbehoben (`erinnerung_2`/`erinnerung_1`-Zweige pruefen jetzt
zusaetzlich `!gesendet.includes('eskalation')` bzw. auch nicht
`erinnerung_2`), Fix live verifiziert (dritter Sweep-Lauf gegen denselben
Testfall: keine weitere Aktion mehr).

Alle drei n8n-Fixes einzeln ueber echte `execute_workflow`-Laeufe gegen
synthetische Testfaelle verifiziert, inkl. eines gezielt konstruierten
Partial-Failure-Szenarios fuer #7 (`erinnerungen_gesendet` manuell auf
`['fristversaeumnis']` gesetzt, `status` manuell auf `'Eingegangen'`
zurueckgesetzt, um genau den Zwischenzustand nachzustellen, der bei einem
Abbruch zwischen Protokoll-INSERT und Status-UPDATE entstehen wuerde -
kein zweiter Protokoll-Eintrag, korrekt). Workflow anschliessend
**published**. Checked-in `feldmark_fristueberwachung_postgres.json`
danach ein zweites Mal per Skript synchronisiert (jsCode + drei
`neuer_status`-Werte), damit der Datei-Stand nicht sofort wieder hinter
dem Live-Stand zurueckbleibt.

#1-#3 (dokumenttyp-Label/Panel, P-Konto-Tri-State, Sofort-Banner) live
gegen echte Browser-UI + DB getestet, nachdem die Migration lief:
synthetische Faelle mit `dokumenttyp='einziehungsverfuegung'`/
`'ueberweisungsverfuegung'` angelegt, korrektes Label + vollstaendig
gerendertes Detail-Panel bestaetigt (der vom Fork befuerchtete
Leer-Panel-Folgefehler trat NICHT auf - Panel rendert und zeigt
korrekterweise "Fall nicht gefunden", solange keine `erweiterung`-Zeile
existiert, das ist erwartetes Verhalten, kein Bug). P-Konto-Tri-State:
Guthaben-Speichern ohne P-Konto-Pruefung loest keine Benachrichtigung
aus; explizites "Kein P-Konto" loest sie aus UND der Bestaetigungs-Banner
erscheint sofort im selben Request (kein Reload noetig) - beides per
direkter DB-Abfrage nach jedem Schritt verifiziert. Alle Testfaelle
(Supabase + n8n-seitig keine Testdaten, da der Blocker vor jeder
Testausfuehrung griff) danach vollstaendig geloescht.

**Fehler waehrend dieser Session, transparent gemacht**: ein zu breiter
`pkill -f "node server/index.js"` / `pkill -f "vite"` beim Aufraeumen des
eigenen Dev-Servers hat versehentlich einen NICHT verwandten, vom Nutzer
selbst gestarteten Dev-Server eines anderen Projekts
(`~/Desktop/instant/site`, seit Freitag gelaufen) mitbeendet, weil die
Muster nicht nach Arbeitsverzeichnis/PID gefiltert waren. Sofort erkannt
und dem Nutzer gemeldet, NICHT eigenmaechtig neu gestartet (fehlende
Kenntnis der genauen Startbedingungen). Feedback dazu lokal
vorbereitet (`SendFeedback`). Ab da: eigener Dev-Server nur noch gezielt
per gemerkter PID beendet, nicht mehr per generischem `pkill -f`.

### CLAUDE.md erstellt (`/init`) + um "Project plan" ergaenzt
Erstmaliges `CLAUDE.md` fuers Repo - Befehle (kein Lint/Test vorhanden),
der wichtige, nicht offensichtliche Datenbank-Pooler-Stolperstein
(`.env.example` zeigt die falsche, direkte Connection-String-Form),
Repo-Layout-Erklaerung (nur `feldmark_app/` ist Code, Rest sind
Migrationen/n8n-Exporte/Analyse-Dokumente), n8n-Export-Staleness-Warnung
(direkt aus dem Fund oben abgeleitet), Cloud-Ressourcen, Architektur,
Kernentscheidungen. Auf Nutzerwunsch danach ein "Project plan"-Abschnitt
ergaenzt: Projektrichtung (bewusst schmal statt breites Intranet),
Definition-of-Done aus `pfaendungs-bauplan.pdf` (mit Klarstellung, dass
dessen generische Tabellennamen KEIN Schema-Vorbild sind), bekannte
Luecken gegen diese Checkliste, Priorisierungslogik fuer naechste
Schritte - alles aus tatsaechlich vorhandenen Quellen (KONTEXT.md,
README, Bauplan) synthetisiert, nichts erfunden.

### Zwei Plan-Luecken geschlossen: Testmatrix + Ablehnen-Pfad
Nutzer fragte nach dem naechsten logischen Schritt gemaess Plan; Empfehlung
war, nicht blind alle "Luecken" abzuarbeiten (drei davon sind bewusste
Portfolio-Grenzen, keine echten Luecken), sondern die zwei billigen,
eindeutig unfertigen: Testmatrix + Ablehnen-Pfad. Nutzer stimmte zu.

**`docs/testmatrix.md`**: konsolidiert saemtliche verstreuten Testnachweise
aus `KONTEXT.md` (Klassifikation/Routing, Pfaendungsblock, Datendiskrepanz,
Auskunftsersuchen, n8n-Sweeps) in einer Tabelle mit ehrlicher
Ampel-Kennzeichnung (✅ live verifiziert / ⚠️ nur indirekt aus Code
abgeleitet / ❌ echte Luecke) statt alles pauschal als "getestet" zu
behaupten. Einzige echte ❌-Luecke ohne jede Testspur: HEIC/HEIF-Upload-
Konvertierung.

**Ablehnen-Pfad** fuer Drittschuldnererklaerung UND Auskunftsersuchen-
Antwort (`POST .../erklaerung/ablehnen`, `.../antwort/ablehnen`). Vorab per
Recherche-Fork die Ausgangslage exakt geklaert (Routen/DB-Funktionen/
Status-Constraints/Protokoll-Schema), dann dem Nutzer zwei Design-Optionen
mit Empfehlung vorgelegt statt selbst zu entscheiden: (A) neuer Terminal-
Status "Abgelehnt" mit Migration, oder (B) den bereits bestehenden, aber
bislang STILLEN Geprueft-Reset aus `speichereErklaerung()`
(regeneriert man eine Erklaerung, faellt der Status ohnehin schon auf
"Geprueft" zurueck) zu einer expliziten, protokollierten Aktion machen -
keine neue Spalte noetig. Nutzer waehlte (B).

Umgesetzt: `db.lehneErklaerungAb()`/`lehneAntwortAb()` (setzen
Freigabe-Nachweis zurueck, Fall-Status auf "Geprueft", NUR moeglich
solange `..._versendet_am IS NULL` - nach bestaetigtem Versand
serverseitig blockiert), neue Protokoll-Ereignisse
`erklaerung_abgelehnt`/`antwort_abgelehnt` (in `EREIGNIS_LABEL` ergaenzt,
oxblood wie alle anderen kritischen Ereignisse), neuer "Ablehnen"-Button
(eigene CSS-Modifier-Klasse, oxblood-Outline) in beiden
Erweiterungs-Komponenten, sichtbar solange der Fall nicht versendet ist.

Vollstaendig getestet: alle drei Zustandsuebergaenge (vor Freigabe / nach
Freigabe vor Versand / nach Versand blockiert) fuer BEIDE Faelle per
direkten API-Aufrufen gegen synthetische Testfaelle, plus ein
Browser-UI-Durchklick (Button rendert korrekt in eigenem Rot-Stil, Klick
schliesst Modal, neues Ereignis erscheint sofort im Aktivitaets-Feed UND
im Fall-Verlauf mit korrektem Label). Testfaelle danach vollstaendig aus
allen betroffenen Tabellen geloescht, Dev-Server diesmal gezielt per PID
beendet (nicht per `pkill -f`).

`CLAUDE.md`s "Known gaps"-Abschnitt aktualisiert: beide Punkte als
"Closed (2026-08-27)" markiert, mit Verweis auf `docs/testmatrix.md` und
kurzer Design-Begruendung fuer den Ablehnen-Pfad.

**Git**: weiterhin nichts committed (keine ausdrueckliche Nutzeranfrage).

## Neu: README fürs GitHub-Repo, Repo public, Bug-Fix aus Schwester-Projekt uebernommen (2026-08-27)
Drei kleinere, in sich abgeschlossene Aufträge in Folge.

**README.md** fürs GitHub-Repo `feldmark-bank-ag` erstellt (vorher leer) — Elevator
Pitch, drei echte Screenshots (Posteingang, Fallübersicht, Prozessdiagramm, per
Playwright/Headless-Chrome aus der laufenden App erzeugt, da die Browser-Pane-
Screenshots selbst nicht als Datei greifbar sind), Mermaid-Architekturdiagramm,
Tech-Stack-Tabelle, Verweise auf die vier bestehenden Analyse-Dokumente statt
Duplizierung, sowie ein bewusster "Bewusste Grenzen"-Abschnitt (kein echter
Versandkanal, keine Kernbank-Anbindung, kein Auth). Vor dem Schreiben Repo-
Historie + Working Tree auf Secrets geprüft (nur der `[DB-PASSWORT]`-Platzhalter
in `.env.example` gefunden, sonst nichts) — danach auf Nutzerwunsch das Repo
von privat auf **public** gestellt und eine kurze Repo-Beschreibung gesetzt.

**Bug-Fix aus einem Schwester-Projekt übernommen**: Nutzer hat parallel ein
zweites, engeres Portfolio-Stück (`~/Desktop/fintech-portfolio/03-feldmark-
fristueberwachung`, eigenes GitHub-Repo `feldmark-fristueberwachung`) aus genau
denselben LIVE n8n-Workflows und derselben Supabase-Instanz aufbereitet, die
auch dieses Projekt nutzt (keine Kopie — dieselbe Workflow-ID `vAHlgWXDJXIS2cps`).
Dabei wurde dort ein echter Bug im Auskunftsersuchen-Sweep gefunden und bereits
live gefixt: der Node "Protokoll schreiben (KPI-Basis)" nutzte `queryReplacement`
als EINEN kommagetrennten String; da `empfaenger` bei Eskalationen selbst
mehrere kommagetrennte Adressen enthält, hat n8n das interne Komma faelschlich
als zusaetzlichen Parametertrenner gelesen — alle nachfolgenden Werte
verschoben sich, wodurch die Spalte `prioritaet` teils eine E-Mail-Adresse statt
"kritisch"/"hoch" enthielt.

Per direktem API-Vergleich beider Workflows festgestellt: derselbe Bug steckte
**unbehoben** im Pfaendungs-Sweep (`Ix9jAYFWgh73fPv9`, unser Workflow) — dessen
"Protokoll schreiben"-Node hatte noch die alte, kommagetrennte String-Form.
Identischen Fix übertragen (`queryReplacement` als Array-Ausdruck statt String),
live getestet: synthetischer Testfall `PF-TEST-BUGFIX` mit 3 kommagetrennten
Empfängern (Eskalation) und danach 2 Empfängern (Erinnerung 2, zweiter Lauf) —
beide Male `empfaenger` vollständig und `prioritaet` korrekt (`kritisch`/`hoch`),
kein Parameter-Shift mehr. Testfall danach komplett aus
`feldmark.pfaendung_protokoll` und `feldmark.pfaendung_faelle` gelöscht,
Workflow-Draft published (wirkt sonst nicht auf den produktiven
Schedule-Trigger). Restliche Inhalte des Schwester-Projekts (reverse-
engineertes Schema, Fehler-Alert-Workflow) sind deckungsgleich mit unserem
Stand, keine weiteren Abweichungen gefunden.

## Neu: Debugging, Supabase-Reorganisation, Redesign, Prozess-Sichtbarkeit (2026-08-14, Fortsetzung)
Direkte Fortsetzung derselben Session wie der Eintrag darunter (Datendiskrepanz-
Sweep-Verkabelung). Nutzer kam mit "ich habe grade getestet, failed to fetch"
zurück und die Session entwickelte sich von dort in mehrere Richtungen. Größter
Umfang der Session bisher — nichts davon ist committed, siehe Abschnitt ganz
unten.

### Debugging (kein Code-Bug, zwei echte Umgebungsprobleme)
- **"failed to fetch"**: Dev-Server lief schlicht nicht mehr. Dabei zusätzlich
  entdeckt: mein Terminal-Zugriff auf `~/Desktop/...` war komplett weg
  (macOS-Berechtigung "Volluzugriff auf Festplatte" für die Claude-App
  verloren) — durch Neustart der Claude-App behoben, nicht code-seitig.
- **Server neu gestartet, Upload getestet**: beide Pipelines (Pfändung +
  Auskunftsersuchen) end-to-end über die echte Browser-UI bestätigt.
- **Vom Nutzer gemeldeter HTTP 500**: beim Nachschauen in den Netzwerk-Logs
  gefunden, dass `GET /api/faelle` und `GET /api/sichtpruefung` kurz nach
  einem Upload viermal mit 500 fehlschlugen — die genaue Fehlermeldung war
  nicht mehr abrufbar (Puffer bereits verworfen), aber dabei eine echte
  strukturelle Lücke gefunden: **der Server loggt Fehler nirgends**, nur in
  der HTTP-Antwort selbst. `console.error` in allen zehn `catch`-Blöcken in
  `server/index.js` sowie in `verarbeiteDatei()` ergänzt — künftige 500er
  sind jetzt im Terminal sichtbar, statt spurlos zu bleiben.
- **"Forderungshoehe fehlt" beim Erzeugen der Drittschuldnererklärung**:
  kein Bug, sondern korrektes fail-closed-Verhalten — alle bestehenden
  Seed-Fälle wurden angelegt, bevor `legePfaendungsfallAn()` gelernt hat,
  `forderung_gesamt_eur` zu speichern, und das Formularfeld ist bewusst
  read-only. Zur Verifikation ein fiktives, sauber gerendertes PfÜB-PDF
  gebaut (HTML → Headless-Chrome-PDF) und durch die volle Pipeline
  geschickt: Autofall korrekt mit Forderungshöhe angelegt, Guthaben erfasst,
  Drittschuldnererklärung erfolgreich erzeugt. Testfall danach komplett
  entfernt.

### Drittschuldnererklärung als Modal statt Inline-Block
Auf Nutzerwunsch ("wie es aussieht… dass ein Fenster rauskommt"): die
erzeugte Erklärung erscheint jetzt in einem echten Popup (öffnet automatisch
beim Erzeugen, Schließen per ×/Klick-außerhalb/Escape, über einen
"Erklärung anzeigen"-Button jederzeit erneut aufrufbar). Freigabe,
Vier-Augen-Warnung und Versand-Bestätigung laufen unverändert innerhalb des
Modals — live inklusive Vier-Augen-Override getestet.

### Supabase-Reorganisation: eigenes Schema statt `public`
Nutzer fand `public` unübersichtlich — dort lagen die 7 `feldmark_*`-Tabellen
gemischt mit Tabellen aus zwei fremden Kurs-Projekten (Reifegrad-Checker,
ein Beschaffungs-Beispiel), die dasselbe Supabase-Projekt mitnutzen. Alle 7
Tabellen + 4 Sequenzen (inkl. zwei eigenständiger `..._fall_seq`, die vorher
in keiner Schema-Datei dokumentiert waren) per `ALTER ... SET SCHEMA` +
`RENAME` ins neue Schema **`feldmark`** verschoben, Tabellennamen dabei um
das redundante `feldmark_`-Präfix gekürzt (`feldmark.pfaendung_faelle` statt
`public.feldmark_pfaendung_faelle`). Betraf `server/db.js` (58 Fundstellen),
zwei Literal-Strings in `server/index.js`, drei Kommentare in
`pkonto_drittschuldner.js`, alle 5 lokalen `.sql`-Schema-Dateien (inkl.
Nachtrag der bisher fehlenden Sequenz-Definitionen) und **alle
Postgres-Nodes in beiden täglichen n8n-Sweep-Workflows** (11 Nodes im
Pfändungs-, 3 im Auskunftsersuchen-Workflow) — beide Workflows danach
published. Verifiziert: frischer Upload → Autofall über die neue Sequenz →
bestehenden Fall über die UI geöffnet (JOIN-Pfad) → beide n8n-Workflows live
ausgeführt, liefern reale Daten aus dem neuen Schema zurück.

### Redesign ("intuitiver, freundlicher, präsentabler", `/frontend-design`)
Bestehende Signaturelemente verstärkt statt neu erfunden — Stempel- und
Fristleiste-Motiv waren im Code selbst schon als "Signaturelement"
dokumentiert, nur blass umgesetzt:
- Neues Farbsystem: tiefes institutionelles Marineblau (`--brand`, trägt
  Sidebar/Primäraktionen) + Messing/Bronze als sparsamer Siegel-Akzent
  (`--brass`) statt des generischen KI-Terracotta; Statusfarben vertieft für
  mehr Kontrast; Radius 3px → 8/12px.
- Dunkle Marine-Sidebar mit handgezeichnetem SVG-Siegel (Grenzstein-Motiv,
  aus "Feldmark" abgeleitet) statt flacher weißer Fläche.
- Stempel: kräftigere Ringe, Tinten-Textur per layered radial-gradient.
- Fristleiste: größer, Fallzeile bekommt zusätzlich einen farbigen
  Rand-Akzent bei kritischen/fälligen Fristen (`:has()`-Selektor,
  progressive enhancement) — auf einen Blick scanbar.
- Solide Primärbuttons statt reinem Outline-Look, größere Typo-Skala,
  echte Panel-Tiefe. Desktop + Mobile, alle Screens, Fokuszustände geprüft.

### Prozesse hinter den Kulissen sichtbar machen
Erst gebrainstormt (4 Optionen), dann alle vier umgesetzt:
1. **Fall-Verlauf**: Timeline pro Fall aus den längst bestehenden, aber nie
   angezeigten Protokoll-Tabellen (`feldmark.pfaendung_protokoll` /
   `-auskunftsersuchen_protokoll`) — reine Audit-Daten-Leiche endlich
   sichtbar gemacht. Nebeneffekt: Auskunftsersuchen-Fallzeilen sind jetzt
   ebenfalls aufklappbar (vorher nur Pfändungsblock — kein fachlicher Grund
   dagegen gefunden, nur fehlte bisher der Inhalt dafür).
2. **Aktivitäts-Feed**: fallübergreifende Zeitleiste (UNION ALL über beide
   Protokoll-Tabellen + JOIN für Kontext), Ereignis-Labels/Farben aus
   `dokumenttypen.js` zentralisiert, von Fall-Verlauf und Feed gemeinsam
   genutzt.
3. **Layout-Fix**: Nutzer bemängelte, der Aktivitäts-Feed sei "ganz unten
   versteckt" — Fallübersicht auf Haupt-/sticky-Seitenspalte umgebaut
   (rechts: Sweep-Status + kompakter Feed, bleibt beim Scrollen sichtbar).
   Dabei echte Regression gefunden+behoben: die schmalere Hauptspalte schnitt
   Parteinamen zu stark ab — Status aus der eigenen Grid-Spalte in eine
   zweite Zeile unter dem Namen verschoben (4-spaltig → 3-spaltig).
4. **n8n-Sweep-Status**: neue Tabelle `feldmark.sweep_status`, die **n8n
   selbst schreibt** (nicht die App über die n8n-API — kein neues API-Token
   nötig, gleiches "n8n schreibt, App liest"-Prinzip wie überall sonst im
   Projekt). Beide Sweeps schreiben optimistisch "erfolgreich" direkt beim
   Start (parallel zum bestehenden Trigger-Fan-out, kein Umbau der
   vielverzweigten bestehenden Workflows nötig); der gemeinsame
   Fehler-Alert-Workflow überschreibt auf "fehler" samt Fehlermeldung, falls
   ein Lauf danach wirklich abbricht (Sweep-Name aus `workflow.name`
   abgeleitet). Beide Erfolgs-Pfade live getestet; der Fehler-Pfad ließ sich
   nicht manuell auslösen (Error-Trigger-Workflows sind nicht direkt
   ausführbar) — nur durch Konstruktion verifiziert (gleiche bereits
   bewiesene UPSERT-SQL, gleicher bereits im selben Workflow verwendeter
   `$json.workflow?.name`-Ausdruck).
5. **Prozess-Diagramm**: neuer dritter Tab mit handgebautem SVG-Flussdiagramm
   (Posteingang → OCR → Klassifikation → Routing-Raute →
   Sichtprüfung/Autofall-Merge → Fallakte/Supabase → Fristüberwachung/n8n →
   vier Ereignis-Chips) plus zwei kurzen Erläuterungstexten. Bug beim Bauen
   gefunden+behoben: der dunkle Fristüberwachungs-Kasten renderte doppelten
   Text (unsichtbarer dunkler Text unter dem weißen) — sauber über eine
   Textfarben-Option der gemeinsamen `Box()`-Hilfsfunktion gelöst statt nur
   überdeckt.

### Stand am Ende der Session
Nichts von alledem war zu diesem Zeitpunkt committed — reine
Arbeitsverzeichnis-Änderungen (`git status` zeigte 14 geänderte + 5 neue
Dateien). Auf ausdrücklichen "handoff"-Wunsch des Nutzers wird dieser
Eintrag zusammen mit allen Änderungen jetzt committed (lokal, kein Push,
wie durchgehend in diesem Projekt).

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

## Erledigt: Claude-Code-Hooks + Testmatrix-Lücke A10 (HEIC) angegangen + Abschlussbericht (2026-09-02)

Auf Anfrage nach einer Automations-/Hook-Analyse zwei Claude-Code-Hooks
eingerichtet und live geprüft (`.claude/settings.json`, `.claude/hooks/`):
PreToolUse blockiert Read/Edit/Write auf `feldmark_app/.env` (DATABASE_URL
inkl. Passwort, MISTRAL_API_KEY), PostToolUse fuehrt nach Edit/Write an
`server/<name>.js` automatisch die passende `<name>.test.js` per
`node --test` aus, falls vorhanden. Committed (`f542ff9`).

Danach die Testmatrix-Lücke **A10 (HEIC-Upload, bislang ❌ ohne jede
Testspur)** angegangen: `feldmark_app/server/convert.test.js` neu angelegt
(bisher gar keine Tests fuer `convert.js`). Dabei Root-Cause-Fund: ein
"echtes HEIC" liess sich in dieser Umgebung nicht synthetisieren —
`sharp().heif({compression:'av1'})` erzeugt ein **AVIF** (Major-Brand
"avif"), kein HEIC (Major-Brand "heic"/"mif1", HEVC-codiert); `heic-decode`
prueft genau diese Brand-Bytes und lehnt das AVIF zu Recht als
"input buffer is not a HEIC image" ab. `compression:'hevc'` schlaegt im
lokalen libvips-Build mit "Unsupported compression" fehl (HEVC-Encoding ist
patentbelastet, selten mitgebaut). Ergebnis: MIME-Dispatch, PDF-/PNG-/JPEG-
Passthrough, generische Bildkonvertierung (WEBP→PNG) und der Fehlerfall
sind jetzt echt getestet (5 neue gruene Tests); die zwei Tests fuer den
eigentlichen HEIC-Decode-Pfad sind vorbereitet, aber mit klarem Grund
uebersprungen (`skip`), bis eine echte HEIC-Datei unter
`muster_dateien/heic-testbild.heic` liegt (z. B. ein unbearbeitetes
iPhone-Foto) — bewusst kein Fake-Fixture, das den Test nur "gruen luegt".
`docs/testmatrix.md` A10 entsprechend von ❌ auf ⚠️ aktualisiert (Zeile +
"Offene Lücken"-Absatz); Zählung der Gesamtmatrix neu verifiziert: 46
Zeilen, 39 ✅, 7 ⚠️, 0 ❌.

Anschliessend `docs/abschlussbericht.md` neu geschrieben (Bauplan PH-09,
"kurzer Abschlussbericht: automatisiert / entfaellt / bleibt beim
Menschen") — fasst README "Kernfunktionen"/"Bewusste Grenzen",
`docs/HITL-GRENZEN.md` und `docs/testmatrix.md` zusammen statt sie zu
duplizieren, mit den oben verifizierten Zahlen.

**Noch offen für die Präsentation** (unverändert seit README/CLAUDE.md):
echter Versandkanal und Self-Service-Statuslink sind bewusst nicht gebaut,
Entscheidung ob das vor Abgabe noch umgesetzt oder als bewusste Grenze
präsentiert wird steht noch aus. Ausserdem im Arbeitsverzeichnis unabhängig
davon offene, noch nicht committete UI-Politur (Dokumenttyp-Badge-Farben in
`Falluebersicht.jsx`/`dokumenttypen.js`/`index.css`) sowie ein vermutlich
versehentlicher Tippfehler in `klassifikations_schema.md` (Zeile 2, ein
alleinstehendes "2") — dem Nutzer gemeldet, nicht selbststaendig
korrigiert, da nicht Teil dieser Aufgabe.

## Offene Fragen / bekannte Probleme

- **HEIC-Dekodierung**: Code-Pfad implementiert und End-to-End verdrahtet
  (`Dropzone.jsx`-Accept-Liste → `istUnterstuetzterTyp()`/
  `normalisiereFuerOcr()` in `server/convert.js` → `heic-convert`), aber
  innerhalb dieses Projekts nie mit einer echten HEIC-Datei verifiziert.
  Details/Testnachweis: `docs/testmatrix.md` A10.
