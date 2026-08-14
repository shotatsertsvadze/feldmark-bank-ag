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

// Platzhalter fuer feldmark_pfaendung_faelle.schuldner (NOT NULL), solange
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
 * Aktenzeichen"). Siehe feldmark_pfaendung_datendiskrepanz_schema.sql fuer
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
      nurSchuldnerFehlt ? SCHULDNER_PLATZHALTER : pfaendung.schuldner_name,
      eingang.zustelldatum,
      eingang.zustellkanal,
      eingang.bearbeiter_email,
      eingang.vertretung_email ?? null,
      eingang.vorgesetzte_email ?? null,
    ]
  );
  // forderung_gesamt_eur/konfidenz_betrag wurden bisher an dieser Stelle
  // verworfen - jetzt in der Erweiterungstabelle mitgefuehrt, weil die
  // P-Konto-Pfaendbarkeitsberechnung und die Drittschuldnererklaerung
  // beide die Forderungshoehe brauchen (siehe pkonto_drittschuldner.js).
  await pool.query(
    `INSERT INTO feldmark_pfaendung_erweiterung (fall_id, forderung_gesamt_eur, konfidenz_betrag)
     VALUES ($1, $2, $3)`,
    [fallId, pfaendung.forderung_gesamt_eur ?? null, pfaendung.konfidenz_betrag ?? null]
  );
  await protokolliere("feldmark_pfaendung_protokoll", fallId, "fall_angelegt", eingang.zustelldatum);

  if (nurSchuldnerFehlt) {
    const rueckfrageText = erzeugeRueckfrage({ aktenzeichen: kopf.aktenzeichen, fall_id: fallId });
    await pool.query(`INSERT INTO feldmark_pfaendung_datendiskrepanz (fall_id, rueckfrage_text) VALUES ($1, $2)`, [
      fallId,
      rueckfrageText,
    ]);
    await protokolliere("feldmark_pfaendung_protokoll", fallId, "datendiskrepanz_rueckfrage_gesendet", eingang.zustelldatum);
  }

  return { angelegt: true, fall_id: fallId, tabelle: "feldmark_pfaendung_faelle", datendiskrepanz: nurSchuldnerFehlt };
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

/** Protokolliert, wenn die weiche Vier-Augen-Warnung bei Freigabe der
 * Drittschuldnererklaerung bewusst uebersteuert wurde (dieselbe Person hat
 * Guthaben erfasst UND freigegeben). Kein Auth-System vorhanden, daher kein
 * hartes Blockieren moeglich - siehe KONTEXT.md. */
export async function protokolliereVierAugenErklaerungUebersteuert(fallId, eingangsdatumIso) {
  await protokolliere("feldmark_pfaendung_protokoll", fallId, "vier_augen_erklaerung_uebersteuert", eingangsdatumIso);
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

/**
 * Pfaendungsfall inkl. P-Konto-/Drittschuldnererklaerung-Erweiterung, fuer
 * die Fall-Detailansicht. Gibt null zurueck, wenn der Fall nicht existiert.
 */
export async function ermittleFallMitErweiterung(fallId) {
  const { rows } = await getPool().query(
    `SELECT f.fall_id, f.aktenzeichen, f.glaeubiger, f.schuldner,
            to_char(f.zustelldatum, 'YYYY-MM-DD') AS zustelldatum, f.zustellkanal, f.status,
            e.forderung_gesamt_eur, e.konfidenz_betrag, e.ist_p_konto,
            e.p_konto_freibetrag_erhoehung, e.p_konto_benachrichtigt_am,
            e.guthaben_eur, e.guthaben_erfasst_am, e.guthaben_erfasst_von, e.erklaerung_text,
            e.erklaerung_erzeugt_am, e.erklaerung_freigegeben_von, e.erklaerung_freigegeben_am,
            e.erklaerung_versendet_von, e.erklaerung_versendet_am
     FROM   feldmark_pfaendung_faelle f
     JOIN   feldmark_pfaendung_erweiterung e ON e.fall_id = f.fall_id
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
     FROM   feldmark_pfaendung_faelle
     WHERE  lower(schuldner) = lower($1)
       AND  fall_id <> $2
       AND  status NOT IN ('Erklaerung versandt', 'Abgeschlossen', 'Abgeschlossen mit Fristversaeumnis')
     ORDER  BY zustelldatum`,
    [schuldner, fallIdAusschliessen]
  );
  return rows;
}

/** Aktualisiert die manuell erfassten Felder (P-Konto-Status, Guthaben). */
export async function aktualisiereErweiterung(fallId, { istPKonto, freibetragErhoehungEur, guthabenEur, guthabenErfasstVon }) {
  const { rows } = await getPool().query(
    `UPDATE feldmark_pfaendung_erweiterung
     SET    ist_p_konto = COALESCE($2, ist_p_konto),
            p_konto_freibetrag_erhoehung = COALESCE($3, p_konto_freibetrag_erhoehung),
            guthaben_eur = COALESCE($4, guthaben_eur),
            guthaben_erfasst_am = CASE WHEN $4 IS NOT NULL THEN now() ELSE guthaben_erfasst_am END,
            guthaben_erfasst_von = CASE WHEN $4 IS NOT NULL THEN $5 ELSE guthaben_erfasst_von END
     WHERE  fall_id = $1
     RETURNING *`,
    [fallId, istPKonto ?? null, freibetragErhoehungEur ?? null, guthabenEur ?? null, guthabenErfasstVon ?? null]
  );
  return rows[0] ?? null;
}

/** Markiert die P-Konto-Benachrichtigung als versandt (Zeitstempel = Nachweis). */
export async function markierePKontoBenachrichtigt(fallId) {
  await getPool().query(
    `UPDATE feldmark_pfaendung_erweiterung SET p_konto_benachrichtigt_am = now() WHERE fall_id = $1`,
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
export async function speichereErklaerung(fallId, text) {
  const pool = getPool();
  await pool.query(
    `UPDATE feldmark_pfaendung_erweiterung
     SET    erklaerung_text = $2, erklaerung_erzeugt_am = now(),
            erklaerung_freigegeben_von = NULL, erklaerung_freigegeben_am = NULL,
            erklaerung_versendet_von = NULL, erklaerung_versendet_am = NULL
     WHERE  fall_id = $1`,
    [fallId, text]
  );
  await pool.query(
    `UPDATE feldmark_pfaendung_faelle
     SET    status = 'Geprueft', letzte_aktion_am = now()
     WHERE  fall_id = $1 AND status IN ('Erklaerung freigegeben', 'Erklaerung versandt')`,
    [fallId]
  );
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
export async function gibErklaerungFrei(fallId, freigegebenVon) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark_pfaendung_erweiterung
     SET    erklaerung_freigegeben_von = $2, erklaerung_freigegeben_am = now()
     WHERE  fall_id = $1 AND erklaerung_text IS NOT NULL
     RETURNING *`,
    [fallId, freigegebenVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark_pfaendung_faelle SET status = 'Erklaerung freigegeben', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  return rows[0];
}

/**
 * Zweiter Schritt nach Freigabe: der tatsaechliche (manuelle) Versand wird
 * bestaetigt. Erst hier wechselt der Fall-Status auf "Erklaerung versandt"
 * und faellt aus der n8n-Fristueberwachung heraus - siehe Kommentar bei
 * gibErklaerungFrei() fuer die Begruendung der Trennung.
 */
export async function bestaetigeVersand(fallId, versendetVon) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark_pfaendung_erweiterung
     SET    erklaerung_versendet_von = $2, erklaerung_versendet_am = now()
     WHERE  fall_id = $1 AND erklaerung_freigegeben_am IS NOT NULL
     RETURNING *`,
    [fallId, versendetVon]
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE feldmark_pfaendung_faelle SET status = 'Erklaerung versandt', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
  return rows[0];
}

// ===================================================================
// Datendiskrepanz-Workflow (Sollkonzept 3.1, Ast A) - siehe
// feldmark_pfaendung_datendiskrepanz_schema.sql und datendiskrepanz.js
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
     FROM   feldmark_pfaendung_datendiskrepanz d
     JOIN   feldmark_pfaendung_faelle f ON f.fall_id = d.fall_id
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
     FROM   feldmark_pfaendung_datendiskrepanz d
     JOIN   feldmark_pfaendung_faelle f ON f.fall_id = d.fall_id
     WHERE  d.fall_id = $1`,
    [fallId]
  );
  return rows[0] ?? null;
}

/** A2: eine der zwei automatischen Nachfassungen protokollieren. */
export async function protokolliereNachfassung(fallId, nummer, text) {
  const spalteText = nummer === 1 ? "nachfassung_1_text" : "nachfassung_2_text";
  const spalteAm = nummer === 1 ? "nachfassung_1_gesendet_am" : "nachfassung_2_gesendet_am";
  await getPool().query(
    `UPDATE feldmark_pfaendung_datendiskrepanz SET ${spalteText} = $2, ${spalteAm} = now() WHERE fall_id = $1`,
    [fallId, text]
  );
}

/**
 * A3: markiert den Ausloese-Zeitpunkt der fristwahrenden Erklaerung
 * (Idempotenz-Sperre fuer den Sweep) und setzt den Fall-Status. Der
 * Erklaerungstext selbst wird ueber speichereErklaerung() in
 * feldmark_pfaendung_erweiterung geschrieben - siehe Aufrufer im Sweep.
 */
export async function markiereFristwahrendErklaert(fallId) {
  const pool = getPool();
  await pool.query(`UPDATE feldmark_pfaendung_datendiskrepanz SET fristwahrend_erklaert_am = now() WHERE fall_id = $1`, [
    fallId,
  ]);
  await pool.query(
    `UPDATE feldmark_pfaendung_faelle SET status = 'Klaerung offen - fristwahrend erklaert', letzte_aktion_am = now() WHERE fall_id = $1`,
    [fallId]
  );
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
    `UPDATE feldmark_pfaendung_datendiskrepanz
     SET    geklaert_am = now(), geklaert_schuldner_name = $2, geklaert_von = $3
     WHERE  fall_id = $1 AND geklaert_am IS NULL AND geschlossen_am IS NULL
     RETURNING *`,
    [fallId, schuldnerName, von]
  );
  if (!rows[0]) return null;
  await pool.query(`UPDATE feldmark_pfaendung_faelle SET schuldner = $2, status = 'Geprueft', letzte_aktion_am = now() WHERE fall_id = $1`, [
    fallId,
    schuldnerName,
  ]);
  return rows[0];
}

/** A4b: 30 Tage ohne Antwort - Fall wird mit Vermerk geschlossen. */
export async function schliesseDatendiskrepanzUngeklaert(fallId, grund) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE feldmark_pfaendung_datendiskrepanz
     SET    geschlossen_am = now(), geschlossen_grund = $2
     WHERE  fall_id = $1 AND geklaert_am IS NULL AND geschlossen_am IS NULL
     RETURNING *`,
    [fallId, grund]
  );
  if (!rows[0]) return null;
  await pool.query(`UPDATE feldmark_pfaendung_faelle SET status = 'Abgeschlossen', letzte_aktion_am = now() WHERE fall_id = $1`, [
    fallId,
  ]);
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
     FROM   feldmark_pfaendung_datendiskrepanz d
     JOIN   feldmark_pfaendung_faelle f ON f.fall_id = d.fall_id
     WHERE  d.geklaert_am IS NULL AND d.geschlossen_am IS NULL`
  );
  return rows;
}
