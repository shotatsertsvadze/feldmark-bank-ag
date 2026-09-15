/**
 * Unit-Tests fuer bestimmeRouting() aus server/mistral.js - die zentrale
 * Routing-Regel des Systems (Autofall vs. Sichtpruefung). Reine Funktion,
 * kein DATABASE_URL und kein MISTRAL_API_KEY noetig.
 *
 * Jede Fail-Closed-Regel bekommt einen eigenen Test, inklusive der Faelle,
 * die live nie provoziert wurden (fehlende Konfidenzwerte, Erinnerung mit
 * Treffer in der falschen Tabelle).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestimmeRouting } from "./mistral.js";

const OCR_GUT = { durchschnitt: 97.5, minimum: 91.2 };

/** Klassifikation, die ohne Zutun als Autofall durchlaeuft. */
function autofallKlassifikation(ueberschreibungen = {}) {
  return {
    dokumenttyp: "pfaendungsschreiben",
    konfidenz_typ: 95,
    plausibilitaet_ok: true,
    wurde_gekuerzt: false,
    pfaendung: { konfidenz_betrag: 95 },
    ...ueberschreibungen,
  };
}

function hatGrund(ergebnis, teilstring) {
  return ergebnis.gruende.some((g) => g.includes(teilstring));
}

test("Autofall: alle Schwellen eingehalten", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation(), { ocrConfidence: OCR_GUT });
  assert.equal(ergebnis.pfad, "autofall");
  assert.equal(ergebnis.vier_augen_erforderlich, false);
  assert.deepEqual(ergebnis.gruende, []);
});

test("konfidenz_typ unter 70 erzwingt Sichtpruefung", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation({ konfidenz_typ: 69 }), {
    ocrConfidence: OCR_GUT,
  });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "konfidenz_typ"));
});

test("konfidenz_typ fehlt komplett - zaehlt als 0, nicht als bestanden", () => {
  const klassifikation = autofallKlassifikation();
  delete klassifikation.konfidenz_typ;
  const ergebnis = bestimmeRouting(klassifikation, { ocrConfidence: OCR_GUT });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "konfidenz_typ"));
});

test("plausibilitaet_ok = false erzwingt Sichtpruefung", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation({ plausibilitaet_ok: false }), {
    ocrConfidence: OCR_GUT,
  });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "plausibilitaet_ok"));
});

test("dokumenttyp sonstiges ist nie Autofall", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation({ dokumenttyp: "sonstiges" }), {
    ocrConfidence: OCR_GUT,
  });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "sonstiges"));
});

test("gekuerzter Text erzwingt Sichtpruefung im Pfaendungsblock", () => {
  for (const typ of ["pfaendungsschreiben", "einziehungsverfuegung", "ueberweisungsverfuegung", "auskunftsersuchen"]) {
    const ergebnis = bestimmeRouting(autofallKlassifikation({ dokumenttyp: typ, wurde_gekuerzt: true }), {
      ocrConfidence: OCR_GUT,
    });
    assert.equal(ergebnis.pfad, "sichtpruefung", `Typ ${typ}`);
    assert.ok(hatGrund(ergebnis, "gekuerzt"), `Typ ${typ}`);
  }
});

test("fehlende OCR-Konfidenz erzwingt Sichtpruefung", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation(), { ocrConfidence: null });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "keine OCR-Konfidenz"));
});

test("ocr_confidence.minimum unter 60 erzwingt Sichtpruefung", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation(), {
    ocrConfidence: { durchschnitt: 95, minimum: 59.9 },
  });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "ocr_confidence.minimum"));
});

test("ocr_confidence.minimum genau auf der Schwelle bleibt Autofall", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation(), {
    ocrConfidence: { durchschnitt: 95, minimum: 60 },
  });
  assert.equal(ergebnis.pfad, "autofall");
});

test("Erinnerung ohne Aktenzeichen-Treffer geht in die Sichtpruefung", () => {
  for (const typ of ["pfaendungserinnerung", "auskunftsersuchenerinnerung"]) {
    const ergebnis = bestimmeRouting(autofallKlassifikation({ dokumenttyp: typ }), {
      ocrConfidence: OCR_GUT,
      erinnerungTreffer: null,
    });
    assert.equal(ergebnis.pfad, "sichtpruefung", `Typ ${typ}`);
    assert.ok(hatGrund(ergebnis, "nicht im Bestand auffindbar"), `Typ ${typ}`);
  }
});

test("Erinnerung mit Treffer in der erwarteten Tabelle bleibt Autofall", () => {
  const paare = [
    ["pfaendungserinnerung", "feldmark.pfaendung_faelle"],
    ["auskunftsersuchenerinnerung", "feldmark.auskunftsersuchen_faelle"],
  ];
  for (const [typ, tabelle] of paare) {
    const ergebnis = bestimmeRouting(autofallKlassifikation({ dokumenttyp: typ }), {
      ocrConfidence: OCR_GUT,
      erinnerungTreffer: { tabelle, fall_id: "PF-2026-0001" },
    });
    assert.equal(ergebnis.pfad, "autofall", `Typ ${typ}`);
    assert.deepEqual(ergebnis.gruende, [], `Typ ${typ}`);
  }
});

test("Erinnerung mit Treffer in der falschen Tabelle geht in die Sichtpruefung", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation({ dokumenttyp: "pfaendungserinnerung" }), {
    ocrConfidence: OCR_GUT,
    erinnerungTreffer: { tabelle: "feldmark.auskunftsersuchen_faelle", fall_id: "AE-2026-0007" },
  });
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.ok(hatGrund(ergebnis, "Typzuordnung unsicher"));
});

test("konfidenz_betrag unter 85 verhindert den Autofall nicht, setzt aber das Vier-Augen-Flag", () => {
  const ergebnis = bestimmeRouting(
    autofallKlassifikation({ pfaendung: { konfidenz_betrag: 84 } }),
    { ocrConfidence: OCR_GUT }
  );
  assert.equal(ergebnis.pfad, "autofall");
  assert.equal(ergebnis.vier_augen_erforderlich, true);
  assert.ok(hatGrund(ergebnis, "konfidenz_betrag"));
});

test("fehlender Pfaendungsblock zaehlt als konfidenz_betrag 0", () => {
  const klassifikation = autofallKlassifikation();
  delete klassifikation.pfaendung;
  const ergebnis = bestimmeRouting(klassifikation, { ocrConfidence: OCR_GUT });
  assert.equal(ergebnis.vier_augen_erforderlich, true);
});

test("Vier-Augen-Flag gilt nur fuer den Pfaendungsblock", () => {
  const ergebnis = bestimmeRouting(
    autofallKlassifikation({ dokumenttyp: "auskunftsersuchen", pfaendung: { konfidenz_betrag: 0 } }),
    { ocrConfidence: OCR_GUT }
  );
  assert.equal(ergebnis.vier_augen_erforderlich, false);
});

test("mehrere verletzte Regeln werden alle begruendet", () => {
  const ergebnis = bestimmeRouting(
    autofallKlassifikation({ konfidenz_typ: 10, plausibilitaet_ok: false, dokumenttyp: "sonstiges" }),
    { ocrConfidence: null }
  );
  assert.equal(ergebnis.pfad, "sichtpruefung");
  assert.equal(ergebnis.gruende.length, 4);
});

test("Optionen-Objekt ist optional - ohne OCR-Konfidenz fail-closed", () => {
  const ergebnis = bestimmeRouting(autofallKlassifikation());
  assert.equal(ergebnis.pfad, "sichtpruefung");
});
