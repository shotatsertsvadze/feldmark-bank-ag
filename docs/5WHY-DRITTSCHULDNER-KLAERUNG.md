# 5-Why — ein konkreter Fristausfall, fünf Ebenen tief

RALPH-PROGRESS.md Backlog #5. Portiert aus `Pfaendungsprozess_Methodenanwendung.html`
Abschnitt 4, hier als Markdown. Inhalt nicht neu erarbeitet.

**Ausgangssymptom** (wie in der Ist-Prozessbeschreibung geschildert, siehe
`docs/IST-PROZESS.md` und `KONTEXT.md` „Bus-Faktor bei Krankheit"): ein
Pfändungsfall gerät in Fristverzug, weil die zuständige Bearbeiterin
erkrankt.

| # | Frage | Antwort |
|---|---|---|
| Warum 1 | Warum führte die Erkrankung einer Person zu Fristverzug bei diesem Fall? | Weil niemand sonst wusste, dass der Fall existierte und wie weit er bearbeitet war. |
| Warum 2 | Warum wusste niemand sonst davon? | Weil der Bearbeitungsstand nur im Kopf der Bearbeiterin und in ihrer persönlichen Papierablage bzw. ihrem Postfach existierte, nicht in einem gemeinsam einsehbaren System. |
| Warum 3 | Warum existiert der Fall nicht in einem gemeinsamen System? | Weil es kein Fallobjekt mit Zustand gibt — nur Dokumente in Postkörben und Einträge in persönlichen Listen (deckungsgleich mit Sollkonzept 2.6, siehe `docs/ISHIKAWA-DURCHLAUFZEIT.md`). |
| Warum 4 | Warum wurde nie ein solches Fallobjekt eingeführt? | Weil der Prozess historisch mit geringem Volumen und einer Person auskam; die Notwendigkeit eines Systems mit Vertretungsfähigkeit entstand erst mit wachsendem Volumen (rechnerisch heute 2,8 VZÄ), wurde aber nie nachgezogen — der Prozess wuchs, die Struktur nicht. |
| Warum 5 | Warum wurde die Lücke bei wachsendem Volumen nicht vorher geschlossen? | Weil Digitalisierungsinvestitionen in der Praxis meist reaktiv statt präventiv priorisiert werden — erst nach einem sichtbaren Ausfall (hier: Kündigung wegen Überlastung, drohende Fristversäumnisse), nicht vorbeugend bei wachsendem Volumen. Kein individuelles Fehlverhalten, sondern ein verbreitetes Muster, wenn Kapazitätswachstum schrittweise statt sprunghaft passiert und jeder einzelne Schritt für sich noch „gerade noch machbar" wirkt. |

## Wurzelursache

Strukturell (fehlendes Fallobjekt mit Vertretungsfähigkeit), **nicht**
personell („die falsche Person war krank").

## Wie das gebaute System diese Wurzel adressiert — mit echten Code-Verweisen

Der 5-Why endet hier nicht bei einer Erkenntnis, sondern bei einer bereits
gebauten und getesteten Antwort:

- **Fallobjekt statt Wissen im Kopf:** `feldmark.pfaendung_faelle` /
  `auskunftsersuchen_faelle` führen Status und Historie unabhängig von
  einer Person. `feldmark_pfaendung_schema.sql`.
- **Vertretungsfähigkeit als feste Felder, nicht als Wissen:**
  `bearbeiter_email`/`vertretung_email`/`vorgesetzte_email` sind Spalten
  je Fall, erfasst bei Fallanlage (`legePfaendungsfallAn()`,
  `server/db.js`) — nicht etwas, das nur die zuständige Person kennt.
- **Automatische Eskalation unabhängig von Erreichbarkeit:** der tägliche
  n8n-Sweep (`Ix9jAYFWgh73fPv9`, 07:00 Uhr) adressiert Erinnerung 2 an
  `bearbeiter_email` **und** `vertretung_email` gemeinsam, und eskaliert
  bei 1 Tag Restlaufzeit zusätzlich an `vorgesetzte_email` — unabhängig
  davon, ob die ursprünglich zuständige Person krank, im Urlaub oder
  gekündigt ist. Getestet: `docs/testmatrix.md` E1–E4, live gegen die
  echte Datenbank verifiziert.
- **Audit-Trail statt „im Kopf":** jede Statusänderung erzeugt ein
  Protokoll-Ereignis (`feldmark.pfaendung_protokoll`/
  `auskunftsersuchen_protokoll`) — inzwischen lückenlos, siehe
  RALPH-PROGRESS.md Iteration 1 (Backlog #1), die neun bis dahin stumme
  Statuswechsel gefunden und geschlossen hat. Ein neuer Bearbeiter kann
  den vollständigen Verlauf eines Falls lesen, ohne die vorherige Person
  fragen zu müssen — das ist die direkte technische Antwort auf „Warum 2"
  oben.

## Grenze dieser Antwort

Die Automatisierung löst „niemand weiß vom Fall", nicht „niemand kann den
Fall inhaltlich bearbeiten" — Fachwissen (z. B. Rechtsgrundlagenprüfung bei
Auskunftsersuchen, E3) bleibt weiterhin an qualifizierte Personen gebunden,
bewusst nicht automatisiert (siehe `docs/HITL-GRENZEN.md`). Das 5-Why löst
den *Sichtbarkeits*-Engpass, nicht den *Kompetenz*-Engpass — beide waren im
Ausgangssymptom vermischt, sind aber unterschiedliche Probleme.
