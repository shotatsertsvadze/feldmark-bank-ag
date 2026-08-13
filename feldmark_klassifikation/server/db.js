/**
 * Postgres-Anbindung fuer die Fallanlage. Direkte Verbindung (pg), nicht
 * die Supabase-REST-API - derselbe Zugriffsweg wie der bereits getestete
 * n8n-Fristueberwachungs-Workflow (Postgres-Node), damit beide auf
 * denselben Tabellen ohne Rollenkonflikt arbeiten.
 *
 * Schreibt in drei Tabellen (siehe feldmark_pfaendung_schema.sql,
 * feldmark_auskunftsersuchen_schema.sql, feldmark_sichtpruefung_schema.sql):
 *  - feldmark_pfaendung_faelle / -protokoll        (unveraendert, bestehend)
 *  - feldmark_auskunftsersuchen_faelle / -protokoll (neu)
 *  - feldmark_sichtpruefung_warteschlange           (neu, typ-uebergreifend)
 */

import pg from "pg";

const { Pool } = pg;
let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL fehlt in der Umgebung (.env) - Supabase-Connection-String eintragen.");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

// Gleicher Wert wie in der Fristen-Node des n8n-Workflows
// ("Fristen berechnen (§ 840 ZPO)"): 14 Kalendertage. Fuer Auskunftsersuchen
// uebernommen, da im Muster ebenfalls 14 Tage (§ 161 StPO-Ersuchen). Nur
// fuer den Audit-Protokolleintrag bei Fallanlage - die tatsaechliche
// Fristueberwachung (inkl. Wochenend-/Feiertagsverschiebung) bleibt Aufgabe
// des n8n-Sweeps, nicht dieses Servers.
const FRIST_TAGE = 14;

function addTage(datumIso, tage) {
  const d = new Date(`${datumIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}
function tageBisHeute(datumIso) {
  const heute = new Date();
  heute.setUTCHours(0, 0, 0, 0);
  const ziel = new Date(`${datumIso}T00:00:00Z`);
  return Math.round((ziel.getTime() - heute.getTime()) / 86400000);
}

async function protokolliere(tabelle, fallId, ereignis, eingangsdatumIso) {
  const fristende = addTage(eingangsdatumIso, FRIST_TAGE);
  const restTage = tageBisHeute(fristende);
  await getPool().query(
    `INSERT INTO ${tabelle} (fall_id, ereignis, fristende, rest_tage) VALUES ($1, $2, $3, $4)`,
    [fallId, ereignis, fristende, restTage]
  );
}

/**
 * Sucht ein bezug_aktenzeichen (aus einem Erinnerungsschreiben) in beiden
 * Faelle-Tabellen. Grundlage fuer die Routing-Regel "Erinnerungsschreiben
 * ohne auffindbares Aktenzeichen -> Sichtpruefung".
 */
export async function findeFallZuAktenzeichen(aktenzeichen) {
  if (!aktenzeichen) return null;
  const pool = getPool();
  // Whitespace-normalisierter Vergleich statt exaktem String-Match: ein
  // einzelner OCR-Wackler (Leerzeichen, Zeilenumbruch) im Aktenzeichen soll
  // ein echtes Erinnerungsschreiben oder ein echtes Duplikat nicht schon
  // an dieser Stelle verfehlen. Faellt der Treffer trotzdem aus, greift
  // weiterhin sicher die Sichtpruefung - hier wird nur die Trefferquote
  // verbessert, nicht die Fehlerrichtung geaendert.
  const pf = await pool.query(
    "SELECT fall_id FROM feldmark_pfaendung_faelle WHERE regexp_replace(aktenzeichen, '\\s+', '', 'g') = regexp_replace($1, '\\s+', '', 'g')",
    [aktenzeichen]
  );
  if (pf.rows.length) return { tabelle: "feldmark_pfaendung_faelle", fall_id: pf.rows[0].fall_id };

  const ae = await pool.query(
    "SELECT fall_id FROM feldmark_auskunftsersuchen_faelle WHERE regexp_replace(aktenzeichen, '\\s+', '', 'g') = regexp_replace($1, '\\s+', '', 'g')",
    [aktenzeichen]
  );
  if (ae.rows.length) return { tabelle: "feldmark_auskunftsersuchen_faelle", fall_id: ae.rows[0].fall_id };

  return null;
}

/**
 * Legt einen Pfaendungsfall an (pfaendungsschreiben, einziehungsverfuegung,
 * ueberweisungsverfuegung - alle drei teilen sich die Tabelle, siehe
 * PFAENDUNGSBLOCK_TYPEN in mistral.js). Legt NICHT an, wenn Pflichtfelder
 * fehlen, egal wie hoch die Konfidenz war - lieber Sichtpruefung als ein
 * unvollstaendiger Fall.
 */
export async function legePfaendungsfallAn(klassifikation, eingang) {
  const { kopf, pfaendung } = klassifikation;
  const fehlend = [];
  if (!kopf.aktenzeichen) fehlend.push("kopf.aktenzeichen");
  if (!pfaendung.glaeubiger_name) fehlend.push("pfaendung.glaeubiger_name");
  if (!pfaendung.schuldner_name) fehlend.push("pfaendung.schuldner_name");
  if (!eingang.zustelldatum) fehlend.push("zustelldatum (Upload-Metadaten)");
  if (!eingang.zustellkanal) fehlend.push("zustellkanal (Upload-Metadaten)");
  if (!eingang.bearbeiter_email) fehlend.push("bearbeiter_email (Upload-Metadaten)");
  if (fehlend.length) {
    return { angelegt: false, grund: `Pflichtfeld(er) fehlen: ${fehlend.join(", ")}` };
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT nextval('feldmark_pfaendung_fall_seq') AS n");
  const fallId = `PF-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(4, "0")}`;

  await pool.query(
    `INSERT INTO feldmark_pfaendung_faelle
       (fall_id, aktenzeichen, glaeubiger, schuldner, zustelldatum, zustellkanal,
        status, bearbeiter_email, vertretung_email, vorgesetzte_email)
     VALUES ($1, $2, $3, $4, $5, $6, 'Eingegangen', $7, $8, $9)`,
    [
      fallId,
      kopf.aktenzeichen,
      pfaendung.glaeubiger_name,
      pfaendung.schuldner_name,
      eingang.zustelldatum,
      eingang.zustellkanal,
      eingang.bearbeiter_email,
      eingang.vertretung_email ?? null,
      eingang.vorgesetzte_email ?? null,
    ]
  );
  await protokolliere("feldmark_pfaendung_protokoll", fallId, "fall_angelegt", eingang.zustelldatum);

  return { angelegt: true, fall_id: fallId, tabelle: "feldmark_pfaendung_faelle" };
}

/**
 * Legt einen Auskunftsersuchen-Fall an. Ohne antwortfrist_tage aus der
 * Extraktion keine Fallanlage - ohne Frist keine Fristueberwachung
 * moeglich (siehe Spaltenkommentar im Schema).
 */
export async function legeAuskunftsersuchenFallAn(klassifikation, eingang) {
  const { kopf, auskunftsersuchen: ae } = klassifikation;
  const fehlend = [];
  if (!kopf.aktenzeichen) fehlend.push("kopf.aktenzeichen");
  if (!kopf.ausstellende_stelle) fehlend.push("kopf.ausstellende_stelle");
  if (!ae.betroffene_person_name) fehlend.push("auskunftsersuchen.betroffene_person_name");
  if (!ae.antwortfrist_tage) fehlend.push("auskunftsersuchen.antwortfrist_tage");
  if (!eingang.zustelldatum) fehlend.push("zustelldatum (Upload-Metadaten)");
  if (!eingang.zustellkanal) fehlend.push("zustellkanal (Upload-Metadaten)");
  if (!eingang.bearbeiter_email) fehlend.push("bearbeiter_email (Upload-Metadaten)");
  if (fehlend.length) {
    return { angelegt: false, grund: `Pflichtfeld(er) fehlen: ${fehlend.join(", ")}` };
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT nextval('feldmark_auskunftsersuchen_fall_seq') AS n");
  const fallId = `AE-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(4, "0")}`;

  await pool.query(
    `INSERT INTO feldmark_auskunftsersuchen_faelle
       (fall_id, aktenzeichen, ausstellende_behoerde, betroffene_person_name,
        betroffene_person_geburtsdatum, tatvorwurf, angefragte_punkte, vertraulich,
        eingangsdatum, antwortfrist_tage, zustellkanal, status,
        bearbeiter_email, vertretung_email, vorgesetzte_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Eingegangen',$12,$13,$14)`,
    [
      fallId,
      kopf.aktenzeichen,
      kopf.ausstellende_stelle,
      ae.betroffene_person_name,
      ae.betroffene_person_geburtsdatum || null,
      ae.tatvorwurf || null,
      ae.angefragte_punkte || [],
      ae.vertraulich ?? false,
      eingang.zustelldatum,
      ae.antwortfrist_tage,
      eingang.zustellkanal,
      eingang.bearbeiter_email,
      eingang.vertretung_email ?? null,
      eingang.vorgesetzte_email ?? null,
    ]
  );
  await protokolliere("feldmark_auskunftsersuchen_protokoll", fallId, "fall_angelegt", eingang.zustelldatum);

  return { angelegt: true, fall_id: fallId, tabelle: "feldmark_auskunftsersuchen_faelle" };
}

/** Vier-Augen-Pflicht als Protokoll-Ereignis, statt einer Extra-Spalte in
 * feldmark_pfaendung_faelle - diese Tabelle sollte laut Entscheidung
 * unveraendert bleiben (schont den bestehenden n8n-Workflow). */
export async function protokolliereVierAugen(tabelle, fallId, eingangsdatumIso) {
  const protokollTabelle =
    tabelle === "feldmark_pfaendung_faelle" ? "feldmark_pfaendung_protokoll" : "feldmark_auskunftsersuchen_protokoll";
  await protokolliere(protokollTabelle, fallId, "vier_augen_erforderlich", eingangsdatumIso);
}

/** Ereignis "Erinnerung erhalten" gegen einen bereits bestehenden Fall -
 * legt KEINEN neuen Fall an. */
export async function protokolliereErinnerungErhalten(tabelle, fallId, eingangsdatumIso) {
  const protokollTabelle =
    tabelle === "feldmark_pfaendung_faelle" ? "feldmark_pfaendung_protokoll" : "feldmark_auskunftsersuchen_protokoll";
  await protokolliere(protokollTabelle, fallId, "erinnerung_erhalten", eingangsdatumIso);
}

/** Sammelpunkt fuer alles, was laut Routing kein Autofall wird. */
export async function legeInSichtpruefungAn({ id, dateiname, klassifikation, routing, ansichtUrl, eingangsdatum }) {
  await getPool().query(
    `INSERT INTO feldmark_sichtpruefung_warteschlange
       (id, dateiname, dokumenttyp, konfidenz_typ, plausibilitaet_ok,
        plausibilitaet_begruendung, routing_gruende, klassifikation,
        rohtext_auszug, ansicht_url, eingangsdatum)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      dateiname,
      klassifikation.dokumenttyp,
      klassifikation.konfidenz_typ,
      klassifikation.plausibilitaet_ok,
      klassifikation.plausibilitaet_begruendung,
      routing.gruende,
      JSON.stringify(klassifikation),
      klassifikation.rohtext_auszug,
      ansichtUrl,
      eingangsdatum || null,
    ]
  );
}

/**
 * Alle offenen Faelle aus beiden Faelle-Tabellen, fuer das Dashboard.
 * "Offen" = noch nicht abgeschlossen (dieselbe Statusliste, die auch der
 * n8n-Fristueberwachungs-Workflow als Sweep-Filter verwendet).
 */
export async function listeOffeneFaelle() {
  // to_char statt der rohen date-Spalte: node-pg parst "date" sonst als
  // JS-Date-Objekt, das beim Serialisieren zu ISO-UTC wird und je nach
  // Zeitzone auf den Vortag faellt (2026-08-13 -> "2026-08-12T22:00:00Z").
  // Genau die Art von Datumsverschiebung, vor der klassifikations_schema.md
  // warnt - hier technisch statt fachlich, aber gleiche Konsequenz.
  const pool = getPool();
  const pfaendung = await pool.query(
    `SELECT fall_id, aktenzeichen, glaeubiger AS partei_a, schuldner AS partei_b,
            to_char(zustelldatum, 'YYYY-MM-DD') AS eingangsdatum, 14 AS antwortfrist_tage, zustellkanal,
            status, erinnerungen_gesendet, 'pfaendungsschreiben' AS dokumenttyp
     FROM   feldmark_pfaendung_faelle
     WHERE  status NOT IN ('Erklaerung versandt', 'Abgeschlossen', 'Abgeschlossen mit Fristversaeumnis')`
  );
  const auskunftsersuchen = await pool.query(
    `SELECT fall_id, aktenzeichen, ausstellende_behoerde AS partei_a, betroffene_person_name AS partei_b,
            to_char(eingangsdatum, 'YYYY-MM-DD') AS eingangsdatum, antwortfrist_tage, zustellkanal,
            status, erinnerungen_gesendet, 'auskunftsersuchen' AS dokumenttyp
     FROM   feldmark_auskunftsersuchen_faelle
     WHERE  status NOT IN ('Antwort versandt', 'Abgeschlossen', 'Abgeschlossen mit Fristversaeumnis')`
  );
  return [...pfaendung.rows, ...auskunftsersuchen.rows].sort((a, b) =>
    a.eingangsdatum < b.eingangsdatum ? -1 : 1
  );
}

/** Offene Eintraege der Sichtpruefungs-Warteschlange, aeltester zuerst. */
export async function listeSichtpruefung() {
  const { rows } = await getPool().query(
    `SELECT id, dateiname, dokumenttyp, konfidenz_typ, plausibilitaet_ok,
            plausibilitaet_begruendung, routing_gruende,
            to_char(eingangsdatum, 'YYYY-MM-DD') AS eingangsdatum, erzeugt_am
     FROM   feldmark_sichtpruefung_warteschlange
     WHERE  status = 'offen'
     ORDER  BY erzeugt_am`
  );
  return rows;
}
