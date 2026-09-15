# Ist-Prozess — Pfändung & Auskunftsersuchen (vor der Digitalisierung)

Beschreibt den manuellen Prozess, aus dem dieses System entstanden ist — die
Vergleichsbasis für `docs/SOLL-PROZESS.md` und für die Nutzenrechnung in
`docs/nutzen.md`.

Inhaltlich aus der Schwachstellenanalyse der frühen Projektphase, hier als
eigenständiges Markdown. Am 2026-08-30 zusammen mit der Methodik-Ebene aus dem
Repo entfernt, am 2026-09-15 bewusst wieder aufgenommen: die Ist-/Soll-Gegen-
überstellung gehört zum Abschlussprojekt, die Methodendokumente (Reifegrad,
Pareto, Ishikawa, 5-Why) bleiben absichtlich draußen — die liegen in den
Präsentationsunterlagen.

**Ausgangslage (KONTEXT.md, „Nickel"-Prozess):** Der reale Ist-Prozess wird
heute real von rund vier Personen bearbeitet, für ein Volumen, das früher
eine Person trug. Chaotische Papierablage, ein Bus-Faktor bei Krankheit
(Wissen über den Bearbeitungsstand eines Falls sitzt nur im Kopf einer
Person), eine Kündigung wegen Überlastung. Kein Kunstfehler einzelner
Personen — ein strukturelles Problem, siehe Abschnitt 5 unten.

Mengengerüst (fiktive Baseline, Sollkonzept Abschnitt 1): 525 Fälle/Monat,
davon 315 über den Papierkanal (60 %), 135 Nullguthaben-Fälle, 85
Teilguthaben-Fälle, 74 Polizei/StA-Anfragen, 38 Datendiskrepanz-Fälle.

## 1. Eingangskanal und Posteingang

Zwei Eingangstüren mit unterschiedlicher Qualität. Der Papierweg erzwingt
einen Medienbruch: ein Schreiben, das montags zugestellt, aber erst
dienstagnachmittag gescannt wird, hat bereits einen Tag von vierzehn Tagen
Frist verbraucht, bevor überhaupt jemand inhaltlich hingesehen hat.
Konservativ gerechnet gehen 0,5–1,5 Tage Latenz (4–10 % der Gesamtfrist)
verloren, bevor der Fall überhaupt existiert.

**Gefährlichste Einzelschwachstelle:** Der Fristlauf beginnt rechtlich mit
der *Zustellung*, nicht mit dem Scan. Wird bei manueller Erfassung das
Scandatum als Fristanker verwendet (der Normalfall, weil das Zustelldatum
auf dem Umschlag steht, nicht im Dokument), ist jede berechnete Frist
systematisch zu lang — der Prozess meldet Fristtreue, wo real bereits
Verzug eingetreten ist. Verdeckt sich selbst, deshalb besonders gefährlich.

## 2. OCR-Klassifikation

Es gab schon eine Klassifikation, aber ohne Konfidenzschwelle und ohne
definierten Zweifelspfad — Erkennungsfehler fallen nicht als Fehler auf,
sondern laufen als scheinbar korrekte Daten weiter. Ein falsch erkanntes
Aktenzeichen oder ein verrutschter Betrag erzeugt keinen Alarm, sondern eine
Datendiskrepanz, die dann fälschlich als „Gläubiger hat sich geirrt"
behandelt wird, obwohl der Fehler bei der eigenen Erfassung liegt.

Nur zwei statt der real vorkommenden sechs Dokumenttypen wurden
unterschieden. Keine Plausibilitätsprüfung — ein Dokument, das zufällig das
Wort „Auskunftsersuchen" enthält (z. B. eine betriebsinterne
Wählerlisten-Anfrage eines Arbeitgebers), wäre nicht von einem echten
Auskunftsersuchen einer Behörde unterscheidbar gewesen.

## 3. Datenprüfung und Identifikation des Schuldners

**Der schwerste strukturelle Fehler des Ist-Prozesses, prozesslogisch, nicht
technisch: Die Klärung blockiert die Frist.** Stimmen die Daten nicht,
geht der Fall in eine Klärungsschleife von 2–3 Tagen mit offenem Ausgang —
der Gläubiger ist telefonisch oft nicht erreichbar, sein Postfach wird
nicht überwacht. Rechtlich eine Fehlannahme mit Haftungsfolge: die Frist
läuft in beiden Fällen weiter, unabhängig davon, ob der Schuldner zugeordnet
werden konnte. Wer auf die Antwort des Gläubigers wartet, wartet auf Kosten
der eigenen Frist — obwohl die korrekte, fristwahrende Antwort
("Geschäftsverbindung unter den angegebenen Daten nicht feststellbar")
längst zur Verfügung stand.

Wirkung beim genannten Volumen: 38 Fälle/Monat × durchschnittlich 2,5 Tage
Blockade ≈ 95 Fall-Tage/Monat reiner Wartezeit — fast ein Fünftel des
14-Tage-Zeitbudgets, in einem Schritt, der die Frist nicht einmal wahrt.
**Der teuerste Einzelbefund der gesamten Analyse.**

## 4. Pfändbarkeitsprüfung und die drei Guthabenfälle

Alle drei Fälle (volles Guthaben, Teilguthaben, kein Guthaben) wurden mit
demselben Instrument behandelt: der Vollsperre.

- **Vollsperre statt Sperrbetrag:** Bei 400 € Forderung auf einem Konto mit
  2.000 € Guthaben wurde das gesamte Konto gesperrt — ein Vielfaches des
  eigentlichen Anspruchs, und der Hauptgrund für Kundenrückfragen (das Konto
  funktioniert komplett nicht mehr, nicht "es wurde etwas gepfändet").
- **Sperre bei Nullguthaben ist ein Zustand ohne Ausgang:** kein Auslöser,
  der den Fall wieder aufweckt, außer manuellem Nachsehen. Wächst zu einem
  reinen Bestand heran (135 Fälle/Monat) — mit dem Risiko, dass spätere
  Zahlungseingänge nicht abgeführt werden oder Konten gesperrt bleiben,
  deren Pfändung längst erledigt ist.
- **Reihenfolge Information vor Überweisung unbestimmt:** kein definierter
  Zeitpunkt für die Auszahlung, obwohl § 835 Abs. 3 ZPO eine
  Zwei-Wochen-Wartefrist vorschreibt. Rein bearbeitungsgesteuert ("wenn
  jemand dazu kommt") verletzt diese Frist zwangsläufig irgendwann in beide
  Richtungen — zu früh (rechtlich angreifbar) oder zu spät (Beschwerde).

## 5. Sonderfall Polizei und Staatsanwaltschaft

Lief im selben Postkorb wie die Pfändungen, obwohl das Risikoprofil ein
anderes ist: harte 14-Tage-Frist, Compliance-Beteiligung, vor allem ein
Vertraulichkeitsproblem. Auskunftsersuchen von Strafverfolgungsbehörden
dürfen dem Kunden in der Regel **nicht** mitgeteilt werden — im selben
Prozess wie Pfändungen, wo Kundeninformation der Normalfall ist, ist eine
versehentliche Kundenbenachrichtigung in einem Ermittlungsverfahren kein
Servicefehler, sondern potenziell strafbewehrt.

Zusätzlich ungeprüft: ob eine pauschale Kontosperre bei jedem
Behördenschreiben rechtlich gedeckt ist — ein reines Auskunftsersuchen
trägt keine Sperrbefugnis, die setzt eine Beschlagnahme oder einen
Vermögensarrest voraus.

## 6. Übergreifende Wurzel: kein Fall, nur Dokumente

Alle obigen Punkte laufen auf denselben Befund zu: **es gibt kein Objekt
„Fall" mit einem Zustand.** Nur Dokumente in Postkörben und Einträge in
persönlichen Listen. Daraus folgt zwangsläufig: keine belastbare
Fristüberwachung (niemand weiß, welche Fälle offen sind), keine
Vertretungsfähigkeit (Bearbeitungsstand liegt im Kopf einer Person), keine
Messbarkeit (keine Zeitstempel), keine Wiedervorlage (kein Zustand, an den
sich ein Timer hängen ließe), keine Revisionssicherheit (keine Historie).

Die vollständige Ursachenanalyse dazu (Ishikawa entlang vier Kategorien,
5-Why an einem konkreten Datendiskrepanz-Fall) liegt in den Präsentations-
unterlagen, nicht im Repo — bewusste Entscheidung vom 2026-08-30.

## Wie sich das im gebauten System auflöst

Siehe `docs/SOLL-PROZESS.md` für den Schritt-für-Schritt-Vergleich mit dem
tatsächlich Gebauten — kurz zusammengefasst: das Fallobjekt mit Status und
Historie (`feldmark.pfaendung_faelle`/`auskunftsersuchen_faelle` +
`..._protokoll`), der ausschließlich aus Upload-Metadaten stammende
Fristanker (nie aus Dokumenttext), die automatische Fristüberwachung mit
Eskalation an Vertretung/Teamleitung, und die parallel statt blockierend
laufende Datendiskrepanz-Klärung adressieren jeweils direkt einen der oben
genannten Befunde.
