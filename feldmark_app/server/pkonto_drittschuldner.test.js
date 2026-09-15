/**
 * Unit-Tests fuer server/pkonto_drittschuldner.js - die rechtsverbindliche
 * Drittschuldnererklaerung nach § 840 ZPO. Reine Funktionen, kein
 * DATABASE_URL noetig.
 *
 * Geprueft werden alle vier Guthaben-Szenarien (voll / teilweise / kein
 * pfaendbares Guthaben / mehrere Pfaendungen) sowie jeder Fail-Closed-Pfad,
 * der in server/index.js zu HTTP 422 fuehrt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berechnePfaendbarenBetrag,
  berechneRang,
  erzeugeDrittschuldnererklaerung,
  P_KONTO_GRUNDFREIBETRAG_EUR,
} from "./pkonto_drittschuldner.js";

function fall(ueberschreibungen = {}) {
  return {
    fall_id: "PF-2026-0042",
    aktenzeichen: "12 M 3456/26",
    schuldner: "Max Mustermann",
    zustelldatum: "2026-09-01",
    ...ueberschreibungen,
  };
}

/** Erweiterung, bei der alle fuenf Pflichtangaben geprueft sind. */
function erweiterung(ueberschreibungen = {}) {
  return {
    forderung_gesamt_eur: 2000,
    guthaben_eur: 5000,
    ist_p_konto: false,
    p_konto_freibetrag_erhoehung: 0,
    ist_gemeinschaftskonto: false,
    unpfaendbarkeit_907_geprueft: true,
    unpfaendbarkeit_907_festgestellt_am: null,
    gemeinschaftskonto_geprueft: true,
    ...ueberschreibungen,
  };
}

test("berechnePfaendbarenBetrag: ohne Guthaben null, ohne P-Konto voller Betrag", () => {
  assert.equal(berechnePfaendbarenBetrag({ guthabenEur: null, istPKonto: false }), null);
  assert.equal(berechnePfaendbarenBetrag({ guthabenEur: 1234.567, istPKonto: false }), 1234.57);
  assert.equal(berechnePfaendbarenBetrag({ guthabenEur: -50, istPKonto: false }), 0);
});

test("berechnePfaendbarenBetrag: P-Konto zieht Freibetrag samt Erhoehung ab", () => {
  assert.equal(
    berechnePfaendbarenBetrag({ guthabenEur: P_KONTO_GRUNDFREIBETRAG_EUR + 100, istPKonto: true }),
    100
  );
  assert.equal(
    berechnePfaendbarenBetrag({
      guthabenEur: P_KONTO_GRUNDFREIBETRAG_EUR + 100,
      istPKonto: true,
      freibetragErhoehungEur: 500,
    }),
    0
  );
});

test("berechneRang: frueheste Zustellung ist Rang 1, unbekannter Fall null", () => {
  const faelle = [
    { fall_id: "PF-B", zustelldatum: "2026-09-05" },
    { fall_id: "PF-A", zustelldatum: "2026-08-01" },
  ];
  assert.equal(berechneRang("PF-A", faelle), 1);
  assert.equal(berechneRang("PF-B", faelle), 2);
  assert.equal(berechneRang("PF-C", faelle), null);
});

test("Szenario 1: Guthaben deckt die Forderung voll", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung());
  assert.equal(ergebnis.ok, true);
  assert.match(ergebnis.text, /in vollem Umfang anerkannt/);
  assert.match(ergebnis.text, /2\.000,00 EUR/);
  assert.match(ergebnis.text, /§ 840 ZPO/);
});

test("Szenario 2: Guthaben deckt die Forderung nur teilweise", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(
    fall(),
    erweiterung({ forderung_gesamt_eur: 2000, guthaben_eur: 500 })
  );
  assert.equal(ergebnis.ok, true);
  assert.match(ergebnis.text, /500,00 EUR anerkannt/);
  assert.match(ergebnis.text, /Restbetrag von 1\.500,00 EUR/);
});

test("Szenario 3: kein pfaendbares Guthaben (P-Konto unter Freibetrag)", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(
    fall(),
    erweiterung({ guthaben_eur: 800, ist_p_konto: true })
  );
  assert.equal(ergebnis.ok, true);
  assert.match(ergebnis.text, /nicht vorhanden/);
  assert.match(ergebnis.text, /unter dem P-Konto-Freibetrag/);
  assert.match(ergebnis.text, /Pfändungsschutzkonto \(P-Konto\)/);
});

test("Szenario 4: mehrere offene Pfaendungen nennen Anzahl, Liste und Rang", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung(), [
    { fall_id: "PF-2026-0007", glaeubiger: "Stadtwerke Feldmark", zustelldatum: "2026-05-04" },
  ]);
  assert.equal(ergebnis.ok, true);
  assert.match(ergebnis.text, /bereits für 1 weiteren Gläubiger gepfändet/);
  assert.match(ergebnis.text, /Stadtwerke Feldmark/);
  assert.match(ergebnis.text, /im Rang 2 von 2/);
});

test("ohne andere Pfaendungen wird das ausdruecklich erklaert", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung());
  assert.match(ergebnis.text, /für keinen anderen Gläubiger gepfändet/);
});

test("fail-closed: fehlende Forderungshoehe erzeugt keine Erklaerung", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung({ forderung_gesamt_eur: null }));
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /forderung_gesamt_eur/);
});

test("fail-closed: nicht erfasstes Guthaben erzeugt keine Erklaerung", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung({ guthaben_eur: null }));
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /Guthaben/);
});

test("fail-closed: § 907 ZPO ungeprueft erzeugt keine Erklaerung", () => {
  for (const wert of [false, null, undefined]) {
    const ergebnis = erzeugeDrittschuldnererklaerung(
      fall(),
      erweiterung({ unpfaendbarkeit_907_geprueft: wert })
    );
    assert.equal(ergebnis.ok, false, `Wert ${wert}`);
    assert.match(ergebnis.grund, /907/);
  }
});

test("fail-closed: ungepruefte Kontoart erzeugt keine Erklaerung", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(
    fall(),
    erweiterung({ gemeinschaftskonto_geprueft: false })
  );
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /Gemeinschaftskonto/);
});

test("§ 907 ZPO: Feststellung innerhalb der letzten zwoelf Monate wird datiert genannt", () => {
  const vorEinemMonat = new Date();
  vorEinemMonat.setUTCMonth(vorEinemMonat.getUTCMonth() - 1);
  const ergebnis = erzeugeDrittschuldnererklaerung(
    fall(),
    erweiterung({ unpfaendbarkeit_907_festgestellt_am: vorEinemMonat.toISOString().slice(0, 10) })
  );
  assert.match(ergebnis.text, /Innerhalb der letzten zwölf Monate wurde die Unpfändbarkeit/);
});

test("§ 907 ZPO: aeltere Feststellung wird als ausserhalb des Zeitraums gekennzeichnet", () => {
  const ergebnis = erzeugeDrittschuldnererklaerung(
    fall(),
    erweiterung({ unpfaendbarkeit_907_festgestellt_am: "2020-03-01" })
  );
  assert.match(ergebnis.text, /außerhalb der letzten zwölf Monate/);
});

test("Kontoart: alle vier Kombinationen aus P-Konto und Gemeinschaftskonto", () => {
  const faelleUndErwartung = [
    [{ ist_p_konto: true, ist_gemeinschaftskonto: true }, /zugleich geführt als Gemeinschaftskonto/],
    [{ ist_p_konto: true, ist_gemeinschaftskonto: false }, /kein Gemeinschaftskonto/],
    [{ ist_p_konto: false, ist_gemeinschaftskonto: true }, /kein Pfändungsschutzkonto/],
    [{ ist_p_konto: false, ist_gemeinschaftskonto: false }, /weder um ein Pfändungsschutzkonto/],
  ];
  for (const [ueberschreibung, erwartung] of faelleUndErwartung) {
    const ergebnis = erzeugeDrittschuldnererklaerung(fall(), erweiterung(ueberschreibung));
    assert.equal(ergebnis.ok, true);
    assert.match(ergebnis.text, erwartung);
  }
});
