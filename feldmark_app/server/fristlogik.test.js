/**
 * Reine Unit-Tests fuer server/fristlogik.js (RALPH-PROGRESS.md Backlog #3).
 * Kein DATABASE_URL noetig - reine, deterministische Funktion, laeuft immer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ermittleFristAktion, VORLAUF_ERINNERUNG_2_TAGE, VORLAUF_ESKALATION_TAGE } from "./fristlogik.js";

const PFAENDUNG_ERLEDIGT = ["Erklaerung versandt", "Abgeschlossen", "Abgeschlossen mit Fristversaeumnis"];
const AUSKUNFT_ERLEDIGT = ["Antwort versandt", "Abgeschlossen", "Abgeschlossen mit Fristversaeumnis"];

// Montag, kein Feiertag in der Naehe - Fristende faellt nicht zufaellig auf
// ein Wochenende und verfaelscht damit rest_tage-Erwartungen in den Tests.
const START_MONTAG = "2026-03-02"; // Montag
function heuteIn(tageAbStart) {
  const d = new Date(`${START_MONTAG}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tageAbStart);
  return d;
}

test("Fristbeginn (Tag 0, nichts gesendet) -> erinnerung_1", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "Eingegangen",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: [],
    heute: heuteIn(0),
  });
  assert.equal(r.aktion, "erinnerung_1");
});

test("Erinnerung 1 bereits gesendet, noch weit von Fristende -> keine", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: ["erinnerung_1"],
    heute: heuteIn(5),
  });
  assert.equal(r.aktion, "keine");
});

test(`${VORLAUF_ERINNERUNG_2_TAGE} Tage vor Fristende, erinnerung_1 bereits gesendet -> erinnerung_2`, () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: ["erinnerung_1"],
    heute: heuteIn(14 - VORLAUF_ERINNERUNG_2_TAGE),
  });
  assert.equal(r.aktion, "erinnerung_2");
});

test(`${VORLAUF_ESKALATION_TAGE} Tag vor Fristende -> eskalation`, () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: ["erinnerung_1", "erinnerung_2"],
    heute: heuteIn(14 - VORLAUF_ESKALATION_TAGE),
  });
  assert.equal(r.aktion, "eskalation");
});

test("Frist ueberschritten, noch nicht dokumentiert -> fristversaeumnis", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: ["erinnerung_1", "erinnerung_2", "eskalation"],
    heute: heuteIn(16),
  });
  assert.equal(r.aktion, "fristversaeumnis");
  assert.ok(r.restTage < 0);
});

test("Frist ueberschritten, fristversaeumnis bereits dokumentiert -> keine (Idempotenz)", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: ["erinnerung_1", "erinnerung_2", "eskalation", "fristversaeumnis"],
    heute: heuteIn(20),
  });
  assert.equal(r.aktion, "keine");
});

test("Status bereits erledigt (versandt) -> keine, unabhaengig von restTage", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "Erklaerung versandt",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: [],
    heute: heuteIn(20),
  });
  assert.equal(r.aktion, "keine");
});

test(
  "Signal-Downgrade-Schutz (Pfaendungs-Parameter): Eskalation bereits gesendet -> erinnerung_2 darf NICHT erneut feuern, obwohl das Tage-Fenster passt",
  () => {
    const r = ermittleFristAktion({
      startdatumIso: START_MONTAG,
      fristTage: 14,
      status: "Geprueft",
      statusErledigt: PFAENDUNG_ERLEDIGT,
      erinnerungenGesendet: ["erinnerung_1", "erinnerung_2", "eskalation"],
      heute: heuteIn(14 - VORLAUF_ERINNERUNG_2_TAGE), // waere ohne Schutz erinnerung_2-Fenster
    });
    assert.equal(r.aktion, "keine", "Downgrade auf erinnerung_2 nach bereits gesendeter Eskalation waere falsch");
  }
);

test(
  "Signal-Downgrade-Schutz (Auskunftsersuchen-Parameter, variable Frist): identische Regel, damit der Bug aus RALPH-PROGRESS.md Iteration 3 (Fix fehlte im § 161 StPO Code-Node) nicht wiederkehrt",
  () => {
    const r = ermittleFristAktion({
      startdatumIso: START_MONTAG,
      fristTage: 21, // Auskunftsersuchen: Frist kommt pro Fall aus antwortfrist_tage, nicht fix 14
      status: "Geprueft",
      statusErledigt: AUSKUNFT_ERLEDIGT,
      erinnerungenGesendet: ["eskalation"],
      heute: heuteIn(21 - VORLAUF_ERINNERUNG_2_TAGE),
    });
    assert.equal(r.aktion, "keine");
  }
);

test("Wochenend-/Feiertagsverschiebung: Fristende auf Feiertag verschiebt sich auf den naechsten Werktag", () => {
  // 2026-05-01 (Freitag) ist in FEIERTAGE_2026 - Start so waehlen, dass die
  // rohe 14-Tage-Frist exakt darauf faellt (2026-04-17 + 14 = 2026-05-01).
  const r = ermittleFristAktion({
    startdatumIso: "2026-04-17",
    fristTage: 14,
    status: "Eingegangen",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: [],
    heute: new Date("2026-04-17T00:00:00Z"),
  });
  assert.notEqual(r.fristende, "2026-05-01", "haette auf den naechsten Werktag verschoben werden muessen");
  assert.equal(r.fristende, "2026-05-04", "naechster Werktag nach Freitag 1.5. ist Montag 4.5.");
});

test("erinnerungen_gesendet als Postgres-Array-String (statt echtem Array) wird korrekt normalisiert", () => {
  const r = ermittleFristAktion({
    startdatumIso: START_MONTAG,
    fristTage: 14,
    status: "In Bearbeitung",
    statusErledigt: PFAENDUNG_ERLEDIGT,
    erinnerungenGesendet: '{erinnerung_1,erinnerung_2,eskalation}',
    heute: heuteIn(14 - VORLAUF_ERINNERUNG_2_TAGE),
  });
  assert.equal(r.aktion, "keine", "String-Array-Parsing haette eskalation erkennen muessen");
});
