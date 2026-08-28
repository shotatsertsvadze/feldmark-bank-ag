# Testmatrix — Feldmark Bank AG

Konsolidierte Übersicht aller Testfälle für den Soll-Prozess (Pfändung, Auskunftsersuchen,
Datendiskrepanz, Fristüberwachung). Schließt die in `pfaendungs-bauplan.pdf` (PH-08) und
`CLAUDE.md` genannte Lücke „keine konsolidierte Testmatrix, nur Ad-hoc-Tests" — die einzelnen
Testläufe selbst sind größtenteils bereits vorher passiert (siehe `KONTEXT.md`), hier werden sie
zum ersten Mal an einem Ort gesammelt, mit ehrlicher Kennzeichnung, was wirklich live verifiziert
wurde und was nicht.

**Legende:**
- ✅ **Verifiziert** — live gegen echte DB/UI/n8n getestet, Ergebnis dokumentiert (Quelle genannt)
- ⚠️ **Indirekt** — durch Code-Konstruktion/-Review abgeleitet, aber nicht mit einem echten
  auslösenden Fall live getriggert (z. B. weil der auslösende Zustand technisch nicht isoliert
  herstellbar ist, siehe jeweilige Anmerkung)
- ❌ **Offen** — bislang nicht getestet, echte Lücke

Stand: 2026-08-27. Bei neuen Tests: Zeile ergänzen/aktualisieren statt eine zweite Matrix anzulegen.

---

## A. Erfassung & Klassifikation (Routing)

| # | Fall | Erwartung | Status | Quelle/Anmerkung |
|---|---|---|---|---|
| A1 | Pfändungsschreiben, hohe Konfidenz, vollständige Pflichtfelder | Autofall angelegt | ✅ | 4 Musterdateien real durch Pipeline, `KONTEXT.md` „Getestet & bestätigt" |
| A2 | Auskunftsersuchen, hohe Konfidenz | Autofall angelegt | ✅ | wie A1 |
| A3 | `konfidenz_typ`/`konfidenz_betrag` unter Schwelle | Sichtprüfung | ✅ | Konfidenzschwellen-Kalibrierung 2026-08-13, live in Sichtprüfungs-Warteschlange sichtbar |
| A4 | `plausibilitaet_ok=false` trotz hoher Konfidenz | Sichtprüfung | ✅ | Plausibilitäts-Fallen (Wahllisten-Datei, Antwort_ZIS_2016) |
| A5 | Modell liefert `konfidenz_typ`/`konfidenz_betrag` als `undefined` (fail-closed-Fix) | Zählt als „keine Konfidenz" → Sichtprüfung, nicht automatisches Grünlicht | ⚠️ | Fix in `bestimmeRouting()` (`?? 0`) code-verifiziert, aber kein realer Fall mit echtem `undefined` vom Modell provoziert — Mistral liefert die Felder in der Praxis bislang immer |
| A6 | Erinnerungsschreiben mit auffindbarem Aktenzeichen | Gegen bestehenden Fall gematcht, kein neuer Fall | ✅ | `KONTEXT.md` „Getestet & bestätigt" |
| A7 | Erinnerungsschreiben, Aktenzeichen NICHT auffindbar | Sichtprüfung | ✅ | Seed-Fall `erinnerung_unbekannt.pdf`, live in Sichtprüfungs-Warteschlange |
| A8 | Doppeltes Aktenzeichen | Kein zweiter Fall, Duplikat-Verdacht gemeldet | ✅ | Seed-Fall `Auskunftsersuchen_StA_fiktiv.pdf` gegen AE-2026-0118 |
| A9 | OCR-Text > 12.000 Zeichen | Kürzungs-Flag erzwingt Sichtprüfung (auch für Auskunftsersuchen) | ⚠️ | Code-Pfad vorhanden, kein echtes Langdokument zum Live-Trigger verwendet |
| A10 | HEIC/HEIF-Upload (Handyscan) | Erfolgreiche Konvertierung vor OCR | ❌ | Kein dokumentierter Testlauf mit echter HEIC-Datei gefunden |

## B. Pfändungsblock — P-Konto & Drittschuldnererklärung

| # | Fall | Erwartung | Status | Quelle/Anmerkung |
|---|---|---|---|---|
| B1 | Volles Guthaben, kein P-Konto | Freigabe → Versand → Status „Erklaerung versandt" | ✅ | UI-Verifikation 2026-08-13, erneut 2026-08-27 (dokumenttyp-Fix-Test) |
| B2 | Teilweise gedeckt (P-Konto + Freibetrag) | Korrekter pfändbarer Betrag, Teilbetrag-Text | ✅ | 2026-08-13, „1.500 EUR ggü. 2.000 EUR → Teilbetrag-Fall" |
| B3 | Kein pfändbares Guthaben | Korrekte Nullbetrag-Erklärung | ✅ | Backend-Verifikation 2026-08-13 („4 Szenarien") |
| B4 | Mehrfachpfändung desselben Schuldners | Korrekte Rangfolge, vollständige Pflichtangabe-3-Liste | ✅ | 2026-08-13 Backend-Test |
| B5 | Forderungshöhe fehlt (NULL, alte Seed-Fälle) | Erzeugung schlägt fail-closed mit 422 fehl | ✅ | 2026-08-13 UI-Verifikation, erneut 2026-08-27 auf PF-2026-0481 (Regressionscheck nach UI-Politur) |
| B6 | Guthaben speichern OHNE P-Konto-Status zu prüfen (tri-state) | `p_konto_geprueft` bleibt `false`, KEINE Benachrichtigung ausgelöst | ✅ | 2026-08-27, Code-Review-Fix #2, live UI + DB geprüft |
| B7 | P-Konto explizit auf „Kein P-Konto" gesetzt | Benachrichtigung ausgelöst, Bestätigungs-Banner erscheint SOFORT (kein Reload nötig) | ✅ | 2026-08-27, Code-Review-Fix #2+#3, live UI + DB geprüft |
| B8 | Vier-Augen: Freigebende Person = zuletzt Guthaben erfasst | 409 + Warnung, Override möglich, protokolliert | ✅ | 2026-08-13 Nacht-Loop, erneut 2026-08-27 (ablehnen-Testreihe) |
| B9 | Vier-Augen: „Erfasst von" leer gelassen | Zählt als Warnfall, nicht als „unbedenklich" | ✅ | Code-Review-Fix 2026-08-13, live getestet |
| B10 | Erklärung neu erzeugen bei bereits freigegebenem/versandtem Fall | `fall.status` fällt korrekt auf „Geprueft" zurück | ✅ | Code-Review-Fund + Live-Test 2026-08-13 |
| B11 | **Erklärung ablehnen, vor Freigabe** | Status bleibt/wird „Geprueft", Text bleibt erhalten, Ereignis `erklaerung_abgelehnt` protokolliert | ✅ | 2026-08-27, neu gebaut + live getestet (API + Browser-UI) |
| B12 | **Erklärung ablehnen, nach Freigabe, vor Versand** | Freigabe-Nachweis zurückgesetzt, Status zurück auf „Geprueft" | ✅ | 2026-08-27, wie B11 |
| B13 | **Erklärung ablehnen, NACH bestätigtem Versand** | Serverseitig blockiert (404) — unveränderlich | ✅ | 2026-08-27, wie B11 |
| B14 | Einziehungsverfügung/Überweisungsverfügung (nicht „pfaendungsschreiben") | Korrektes Label in Fallübersicht/Feed, Detailpanel rendert vollständig (nicht leer) | ✅ | 2026-08-27, Code-Review-Fix #1, live UI + DB geprüft |

## C. Datendiskrepanz (Sollkonzept 3.1, Ast A)

| # | Fall | Erwartung | Status | Quelle/Anmerkung |
|---|---|---|---|---|
| C1 | Nur `schuldner_name` fehlt, Aktenzeichen + Gläubiger vorhanden | Fall trotzdem mit Platzhalter angelegt, Frist läuft sofort | ✅ | 2026-08-14 morgens |
| C2 | Sweep: Nachfassung 1 → 2 → fristwahrende Erklärung → 30-Tage-Schließung | Alle vier Pfade einzeln korrekt, Idempotenz bei wiederholtem Lauf | ✅ | 2026-08-14, n8n-Verkabelung |
| C3 | Reaktivierung über echte UI (Schuldner nachtragen) | Status korrekt zurück auf „Geprueft" | ✅ | 2026-08-14 morgens |
| C4 | Aktenzeichen ODER Gläubiger fehlt (nicht nur Schuldner) | Bleibt in normaler Sichtprüfung, KEIN Datendiskrepanz-Fall | ⚠️ | Aus Routing-Logik abgeleitet (bewusste Scope-Grenze), kein expliziter Testfall mit genau dieser Kombination dokumentiert |

## D. Auskunftsersuchen (Sollkonzept 3.5, Ast E)

| # | Fall | Erwartung | Status | Quelle/Anmerkung |
|---|---|---|---|---|
| D1 | Fallanlage | Compliance automatisch informiert (`compliance_informiert`-Ereignis) | ✅ | Live im Aktivitätsfeed/Protokoll sichtbar, jede Fallanlage ruft dies auf |
| D2 | Vertrauliches Ersuchen (§§ 161, 161a StPO) | Warnhinweis „keine Kundeninformation" in UI sichtbar | ✅ | Visuell bestätigt (AE-2026-0118/0130, VERTRAULICH-Badge) |
| D3 | Rechtsgrundlagenprüfung (E3): Punkte auswählen + Antwortwerte | Korrekt gespeichert, Antworttext nutzt nur freigegebene Punkte | ✅ | 2026-08-27, im Rahmen des Ablehnen-Tests durchlaufen; erneut 2026-08-27 (Regressionscheck) auf AE-2026-0118 — nur „Kontobestand" freigegeben, Antworttext listet korrekt nur diesen Punkt |
| D4 | Kontosperre NUR bei Beschlagnahme/Arrest im Schreiben selbst | Reines Auskunftsersuchen löst KEINE Sperre aus | ⚠️ | Backend-Logik (`entscheideSperre()`) vorhanden, kein dokumentierter Klick-Test über die echte UI gefunden |
| D5 | Vier-Augen bei Antwortfreigabe (`rechtsgrundlage_geprueft_von`) | Gleiche Person → 409-Warnung, Override protokolliert | ⚠️ | Strukturell identisch zu B8 (Code-Review bestätigt), aber kein dokumentierter Live-Test speziell für die Auskunftsersuchen-Seite mit dem 409-Pfad (2026-08-27 wurde nur direkt mit `vier_augen_bestaetigt:true` getestet) |
| D6 | **Antwort ablehnen** — vor Freigabe / nach Freigabe vor Versand / nach Versand | Gleiches Verhalten wie B11–B13 | ✅ | 2026-08-27, neu gebaut + live getestet (API + Protokoll-Event); erneut 2026-08-27 (Regressionscheck) über echte Browser-UI auf AE-2026-0118 — Status korrekt zurück auf „Geprueft", `antwort_text` bleibt erhalten, `antwort_abgelehnt`-Ereignis live im Protokoll |

## E. Fristüberwachung (n8n, täglich)

| # | Fall | Erwartung | Status | Quelle/Anmerkung |
|---|---|---|---|---|
| E1 | Pfändungs-Sweep: Erinnerung 1 | Ausgelöst, `erinnerungen_gesendet` erweitert, Status „Eingegangen" → „In Bearbeitung" | ✅ | 2026-08-27, live via `execute_workflow` (Fix für Status-Advancement-Regression) |
| E2 | Pfändungs-Sweep: Erinnerung 2 | Ausgelöst, idempotent bei Doppellauf | ✅ | 2026-08-13 (Idempotenz), 2026-08-27 (Status-Fix erneut geprüft) |
| E3 | Pfändungs-Sweep: Eskalation | Ausgelöst, Status bleibt/wird „In Bearbeitung", kein Downgrade bei bereits fortgeschrittenem Status | ✅ | 2026-08-27, inkl. Test mit Status „Geprueft" (bleibt unverändert) |
| E4 | Eskalation gefolgt von Erinnerung-2-Bedingung am Folgetag | Erinnerung 2 wird NICHT mehr nachträglich ausgelöst (Signal-Downgrade-Bug) | ✅ | 2026-08-27, neu gefundener + gefixter Bug, live reproduziert und danach als behoben verifiziert |
| E5 | Pfändungs-Sweep: Fristversäumnis | Dokumentiert, Status „Abgeschlossen mit Fristversaeumnis" | ✅ | 2026-08-27, live via `execute_workflow` |
| E6 | Fristversäumnis-Idempotenz bei Partial-Failure (Protokoll-INSERT ok, Status-UPDATE fehlgeschlagen) | Kein doppelter `fristversaeumnis`-Protokolleintrag beim nächsten Lauf | ✅ | 2026-08-27, künstlich simuliert (Status manuell zurückgesetzt, `erinnerungen_gesendet` behalten), Sweep erneut gelaufen — korrekt kein Duplikat |
| E7 | Auskunftsersuchen-Sweep: alle vier Aktionspfade | Wie E1–E5, eigene Fristlogik (StPO) | ✅ | 2026-08-13, „alle Aktionspfade ... zweimal hintereinander ... Idempotenz bestätigt" |
| E12 | Auskunftsersuchen-Sweep: Signal-Downgrade-Schutz (Eskalation bereits gesendet → erinnerung_2/1 dürfen nicht nachträglich feuern) | Kein Downgrade, wie E4 auf der Pfändungsseite | ✅ | 2026-08-28, RALPH-PROGRESS.md Iteration 3: live geprüft, Code-Node „Fristen berechnen (§ 161 StPO)" fehlte der am 2026-08-27 im Pfändungs-Node ergänzte Schutz trotz „1:1 Kopie"-Kommentar — jetzt live nachgezogen + published, Regel zusätzlich unit-getestet in `feldmark_app/server/fristlogik.test.js` |
| E8 | Fristende auf Wochenende/Feiertag | Verschiebung auf nächsten Werktag | ✅ | 2026-08-13 |
| E9 | Kompletter Sweep-Ausfall → Fehler-Alert-Workflow | `feldmark.sweep_status` wird auf „fehler" gesetzt samt Fehlermeldung | ⚠️ | Nur durch Konstruktion verifiziert — Error-Trigger-Workflows lassen sich in n8n nicht manuell auslösen, laut `KONTEXT.md` bereits so dokumentiert |
| E10 | `sweep_status` Erfolgs-Pfad (optimistisches „erfolgreich" bei Sweep-Start) | Dashboard-Panel zeigt aktuellen Lauf korrekt | ✅ | 2026-08-27 im Dashboard sichtbar bestätigt („heute, 09:59 Uhr") |
| E11 | Mehrere gleichzeitige Postgres-INSERT-Items in einem n8n-Lauf | Kein `pairedItem`-Mixup (`queryBatching: independently`) | ✅ | Ursprünglich früh gefunden+gefixt, seitdem in jedem weiteren Sweep-Test implizit mitverifiziert |

## F. Nicht Gegenstand dieser Matrix

- **RLS/Datenbankzugriffsrechte** — kein Anwendungstest, siehe `CLAUDE.md`: nicht bestätigt, ob echte RLS-Policies konfiguriert sind (die App verbindet direkt über `DATABASE_URL`).
- **Auth/Multi-User** — bewusst nicht gebaut (siehe README „Bewusste Grenzen"), daher kein Testfall.
- **Echter Versandkanal** — Platzhalter in beiden Sweeps, kein echter Sende-Node zum Testen vorhanden.

---

## Regressionscheck 2026-08-27 (nach UI-Politur)

Nach den rein visuellen Änderungen dieser Session (Tastaturzugänglichkeit der Fallzeilen,
Primär-/Sekundär-Button-Stile) wurde end-to-end geprüft, dass keine Funktionslogik betroffen ist:

- Backend/DB: alle GET-Endpunkte (`/api/faelle`, `/api/sichtpruefung`, `/api/aktivitaet`,
  `/api/sweep-status`, `/api/datendiskrepanz`, `/api/faelle/:id/protokoll`, `/api/faelle/:id/erweiterung`,
  `/api/faelle/:id/auskunftsersuchen-erweiterung`) liefern korrekte Live-Daten, 404 bei unbekanntem
  Fall geprüft.
- Frontend: keine Konsolenfehler (nur die vorbestehenden React-Router-v7-Future-Flag-Warnungen,
  unabhängig vom Projekt), KPI-Zahlen und Fallliste stimmen mit Backend überein.
- Voller Interaktionspfad live über echte Browser-UI durchgespielt (siehe B5, D3, D6 oben) — inklusive
  des neu gestalteten Primär-Buttons ("Antwort erzeugen"), des Fehlerpfads (422 fail-closed) und des
  Ablehnen-Buttons (`.nav-tabs__btn--ablehnen`).
- **Bewusst NICHT erneut ausgelöst:** die n8n-Sweeps (Fristüberwachung). Beide liefen heute bereits
  regulär (siehe `sweep-status`, 07:00/07:15 Uhr) und ein manueller Re-Run würde reale Fallzustände
  weiter (irreversibel) vorantreiben, z. B. PF-2026-0481 von „Eskalation gesendet" zu
  „Fristversäumnis". E1–E11 stützen sich daher weiter auf die zuletzt dokumentierte Live-Verifikation
  vom 2026-08-27 (siehe Tabelle E) — bei Bedarf auf Anfrage erneut auslösbar.
- Datendiskrepanz (C1–C4) aktuell nicht live nachstellbar — kein offener Datendiskrepanz-Fall im
  System (`/api/datendiskrepanz` liefert `[]`); Code-Pfad seit 2026-08-14 unverändert.

## Offene Lücken auf einen Blick

Aus A–F: A5, A9, A10, C4, D4, D5, E9 sind entweder nur indirekt (⚠️) oder gar nicht (❌)
verifiziert. Von diesen ist **A10 (HEIC-Konvertierung)** die einzige echte ❌-Lücke ohne jede
Testspur — alle anderen wurden zumindest einmal durch Code-Konstruktion abgeleitet oder sind aus
technischen Gründen (E9) nicht isoliert auslösbar.
