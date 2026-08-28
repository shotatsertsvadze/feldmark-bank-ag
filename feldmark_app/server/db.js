/**
 * Postgres-Anbindung fuer die Fallanlage. Direkte Verbindung (pg), nicht
 * die Supabase-REST-API - derselbe Zugriffsweg wie der bereits getestete
 * n8n-Fristueberwachungs-Workflow (Postgres-Node), damit beide auf
 * denselben Tabellen ohne Rollenkonflikt arbeiten.
 *
 * Schreibt in drei Tabellen (siehe feldmark_pfaendung_schema.sql,
 * feldmark_auskunftsersuchen_schema.sql, feldmark_sichtpruefung_schema.sql):
 *  - feldmark.pfaendung_faelle / -protokoll        (unveraendert, bestehend)
 *  - feldmark.auskunftsersuchen_faelle / -protokoll (neu)
 *  - feldmark.sichtpruefung_warteschlange           (neu, typ-uebergreifend)
 */

import pg from "pg";
import { erzeugeRueckfrage } from "./datendiskrepanz.js";

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
    "SELECT fall_id FROM feldmark.pfaendung_faelle WHERE regexp_replace(aktenzeichen, '\\s+', '', 'g') = regexp_replace($1, '\\s+', '', 'g')",
    [aktenzeichen]
  );
  if (pf.rows.length) return { tabelle: "feldmark.pfaendung_faelle", fall_id: pf.rows[0].fall_id };

  const ae = await pool.query(
    "SELECT fall_id FROM feldmark.auskunftsersuchen_faelle WHERE regexp_replace(aktenzeichen, '\\s+', '', 'g') = regexp_replace($1, '\\s+', '', 'g')",
    [aktenzeichen]
  );
  if (ae.rows.length) return { tabelle: "feldmark.auskunftsersuchen_faelle", fall_id: ae.rows[0].fall_id };

  return null;
}

// Platzhalter fuer feldmark.pfaendung_faelle.schuldner (NOT NULL), solange
// der Datendiskrepanz-Workflow noch laeuft - siehe legePfaendungsfallAn().
const SCHULDNER_PLATZHALTER = "(nicht zugeordnet - Rückfrage an Gläubiger läuft)";

/**
 * Legt einen Pfaendungsfall an (pfaendungsschreiben, einziehungsverfuegung,
 * ueberweisungsverfuegung - alle drei teilen sich die Tabelle, siehe
 * PFAENDUNGSBLOCK_TYPEN in mistral.js). Legt NICHT an, wenn Pflichtfelder
 * fehlen, egal wie hoch die Konfidenz war - lieber Sichtpruefung als ein
 * unvollstaendiger Fall.
 *
 * Ausnahme (Sollkonzept 3.1, Ast A "Datendiskrepanz"): fehlt EINZIG
 * pfaendung.schuldner_name, wird der Fall trotzdem angelegt (mit
 * Platzhalter-Schuldner) und der Datendiskrepanz-Workflow angestossen,
 * statt in die Sichtpruefung zu gehen - das ist der Kern des Sollkonzept-
 * Befunds "die Klaerung darf die Frist nicht blockieren". Fehlen dagegen
 * Aktenzeichen oder Glaeubiger (oder mehr als nur der Schuldnername),
 * bleibt es bei der Sichtpruefung, weil ohne diese beiden Angaben keine
 * sinnvolle Rueckfrage moeglich ist ("unser Aktenzeichen, sein
 * Aktenzeichen"). Siehe feldmark.pfaendung_datendiskrepanz_schema.sql fuer
 * die vollstaendige Begruendung dieser Scope-Praezisierung.
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

  const nurSchuldnerFehlt = fehlend.length === 1 && fehlend[0] === "pfaendung.schuldner_name";
  if (fehlend.length && !nurSchuldnerFehlt) {
    return { angelegt: false, grund: `Pflichtfeld(er) fehlen: ${fehlend.join(", ")}` };
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT nextval('feldmark.pfaendung_fall_seq') AS n");
  const fallId = `PF-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(4, "0")}`;

  await pool.query(
    `INSERT INTO feldmark.pfaendung_faelle
       (fall_id, aktenzeichen, glaeubiger, schuldner, zustelldatum, zustellkanal,
        status, bearbeiter_email, vertretung_email, vorgesetzte_email, dokumenttyp)
     VALUES ($1, $2, $3, $4, $5, $6, 'Eingegangen', $7, $8, $9, $10)`,
    [
      fallId,
      kopf.aktenzeichen,
      pfaendung.glaeubiger_name,
      nurSchuldnerFehlt ? SCHULDNER_PLATZHALTER : pfaendung.schuldner_name,
      eingang.zustelldatum,
      eingang.zustellkanal,
      eingang.bearbeiter_email,
      eingang.vertretung_email ?? null,
      eingang.vorgesetzte_email ?? null,
      klassifikation.dokumenttyp,
    ]
  );
  // forderung_gesamt_eur/konfidenz_betrag wurden bisher an dieser Stelle
  // verworfen - jetzt in der Erweiterungstabelle mitgefuehrt, weil die
  // P-Konto-Pfaendbarkeitsberechnung und die Drittschuldnererklaerung
  // beide die Forderungshoehe brauchen (siehe pkonto_drittschuldner.js).
  await pool.query(
    `INSERT INTO feldmark.pfaendung_erweiterung (fall_id, forderung_gesamt_eur, konfidenz_betrag)
     VALUES ($1, $2, $3)`,
    [fallId, pfaendung.forderung_gesamt_eur ?? null, pfaendung.konfidenz_betrag ?? null]
  );
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "fall_angelegt", eingang.zustelldatum);

  if (nurSchuldnerFehlt) {
    const rueckfrageText = erzeugeRueckfrage({ aktenzeichen: kopf.aktenzeichen, fall_id: fallId });
    await pool.query(`INSERT INTO feldmark.pfaendung_datendiskrepanz (fall_id, rueckfrage_text) VALUES ($1, $2)`, [
      fallId,
      rueckfrageText,
    ]);
    await protokolliere("feldmark.pfaendung_protokoll", fallId, "datendiskrepanz_rueckfrage_gesendet", eingang.zustelldatum);
  }

  return { angelegt: true, fall_id: fallId, tabelle: "feldmark.pfaendung_faelle", datendiskrepanz: nurSchuldnerFehlt };
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
  const { rows } = await pool.query("SELECT nextval('feldmark.auskunftsersuchen_fall_seq') AS n");
  const fallId = `AE-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(4, "0")}`;

  await pool.query(
    `INSERT INTO feldmark.auskunftsersuchen_faelle
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
  // kopf.rechtsgrundlage wurde bisher an dieser Stelle verworfen - jetzt in
  // der Erweiterungstabelle mitgefuehrt, weil die Antwort sie zitieren muss
  // (siehe auskunftsersuchen_antwort.js). compliance_informiert_am wird
  // sofort gesetzt (E2 "automatisiert, sofort" - Sollkonzept 3.5), nicht
  // erst bei einer spaeteren Mitarbeiteraktion wie bei der P-Konto-
  // Benachrichtigung, wo das erst beim Erfassen des Guthabens ausgeloest
  // wird - hier gibt es keine vergleichbare Ambiguitaet zu vermeiden.
  await pool.query(
    `INSERT INTO feldmark.auskunftsersuchen_erweiterung (fall_id, rechtsgrundlage, compliance_informiert_am)
     VALUES ($1, $2, now())`,
    [fallId, kopf.rechtsgrundlage || []]
  );
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "fall_angelegt", eingang.zustelldatum);
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "compliance_informiert", eingang.zustelldatum);

  return { angelegt: true, fall_id: fallId, tabelle: "feldmark.auskunftsersuchen_faelle" };
}

/** Vier-Augen-Pflicht als Protokoll-Ereignis, statt einer Extra-Spalte in
 * feldmark.pfaendung_faelle - diese Tabelle sollte laut Entscheidung
 * unveraendert bleiben (schont den bestehenden n8n-Workflow). */
export async function protokolliereVierAugen(tabelle, fallId, eingangsdatumIso) {
  const protokollTabelle =
    tabelle === "feldmark.pfaendung_faelle" ? "feldmark.pfaendung_protokoll" : "feldmark.auskunftsersuchen_protokoll";
  await protokolliere(protokollTabelle, fallId, "vier_augen_erforderlich", eingangsdatumIso);
}

/** Protokolliert, wenn die weiche Vier-Augen-Warnung bei Freigabe der
 * Drittschuldnererklaerung bewusst uebersteuert wurde (dieselbe Person hat
 * Guthaben erfasst UND freigegeben). Kein Auth-System vorhanden, daher kein
 * hartes Blockieren moeglich - siehe KONTEXT.md. */
export async function protokolliereVierAugenErklaerungUebersteuert(fallId, eingangsdatumIso) {
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "vier_augen_erklaerung_uebersteuert", eingangsdatumIso);
}

/** Gleiches Muster wie protokolliereVierAugenErklaerungUebersteuert(), nur
 * fuer die Auskunftsersuchen-Antwort (Ast E, E4). Eigene Funktion statt
 * Wiederverwendung ueber einen Tabellen-Parameter, um den bereits
 * getesteten Pfaendungs-Pfad nicht anzufassen. */
export async function protokolliereVierAugenAntwortUebersteuert(fallId, eingangsdatumIso) {
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "vier_augen_antwort_uebersteuert", eingangsdatumIso);
}

export async function protokolliereErklaerungAbgelehnt(fallId, eingangsdatumIso) {
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "erklaerung_abgelehnt", eingangsdatumIso);
}

export async function protokolliereAntwortAbgelehnt(fallId, eingangsdatumIso) {
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "antwort_abgelehnt", eingangsdatumIso);
}

/** Ereignis "Erinnerung erhalten" gegen einen bereits bestehenden Fall -
 * legt KEINEN neuen Fall an. */
export async function protokolliereErinnerungErhalten(tabelle, fallId, eingangsdatumIso) {
  const protokollTabelle =
    tabelle === "feldmark.pfaendung_faelle" ? "feldmark.pfaendung_protokoll" : "feldmark.auskunftsersuchen_protokoll";
  await protokolliere(protokollTabelle, fallId, "erinnerung_erhalten", eingangsdatumIso);
}

/** Sammelpunkt fuer alles, was laut Routing kein Autofall wird. */
export async function legeInSichtpruefungAn({ id, dateiname, klassifikation, routing, ansichtUrl, eingangsdatum }) {
  await getPool().query(
    `INSERT INTO feldmark.sichtpruefung_warteschlange
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
            status, erinnerungen_gesendet, dokumenttyp
     FROM   feldmark.pfaendung_faelle
     WHERE  status NOT IN ('Erklaerung versandt', 'Abgeschlossen', 'Abgeschlossen mit Fristversaeumnis')`
  );
  const auskunftsersuchen = await pool.query(
    `SELECT fall_id, aktenzeichen, ausstellende_behoerde AS partei_a, betroffene_person_name AS partei_b,
            to_char(eingangsdatum, 'YYYY-MM-DD') AS eingangsdatum, antwortfrist_tage, zustellkanal,
            status, erinnerungen_gesendet, vertraulich, 'auskunftsersuchen' AS dokumenttyp
     FROM   feldmark.auskunftsersuchen_faelle
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
     FROM   feldmark.sichtpruefung_warteschlange
     WHERE  status = 'offen'
     ORDER  BY erzeugt_am`
  );
  return rows;
}

/**
 * Pfaendungsfall inkl. P-Konto-/Drittschuldnererklaerung-Erweiterung, fuer
 * die Fall-Detailansicht. Gibt null zurueck, wenn der Fall nicht existiert.
 */
export async function ermittleFallMitErweiterung(fallId) {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen, f.glaeubiger, f.schuldner,
            to_char(f.zustelldatum, 'YYYY-MM-DD') AS zustelldatum, f.zustellkanal, f.status,
            e.forderung_gesamt_eur, e.konfidenz_betrag, e.ist_p_konto, e.p_konto_geprueft,
            e.p_konto_freibetrag_erhoehung, e.p_konto_benachrichtigt_am,
            e.guthaben_eur, e.guthaben_erfasst_am, e.guthaben_erfasst_von, e.erklaerung_text,
            e.erklaerung_erzeugt_am, e.erklaerung_freigegeben_von, e.erklaerung_freigegeben_am,
            e.erklaerung_versendet_von, e.erklaerung_versendet_am
     FROM   feldmark.pfaendung_faelle f
     JOIN   feldmark.pfaendung_erweiterung e ON e.fall_id = f.fall_id
     WHERE  f.fall_id = $1`,
    [fallId]
  );
  return rows[0] ?? null;
}

/**
 * Andere offene Pfaendungsfaelle desselben Schuldners (fuer Rang und
 * Pflichtangabe 3 nach § 840 ZPO). Namensabgleich ist bewusst simpel
 * (exakter Textvergleich, case-insensitive) - ein robuster Identitaets-
 * abgleich (IBAN/Geburtsdatum) ist im aktuellen Datenmodell nicht
 * vorhanden, siehe Ergaenzungskonzept, offene Punkte.
 */
export async function findeAndereOffenePfaendungen(schuldner, fallIdAusschliessen) {
  const { rows } = await getPool().query(
    `SELECT fall_id, glaeubiger, to_char(zustelldatum, 'YYYY-MM-DD') AS zustelldatum
     FROM   feldmark.pfaendung_faelle
     WHERE  lower(schuldner) = lower($1)
       AND  fall_id <> $2
       AND  status NOT IN ('Erklaerung versandt', 'Abgeschlossen', 'Abgeschlossen mit Fristversaeumnis')
     ORDER  BY zustelldatum`,
    [schuldner, fallIdAusschliessen]
  );
  return rows;
}

/**
 * Aktualisiert die manuell erfassten Felder (P-Konto-Status, Guthaben).
 *
 * Code-Review-Fund 2026-08-27: ist_p_konto ist NOT NULL DEFAULT false, und
 * die Checkbox im Formular startet ebenfalls ungecheckt - "kein P-Konto"
 * und "noch nicht geprueft" waren dadurch nicht unterscheidbar. Ein
 * Mitarbeiter, der nur das Guthaben speichert, BEVOR er den P-Konto-Status
 * ueberhaupt geprueft hat, loeste dadurch ungewollt die "kein P-Konto"-
 * Benachrichtigung aus. Neue Spalte p_konto_geprueft traegt jetzt die
 * eigentliche Tri-State-Information; ist_p_konto bleibt unangetastet
 * (kein Eingriff in die bestehende COALESCE-Logik fuer guthaben_eur/
 * p_konto_freibetrag_erhoehung - siehe KONTEXT.md fuer die bekannte,
 * bewusst zurueckgestellte Einschraenkung dort).
 *
 * Gibt { zeile, wurdeGeradeGeprueft } zurueck statt nur der Zeile: die
 * WITH-CTE liest den P-Konto-Geprueft-Stand VOR dem UPDATE mit, damit der
 * Aufrufer (index.js) den Uebergang false -> true in genau diesem Aufruf
 * erkennen kann - nur DANN darf die P-Konto-Benachrichtigung feuern, nicht
 * schon deshalb, weil ist_p_konto zufaellig false ist.
 */
export async function aktualisiereErweiterung(
  fallId,
  { istPKonto, freibetragErhoehungEur, guthabenEur, guthabenErfasstVon, pKontoGeprueft }
) {
  const { rows } = await getPool().query(
    `WITH vorher AS (
       SELECT p_konto_geprueft FROM feldmark.pfaendung_erweiterung WHERE fall_id = $1
     )
     UPDATE feldmark.pfaendung_erweiterung e
     SET    ist_p_konto = COALESCE($2, e.ist_p_konto),
            p_konto_freibetrag_erhoehung = COALESCE($3, e.p_konto_freibetrag_erhoehung),
            guthaben_eur = COALESCE($4, e.guthaben_eur),
            guthaben_erfasst_am = CASE WHEN $4 IS NOT NULL THEN now() ELSE e.guthaben_erfasst_am END,
            guthaben_erfasst_von = CASE WHEN $4 IS NOT NULL THEN $5 ELSE e.guthaben_erfasst_von END,
            p_konto_geprueft = e.p_konto_geprueft OR COALESCE($6, false)
     FROM   vorher
     WHERE  e.fall_id = $1
     RETURNING e.*, vorher.p_konto_geprueft AS p_konto_geprueft_vorher`,
    [fallId, istPKonto ?? null, freibetragErhoehungEur ?? null, guthabenEur ?? null, guthabenErfasstVon ?? null, pKontoGeprueft ?? null]
  );
  if (!rows[0]) return null;
  const { p_konto_geprueft_vorher, ...zeile } = rows[0];
  const wurdeGeradeGeprueft = pKontoGeprueft === true && p_konto_geprueft_vorher === false;
  return { zeile, wurdeGeradeGeprueft };
}

/** Markiert die P-Konto-Benachrichtigung als versandt (Zeitstempel = Nachweis). */
export async function markierePKontoBenachrichtigt(fallId) {
  await getPool().query(
    `UPDATE feldmark.pfaendung_erweiterung SET p_konto_benachrichtigt_am = now() WHERE fall_id = $1`,
    [fallId]
  );
}

/** Speichert den erzeugten Erklaerungstext (noch nicht freigegeben).
 * Setzt auch einen evtl. vorhandenen Freigabe-/Versand-Nachweis einer
 * FRUEHEREN Erklaerung fuer denselben Fall zurueck - sonst wuerde ein neu
 * erzeugter Text faelschlich als "bereits versendet" angezeigt, obwohl nur
 * die vorherige Fassung tatsaechlich versendet wurde. Setzt aus demselben
 * Grund auch fall.status zurueck auf 'Geprueft', falls der Fall bereits bei
 * 'Erklaerung freigegeben' oder 'Erklaerung versandt' stand - sonst wuerde
 * eine frisch erzeugte, noch UNGEPRUEFTE Erklaerung faelschlich als
 * abgeschlossen gelten: der Fall verschwindet dann aus listeOffeneFaelle()
 * und aus findeAndereOffenePfaendungen() (beide filtern 'Erklaerung
 * versandt' heraus), obwohl er weiterhin ueberwacht werden muss - und ein
 * ANDERER Fall desselben Schuldners wuerde bei der Rang-/Pflichtangabe-3-
 * Berechnung eine zu kurze Glaeubigerliste bekommen (Fund aus dem
 * autonomen Nacht-Review, siehe KONTEXT.md). */
export async function speichereErklaerung(fallId, text, eingangsdatumIso) {
  const pool = getPool();
  await pool.query(
    `UPDATE feldmark.pfaendung_erweiterung
     SET    erklaerung_text = $2, erklaerung_erzeugt_am = now(),
            erklaerung_freigegeben_von = NULL, erklaerung_freigegeben_am = NULL,
            erklaerung_versendet_von = NULL, erklaerung_versendet_am = NULL
     WHERE  fall_id = $1`,
    [fallId, text]
  );
  await pool.query(
    `UPDATE feldmark.pfaendung_faelle
     SET    status = 'Geprueft', letzte_aktion_am = now()
     WHERE  fall_id = $1 AND status IN ('Erklaerung freigegeben', 'Erklaerung versandt')`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): dieser Aufruf aenderte bisher
  // teils den Fall-Status (impliziter Geprueft-Reset), ohne je ein
  // Protokoll-Ereignis zu schreiben - unabhaengig vom Aufrufer (Route oder
  // Datendiskrepanz-Sweep) jetzt hier verankert, statt auf Disziplin am
  // Aufrufort zu vertrauen.
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "erklaerung_erzeugt", eingangsdatumIso);
}

/**
 * Freigabe = inhaltliche Bestaetigung des erzeugten Texts durch einen
 * Mitarbeiter. Setzt NUR den Zwischenstatus "Erklaerung freigegeben",
 * NICHT mehr "Erklaerung versandt" (Redesign, siehe KONTEXT.md) - der
 * fruehere Direktsprung war irrefuehrend, weil kein echter Versand-Kanal
 * angebunden ist und "freigegeben" damit faktisch "beim Empfaenger
 * angekommen" vortaeuschte. Der Fall bleibt bewusst in der offenen Liste
 * (listeOffeneFaelle/findeAndereOffenePfaendungen schliessen weiterhin nur
 * 'Erklaerung versandt' aus), bis bestaetigeVersand() den zweiten Schritt
 * abschliesst.
 */
export async function gibErklaerungFrei(fallId, freigegebenVon, eingangsdatumIso) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.pfaendung_erweiterung
     SET    erklaerung_freigegeben_von = $2, erklaerung_freigegeben_am = now()
     WHERE  fall_id = $1 AND erklaerung_text IS NOT NULL
     RETURNING *`,
    [fallId, freigegebenVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.pfaendung_faelle SET status = 'Erklaerung freigegeben', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): frueher nur bei Vier-Augen-
  // Uebersteuerung ein Ereignis (siehe Route) - der reguläre Freigabefall
  // (keine Uebersteuerung noetig) blieb bisher komplett unprotokolliert.
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "erklaerung_freigegeben", eingangsdatumIso);
  return rows[0];
}

/**
 * Zweiter Schritt nach Freigabe: der tatsaechliche (manuelle) Versand wird
 * bestaetigt. Erst hier wechselt der Fall-Status auf "Erklaerung versandt"
 * und faellt aus der n8n-Fristueberwachung heraus - siehe Kommentar bei
 * gibErklaerungFrei() fuer die Begruendung der Trennung.
 */
export async function bestaetigeVersand(fallId, versendetVon, eingangsdatumIso) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.pfaendung_erweiterung
     SET    erklaerung_versendet_von = $2, erklaerung_versendet_am = now()
     WHERE  fall_id = $1 AND erklaerung_freigegeben_am IS NOT NULL
     RETURNING *`,
    [fallId, versendetVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.pfaendung_faelle SET status = 'Erklaerung versandt', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): der irreversible Abschluss-
  // Schritt des gesamten Ast-B-Flows blieb bisher unprotokolliert.
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "erklaerung_versendet", eingangsdatumIso);
  return rows[0];
}

/**
 * Ablehnung: Sachbearbeitung prueft die erzeugte Erklaerung und lehnt sie
 * bewusst ab, statt sie freizugeben (z.B. falsche Angaben) - macht den
 * bisher stillen Geprueft-Reset aus speichereErklaerung() (siehe dort) zu
 * einer expliziten, protokollierten Entscheidung, statt dass eine neue
 * Erklaerung erzeugt werden muesste, um dieselbe Wirkung zu erreichen.
 * Setzt einen evtl. vorhandenen Freigabe-Nachweis zurueck, der Erklaerungs-
 * text selbst bleibt erhalten (kann erneut freigegeben oder ueber "Drittschuldner-
 * erklaerung erzeugen" neu erstellt werden). Nicht mehr moeglich, sobald der
 * Versand bereits bestaetigt wurde - das waere nicht mehr rueckholbar.
 */
export async function lehneErklaerungAb(fallId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.pfaendung_erweiterung
     SET    erklaerung_freigegeben_von = NULL, erklaerung_freigegeben_am = NULL
     WHERE  fall_id = $1 AND erklaerung_text IS NOT NULL AND erklaerung_versendet_am IS NULL
     RETURNING *`,
    [fallId]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.pfaendung_faelle SET status = 'Geprueft', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  return rows[0];
}

// ===================================================================
// Auskunftsersuchen-Erweiterung, Ast E (Sollkonzept 3.5) - Compliance-
// Einbindung, strukturierte Antwort, bedingte Kontosperre. Siehe
// feldmark_auskunftsersuchen_erweiterung_schema.sql und
// auskunftsersuchen_antwort.js. Struktur bewusst 1:1 analog zum
// Pfaendungs-Erweiterungsblock oben (ermittleFallMitErweiterung,
// speichereErklaerung, gibErklaerungFrei, bestaetigeVersand).
// ===================================================================

/**
 * Auskunftsersuchen-Fall inkl. Ast-E-Erweiterung, fuer die Fall-
 * Detailansicht. Gibt null zurueck, wenn der Fall nicht existiert.
 */
export async function ermittleAuskunftsersuchenMitErweiterung(fallId) {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen, f.ausstellende_behoerde, f.betroffene_person_name,
            to_char(f.betroffene_person_geburtsdatum, 'YYYY-MM-DD') AS betroffene_person_geburtsdatum,
            f.tatvorwurf, f.angefragte_punkte, f.vertraulich,
            to_char(f.eingangsdatum, 'YYYY-MM-DD') AS eingangsdatum, f.status,
            e.rechtsgrundlage, e.compliance_informiert_am,
            e.freizugebende_punkte, e.rechtsgrundlage_geprueft_von, e.rechtsgrundlage_geprueft_am,
            e.antwort_werte, e.antwort_text, e.antwort_erzeugt_am,
            e.antwort_freigegeben_von, e.antwort_freigegeben_am,
            e.antwort_versendet_von, e.antwort_versendet_am,
            e.sperre_rechtsgrundlage_vorhanden, e.sperre_begruendung,
            e.sperre_entschieden_von, e.sperre_entschieden_am
     FROM   feldmark.auskunftsersuchen_faelle f
     JOIN   feldmark.auskunftsersuchen_erweiterung e ON e.fall_id = f.fall_id
     WHERE  f.fall_id = $1`,
    [fallId]
  );
  return rows[0] ?? null;
}

/** E3: Rechtsgrundlagenpruefung - welche der angefragten Punkte werden
 * freigegeben, plus die dazugehoerigen Antwortwerte. Bewusst ein einzelner
 * PUT-Endpunkt fuer beides (analog zu aktualisiereErweiterung()), da beide
 * im selben Formular erfasst werden. */
export async function aktualisiereAuskunftsersuchenErweiterung(
  fallId,
  { freizugebendePunkte, rechtsgrundlageGeprueftVon, antwortWerte }
) {
  const { rows } = await getPool().query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    freizugebende_punkte = COALESCE($2, freizugebende_punkte),
            rechtsgrundlage_geprueft_von = CASE WHEN $2 IS NOT NULL THEN $3 ELSE rechtsgrundlage_geprueft_von END,
            rechtsgrundlage_geprueft_am = CASE WHEN $2 IS NOT NULL THEN now() ELSE rechtsgrundlage_geprueft_am END,
            antwort_werte = COALESCE($4, antwort_werte)
     WHERE  fall_id = $1
     RETURNING *`,
    [fallId, freizugebendePunkte ?? null, rechtsgrundlageGeprueftVon ?? null, antwortWerte ? JSON.stringify(antwortWerte) : null]
  );
  return rows[0] ?? null;
}

/** Speichert den erzeugten Antworttext (noch nicht freigegeben). Setzt
 * einen evtl. vorhandenen Freigabe-/Versand-Nachweis einer FRUEHEREN
 * Antwort zurueck und den Fall-Status auf 'Geprueft', falls er bereits bei
 * 'Antwort freigegeben'/'Antwort versandt' stand - identische Begruendung
 * wie bei speichereErklaerung() (siehe dortiger Kommentar). */
export async function speichereAuskunftsersuchenAntwort(fallId, text, eingangsdatumIso) {
  const pool = getPool();
  await pool.query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    antwort_text = $2, antwort_erzeugt_am = now(),
            antwort_freigegeben_von = NULL, antwort_freigegeben_am = NULL,
            antwort_versendet_von = NULL, antwort_versendet_am = NULL
     WHERE  fall_id = $1`,
    [fallId, text]
  );
  await pool.query(
    `UPDATE feldmark.auskunftsersuchen_faelle
     SET    status = 'Geprueft', letzte_aktion_am = now()
     WHERE  fall_id = $1 AND status IN ('Antwort freigegeben', 'Antwort versandt')`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1) - siehe speichereErklaerung().
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "antwort_erzeugt", eingangsdatumIso);
}

/** E4: Freigabe der Antwort (z.B. durch Compliance). Setzt nur den
 * Zwischenstatus 'Antwort freigegeben' - gleiche Freigabe-/Versand-
 * Trennung wie bei gibErklaerungFrei(). */
export async function gibAntwortFrei(fallId, freigegebenVon, eingangsdatumIso) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    antwort_freigegeben_von = $2, antwort_freigegeben_am = now()
     WHERE  fall_id = $1 AND antwort_text IS NOT NULL
     RETURNING *`,
    [fallId, freigegebenVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.auskunftsersuchen_faelle SET status = 'Antwort freigegeben', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1) - siehe gibErklaerungFrei().
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "antwort_freigegeben", eingangsdatumIso);
  return rows[0];
}

/** Zweiter Schritt nach Freigabe: bestaetigt den tatsaechlichen Versand.
 * Erst hier wechselt der Fall-Status auf 'Antwort versandt' und faellt aus
 * listeOffeneFaelle() heraus. */
export async function bestaetigeAntwortVersand(fallId, versendetVon, eingangsdatumIso) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    antwort_versendet_von = $2, antwort_versendet_am = now()
     WHERE  fall_id = $1 AND antwort_freigegeben_am IS NOT NULL
     RETURNING *`,
    [fallId, versendetVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.auskunftsersuchen_faelle SET status = 'Antwort versandt', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1) - siehe bestaetigeVersand().
  await protokolliere("feldmark.auskunftsersuchen_protokoll", fallId, "antwort_versendet", eingangsdatumIso);
  return rows[0];
}

/** Ablehnung der Antwort - identisches Muster wie lehneErklaerungAb() auf
 * der Pfaendungsseite, siehe dortiger Kommentar. */
export async function lehneAntwortAb(fallId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    antwort_freigegeben_von = NULL, antwort_freigegeben_am = NULL
     WHERE  fall_id = $1 AND antwort_text IS NOT NULL AND antwort_versendet_am IS NULL
     RETURNING *`,
    [fallId]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark.auskunftsersuchen_faelle SET status = 'Geprueft', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  return rows[0];
}

/**
 * E5: dokumentiert die Sperr-Entscheidung. rechtsgrundlageVorhanden=true
 * nur, wenn das Schreiben selbst eine Beschlagnahme/einen Arrest traegt -
 * ein reines Auskunftsersuchen fuehrt zu keiner Sperre (Sollkonzept 2.5).
 * Loest KEINE echte Kontosperre aus (keine Kernbank-Anbindung) - protokolliert
 * nur die getroffene Entscheidung samt Begruendung, in beide Richtungen
 * (auch "keine Sperre" wird protokolliert, damit die Entscheidung
 * nachvollziehbar bewusst getroffen wurde statt schlicht vergessen).
 */
export async function entscheideSperre(fallId, { rechtsgrundlageVorhanden, begruendung, entschiedenVon }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.auskunftsersuchen_erweiterung
     SET    sperre_rechtsgrundlage_vorhanden = $2, sperre_begruendung = $3,
            sperre_entschieden_von = $4, sperre_entschieden_am = now()
     WHERE  fall_id = $1
     RETURNING *`,
    [fallId, rechtsgrundlageVorhanden, begruendung ?? null, entschiedenVon]
  );
  if (!rows[0]) return null;
  const eingangsdatum = (await getPool().query(
    `SELECT to_char(eingangsdatum, 'YYYY-MM-DD') AS d FROM feldmark.auskunftsersuchen_faelle WHERE fall_id = $1`,
    [fallId]
  )).rows[0]?.d;
  await protokolliere(
    "feldmark.auskunftsersuchen_protokoll",
    fallId,
    rechtsgrundlageVorhanden ? "kontosperre_ausgeloest" : "kontosperre_nicht_ausgeloest",
    eingangsdatum
  );
  return rows[0];
}

// ===================================================================
// Datendiskrepanz-Workflow (Sollkonzept 3.1, Ast A) - siehe
// feldmark.pfaendung_datendiskrepanz_schema.sql und datendiskrepanz.js
// fuer Begruendung und Textbausteine.
// ===================================================================

/**
 * Alle noch offenen Datendiskrepanz-Faelle (weder geklaert noch
 * geschlossen), fuer die Fallübersicht und den Sweep gemeinsam nutzbar.
 */
export async function listeOffeneDatendiskrepanzen() {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen, f.glaeubiger, f.status,
            to_char(f.zustelldatum, 'YYYY-MM-DD') AS zustelldatum,
            d.rueckfrage_text, d.rueckfrage_gesendet_am,
            d.nachfassung_1_gesendet_am, d.nachfassung_2_gesendet_am,
            d.fristwahrend_erklaert_am
     FROM   feldmark.pfaendung_datendiskrepanz d
     JOIN   feldmark.pfaendung_faelle f ON f.fall_id = d.fall_id
     WHERE  d.geklaert_am IS NULL AND d.geschlossen_am IS NULL
     ORDER  BY d.rueckfrage_gesendet_am`
  );
  return rows;
}

/** Einzelner Datendiskrepanz-Fall inkl. Falldaten, fuer die Detailansicht. */
export async function ermittleDatendiskrepanz(fallId) {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen, f.glaeubiger, f.schuldner, f.status,
            to_char(f.zustelldatum, 'YYYY-MM-DD') AS zustelldatum,
            d.rueckfrage_text, d.rueckfrage_gesendet_am,
            d.nachfassung_1_text, d.nachfassung_1_gesendet_am,
            d.nachfassung_2_text, d.nachfassung_2_gesendet_am,
            d.fristwahrend_erklaert_am,
            d.geklaert_am, d.geklaert_schuldner_name, d.geklaert_von,
            d.geschlossen_am, d.geschlossen_grund
     FROM   feldmark.pfaendung_datendiskrepanz d
     JOIN   feldmark.pfaendung_faelle f ON f.fall_id = d.fall_id
     WHERE  d.fall_id = $1`,
    [fallId]
  );
  return rows[0] ?? null;
}

/** A2: eine der zwei automatischen Nachfassungen protokollieren. */
export async function protokolliereNachfassung(fallId, nummer, text, eingangsdatumIso) {
  const spalteText = nummer === 1 ? "nachfassung_1_text" : "nachfassung_2_text";
  const spalteAm = nummer === 1 ? "nachfassung_1_gesendet_am" : "nachfassung_2_gesendet_am";
  await getPool().query(
    `UPDATE feldmark.pfaendung_datendiskrepanz SET ${spalteText} = $2, ${spalteAm} = now() WHERE fall_id = $1`,
    [fallId, text]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): trotz des Namens schrieb
  // diese Funktion bisher NIE einen echten Protokoll-Eintrag (nur die
  // Datendiskrepanz-Tabelle selbst) - der A2-Zweig war damit im Fall-Verlauf
  // komplett unsichtbar.
  await protokolliere(
    "feldmark.pfaendung_protokoll",
    fallId,
    nummer === 1 ? "datendiskrepanz_nachfassung_1_gesendet" : "datendiskrepanz_nachfassung_2_gesendet",
    eingangsdatumIso
  );
}

/**
 * A3: markiert den Ausloese-Zeitpunkt der fristwahrenden Erklaerung
 * (Idempotenz-Sperre fuer den Sweep) und setzt den Fall-Status. Der
 * Erklaerungstext selbst wird ueber speichereErklaerung() in
 * feldmark.pfaendung_erweiterung geschrieben - siehe Aufrufer im Sweep.
 */
export async function markiereFristwahrendErklaert(fallId, eingangsdatumIso) {
  const pool = getPool();
  await pool.query(`UPDATE feldmark.pfaendung_datendiskrepanz SET fristwahrend_erklaert_am = now() WHERE fall_id = $1`, [
    fallId,
  ]);
  await pool.query(
    `UPDATE feldmark.pfaendung_faelle SET status = 'Klaerung offen - fristwahrend erklaert', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): der Statuswechsel selbst war
  // unprotokolliert (speichereErklaerung() protokolliert nur die
  // Texterzeugung, nicht diesen A3-spezifischen Folge-Status).
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "datendiskrepanz_fristwahrend_erklaert", eingangsdatumIso);
}

/**
 * A4a: Antwort des Glaeubigers trifft ein (auch nach der fristwahrenden
 * Erklaerung noch moeglich) - Fall wird reaktiviert, echter Schuldnername
 * nachgetragen, Status auf 'Geprueft' zurueckgesetzt (bewusst derselbe
 * Zielstatus wie beim Reset in speichereErklaerung() - "wieder normal in
 * Bearbeitung", keine dritte Status-Variante nur fuer diesen Uebergang).
 */
export async function reaktiviereDatendiskrepanzFall(fallId, schuldnerName, von) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.pfaendung_datendiskrepanz
     SET    geklaert_am = now(), geklaert_schuldner_name = $2, geklaert_von = $3
     WHERE  fall_id = $1 AND geklaert_am IS NULL AND geschlossen_am IS NULL
     RETURNING *`,
    [fallId, schuldnerName, von]
  );
  if (!rows[0]) return null;
  await pool.query(`UPDATE feldmark.pfaendung_faelle SET schuldner = $2, status = 'Geprueft', letzte_aktion_am = now() WHERE fall_id = $1`, [
    fallId,
    schuldnerName,
  ]);
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): die Route kennt das
  // eingangsdatum nicht (kein vorheriger Fall-Fetch noetig fuer die
  // Reaktivierung selbst) - kleine Zusatzabfrage statt die Route unnoetig
  // schwerer zu machen, gleiches Muster wie in entscheideSperre() oben.
  const eingangsdatum = (
    await pool.query(`SELECT to_char(zustelldatum, 'YYYY-MM-DD') AS d FROM feldmark.pfaendung_faelle WHERE fall_id = $1`, [
      fallId,
    ])
  ).rows[0]?.d;
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "datendiskrepanz_reaktiviert", eingangsdatum);
  return rows[0];
}

/** A4b: 30 Tage ohne Antwort - Fall wird mit Vermerk geschlossen. */
export async function schliesseDatendiskrepanzUngeklaert(fallId, grund, eingangsdatumIso) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark.pfaendung_datendiskrepanz
     SET    geschlossen_am = now(), geschlossen_grund = $2
     WHERE  fall_id = $1 AND geklaert_am IS NULL AND geschlossen_am IS NULL
     RETURNING *`,
    [fallId, grund]
  );
  if (!rows[0]) return null;
  await pool.query(`UPDATE feldmark.pfaendung_faelle SET status = 'Abgeschlossen', letzte_aktion_am = now() WHERE fall_id = $1`, [
    fallId,
  ]);
  // Audit-Fund (RALPH-PROGRESS.md, Backlog #1): der A4b-Terminalzustand
  // (30 Tage ohne Antwort) war bisher der einzige Datendiskrepanz-Ausgang
  // ganz ohne jede Spur im Fall-Verlauf.
  await protokolliere("feldmark.pfaendung_protokoll", fallId, "datendiskrepanz_geschlossen_ungeklaert", eingangsdatumIso);
  return rows[0];
}

/**
 * Alle noch offenen Datendiskrepanz-Faelle mit den Zeitstempeln, die der
 * Sweep fuer die Tag-3/6/10/30-Entscheidung braucht. Getrennt von
 * listeOffeneDatendiskrepanzen() nur der Lesbarkeit halber - gleiche Query,
 * anderer Verwendungszweck.
 */
export async function holeFaelligeDatendiskrepanzen() {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen,
            to_char(f.zustelldatum, 'YYYY-MM-DD') AS zustelldatum,
            d.rueckfrage_gesendet_am, d.nachfassung_1_gesendet_am,
            d.nachfassung_2_gesendet_am, d.fristwahrend_erklaert_am
     FROM   feldmark.pfaendung_datendiskrepanz d
     JOIN   feldmark.pfaendung_faelle f ON f.fall_id = d.fall_id
     WHERE  d.geklaert_am IS NULL AND d.geschlossen_am IS NULL`
  );
  return rows;
}

/**
 * Fall-Verlauf fuer die Detailansicht: jedes protokollierte Ereignis (vom
 * n8n-Sweep UND von der App selbst - Fallanlage, Vier-Augen, Datendiskrepanz-
 * Rueckfrage), neueste zuerst. Die Protokoll-Tabellen existierten schon
 * vorher als KPI-Basis (siehe protokolliere() oben), wurden aber nirgends
 * angezeigt - reine Audit-Daten-Leiche. Tabelle wird aus dem fall_id-Praefix
 * abgeleitet (PF- vs. AE-), genau wie bei der ID-Vergabe selbst - keine
 * zusaetzliche Typ-Angabe vom Aufrufer noetig.
 */
/**
 * Aktivitaets-Feed ueber ALLE Faelle hinweg (Pfaendung + Auskunftsersuchen),
 * neueste zuerst - "was hat der taegliche Sweep zuletzt automatisch getan".
 * Gleiche Idee wie holeProtokoll(), aber fallübergreifend fuer einen
 * Ueberblick statt der Detailansicht eines einzelnen Falls. partei_a/
 * partei_b folgen derselben Benennung wie in listeOffeneFaelle().
 */
export async function holeAktivitaetsfeed(limit = 20) {
  const { rows } = await getPool().query(
    `(SELECT p.fall_id, p.ereignis, p.erzeugt_am, p.empfaenger,
             f.glaeubiger AS partei_a, f.schuldner AS partei_b,
             f.dokumenttyp
      FROM   feldmark.pfaendung_protokoll p
      JOIN   feldmark.pfaendung_faelle f ON f.fall_id = p.fall_id)
     UNION ALL
     (SELECT p.fall_id, p.ereignis, p.erzeugt_am, p.empfaenger,
             f.ausstellende_behoerde AS partei_a, f.betroffene_person_name AS partei_b,
             'auskunftsersuchen' AS dokumenttyp
      FROM   feldmark.auskunftsersuchen_protokoll p
      JOIN   feldmark.auskunftsersuchen_faelle f ON f.fall_id = p.fall_id)
     ORDER BY erzeugt_am DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Letzter bekannter Stand beider n8n-Sweeps (feldmark.sweep_status wird
 * NICHT von dieser App geschrieben, sondern von n8n selbst - siehe
 * feldmark_sweep_status_schema.sql). Reiner Lesezugriff.
 */
export async function holeSweepStatus() {
  const { rows } = await getPool().query(
    `SELECT sweep_name, status, zuletzt_gelaufen_am, meldung FROM feldmark.sweep_status ORDER BY sweep_name`
  );
  return rows;
}

export async function holeProtokoll(fallId) {
  const tabelle = fallId.startsWith("AE-") ? "feldmark.auskunftsersuchen_protokoll" : "feldmark.pfaendung_protokoll";
  const { rows } = await getPool().query(
    `SELECT id, ereignis, fristende, rest_tage, empfaenger, prioritaet, erzeugt_am
     FROM   ${tabelle}
     WHERE  fall_id = $1
     ORDER  BY erzeugt_am DESC`,
    [fallId]
  );
  return rows;
}
