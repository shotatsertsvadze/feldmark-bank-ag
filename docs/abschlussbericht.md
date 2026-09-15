# Abschlussbericht — Feldmark Bank AG

Kurzer Abschlussbericht gemäß `pfaendungs-bauplan.pdf` PH-09 ("was entfällt /
was wird automatisiert / was bleibt beim Menschen"). Details und Belege
liegen in `docs/HITL-GRENZEN.md` (Gate-für-Gate-Verifikation),
`docs/testmatrix.md` (Testnachweis) und `docs/nutzen.md` (Nutzenrechnung:
gemessene Durchlaufzeiten, offen deklarierte Aufwandsannahme) — hier nur die
Zusammenfassung. Der Ausgangsprozess steht in `docs/IST-PROZESS.md`, der
Zielprozess mit Umsetzungsstand je Schritt in `docs/SOLL-PROZESS.md`.

## Ausgangslage

Im Ist-Prozess hing die fristsichere Bearbeitung von Kontopfändungen (§ 840
ZPO) und behördlichen Auskunftsersuchen (§§ 161, 161a StPO) an einer
einzelnen Person, die wusste, was in welchem Papierordner lag. Bei Krankheit,
Urlaub oder Fluktuation kippte das sofort — zuletzt waren vier Personen für
dasselbe Volumen nötig, das vorher eine Person bewältigt hatte. Ziel dieses
Projekts war nicht, den ganzen Prozess der Maschine zu übergeben, sondern
genau die drei Schritte zu automatisieren, die sich tatsächlich sicher
automatisieren lassen — Erkennen, Routen, Überwachen — und dort einen
Menschen entscheiden zu lassen, wo Ermessen, Rechtsprüfung oder Geldbewegung
im Spiel sind.

## Was automatisiert wurde

- **Erkennen**: OCR + KI-Klassifikation in einem Aufruf (Mistral), inkl.
  Dokumenttyp, Fristangaben und strukturierten Feldern.
- **Routen**: fail-closed — fehlende Konfidenz zählt als *keine* Konfidenz,
  nie als automatisches Grünlicht. Nur plausible, hochkonfidente Fälle werden
  automatisch angelegt; alles andere landet sichtbar in der Sichtprüfung
  statt unbemerkt im Postkorb zu verschwinden. Erinnerungsschreiben werden
  gegen bestehende Aktenzeichen gematcht statt Duplikate anzulegen.
- **Überwachen**: zwei tägliche n8n-Sweeps (ZPO- und StPO-Fristlogik separat,
  da unterschiedliche Fristregeln) mit Idempotenzsperre — Erinnerungsstufen,
  Eskalation an Vorgesetzte und Fristversäumnis-Dokumentation laufen ohne
  tägliches manuelles Nachschauen.
- **Texterzeugung**: Drittschuldnererklärung und Auskunftsersuchen-Antwort
  werden deterministisch (nicht durch das Sprachmodell) aus den geprüften
  Falldaten erzeugt — vollständig, aber noch ohne Rechtswirkung, bis ein
  Mensch freigibt.
- **Prozess-Transparenz**: jeder Statuswechsel schreibt sich selbst ins
  Protokoll; Fall-Verlauf, fallübergreifender Aktivitäts-Feed und
  Sweep-Status im Dashboard entstehen aus denselben Audit-Tabellen, ohne
  zusätzliche Dokumentationsarbeit.

## Was bewusst beim Menschen bleibt

Jeder Schritt mit echter Außenwirkung — Geld bewegen, Daten an eine Behörde
herausgeben, eine rechtsverbindliche Erklärung versenden — hat ein
server-seitig erzwungenes Vier-Augen-Gate, kein UI-Hinweis, der sich
umgehen ließe:

- **Drittschuldnererklärung freigeben** (vor Versand) und **Auskunftsersuchen-
  Antwort freigeben** (= Datenherausgabe an Polizei/StA) sind die beiden
  Gates, die die Aufgabenstellung explizit verlangt. Beide blockieren mit
  HTTP 409, wenn dieselbe Person zuvor die zugrunde liegenden Daten erfasst
  hat — die freigebende Datenbankfunktion wird dabei gar nicht erst
  aufgerufen, nicht nur die Anzeige geändert.
- **Versand selbst** bleibt immer beim Menschen (kein echter Versandkanal,
  siehe unten) — das System bestätigt nur nachträglich, dass versendet wurde.
- **P-Konto-Status/Guthaben, Rechtsgrundlagenprüfung, Kontosperre-
  Entscheidung** sind bewusst Dateneingaben durch Sachbearbeitung/Compliance,
  nicht automatisch abgeleitet — es gibt keine Kernbank-Anbindung, gegen die
  automatisch abgeglichen werden könnte.

Vollständige Tabelle mit Begründung je Schritt: `docs/HITL-GRENZEN.md`.
Verifiziert durch `feldmark_app/server/hitl-gates.test.js` (läuft gegen den
echten Server + echte DB, prüft nicht nur den HTTP-Status, sondern dass der
Fallstatus sich bei blockierter Freigabe tatsächlich **nicht** ändert).

## Was bewusst nicht gebaut wurde (entfällt)

- **Echter Versandkanal.** Beide Sweeps bereiten Empfänger, Betreff und Text
  vollständig auf, senden aber nicht wirklich — der letzte Node fehlt
  absichtlich, bis geklärt ist, über welchen Kanal (E-Mail, Fax, Portal)
  ein realer Versand überhaupt laufen soll.
- **Kernbank-Anbindung.** Kontostände/Guthaben werden manuell erfasst
  (Annahme A7 im Sollkonzept) statt per API abgeglichen.
- **Auth-/Rollensystem.** Das Vier-Augen-Prinzip ist serverseitig
  durchgesetzt, aber namensbasiert statt durch echte Logins — verhindert
  versehentliches Umgehen, keinen vorsätzlichen Missbrauch mit falschem
  Namen.
- **Self-Service-Statuslink** (optionales Bauplan-Stretch-Goal, PH-07) —
  zurückgestellt, kein Teil des Kernumfangs.

Alle vier Punkte stehen bewusst hier und nicht versteckt im Code — Details
und Begründung je Punkt in README „Bewusste Grenzen".

## Nachweis

- **Audit-Trail**: jeder Statuswechsel in beiden Prozessen erzeugt einen
  Protokolleintrag automatisch, nicht als Zusatzschritt — Fall-Verlauf und
  Aktivitäts-Feed lesen direkt daraus.
- **Testmatrix** (`docs/testmatrix.md`, Stand 2026-09-02): 46 Testfälle über
  Erfassung, Pfändungsblock, Datendiskrepanz, Auskunftsersuchen und
  Fristüberwachung, davon 39 live gegen echte DB/UI/n8n verifiziert, 7 aus
  Code-Konstruktion abgeleitet (⚠️, technisch nicht isoliert auslösbar oder
  noch ohne reales Testdokument), keine einzige Zeile mehr ganz ohne
  Testspur (❌).
- **Code-Review**: ein vollständiger Review-Durchgang (`docs/code_review/
  2026-08-27-full-repo-review.md`) — jeder Befund (kritisch/hoch/mittel)
  wurde behoben und live gegen die echte DB/den echten n8n-Workflow erneut
  geprüft, nicht nur im Code geändert.

## Offen für die nächste Iteration

- Ein echtes HEIC-Testbild fehlt noch (`muster_dateien/heic-testbild.heic`)
  — die Konvertierungs-Dispatch-Logik ist seit 2026-09-02 getestet
  (`server/convert.test.js`), der eigentliche Bilddecodier-Pfad wartet auf
  ein reales Handyfoto als Fixture.
- Entscheidung, ob ein echter Versandkanal und/oder der Self-Service-Link
  noch vor Abgabe umgesetzt werden, oder ob beide bewusst als "nächster
  Schritt" in der Präsentation stehen bleiben.
