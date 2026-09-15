# Demo-Drehbuch — Live-Vorführung Feldmark Bank AG

Fester Klickpfad für die Abschlusspräsentation. Ziel: in ~8 Minuten einmal
durch beide Prozesse, inklusive der Stellen, an denen das System bewusst
*nicht* automatisch weitermacht.

## Vorher (5 Minuten vor Beginn)

1. `cd feldmark_app && npm run dev` — Backend 4300, Frontend 5291.
2. `http://localhost:5291` öffnen, Fallübersicht lädt ohne Fehlerbanner.
3. Sweep-Status-Kachel prüfen: beide Punkte grün. Gelb heißt „letzter Lauf
   älter als 26 Stunden" — dann vorher in n8n einmal manuell auslösen. Grün
   heißt seit 2026-09-15 wirklich „Lauf durchgelaufen": der Status wird am Ende
   des Sweeps geschrieben, nicht mehr beim Start.
4. Mistral-Kontingent prüfen: eine Testdatei hochladen. Kommt „Verarbeitung
   fehlgeschlagen", läuft der Account im Rate-Limit (HTTP 429) — dann Schritt 3
   (Sichtprüfung) als Demo des **Dead-Letter-Pfads** fahren: das Schreiben liegt
   trotz API-Ausfall in der Warteschlange und lässt sich dort manuell erfassen.
   Echtes Systemverhalten, kein Workaround — aber Schritt 1 und 5 (Autofall,
   Dublette) fallen dann aus.
5. Diese Dateien bereitlegen (alle in `muster_dateien/`):

| # | Datei | Zeigt |
|---|---|---|
| 1 | `PfUeB.jpg` | Sauberer Pfändungsfall → Autofall |
| 2 | `Auskunftsersuchen_StA_fiktiv.pdf` | Auskunftsersuchen → eigener Prozess, eigene Frist |
| 3 | `auskunftsersuchen-beim-arbeitgeber-zur-aufstellung-der-wahlerliste.jpg` | Plausibilitätsfalle: Wort „Auskunftsersuchen", aber kein Bankbezug → Sichtprüfung |
| 4 | `Antwort_ZIS_2016.jpeg` | Schlechter Scan → niedrige Konfidenz → Sichtprüfung |
| 5 | Datei 1 ein zweites Mal | Dublettenerkennung über das Aktenzeichen |

## Ablauf

### 1 — Posteingang: der Fristanker (1 min)

Datei 1 hochladen. **Vor** dem Klick auf „Verarbeiten" auf das Formular
zeigen: Zustelldatum, Kanal, Bearbeiter:in.

> „Das Zustelldatum kommt aus dem Umschlag, nicht aus dem Dokument. Das Feld
> existiert im JSON-Schema des Modells gar nicht — das Modell *kann* keine
> Frist setzen."

Ergebnis: Stempel mit Fall-ID, Typ „Pfändung".

### 2 — Fallübersicht: Fallakte, Frist, Verlauf (2 min)

Neuen Fall öffnen. Zeigen:
- Fristleiste (14 Tage, § 840 ZPO),
- Fall-Verlauf mit `Fall angelegt`,
- Aktivitätsfeed rechts.

> „Jeder Statuswechsel erzeugt eine Protokollzeile mit Fristende und
> Restlaufzeit — das ist der Audit-Trail, nicht ein Log."

### 3 — Die Sichtprüfungs-Schleife (2 min, Kernstück)

Dateien 3 und 4 hochladen → beide landen in der Sichtprüfung, mit Begründung
als Badge („konfidenz_typ unter Schwelle", „plausibilitaet_ok = false").

> „Fail-closed: ein fehlender Konfidenzwert zählt als *keine* Konfidenz, nie
> als Freifahrtschein."

Dann in der Warteschlange **„Sichtprüfung abschließen"** klicken:
- Datei 4: Felder korrigieren → **„Als Fall übernehmen"** → es entsteht eine
  echte Fallakte, im Verlauf steht `Aus Sichtprüfung übernommen`.
- Datei 3: **„Verwerfen"** mit Begründung „kein Bankbezug, Wahllisten-Aufruf".

> „Das ist der Rückweg, den das Prozessdiagramm zeichnet — er ist seit heute
> auch wirklich begehbar. Vorher war die Warteschlange eine Sackgasse."

### 4 — Vier-Augen-Gate (2 min)

Im Pfändungsfall aus Schritt 1:
1. Guthaben erfassen, P-Konto-Status, § 907 ZPO, Kontoart — mit Namen X.
2. „Drittschuldnererklärung erzeugen" → Text erscheint.
3. **Freigeben mit demselben Namen X** → HTTP 409, Warnung im UI.
4. Mit Namen Y freigeben → geht durch, Verlauf zeigt `freigegeben`.

Ehrlich dazusagen (Frage kommt garantiert):

> „Das ist ein weiches Gate: es gibt kein Login, die zwei Personen sind zwei
> Freitextfelder. Wer die Warnung übersteuert, wird protokolliert. Grenzen
> stehen in `docs/HITL-GRENZEN.md`."

Bonus, wenn Zeit: vorher einmal **ohne** § 907-Prüfung erzeugen → 422, kein
Text. Die Erklärung entsteht nicht mit ungeprüften Angaben.

### 5 — Auskunftsersuchen + Dublette (1 min)

Datei 2 hochladen → eigener Fall, eigene Frist aus dem Dokument (nicht 14
Tage pauschal). Datei 5 (= Datei 1 erneut) hochladen → als Dublette zum
bestehenden Aktenzeichen erkannt, kein zweiter Fall.

### 6 — Automatisierung (1 min)

Sweep-Status-Kachel + n8n-Workflow zeigen (Cron 07:00 / 07:15, Fristen-Node,
Idempotenz-Marker).

> „Was hier nicht passiert: verschickt wird nichts. Der Versandknoten ist ein
> Platzhalter, deshalb heißen die Ereignisse im Verlauf ‚versandbereit', nicht
> ‚gesendet'."

## Fragen, auf die vorbereitet sein

| Frage | Kurzantwort | Beleg offen haben |
|---|---|---|
| „Ist das ein KI-Agent?" | Nein, bewusst nicht. Ein Modellaufruf, keine Tools, keine Schleife, keine Autonomie. Alles nach der Extraktion ist deterministischer Code. | `datendiskrepanz.js` Kopfkommentar |
| „Wie vertrauenswürdig ist der Konfidenzwert?" | Selbstauskunft desselben Modells. Deshalb greifen zusätzlich OCR-Konfidenz, Pflichtfeldprüfung und Dublettenprüfung — und die Schwellen sind offen als Startwerte deklariert. | `klassifikations_schema.md` |
| „Was bringt das messbar?" | Sekunden statt Minuten bei der Erfassung, plus Fristsicherheit, die vorher am Gedächtnis hing. Aufwandsannahme offen deklariert, keine erfundene Fehlerquote. | `docs/nutzen.md` |
| „Was passiert, wenn die API ausfällt?" | Timeout, ein Wiederholungsversuch, danach Dead-Letter in die Sichtprüfung. Kein fristgebundenes Schreiben geht verloren. | `server/mistral.js`, `server/index.js` |
| „Wer darf freigeben?" | Namensbasiertes weiches Gate, kein Auth-System — offen dokumentiert. | `docs/HITL-GRENZEN.md` |
| „Zeig den Ist-Prozess" | `docs/IST-PROZESS.md`, Gegenüberstellung in `docs/SOLL-PROZESS.md`. | beide Dateien |
| „Zeig mir die n8n-Workflows" | Alle vier liegen als JSON im Repo, ohne Zugangsdaten — kein Login nötig, um sie zu lesen. | `feldmark_*.json` |
| „Personenbezogene Daten in einem Google Sheet?" | Ja, der Sync spiegelt Falldaten alle 10 Minuten. Demo-Komfort, würde so nicht in Produktion gehen. | `feldmark_google_sheets_sync.json` |

## Stand der Probe (2026-09-15)

Trocken durchgespielt, soweit ohne Modellkontingent möglich:

- Schritt 3 (Sichtprüfung übernehmen/verwerfen) gegen die echten HTTP-Routen
  geprüft — `server/sichtpruefung-loop.test.js`, 5 Tests grün.
- Schritt 4 (Vier-Augen-Gate, 409 + Override) — `server/hitl-gates.test.js`.
- Schritt 1/5 (Upload → OCR → Fallanlage) am 2026-09-15 **nicht** vollständig
  durchlaufbar: der Mistral-Account lief in ein dauerhaftes Rate-Limit
  (HTTP 429 auf `/chat/completions`, OCR lief normal). Der Dead-Letter-Pfad
  hat dabei gegriffen — alle drei Testdokumente landeten in der
  Sichtprüfungs-Warteschlange statt verloren zu gehen.

**Vor der Präsentation deshalb zwingend das Mistral-Kontingent prüfen** und den
vollen Pfad einmal live durchklicken.

## Nach der Demo

Angelegte Demo-Fälle und Warteschlangen-Einträge aufräumen (oder bewusst
stehen lassen, damit die Fallübersicht nicht leer wirkt — dann vorher
entscheiden, nicht währenddessen).
