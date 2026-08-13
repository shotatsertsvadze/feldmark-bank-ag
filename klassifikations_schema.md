# Klassifikations- und Extraktionsschema — Feldmark Bank AG

Grundlage: `muster_dateien/PfUeB.jpg` (echter Amtsgerichts-Vordruck), `muster_dateien/Auskunftsersuchen_StA_fiktiv.html` (fiktiv, rechtlich abgesichert über §§ 161, 161a, 95 StPO). Für Einziehungsverfügung und Überweisungsverfügung liegen noch keine Muster vor — die Felder dort sind Annahmen (Annahme A11), analog zur PfÜB-Logik, aber mit Vollstreckungsbehörde statt Amtsgericht als Absender. Zu prüfen, sobald echte Muster da sind.

## Architektur des Aufrufs

Wie bei `belegerkennung`: voller OCR-Text geht an das Sprachmodell, JSON-Mode, ein Aufruf klassifiziert UND extrahiert gleichzeitig — kein separater Klassifikations-Schritt vor der Extraktion, weil das Modell den Typ ohnehin aus demselben Volltextverständnis ableitet, das auch die Felder liefert.

## JSON-Schema (Response-Format für den Chat-Aufruf)

```json
{
  "dokumenttyp": "pfaendungsschreiben | auskunftsersuchen | einziehungsverfuegung | ueberweisungsverfuegung | erinnerungsschreiben | sonstiges",
  "konfidenz_typ": 0,
  "plausibilitaet_ok": true,
  "plausibilitaet_begruendung": "string, 1 Satz",

  "kopf": {
    "ausstellende_stelle": null,
    "aktenzeichen": null,
    "ausstellungsdatum": null,
    "empfaenger_bezeichnung": null,
    "rechtsgrundlage": []
  },

  "pfaendung": {
    "glaeubiger_name": null,
    "glaeubiger_vertretung": null,
    "schuldner_name": null,
    "vollstreckungstitel_aktenzeichen": null,
    "vollstreckungstitel_datum": null,
    "forderung_hauptforderung_eur": null,
    "forderung_zinsen_prozent": null,
    "forderung_kosten_eur": null,
    "forderung_gesamt_eur": null,
    "drittschuldner_bezeichnung": null,
    "konfidenz_betrag": 0
  },

  "auskunftsersuchen": {
    "betroffene_person_name": null,
    "betroffene_person_geburtsdatum": null,
    "tatvorwurf": null,
    "angefragte_punkte": [],
    "antwortfrist_tage": null,
    "vertraulich": false
  },

  "erinnerung": {
    "bezug_aktenzeichen": null,
    "hinweis_text": null
  },

  "rohtext_auszug": "string, erste 300 Zeichen — für die Sichtprüfungsmaske bei niedriger Konfidenz"
}
```

**Bewusst nicht im Schema:** `zustelldatum`. Das Modell bekommt dafür kein Feld — es kommt ausschließlich aus dem E-Mail-Header bzw. dem Scan-Eingangsstempel, nie aus dem Dokumenttext. Das ist eine strukturelle Sperre gegen genau den Fehler, den das Sollkonzept als gefährlichste Einzelschwachstelle markiert hat: Scandatum wird fälschlich als Fristanker verwendet, weil es im System einfacher verfügbar ist als das echte Zustelldatum.

Je nach `dokumenttyp` wird nur der passende Unterblock befüllt (`pfaendung` für Pfändungsschreiben/Einziehungsverfügung/Überweisungsverfügung, `auskunftsersuchen` für Auskunftsersuchen, `erinnerung` für Erinnerungsschreiben) — die anderen bleiben auf null-Werten stehen.

## System-Prompt (Entwurf)

```
Du bist Klassifikations- und Extraktionsassistent im Kontenservice der
Feldmark Bank AG. Du bekommst den vollständigen OCR-Text eines eingehenden
Schreibens (Scan oder E-Mail-Anhang).

Aufgabe:
1. Ordne das Dokument genau einem der sechs Typen zu: pfaendungsschreiben,
   auskunftsersuchen, einziehungsverfuegung, ueberweisungsverfuegung,
   erinnerungsschreiben, sonstiges.
2. Fülle nur die Felder, die zum erkannten Typ gehören, aus dem
   JSON-Schema aus.
3. Trage ausschließlich das ein, was wörtlich oder eindeutig im Text
   steht. Erfinde, schätze oder ergänze keine Werte. Unklare oder fehlende
   Angaben bleiben null.
4. Prüfe die Plausibilität: Passt der Inhalt wirklich zu einer bankbezogenen
   Vollstreckungs- oder Ermittlungsangelegenheit? Fehlen zentrale Anker
   (Aktenzeichen, Bezug auf ein Konto oder einen Kunden, erkennbare
   Vollstreckungs-/Ermittlungsbehörde als Absender), setze
   plausibilitaet_ok auf false und dokumenttyp auf sonstiges — auch wenn
   ein Begriff wie „Auskunftsersuchen" im Text vorkommt.
5. Vergib konfidenz_typ und konfidenz_betrag ehrlich und konservativ.
   Ein Wert über 90 bedeutet: du bist dir wirklich sicher, nicht nur,
   dass es wahrscheinlich stimmt. Bei Scan-Artefakten, unklarer
   Handschrift oder mehrdeutigen Zahlen: Wert senken, nicht raten.
6. Gib niemals ein Zustelldatum an — dieses Feld existiert absichtlich
   nicht im Schema.
```

## Konfidenz-Schwellen und Routing (Halluzinations-Sicherung, M6-Baustein)

| Bedingung | Aktion |
|---|---|
| `konfidenz_typ < 70` | Fall geht unabhängig vom erkannten Typ in die Sichtprüfungs-Warteschlange, kein Autofall |
| `plausibilitaet_ok = false` | Wie oben — auch bei hoher `konfidenz_typ`. Das ist die Absicherung gegen Fälle wie das Betriebsrat-Wahllisten-Muster: Worttreffer „Auskunftsersuchen" ohne passende Struktur |
| `konfidenz_betrag < 85` (nur `pfaendung`-Block) | Vier-Augen-Pflicht vor Weiterverarbeitung — deckt sich mit der Vorgabe aus dem Sollkonzept, dass nur Betrag und Zustelldatum eine Doppelprüfung brauchen |
| `dokumenttyp = erinnerungsschreiben` und `bezug_aktenzeichen` nicht im Bestand auffindbar | Kein automatisches Matching — geht ebenfalls in Sichtprüfung, damit keine Eskalation an einen falschen oder nicht existierenden Fall gehängt wird |
| `dokumenttyp = sonstiges` | Nie Autofall, immer Sichtprüfung |

## Offene Punkte

- Einziehungsverfügung/Überweisungsverfügung-Felder sind Annahme A11, ungeprüft — sobald du echte Muster hast, wird dieser Abschnitt korrigiert.
- Schwellenwerte (70 / 85) sind Startwerte, keine gemessenen — nach den ersten Testläufen (M13-T03-A02 Stress-Test) ggf. nachjustieren.
