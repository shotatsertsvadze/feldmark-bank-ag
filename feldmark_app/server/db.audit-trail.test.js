/**
 * Integrationstest fuer RALPH-PROGRESS.md Backlog #1 (Audit-Trail-
 * Vollstaendigkeit). Laeuft gegen die echte Supabase-DB (wie der Rest des
 * Projekts bisher "getestet" wird - es gibt keine separate Test-DB/Mocking-
 * Schicht, siehe CLAUDE.md), legt dafuer eigene RALPH-TEST-*-Faelle an und
 * raeumt sie in `after()` wieder auf, damit das Demo-Datenset sauber bleibt.
 *
 * Ausfuehren: npm test (siehe package.json) - erfordert eine echte
 * DATABASE_URL in feldmark_app/.env (Session Pooler, siehe CLAUDE.md). Ohne
 * .env werden die Tests uebersprungen statt fehlzuschlagen (z.B. CI/frischer
 * Checkout ohne Secrets).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PFAD = path.join(__dirname, "..", ".env");
if (existsSync(ENV_PFAD)) process.loadEnvFile(ENV_PFAD);

const HAT_DB = !!process.env.DATABASE_URL;
const SKIP_GRUND = "DATABASE_URL fehlt (.env) - Audit-Trail-Integrationstest uebersprungen";
const pool = HAT_DB ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

// { fallId, typ: "pfaendung" | "auskunftsersuchen" } - in jedem Test
// gesammelt, damit after() alles wieder entfernt, egal welche Tests liefen.
const erstellteFaelle = [];

after(async () => {
  if (!pool) return;
  for (const { fallId, typ } of erstellteFaelle) {
    if (typ === "pfaendung") {
      await pool.query(`DELETE FROM feldmark.pfaendung_protokoll WHERE fall_id = $1`, [fallId]);
      await pool.query(`DELETE FROM feldmark.pfaendung_datendiskrepanz WHERE fall_id = $1`, [fallId]);
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

async function holeEreignisse(tabelle, fallId) {
  const { rows } = await pool.query(`SELECT ereignis FROM ${tabelle} WHERE fall_id = $1 ORDER BY erzeugt_am`, [fallId]);
  return rows.map((r) => r.ereignis);
}

function testEingang() {
  return { zustelldatum: "2026-01-01", zustellkanal: "E-Mail", bearbeiter_email: "ralph-test@feldmark.test" };
}

test(
  "Pfaendung: erzeugen/freigeben/versenden schreiben je ein Protokoll-Ereignis (vorher stumm)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: "RALPH-TEST Schuldner" },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    await db.speichereErklaerung(fallId, "RALPH-TEST Erklaerungstext", "2026-01-01");
    await db.gibErklaerungFrei(fallId, "Pruefer A", "2026-01-01");
    await db.bestaetigeVersand(fallId, "Versender B", "2026-01-01");

    const ereignisse = await holeEreignisse("feldmark.pfaendung_protokoll", fallId);
    assert.ok(ereignisse.includes("erklaerung_erzeugt"), `erklaerung_erzeugt fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("erklaerung_freigegeben"), `erklaerung_freigegeben fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("erklaerung_versendet"), `erklaerung_versendet fehlt in ${ereignisse}`);
  }
);

test(
  "Auskunftsersuchen: erzeugen/freigeben/versenden schreiben je ein Protokoll-Ereignis (vorher stumm)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legeAuskunftsersuchenFallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-AE-${Date.now()}`, ausstellende_stelle: "RALPH-TEST Behoerde", rechtsgrundlage: ["§ 161 StPO"] },
        auskunftsersuchen: { betroffene_person_name: "RALPH-TEST Person", antwortfrist_tage: 14, angefragte_punkte: ["Kontobestand"], vertraulich: false },
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "auskunftsersuchen" });

    await db.speichereAuskunftsersuchenAntwort(fallId, "RALPH-TEST Antworttext", "2026-01-01");
    await db.gibAntwortFrei(fallId, "Pruefer A", "2026-01-01");
    await db.bestaetigeAntwortVersand(fallId, "Versender B", "2026-01-01");

    const ereignisse = await holeEreignisse("feldmark.auskunftsersuchen_protokoll", fallId);
    assert.ok(ereignisse.includes("antwort_erzeugt"), `antwort_erzeugt fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("antwort_freigegeben"), `antwort_freigegeben fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("antwort_versendet"), `antwort_versendet fehlt in ${ereignisse}`);
  }
);

test(
  "Datendiskrepanz (Ast A): Nachfassungen, fristwahrende Erklaerung, Reaktivierung protokollieren (vorher stumm)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-DD-A-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: null },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    assert.equal(angelegt.datendiskrepanz, true, "Testfall sollte nurSchuldnerFehlt-Pfad ausloesen");
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    await db.protokolliereNachfassung(fallId, 1, "RALPH-TEST Nachfassung 1", "2026-01-01");
    await db.protokolliereNachfassung(fallId, 2, "RALPH-TEST Nachfassung 2", "2026-01-01");
    await db.markiereFristwahrendErklaert(fallId, "2026-01-01");
    await db.reaktiviereDatendiskrepanzFall(fallId, "RALPH-TEST Echter Schuldner", "Bearbeiter C");

    const ereignisse = await holeEreignisse("feldmark.pfaendung_protokoll", fallId);
    assert.ok(ereignisse.includes("datendiskrepanz_nachfassung_1_gesendet"), `nachfassung_1 fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("datendiskrepanz_nachfassung_2_gesendet"), `nachfassung_2 fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("datendiskrepanz_fristwahrend_erklaert"), `fristwahrend fehlt in ${ereignisse}`);
    assert.ok(ereignisse.includes("datendiskrepanz_reaktiviert"), `reaktiviert fehlt in ${ereignisse}`);
  }
);

test(
  "Datendiskrepanz (Ast A4b): Schliessung nach 30 Tagen ohne Antwort protokolliert (vorher stumm)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    // Eigener Fall statt Wiederverwendung des obigen: reaktiviereDatendiskrepanzFall()
    // und schliesseDatendiskrepanzUngeklaert() schliessen sich gegenseitig aus
    // (beide pruefen "geklaert_am IS NULL AND geschlossen_am IS NULL").
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-DD-B-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: null },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    await db.schliesseDatendiskrepanzUngeklaert(fallId, "RALPH-TEST Testgrund", "2026-01-01");

    const ereignisse = await holeEreignisse("feldmark.pfaendung_protokoll", fallId);
    assert.ok(ereignisse.includes("datendiskrepanz_geschlossen_ungeklaert"), `geschlossen_ungeklaert fehlt in ${ereignisse}`);
  }
);
