/**
 * Integrationstest fuer die geschlossene Sichtpruefungs-Schleife
 * (POST /api/sichtpruefung/:id/uebernehmen | /verwerfen, neu 2026-09-15).
 * Gleiche Bauart wie hitl-gates.test.js: echter Express-Server auf einem
 * eigenen Test-Port, echte Supabase-DB, Cleanup in after().
 *
 * Ohne DATABASE_URL werden die Tests uebersprungen statt fehlzuschlagen.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PFAD = path.join(ROOT, ".env");
if (existsSync(ENV_PFAD)) process.loadEnvFile(ENV_PFAD);

const HAT_DB = !!process.env.DATABASE_URL;
const SKIP_GRUND = "DATABASE_URL fehlt (.env) - Sichtpruefungs-Integrationstest uebersprungen";
const TEST_PORT = 4398;
const BASIS_URL = `http://localhost:${TEST_PORT}`;

const pool = HAT_DB ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const erstellteEintraege = [];
const erstellteFaelle = [];
let serverProzess;

async function warteAufServer(versuche = 40) {
  for (let i = 0; i < versuche; i++) {
    try {
      const res = await fetch(`${BASIS_URL}/api/faelle`);
      if (res.ok) return;
    } catch {
      // Server noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Test-Server auf Port ${TEST_PORT} kam nach ${versuche * 250}ms nicht hoch.`);
}

before(async () => {
  if (!HAT_DB) return;
  serverProzess = spawn("node", ["server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, FELDMARK_KLASSIFIKATION_SERVER_PORT: String(TEST_PORT) },
    stdio: "ignore",
  });
  await warteAufServer();
});

after(async () => {
  if (serverProzess) serverProzess.kill();
  if (!pool) return;
  for (const fallId of erstellteFaelle) {
    await pool.query(`DELETE FROM feldmark.pfaendung_protokoll WHERE fall_id = $1`, [fallId]);
    await pool.query(`DELETE FROM feldmark.pfaendung_erweiterung WHERE fall_id = $1`, [fallId]);
    await pool.query(`DELETE FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [fallId]);
  }
  for (const id of erstellteEintraege) {
    await pool.query(`DELETE FROM feldmark.sichtpruefung_warteschlange WHERE id = $1`, [id]);
  }
  await pool.end();
});

/** Legt einen offenen Warteschlangen-Eintrag an, wie ihn das Routing erzeugt. */
async function legeWarteschlangenEintragAn(klassifikation) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO feldmark.sichtpruefung_warteschlange
       (id, dateiname, dokumenttyp, einordnung, konfidenz_typ, plausibilitaet_ok,
        routing_gruende, klassifikation, eingangsdatum)
     VALUES ($1, $2, $3, 'niedrige_konfidenz', $4, true, $5, $6, CURRENT_DATE)`,
    [
      id,
      "SICHTPRUEFUNG-TEST.pdf",
      klassifikation.dokumenttyp,
      klassifikation.konfidenz_typ ?? 55,
      ["konfidenz_typ (55) unter Schwelle 70"],
      JSON.stringify(klassifikation),
    ]
  );
  erstellteEintraege.push(id);
  return id;
}

function eingang() {
  return { zustellkanal: "E-Mail", bearbeiter_email: "sichtpruefung-test@feldmark.test" };
}

test(
  "uebernehmen: korrigierter Eintrag wird zum echten Fall, Warteschlange geschlossen, Audit-Ereignis geschrieben",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const id = await legeWarteschlangenEintragAn({
      dokumenttyp: "pfaendungsschreiben",
      konfidenz_typ: 55,
      kopf: { aktenzeichen: `SICHT-TEST-${Date.now()}` },
      // Schuldner unleserlich - genau der Grund fuer die Sichtpruefung.
      pfaendung: { glaeubiger_name: "SICHT-TEST Glaeubiger", schuldner_name: null },
    });

    const res = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/uebernehmen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geprueft_von: "Pruefer A",
        korrekturen: { pfaendung: { schuldner_name: "SICHT-TEST Schuldner" } },
        eingang: eingang(),
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    erstellteFaelle.push(body.fall_id);
    assert.match(body.fall_id, /^PF-\d{4}-\d{4}$/);
    assert.equal(body.warteschlange_geschlossen, true);

    const fall = (
      await pool.query(`SELECT schuldner, status FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [body.fall_id])
    ).rows[0];
    assert.equal(fall.schuldner, "SICHT-TEST Schuldner");

    const eintrag = (
      await pool.query(
        `SELECT status, uebernommen_als_fall_id, geprueft_von, geprueft_am
         FROM feldmark.sichtpruefung_warteschlange WHERE id = $1`,
        [id]
      )
    ).rows[0];
    assert.equal(eintrag.status, "uebernommen");
    assert.equal(eintrag.uebernommen_als_fall_id, body.fall_id);
    assert.equal(eintrag.geprueft_von, "Pruefer A");
    assert.ok(eintrag.geprueft_am);

    const ereignisse = (
      await pool.query(`SELECT ereignis FROM feldmark.pfaendung_protokoll WHERE fall_id = $1`, [body.fall_id])
    ).rows.map((r) => r.ereignis);
    assert.ok(ereignisse.includes("fall_angelegt"));
    assert.ok(ereignisse.includes("aus_sichtpruefung_uebernommen"));
  }
);

test(
  "uebernehmen: fehlende Pflichtfelder liefern 422, der Eintrag bleibt offen und korrigierbar",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const id = await legeWarteschlangenEintragAn({
      dokumenttyp: "pfaendungsschreiben",
      kopf: { aktenzeichen: null },
      pfaendung: { glaeubiger_name: null, schuldner_name: null },
    });

    const res = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/uebernehmen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geprueft_von: "Pruefer A", eingang: eingang() }),
    });
    assert.equal(res.status, 422);
    assert.match((await res.json()).fehler, /Pflichtfeld/);

    const status = (
      await pool.query(`SELECT status FROM feldmark.sichtpruefung_warteschlange WHERE id = $1`, [id])
    ).rows[0].status;
    assert.equal(status, "offen");
  }
);

test(
  "uebernehmen: dokumenttyp sonstiges kann nicht zum Fall werden (422)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const id = await legeWarteschlangenEintragAn({
      dokumenttyp: "sonstiges",
      kopf: { aktenzeichen: "SICHT-TEST-SONST" },
      pfaendung: {},
    });
    const res = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/uebernehmen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geprueft_von: "Pruefer A", eingang: eingang() }),
    });
    assert.equal(res.status, 422);
    assert.match((await res.json()).fehler, /kein Fall/);
  }
);

test(
  "verwerfen: schliesst den Eintrag mit Begruendung; ein zweiter Versuch liefert 409",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const id = await legeWarteschlangenEintragAn({
      dokumenttyp: "sonstiges",
      kopf: { aktenzeichen: null },
      pfaendung: {},
    });

    const res = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/verwerfen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geprueft_von: "Pruefer B", grund: "Werbeschreiben, kein Vollstreckungsbezug" }),
    });
    assert.equal(res.status, 200);

    const eintrag = (
      await pool.query(
        `SELECT status, pruef_notiz, geprueft_von FROM feldmark.sichtpruefung_warteschlange WHERE id = $1`,
        [id]
      )
    ).rows[0];
    assert.equal(eintrag.status, "verworfen");
    assert.equal(eintrag.geprueft_von, "Pruefer B");
    assert.match(eintrag.pruef_notiz, /Werbeschreiben/);

    const zweiter = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/verwerfen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geprueft_von: "Pruefer B", grund: "nochmal" }),
    });
    assert.equal(zweiter.status, 409);
  }
);

test(
  "verwerfen ohne Begruendung oder ohne Pruefer wird abgelehnt (400)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const id = await legeWarteschlangenEintragAn({ dokumenttyp: "sonstiges", kopf: {}, pfaendung: {} });
    for (const body of [{ geprueft_von: "Pruefer B" }, { grund: "kein Bezug" }]) {
      const res = await fetch(`${BASIS_URL}/api/sichtpruefung/${id}/verwerfen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400);
    }
  }
);
