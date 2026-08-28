# Human-in-the-Loop-Grenzen — Feldmark Bank AG

RALPH-PROGRESS.md Backlog #2. Für jeden Prozessschritt: läuft er automatisch,
oder braucht er eine menschliche Freigabe — und warum. Jede Zeile mit
"Ja (Gate)" ist unten unter [Verifikation](#verifikation) mit einem konkreten
Code-Verweis und einem automatisierten Test belegt, nicht nur behauptet.

Referenzrahmen: `pfaendungs-bauplan.pdf` PH-02 nennt vier Beispielzeilen
(Datenabgleich automatisch, Konto sperren automatisch, Überweisung/Entsperren
manuell). Dieses Projekt hat kein Kernbanksystem angebunden (siehe README
„Bewusste Grenzen") — „Konto sperren/entsperren" existiert hier nicht als
echte technische Aktion, sondern nur als protokollierte *Entscheidung*
(`entscheideSperre()`). Die Tabelle unten bildet deshalb die tatsächlichen
Schritte dieses Projekts ab, nicht die Bauplan-Beispielzeilen 1:1.

## Pfändung (Ast B — § 840 ZPO)

| Schritt | Automatisiert? | Freigabe durch | Begründung |
|---|---|---|---|
| OCR + Klassifikation | Ja | — | Reversibel, keine Außenwirkung. Bei niedriger Konfidenz/Plausibilität automatischer Fallback in die Sichtprüfung (kein separates Gate nötig — es ist bereits der Mensch-Pfad). |
| Fallanlage (`legePfaendungsfallAn`) | Ja | — | Reine Datenerfassung, keine Außenwirkung. |
| P-Konto-Status / Guthaben erfassen | Ja (Dateneingabe) | Sachbearbeitung gibt die Werte ein | Kein automatischer Datenabgleich mit einer Kernbank vorhanden — die „Automatisierung" hier *ist* die manuelle Eingabe, es gibt keinen weiteren Schritt zu gaten. |
| Drittschuldnererklärung **erzeugen** (Text) | Ja | — | Reiner Textentwurf, noch keine Außenwirkung — entspricht keinem Schritt aus der Bauplan-Tabelle, die erst ab „Überweisung" ein Gate verlangt. |
| Drittschuldnererklärung **freigeben** | **Nein — Ja (Gate)** | Sachbearbeitung | Inhaltliche Bestätigung vor Versand. Vier-Augen-Prinzip: dieselbe Person, die zuletzt das Guthaben erfasst hat, kann nicht ohne explizite Bestätigung freigeben (409 statt automatischem Durchlauf). |
| Versand **bestätigen** | Nein | Sachbearbeitung | Es gibt keinen echten Versandkanal (README „Bewusste Grenzen") — der tatsächliche Versand geschieht ohnehin außerhalb des Systems durch einen Menschen; dieser Schritt protokolliert das nur nachträglich. Kein Gate nötig, weil hier structurally nichts automatisiert werden *könnte*. |
| Erklärung **ablehnen** | Nein | Sachbearbeitung | Ablehnung ist selbst die menschliche Entscheidung — kein zusätzliches Gate über einer Ablehnung nötig. |

## Auskunftsersuchen (Ast E — §§ 161, 161a StPO)

| Schritt | Automatisiert? | Freigabe durch | Begründung |
|---|---|---|---|
| Fallanlage + Compliance-Info | Ja | — | Reversibel, informativ, keine Datenherausgabe. |
| Rechtsgrundlagenprüfung (E3, welche Punkte werden freigegeben) | Ja (Dateneingabe) | Sachbearbeitung wählt die Punkte | Legt fest, WAS später herausgegeben werden darf — noch keine Herausgabe selbst. |
| Antwort **erzeugen** (Text) | Ja | — | Reiner Textentwurf. |
| Antwort **freigeben** (= Datenherausgabe an Polizei/StA) | **Nein — Ja (Gate)** | Compliance/Sachbearbeitung | **Das ist der in der Aufgabenstellung explizit genannte Fall „Datenherausgabe an Polizei/Staatsanwaltschaft" — muss immer Freigabe erfordern.** Gleiches Vier-Augen-Gate wie bei der Drittschuldnererklärung (409 bei derselben Person wie bei der Rechtsgrundlagenprüfung). |
| Versand **bestätigen** | Nein | Sachbearbeitung | Wie oben — kein echter Versandkanal, rein protokollierend. |
| Antwort **ablehnen** | Nein | Sachbearbeitung | Wie oben. |
| Kontosperre-**Entscheidung** (E5) | Nein | Sachbearbeitung/Compliance | Löst **keine echte Kontosperre** aus (kein Kernbanksystem) — ist bereits zu 100% eine manuelle, protokollierte Entscheidung (`entschieden_von` ist Pflichtfeld). Kein zusätzliches Gate nötig, weil hier nichts automatisch passieren *könnte*, das gegated werden müsste. |

## Datendiskrepanz (Ast A — Sollkonzept 3.1)

| Schritt | Automatisiert? | Freigabe durch | Begründung |
|---|---|---|---|
| Rückfrage an Gläubiger (bei Fallanlage) | Ja | — | Reversibel, informativ. |
| Nachfassung 1 / 2 (Sweep) | Ja | — | Reine Erinnerungen, keine Außenwirkung. |
| **Fristwahrende Erklärung** (Tag 10, Sweep) | **Teilautomatisch — Ja (Gate danach)** | Sachbearbeitung | Der Sweep generiert und speichert nur den **Entwurf** (`speichereErklaerung`) und markiert den Status — er ruft **nicht** `gibErklaerungFrei`/`bestaetigeVersand` auf. Freigabe/Versand laufen über exakt denselben menschlichen Zwei-Schritt-Prozess wie eine regulär erzeugte Erklärung. Wichtig zu dokumentieren, weil es beim Lesen des Sweep-Codes nicht offensichtlich ist. |
| Reaktivierung (A4a, Schuldner nachtragen) | Nein | Sachbearbeitung | Route verlangt zwingend `schuldner_name` + `reaktiviert_von` (HTTP 400 sonst) — kann nicht ohne menschliche Eingabe passieren. |
| Schließung nach 30 Tagen (A4b, Sweep) | Ja | — | Reversibel im Sinn von: dokumentiert nur „keine ausreichende Antwort", keine Außenwirkung, kein Geld bewegt. |

## Fristüberwachung (n8n, täglich)

| Schritt | Automatisiert? | Freigabe durch | Begründung |
|---|---|---|---|
| Erinnerung 1 / 2, Eskalation, Fristversäumnis-Dokumentation | Ja | — | Interne Benachrichtigungen/Protokolleinträge, keine Außenwirkung, kein Geld bewegt, keine Daten herausgegeben. |

## Verifikation

Jede mit „Ja (Gate)" markierte Zeile oben ist serverseitig erzwungen, nicht
nur per UI-Warnung oder Kommentar behauptet — geprüft durch Lesen von
`server/index.js` (jede `/freigeben`-Route prüft `guthaben_erfasst_von`
bzw. `rechtsgrundlage_geprueft_von` gegen `freigegeben_von` und gibt bei
fehlender `vier_augen_bestaetigt`-Bestätigung **409 zurück, ohne die
freigebende DB-Funktion überhaupt aufzurufen** — der Request bricht vor
jeder Statusänderung ab) und bewiesen durch
`feldmark_app/server/hitl-gates.test.js` (`npm test`, 3 neue Tests, laufen
gegen den echten Express-Server als Kindprozess auf einem eigenen
Test-Port + die echte Supabase-DB):

```
✔ Vier-Augen-Gate (Drittschuldnererklaerung): ... blockiert (409) ... Status aendert sich NICHT
✔ Vier-Augen-Gate (Auskunftsersuchen-Antwort / Datenherausgabe an Behoerde): ... blockiert (409) ...
✔ Freigabe-Endpunkte lehnen einen Request komplett ohne 'freigegeben_von' ab (400) ...
```

Jeder Test bestätigt nicht nur den HTTP-Statuscode, sondern liest den
Fall-Status danach erneut aus der DB und prüft, dass er sich **nicht**
geändert hat — ein Gate, das nur die HTTP-Antwort verändert, aber die
Aktion trotzdem ausführt, würde diesen Test nicht bestehen.

**Bekannte Einschränkung (bewusst, siehe `CLAUDE.md`/`KONTEXT.md`):** das
Vier-Augen-Gate ist namensbasiert, kein echtes Auth-System (kein Login).
Es verhindert versehentliches Umgehen, keinen vorsätzlichen Missbrauch mit
einem falschen Namen — dokumentiert als Grenze, nicht als ungelöster Bug.
