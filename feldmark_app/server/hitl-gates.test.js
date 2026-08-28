/**
 * Integrationstest fuer RALPH-PROGRESS.md Backlog #2 (HITL-Grenzen,
 * docs/HITL-GRENZEN.md): beweist, dass die dort behaupteten Freigabe-Gates
 * echte serverseitige Blocker sind (HTTP 409 + KEINE Statusaenderung in der
 * DB), nicht nur ein Kommentar/eine UI-Warnung. Startet den echten Express-
 * Server als Kindprozess auf einem eigenen Test-Port (kollidiert nicht mit
 * einem parallel laufenden `npm run dev`), spricht ihn per echtem HTTP-
 * Request an - kein Mocking, gleiche Philosophie wie db.audit-trail.test.js.
 *
 * Ausfuehren: npm test (siehe package.json). Ohne DATABASE_URL in .env
 * werden die Tests uebersprungen statt fehlzuschlagen.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PFAD = path.join(ROOT, ".env");
if (existsSync(ENV_PFAD)) process.loadEnvFile(ENV_PFAD);

const HAT_DB = !!process.env.DATABASE_URL;
const SKIP_GRUND = "DATABASE_URL fehlt (.env) - HITL-Gate-Integrationstest uebersprungen";
const TEST_PORT = 4399;
const BASIS_URL = `http://localhost:${TEST_PORT}`;

const pool = HAT_DB ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const erstellteFaelle = [];
let serverProzess;

async function warteAufServer(versuche = 40) {
  for (let i = 0; i < versuche; i++) {
    try {
      const res = await fetch(`${BASIS_URL}/api/faelle`);
      if (res.ok) return;
    } catch {
      // Server noch nicht bereit - weiter warten
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
  for (const { fallId, typ } of erstellteFaelle) {
    if (typ === "pfaendung") {
      await pool.query(`DELETE FROM feldmark.pfaendung_protokoll WHERE fall_id = $1`, [fallId]);
      await pool.query(`DELETE FROM feldmark.pfaendung_erweiterung WHERE fall_id = $1`, [fallId]);
      await pool.query(`DELETE FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [fallId]);
    } else {
      await pool.query(`DELETE FROM feldmark.auskunftsersuchen_protokoll WHERE fall_id = $1`, [fallId]);
      await pool.query(`DELETE FROM feldmark.auskunftsersuchen_erweiterung WHERE fall_id = $1`, [fallId]);
      await pool.query(`DELETE FROM feldmark.auskunftsersuchen_faelle WHERE fall_id = $1`, [fallId]);
    }
  }
  await pool.end();
});

function testEingang() {
  return { zustelldatum: "2026-01-01", zustellkanal: "E-Mail", bearbeiter_email: "ralph-test@feldmark.test" };
}

test(
  "Vier-Augen-Gate (Drittschuldnererklaerung): Freigabe durch dieselbe Person, die das Guthaben erfasst hat, wird serverseitig blockiert (409) statt nur gewarnt - Status aendert sich NICHT",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-HITL-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: "RALPH-TEST Schuldner" },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    await db.aktualisiereErweiterung(fallId, { guthabenEur: 500, guthabenErfasstVon: "Pruefer A" });
    await db.speichereErklaerung(fallId, "RALPH-TEST Erklaerungstext", "2026-01-01");

    const vorherStatus = (await pool.query(`SELECT status FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [fallId])).rows[0]
      .status;

    // Dieselbe Person, KEIN vier_augen_bestaetigt - muss blockiert werden.
    const res = await fetch(`${BASIS_URL}/api/faelle/${fallId}/erklaerung/freigeben`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freigegeben_von: "Pruefer A" }),
    });
    assert.equal(res.status, 409, "Gate haette 409 liefern muessen");
    const body = await res.json();
    assert.equal(body.vier_augen_warnung, true);

    const nachherStatus = (await pool.query(`SELECT status FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [fallId])).rows[0]
      .status;
    assert.equal(nachherStatus, vorherStatus, "Status haette sich trotz blockiertem Request NICHT aendern duerfen");
    assert.notEqual(nachherStatus, "Erklaerung freigegeben", "Freigabe haette nicht durchgehen duerfen");
  }
);

test(
  "Vier-Augen-Gate (Auskunftsersuchen-Antwort / Datenherausgabe an Behoerde): gleiche Person wird blockiert (409), Status aendert sich NICHT",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legeAuskunftsersuchenFallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-HITL-AE-${Date.now()}`, ausstellende_stelle: "RALPH-TEST Behoerde", rechtsgrundlage: ["§ 161 StPO"] },
        auskunftsersuchen: { betroffene_person_name: "RALPH-TEST Person", antwortfrist_tage: 14, angefragte_punkte: ["Kontobestand"], vertraulich: true },
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "auskunftsersuchen" });

    await db.aktualisiereAuskunftsersuchenErweiterung(fallId, {
      freizugebendePunkte: ["Kontobestand"],
      rechtsgrundlageGeprueftVon: "Pruefer A",
      antwortWerte: { Kontobestand: "500 EUR" },
    });
    await db.speichereAuskunftsersuchenAntwort(fallId, "RALPH-TEST Antworttext", "2026-01-01");

    const vorherStatus = (await pool.query(`SELECT status FROM feldmark.auskunftsersuchen_faelle WHERE fall_id = $1`, [fallId]))
      .rows[0].status;

    const res = await fetch(`${BASIS_URL}/api/faelle/${fallId}/antwort/freigeben`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freigegeben_von: "Pruefer A" }),
    });
    assert.equal(res.status, 409, "Gate haette 409 liefern muessen - hier geht es um Datenherausgabe an eine Behoerde");
    const body = await res.json();
    assert.equal(body.vier_augen_warnung, true);

    const nachherStatus = (await pool.query(`SELECT status FROM feldmark.auskunftsersuchen_faelle WHERE fall_id = $1`, [fallId]))
      .rows[0].status;
    assert.equal(nachherStatus, vorherStatus);
    assert.notEqual(nachherStatus, "Antwort freigegeben");
  }
);

test(
  "Freigabe-Endpunkte lehnen einen Request komplett ohne 'freigegeben_von' ab (400), unabhaengig vom Vier-Augen-Gate",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-HITL-400-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: "RALPH-TEST Schuldner" },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    const res = await fetch(`${BASIS_URL}/api/faelle/${fallId}/erklaerung/freigeben`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  }
);
