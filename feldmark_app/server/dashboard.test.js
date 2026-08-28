/**
 * Integrationstest fuer RALPH-PROGRESS.md Backlog #4 (Case Dashboard):
 * listeOffeneFaelle() muss pro Fall Aktenzeichen, Status, Restfrist UND das
 * letzte protokollierte Ereignis liefern - der letzte Punkt fehlte bisher
 * komplett (nur im fallübergreifenden Aktivitätsfeed oder nach Aufklappen
 * der Zeile sichtbar). Laeuft wie db.audit-trail.test.js gegen die echte
 * Supabase-DB, eigene RALPH-TEST-*-Faelle, Cleanup in after().
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
const SKIP_GRUND = "DATABASE_URL fehlt (.env) - Dashboard-Integrationstest uebersprungen";
const pool = HAT_DB ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const erstellteFaelle = [];

after(async () => {
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
  "listeOffeneFaelle() liefert das letzte Ereignis pro Pfaendungsfall (vorher gar nicht vorhanden)",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legePfaendungsfallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-DASH-${Date.now()}` },
        pfaendung: { glaeubiger_name: "RALPH-TEST Glaeubiger", schuldner_name: "RALPH-TEST Schuldner" },
        dokumenttyp: "pfaendungsschreiben",
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "pfaendung" });

    // fall_angelegt ist jetzt das letzte Ereignis ...
    let faelle = await db.listeOffeneFaelle();
    let zeile = faelle.find((f) => f.fall_id === fallId);
    assert.ok(zeile, "Frisch angelegter Fall sollte in listeOffeneFaelle() erscheinen");
    assert.equal(zeile.letztes_ereignis, "fall_angelegt");
    assert.ok(zeile.letztes_ereignis_am, "letztes_ereignis_am sollte gesetzt sein");

    // ... nach einer weiteren Aktion muss sich das letzte Ereignis aendern.
    await db.speichereErklaerung(fallId, "RALPH-TEST Erklaerungstext", "2026-01-01");
    faelle = await db.listeOffeneFaelle();
    zeile = faelle.find((f) => f.fall_id === fallId);
    assert.equal(zeile.letztes_ereignis, "erklaerung_erzeugt", "letztes Ereignis haette sich aktualisieren muessen");
  }
);

test(
  "listeOffeneFaelle() liefert das letzte Ereignis pro Auskunftsersuchen-Fall",
  { skip: !HAT_DB && SKIP_GRUND },
  async () => {
    const angelegt = await db.legeAuskunftsersuchenFallAn(
      {
        kopf: { aktenzeichen: `RALPH-TEST-DASH-AE-${Date.now()}`, ausstellende_stelle: "RALPH-TEST Behoerde", rechtsgrundlage: ["§ 161 StPO"] },
        auskunftsersuchen: { betroffene_person_name: "RALPH-TEST Person", antwortfrist_tage: 14, angefragte_punkte: ["Kontobestand"], vertraulich: false },
      },
      testEingang()
    );
    assert.equal(angelegt.angelegt, true);
    const fallId = angelegt.fall_id;
    erstellteFaelle.push({ fallId, typ: "auskunftsersuchen" });

    // Bei Auskunftsersuchen ist "compliance_informiert" das jüngste
    // Ereignis bei Fallanlage (siehe legeAuskunftsersuchenFallAn), nicht
    // fall_angelegt - beide werden geschrieben, aber compliance_informiert
    // zuletzt.
    let faelle = await db.listeOffeneFaelle();
    let zeile = faelle.find((f) => f.fall_id === fallId);
    assert.ok(zeile, "Frisch angelegter Auskunftsersuchen-Fall sollte erscheinen");
    assert.equal(zeile.letztes_ereignis, "compliance_informiert");

    await db.speichereAuskunftsersuchenAntwort(fallId, "RALPH-TEST Antworttext", "2026-01-01");
    faelle = await db.listeOffeneFaelle();
    zeile = faelle.find((f) => f.fall_id === fallId);
    assert.equal(zeile.letztes_ereignis, "antwort_erzeugt");
  }
);
