/**
 * Unit-Tests fuer server/auskunftsersuchen_antwort.js. Kernzusage: im
 * Antworttext stehen ausschliesslich die in der Rechtsgrundlagenpruefung
 * (E3) freigegebenen Punkte - zurueckgehaltene Punkte werden benannt, aber
 * nie beantwortet. Reine Funktion, kein DATABASE_URL noetig.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { erzeugeAuskunftsersuchenAntwort } from "./auskunftsersuchen_antwort.js";

function fall(ueberschreibungen = {}) {
  return {
    fall_id: "AE-2026-0011",
    aktenzeichen: "501 Js 1234/26",
    ausstellende_behoerde: "Staatsanwaltschaft Feldmark",
    betroffene_person_name: "Erika Musterfrau",
    betroffene_person_geburtsdatum: "1985-04-12",
    tatvorwurf: "Betrug",
    eingangsdatum: "2026-09-02",
    angefragte_punkte: ["Kontostammdaten", "Umsatzliste 6 Monate", "Schliessfach"],
    ...ueberschreibungen,
  };
}

function erweiterung(ueberschreibungen = {}) {
  return {
    freizugebende_punkte: ["Kontostammdaten"],
    antwort_werte: { Kontostammdaten: "Girokonto DE02 1203 0000 0000 2020 51, eröffnet 2019-03-04" },
    rechtsgrundlage: ["§ 161 StPO"],
    ...ueberschreibungen,
  };
}

test("nur freigegebene Punkte erscheinen als Auskunft", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(fall(), erweiterung());
  assert.equal(ergebnis.ok, true);
  assert.match(ergebnis.text, /1\. Kontostammdaten: Girokonto/);
  assert.doesNotMatch(ergebnis.text, /2\. Umsatzliste/);
  assert.doesNotMatch(ergebnis.text, /2\. Schliessfach/);
});

test("zurueckgehaltene Punkte werden benannt, aber nicht beantwortet", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(fall(), erweiterung());
  assert.match(ergebnis.text, /keine Auskunft erteilt: Umsatzliste 6 Monate, Schliessfach/);
});

test("der Wert eines zurueckgehaltenen Punktes taucht nirgends im Text auf", () => {
  // Kern der E3-Zusage: auch wenn zu einem Punkt bereits ein Wert erfasst
  // wurde, darf er ohne Freigabe nicht in die Antwort geraten.
  const ergebnis = erzeugeAuskunftsersuchenAntwort(
    fall(),
    erweiterung({
      freizugebende_punkte: ["Kontostammdaten"],
      antwort_werte: {
        Kontostammdaten: "Girokonto DE02 1203 0000 0000 2020 51",
        "Umsatzliste 6 Monate": "GEHEIM 47 Buchungen, Saldo 12.400 EUR",
        Schliessfach: "GEHEIM Schliessfach 118, Zugang 2021",
      },
    })
  );
  assert.equal(ergebnis.ok, true);
  assert.doesNotMatch(ergebnis.text, /GEHEIM/);
  assert.doesNotMatch(ergebnis.text, /47 Buchungen|12\.400|118/);
  assert.match(ergebnis.text, /Girokonto DE02/);
});

test("werden alle Punkte freigegeben, entfaellt der Zurueckhaltungs-Absatz", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(
    fall(),
    erweiterung({
      freizugebende_punkte: ["Kontostammdaten", "Umsatzliste 6 Monate", "Schliessfach"],
      antwort_werte: {
        Kontostammdaten: "Girokonto DE02",
        "Umsatzliste 6 Monate": "als Anlage",
        Schliessfach: "kein Schliessfach vorhanden",
      },
    })
  );
  assert.equal(ergebnis.ok, true);
  assert.doesNotMatch(ergebnis.text, /keine Auskunft erteilt/);
  assert.match(ergebnis.text, /3\. Schliessfach/);
});

test("Kopf enthaelt Behoerde, beide Aktenzeichen und die Rechtsgrundlage", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(fall(), erweiterung());
  assert.match(ergebnis.text, /AUSKUNFT gemäß § 161 StPO/);
  assert.match(ergebnis.text, /An: Staatsanwaltschaft Feldmark/);
  assert.match(ergebnis.text, /Ihr Aktenzeichen: 501 Js 1234\/26/);
  assert.match(ergebnis.text, /Unser Aktenzeichen: AE-2026-0011/);
  assert.match(ergebnis.text, /Geburtsdatum: 12\.4\.1985/);
});

test("ohne hinterlegte Rechtsgrundlage wird der gesetzliche Standard genannt", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(fall(), erweiterung({ rechtsgrundlage: [] }));
  assert.match(ergebnis.text, /§§ 161, 161a, 95 StPO/);
});

test("optionale Kopffelder fehlen sauber statt als null im Text zu landen", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(
    fall({ betroffene_person_geburtsdatum: null, tatvorwurf: null }),
    erweiterung()
  );
  assert.equal(ergebnis.ok, true);
  assert.doesNotMatch(ergebnis.text, /Geburtsdatum|Tatvorwurf|null/);
});

test("fail-closed: ohne E3-Pruefung keine Antwort", () => {
  for (const wert of [null, undefined, []]) {
    const ergebnis = erzeugeAuskunftsersuchenAntwort(fall(), erweiterung({ freizugebende_punkte: wert }));
    assert.equal(ergebnis.ok, false, `Wert ${JSON.stringify(wert)}`);
    assert.match(ergebnis.grund, /E3/);
  }
});

test("fail-closed: fehlender oder leerer Antwortwert blockiert die Antwort", () => {
  const ergebnis = erzeugeAuskunftsersuchenAntwort(
    fall(),
    erweiterung({
      freizugebende_punkte: ["Kontostammdaten", "Schliessfach"],
      antwort_werte: { Kontostammdaten: "Girokonto DE02", Schliessfach: "   " },
    })
  );
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /Schliessfach/);
});
