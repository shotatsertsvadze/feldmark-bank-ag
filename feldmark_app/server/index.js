import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";

import { istUnterstuetzterTyp, normalisiereFuerOcr } from "./convert.js";
import { ocrDokument, klassifiziereUndExtrahiere, bestimmeRouting, PFAENDUNGSBLOCK_TYPEN } from "./mistral.js";
import { erzeugeDrittschuldnererklaerung } from "./pkonto_drittschuldner.js";
import { erzeugeAuskunftsersuchenAntwort } from "./auskunftsersuchen_antwort.js";
import {
  erzeugeNachfassung,
  erzeugeFristwahrendeErklaerung,
  NACHFASSUNG_1_TAGE_NACH_RUECKFRAGE,
  NACHFASSUNG_2_TAGE_NACH_RUECKFRAGE,
  FRISTWAHREND_SPAETESTENS_TAG,
  SCHLIESSEN_NACH_TAGEN_OHNE_ANTWORT,
} from "./datendiskrepanz.js";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// .env liegt nicht im Repo (gitignored) - process.loadEnvFile() ist die
// native Node-Variante, keine zusaetzliche Abhaengigkeit noetig.
const ENV_PFAD = path.join(ROOT, ".env");
if (existsSync(ENV_PFAD)) process.loadEnvFile(ENV_PFAD);

const PORT = process.env.FELDMARK_KLASSIFIKATION_SERVER_PORT || 4300;
const UPLOAD_DIR = path.join(ROOT, "uploads");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

const speicher = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage: speicher,
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

/**
 * Verarbeitet ein einzelnes hochgeladenes Schreiben: normalisieren -> OCR ->
 * Klassifikation/Extraktion -> Routing-Entscheidung -> Fallanlage in
 * Postgres. Wirft nicht weiter, sondern gibt bei Fehlern ein Ergebnis mit
 * "fehler" zurueck, damit ein einzelnes fehlgeschlagenes Schreiben in einem
 * Mehrfach-Upload die anderen nicht mitreisst.
 *
 * @param {Express.Multer.File} file
 * @param {{zustelldatum?:string, zustellkanal?:string, bearbeiter_email?:string,
 *          vertretung_email?:string, vorgesetzte_email?:string}} eingang
 *   Eingangsmetadaten fuer den ganzen Upload-Stapel - kommen NIE aus dem
 *   Dokumenttext oder vom Modell, siehe klassifikations_schema.md.
 */
async function verarbeiteDatei(file, eingang) {
  const basis = {
    id: randomUUID(),
    dateiname: file.originalname,
    hochgeladen_am: new Date().toISOString(),
    ansicht_url: `/uploads/${path.basename(file.path)}`,
  };
  try {
    if (!istUnterstuetzterTyp(file.mimetype)) {
      throw new Error(
        `Dateityp "${file.mimetype}" wird nicht unterstuetzt. Erlaubt sind PDF und gaengige Bildformate.`
      );
    }
    const { readFile } = await import("node:fs/promises");
    const rohbytes = await readFile(file.path);
    const { bytes, mimeType } = await normalisiereFuerOcr(rohbytes, file.mimetype);

    const ocrErgebnis = await ocrDokument(bytes, mimeType);
    const klassifikation = await klassifiziereUndExtrahiere(ocrErgebnis.markdown, ocrErgebnis.ocr_confidence);

    let erinnerungTreffer = null;
    if (klassifikation.dokumenttyp === "erinnerungsschreiben") {
      erinnerungTreffer = await db.findeFallZuAktenzeichen(klassifikation.erinnerung.bezug_aktenzeichen);
    }
    const routing = bestimmeRouting(klassifikation, {
      bezugAktenzeichenGefunden: !!erinnerungTreffer,
      ocrConfidence: ocrErgebnis.ocr_confidence,
    });

    let fallergebnis;
    if (routing.pfad === "sichtpruefung") {
      await db.legeInSichtpruefungAn({
        id: basis.id,
        dateiname: basis.dateiname,
        klassifikation,
        routing,
        ansichtUrl: basis.ansicht_url,
        eingangsdatum: eingang.zustelldatum,
      });
      fallergebnis = { angelegt: false, tabelle: "feldmark.sichtpruefung_warteschlange" };
    } else if (klassifikation.dokumenttyp === "erinnerungsschreiben") {
      await db.protokolliereErinnerungErhalten(erinnerungTreffer.tabelle, erinnerungTreffer.fall_id, eingang.zustelldatum);
      fallergebnis = { angelegt: false, zugeordnet_zu: erinnerungTreffer.fall_id, tabelle: erinnerungTreffer.tabelle };
    } else if (PFAENDUNGSBLOCK_TYPEN.includes(klassifikation.dokumenttyp) || klassifikation.dokumenttyp === "auskunftsersuchen") {
      // Duplikat-Check zuerst: derselbe Brief zweimal hochgeladen (Scan-
      // Wiederholung, doppelte E-Mail-Zustellung) darf keinen zweiten Fall
      // mit eigener Fristuhr erzeugen. Nutzt denselben Aktenzeichen-Abgleich
      // wie beim Erinnerungsschreiben oben, nur hier VOR statt ANSTATT der
      // Fallanlage.
      const duplikat = await db.findeFallZuAktenzeichen(klassifikation.kopf.aktenzeichen);
      if (duplikat) {
        fallergebnis = {
          angelegt: false,
          grund: `moeglicher Duplikat-Verdacht: Aktenzeichen bereits bei Fall ${duplikat.fall_id} (${duplikat.tabelle})`,
        };
      } else if (PFAENDUNGSBLOCK_TYPEN.includes(klassifikation.dokumenttyp)) {
        fallergebnis = await db.legePfaendungsfallAn(klassifikation, eingang);
      } else {
        fallergebnis = await db.legeAuskunftsersuchenFallAn(klassifikation, eingang);
      }
    }

    // Pflichtfelder fuer die Fallanlage fehlten trotz Autofall-Routing (z.B.
    // ein leeres Formular mit hoher Typ-Konfidenz, aber ohne Inhaltsfelder)
    // -> Fallback in die Sichtpruefung statt eines kaputten Datensatzes.
    if (fallergebnis && fallergebnis.angelegt === false && fallergebnis.grund) {
      routing.pfad = "sichtpruefung";
      routing.gruende.push(fallergebnis.grund);
      await db.legeInSichtpruefungAn({
        id: basis.id,
        dateiname: basis.dateiname,
        klassifikation,
        routing,
        ansichtUrl: basis.ansicht_url,
        eingangsdatum: eingang.zustelldatum,
      });
      fallergebnis = { angelegt: false, tabelle: "feldmark.sichtpruefung_warteschlange" };
    }

    if (fallergebnis?.angelegt && routing.vier_augen_erforderlich) {
      await db.protokolliereVierAugen(fallergebnis.tabelle, fallergebnis.fall_id, eingang.zustelldatum);
    }

    return {
      ...basis,
      status: "erkannt",
      klassifikation,
      routing,
      fall: fallergebnis,
      ocr_confidence: ocrErgebnis.ocr_confidence,
      seiten: ocrErgebnis.seiten,
      rohtext: ocrErgebnis.markdown,
    };
  } catch (fehler) {
    console.error(`[verarbeiteDatei] ${file.originalname}:`, fehler);
    return {
      ...basis,
      status: "fehler",
      fehler: String(fehler.message || fehler),
    };
  }
}

app.post("/api/klassifizieren", upload.array("schreiben", 20), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ fehler: "Keine Datei(en) im Feld 'schreiben' gefunden." });
  }
  // Eingangsmetadaten gelten fuer den ganzen Stapel - realistisch fuer eine
  // taegliche Scan-/E-Mail-Charge, die zusammen verarbeitet wird.
  const eingang = {
    zustelldatum: req.body.zustelldatum || null,
    zustellkanal: req.body.zustellkanal || null,
    bearbeiter_email: req.body.bearbeiter_email || null,
    vertretung_email: req.body.vertretung_email || null,
    vorgesetzte_email: req.body.vorgesetzte_email || null,
  };
  const ergebnisse = [];
  // Sequenziell statt Promise.all: begrenzt gleichzeitige, kostenpflichtige
  // Mistral-Aufrufe bei einem Mehrfach-Upload statt alle parallel abzufeuern.
  for (const file of req.files) {
    ergebnisse.push(await verarbeiteDatei(file, eingang));
  }
  res.json({ ergebnisse });
});

app.get("/api/faelle", async (req, res) => {
  try {
    res.json({ faelle: await db.listeOffeneFaelle() });
  } catch (fehler) {
    console.error("[GET /api/faelle]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/sichtpruefung", async (req, res) => {
  try {
    res.json({ eintraege: await db.listeSichtpruefung() });
  } catch (fehler) {
    console.error("[GET /api/sichtpruefung]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/aktivitaet", async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    res.json({ eintraege: await db.holeAktivitaetsfeed(limit) });
  } catch (fehler) {
    console.error("[GET /api/aktivitaet]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/sweep-status", async (req, res) => {
  try {
    res.json({ sweeps: await db.holeSweepStatus() });
  } catch (fehler) {
    console.error("[GET /api/sweep-status]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/faelle/:fallId/protokoll", async (req, res) => {
  try {
    res.json({ eintraege: await db.holeProtokoll(req.params.fallId) });
  } catch (fehler) {
    console.error(`[GET /api/faelle/${req.params.fallId}/protokoll]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/faelle/:fallId/erweiterung", async (req, res) => {
  try {
    const fall = await db.ermittleFallMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });
    res.json({ fall });
  } catch (fehler) {
    console.error(`[GET /api/faelle/${req.params.fallId}/erweiterung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Manuelle Erfassung von P-Konto-Status und Guthaben (keine Kernbank-API
// angebunden, siehe Ergaenzungskonzept Annahme A7). Die P-Konto-
// Benachrichtigung feuert NICHT mehr allein deshalb, weil ist_p_konto
// zufaellig (default) false ist - sondern nur, wenn p_konto_geprueft in
// GENAU diesem Aufruf von false auf true wechselt (siehe
// db.aktualisiereErweiterung(), Code-Review-Fund 2026-08-27: sonst haette
// ein Mitarbeiter, der nur das Guthaben speichert bevor er den P-Konto-
// Status ueberhaupt geprueft hat, die Benachrichtigung ungewollt ausgeloest).
app.put("/api/faelle/:fallId/erweiterung", async (req, res) => {
  try {
    const { ist_p_konto, freibetrag_erhoehung_eur, guthaben_eur, guthaben_erfasst_von, p_konto_geprueft } = req.body;
    const ergebnis = await db.aktualisiereErweiterung(req.params.fallId, {
      istPKonto: typeof ist_p_konto === "boolean" ? ist_p_konto : null,
      freibetragErhoehungEur: freibetrag_erhoehung_eur ?? null,
      guthabenEur: guthaben_eur ?? null,
      guthabenErfasstVon: guthaben_erfasst_von ?? null,
      pKontoGeprueft: p_konto_geprueft === true ? true : null,
    });
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const { zeile, wurdeGeradeGeprueft } = ergebnis;
    let benachrichtigungAusgeloest = false;
    if (wurdeGeradeGeprueft && zeile.ist_p_konto === false && !zeile.p_konto_benachrichtigt_am) {
      await db.markierePKontoBenachrichtigt(req.params.fallId);
      benachrichtigungAusgeloest = true;
      // Ohne diese Nachfuehrung wuerde die Antwort noch den Stand VOR der
      // Benachrichtigung tragen - die UI-Bestaetigungsmeldung waere erst
      // nach einem Neuladen sichtbar (Code-Review-Fund 2026-08-27).
      zeile.p_konto_benachrichtigt_am = new Date().toISOString();
    }
    res.json({ erweiterung: zeile, p_konto_benachrichtigung_ausgeloest: benachrichtigungAusgeloest });
  } catch (fehler) {
    console.error(`[PUT /api/faelle/${req.params.fallId}/erweiterung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.post("/api/faelle/:fallId/erklaerung", async (req, res) => {
  try {
    const fall = await db.ermittleFallMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const andereOffenePfaendungen = await db.findeAndereOffenePfaendungen(fall.schuldner, fall.fall_id);
    const ergebnis = erzeugeDrittschuldnererklaerung(fall, fall, andereOffenePfaendungen);
    if (!ergebnis.ok) return res.status(422).json({ fehler: ergebnis.grund });

    await db.speichereErklaerung(fall.fall_id, ergebnis.text);
    res.json({ erklaerung_text: ergebnis.text });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/erklaerung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Weiche Vier-Augen-Pruefung: kein echtes Auth-System vorhanden (siehe
// KONTEXT.md), daher kein hartes Blockieren moeglich - stattdessen ein
// expliziter Bestaetigungsschritt, wenn Freigebende:r == Guthaben-
// Erfasser:in (Textvergleich, whitespace-/case-normalisiert). Serverseitig
// geprueft statt nur im Frontend, damit ein direkter API-Aufruf die
// Warnung nicht umgehen kann.
//
// "Erfasst von" ist im Formular bewusst optional (siehe UI) - das darf
// aber nicht dazu fuehren, dass die Pruefung durch einfaches Leerlassen
// umgangen wird. Ein fehlender guthaben_erfasst_von zaehlt deshalb
// ebenfalls als Warnfall ("Vier-Augen kann nicht geprueft werden"), nicht
// als "andere Person, also unbedenklich" - sonst waere das Leerlassen des
// Feldes der bequemste Weg, die Kontrolle zu umgehen (Fund aus dem
// autonomen Nacht-Review, siehe KONTEXT.md).
app.post("/api/faelle/:fallId/erklaerung/freigeben", async (req, res) => {
  try {
    const freigegebenVon = req.body.freigegeben_von;
    const vierAugenBestaetigt = req.body.vier_augen_bestaetigt === true;
    if (!freigegebenVon) return res.status(400).json({ fehler: "freigegeben_von fehlt." });

    const fall = await db.ermittleFallMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const erfasserUnbekannt = !fall.guthaben_erfasst_von;
    const gleichePerson =
      !erfasserUnbekannt && fall.guthaben_erfasst_von.trim().toLowerCase() === freigegebenVon.trim().toLowerCase();
    const brauchtBestaetigung = erfasserUnbekannt || gleichePerson;

    if (brauchtBestaetigung && !vierAugenBestaetigt) {
      return res.status(409).json({
        fehler: erfasserUnbekannt
          ? `Guthaben wurde ohne "Erfasst von"-Angabe gespeichert - Vier-Augen-Prinzip kann nicht geprueft werden.`
          : `"${freigegebenVon}" hat auch zuletzt das Guthaben erfasst - Vier-Augen-Prinzip nicht eingehalten.`,
        vier_augen_warnung: true,
      });
    }

    const ergebnis = await db.gibErklaerungFrei(req.params.fallId, freigegebenVon);
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden oder noch keine Erklaerung erzeugt." });
    if (brauchtBestaetigung) {
      await db.protokolliereVierAugenErklaerungUebersteuert(req.params.fallId, fall.zustelldatum);
    }
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/erklaerung/freigeben]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Zweiter Schritt nach Freigabe: bestaetigt den tatsaechlichen (manuellen)
// Versand und schliesst den Fall erst dann aus der Fristueberwachung aus -
// siehe Kommentar bei db.gibErklaerungFrei() fuer die Begruendung.
app.post("/api/faelle/:fallId/erklaerung/versenden", async (req, res) => {
  try {
    const versendetVon = req.body.versendet_von;
    if (!versendetVon) return res.status(400).json({ fehler: "versendet_von fehlt." });
    const ergebnis = await db.bestaetigeVersand(req.params.fallId, versendetVon);
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden oder noch nicht freigegeben." });
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/erklaerung/versenden]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Ablehnung: Sachbearbeitung prueft die erzeugte Erklaerung und lehnt sie
// bewusst ab, statt sie freizugeben - macht den bisher stillen Geprueft-
// Reset aus speichereErklaerung() zu einer expliziten, protokollierten
// Entscheidung (siehe Kommentar bei db.lehneErklaerungAb()). Nicht mehr
// moeglich, sobald der Versand bereits bestaetigt wurde.
app.post("/api/faelle/:fallId/erklaerung/ablehnen", async (req, res) => {
  try {
    const fall = await db.ermittleFallMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const ergebnis = await db.lehneErklaerungAb(req.params.fallId);
    if (!ergebnis) {
      return res.status(404).json({ fehler: "Fall nicht gefunden, noch keine Erklaerung erzeugt, oder bereits versandt." });
    }
    await db.protokolliereErklaerungAbgelehnt(req.params.fallId, fall.zustelldatum);
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/erklaerung/ablehnen]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// ===================================================================
// Auskunftsersuchen-Erweiterung, Ast E (Sollkonzept 3.5) - Compliance-
// Einbindung, strukturierte Antwort, bedingte Kontosperre. Routen-Struktur
// bewusst 1:1 analog zum Pfaendungsblock oben.
// ===================================================================

app.get("/api/faelle/:fallId/auskunftsersuchen-erweiterung", async (req, res) => {
  try {
    const fall = await db.ermittleAuskunftsersuchenMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });
    res.json({ fall });
  } catch (fehler) {
    console.error(`[GET /api/faelle/${req.params.fallId}/auskunftsersuchen-erweiterung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// E3: Rechtsgrundlagenpruefung - welche angefragten Punkte werden
// freigegeben, plus die Antwortwerte dazu (keine Kernbank-API angebunden,
// gleiche Annahme A7 wie beim P-Konto-Ergaenzungskonzept).
app.put("/api/faelle/:fallId/auskunftsersuchen-erweiterung", async (req, res) => {
  try {
    const { freizugebende_punkte, rechtsgrundlage_geprueft_von, antwort_werte } = req.body;
    const aktualisiert = await db.aktualisiereAuskunftsersuchenErweiterung(req.params.fallId, {
      freizugebendePunkte: Array.isArray(freizugebende_punkte) ? freizugebende_punkte : null,
      rechtsgrundlageGeprueftVon: rechtsgrundlage_geprueft_von ?? null,
      antwortWerte: antwort_werte && typeof antwort_werte === "object" ? antwort_werte : null,
    });
    if (!aktualisiert) return res.status(404).json({ fehler: "Fall nicht gefunden." });
    res.json({ erweiterung: aktualisiert });
  } catch (fehler) {
    console.error(`[PUT /api/faelle/${req.params.fallId}/auskunftsersuchen-erweiterung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.post("/api/faelle/:fallId/antwort", async (req, res) => {
  try {
    const fall = await db.ermittleAuskunftsersuchenMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const ergebnis = erzeugeAuskunftsersuchenAntwort(fall, fall);
    if (!ergebnis.ok) return res.status(422).json({ fehler: ergebnis.grund });

    await db.speichereAuskunftsersuchenAntwort(fall.fall_id, ergebnis.text);
    res.json({ antwort_text: ergebnis.text });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/antwort]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Weiche Vier-Augen-Pruefung wie bei der Drittschuldnererklaerung: kein
// echtes Auth-System vorhanden, daher Bestaetigungsschritt statt hartem
// Blockieren, serverseitig geprueft. Bezugsperson ist hier
// rechtsgrundlage_geprueft_von (E3, wer die Freigabepunkte festgelegt hat),
// nicht guthaben_erfasst_von - der inhaltliche Vorlaeuferschritt vor der
// Freigabe.
app.post("/api/faelle/:fallId/antwort/freigeben", async (req, res) => {
  try {
    const freigegebenVon = req.body.freigegeben_von;
    const vierAugenBestaetigt = req.body.vier_augen_bestaetigt === true;
    if (!freigegebenVon) return res.status(400).json({ fehler: "freigegeben_von fehlt." });

    const fall = await db.ermittleAuskunftsersuchenMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const pruefendeUnbekannt = !fall.rechtsgrundlage_geprueft_von;
    const gleichePerson =
      !pruefendeUnbekannt &&
      fall.rechtsgrundlage_geprueft_von.trim().toLowerCase() === freigegebenVon.trim().toLowerCase();
    const brauchtBestaetigung = pruefendeUnbekannt || gleichePerson;

    if (brauchtBestaetigung && !vierAugenBestaetigt) {
      return res.status(409).json({
        fehler: pruefendeUnbekannt
          ? `Rechtsgrundlagenpruefung wurde ohne "Geprueft von"-Angabe gespeichert - Vier-Augen-Prinzip kann nicht geprueft werden.`
          : `"${freigegebenVon}" hat auch zuletzt die Rechtsgrundlage geprueft - Vier-Augen-Prinzip nicht eingehalten.`,
        vier_augen_warnung: true,
      });
    }

    const ergebnis = await db.gibAntwortFrei(req.params.fallId, freigegebenVon);
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden oder noch keine Antwort erzeugt." });
    if (brauchtBestaetigung) {
      await db.protokolliereVierAugenAntwortUebersteuert(req.params.fallId, fall.eingangsdatum);
    }
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/antwort/freigeben]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.post("/api/faelle/:fallId/antwort/versenden", async (req, res) => {
  try {
    const versendetVon = req.body.versendet_von;
    if (!versendetVon) return res.status(400).json({ fehler: "versendet_von fehlt." });
    const ergebnis = await db.bestaetigeAntwortVersand(req.params.fallId, versendetVon);
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden oder noch nicht freigegeben." });
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/antwort/versenden]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// Ablehnung der Antwort - identisches Muster wie /erklaerung/ablehnen auf
// der Pfaendungsseite.
app.post("/api/faelle/:fallId/antwort/ablehnen", async (req, res) => {
  try {
    const fall = await db.ermittleAuskunftsersuchenMitErweiterung(req.params.fallId);
    if (!fall) return res.status(404).json({ fehler: "Fall nicht gefunden." });

    const ergebnis = await db.lehneAntwortAb(req.params.fallId);
    if (!ergebnis) {
      return res.status(404).json({ fehler: "Fall nicht gefunden, noch keine Antwort erzeugt, oder bereits versandt." });
    }
    await db.protokolliereAntwortAbgelehnt(req.params.fallId, fall.eingangsdatum);
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/antwort/ablehnen]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// E5: dokumentiert, ob eine Kontosperre gerechtfertigt ist. Per Sollkonzept
// 2.5/E5 NUR bei eigener Rechtsgrundlage (Beschlagnahme/Arrest) - ein
// reines Auskunftsersuchen darf hier nicht pauschal "true" setzen. Loest
// keine echte Sperre aus (keine Kernbank-Anbindung), protokolliert nur die
// getroffene Entscheidung.
app.post("/api/faelle/:fallId/sperre-entscheidung", async (req, res) => {
  try {
    const { rechtsgrundlage_vorhanden, begruendung, entschieden_von } = req.body;
    if (typeof rechtsgrundlage_vorhanden !== "boolean" || !entschieden_von) {
      return res.status(400).json({ fehler: "rechtsgrundlage_vorhanden (boolean) und entschieden_von sind erforderlich." });
    }
    if (rechtsgrundlage_vorhanden && !begruendung?.trim()) {
      return res.status(400).json({ fehler: "Bei rechtsgrundlage_vorhanden=true ist eine Begruendung erforderlich." });
    }
    const ergebnis = await db.entscheideSperre(req.params.fallId, {
      rechtsgrundlageVorhanden: rechtsgrundlage_vorhanden,
      begruendung: begruendung ?? null,
      entschiedenVon: entschieden_von,
    });
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden." });
    res.json({ erweiterung: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/sperre-entscheidung]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// ===================================================================
// Datendiskrepanz-Workflow (Sollkonzept 3.1, Ast A) - siehe
// feldmark_pfaendung_datendiskrepanz_schema.sql und datendiskrepanz.js.
// ===================================================================

app.get("/api/datendiskrepanz", async (req, res) => {
  try {
    res.json({ faelle: await db.listeOffeneDatendiskrepanzen() });
  } catch (fehler) {
    console.error("[GET /api/datendiskrepanz]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/faelle/:fallId/datendiskrepanz", async (req, res) => {
  try {
    const eintrag = await db.ermittleDatendiskrepanz(req.params.fallId);
    if (!eintrag) return res.status(404).json({ fehler: "Kein Datendiskrepanz-Eintrag fuer diesen Fall." });
    res.json({ datendiskrepanz: eintrag });
  } catch (fehler) {
    console.error(`[GET /api/faelle/${req.params.fallId}/datendiskrepanz]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

// A4a: der Glaeubiger antwortet mit ausreichenden Angaben - ein Mensch
// traegt den Schuldnernamen nach, der Fall laeuft normal weiter.
app.post("/api/faelle/:fallId/datendiskrepanz/reaktivieren", async (req, res) => {
  try {
    const { schuldner_name, reaktiviert_von } = req.body;
    if (!schuldner_name || !reaktiviert_von) {
      return res.status(400).json({ fehler: "schuldner_name und reaktiviert_von sind erforderlich." });
    }
    const ergebnis = await db.reaktiviereDatendiskrepanzFall(req.params.fallId, schuldner_name, reaktiviert_von);
    if (!ergebnis) return res.status(404).json({ fehler: "Fall nicht gefunden oder bereits geklaert/geschlossen." });
    res.json({ datendiskrepanz: ergebnis });
  } catch (fehler) {
    console.error(`[POST /api/faelle/${req.params.fallId}/datendiskrepanz/reaktivieren]`, fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

const MS_PRO_TAG = 86_400_000;
function tageSeit(datumWert) {
  if (!datumWert) return null;
  return Math.floor((Date.now() - new Date(datumWert).getTime()) / MS_PRO_TAG);
}

/**
 * Verarbeitet alle faelligen Aktionen ueber alle offenen Datendiskrepanz-
 * Faelle hinweg (A2 Nachfassungen, A3 fristwahrende Erklaerung, A4b
 * Schliessung nach 30 Tagen) - ein Aufruf pro Tag, analog zum bestehenden
 * n8n-Fristueberwachungs-Sweep. Bewusst als eigener REST-Endpunkt statt
 * direkt in n8n nachgebaut: die fristwahrende Erklaerung nutzt dieselbe
 * Text-Erzeugung wie die regulaere Drittschuldnererklaerung
 * (pkonto_drittschuldner.js) - dieselbe Logik zusaetzlich in einem n8n-
 * Code-Node zu duplizieren wuerde genau das Duplizierungsrisiko schaffen,
 * das der Code-Review in der vorherigen Nacht bei anderen Konstanten
 * bereits als Problem markiert hat. n8n ruft diesen Endpunkt taeglich auf
 * (Wiring noch nicht vorgenommen, siehe KONTEXT.md).
 *
 * Reihenfolge der Pruefung ist bewusst: fristwahrende Erklaerung zuerst
 * (sobald Tag 10 erreicht ist, erledigt sie die eigentliche Fristsicherung
 * und macht eine noch ausstehende Nachfassung obsolet), danach Schliessung
 * nach 30 Tagen, erst danach die beiden Nachfassungen.
 */
app.post("/api/sweep/datendiskrepanz", async (req, res) => {
  try {
    const faelle = await db.holeFaelligeDatendiskrepanzen();
    const aktionen = [];
    for (const f of faelle) {
      const tageSeitZustellung = tageSeit(f.zustelldatum);
      const tageSeitRueckfrage = tageSeit(f.rueckfrage_gesendet_am);

      if (tageSeitZustellung >= FRISTWAHREND_SPAETESTENS_TAG && !f.fristwahrend_erklaert_am) {
        const fall = await db.ermittleFallMitErweiterung(f.fall_id);
        const ergebnis = erzeugeFristwahrendeErklaerung(fall, { rueckfrage_gesendet_am: f.rueckfrage_gesendet_am });
        await db.speichereErklaerung(f.fall_id, ergebnis.text);
        await db.markiereFristwahrendErklaert(f.fall_id);
        aktionen.push({ fall_id: f.fall_id, aktion: "fristwahrende_erklaerung_erzeugt" });
      } else if (tageSeitRueckfrage >= SCHLIESSEN_NACH_TAGEN_OHNE_ANTWORT) {
        await db.schliesseDatendiskrepanzUngeklaert(
          f.fall_id,
          "Keine ausreichende Antwort des Glaeubigers innerhalb von 30 Tagen - Zuordnung nicht moeglich."
        );
        aktionen.push({ fall_id: f.fall_id, aktion: "geschlossen_ungeklaert" });
      } else if (tageSeitRueckfrage >= NACHFASSUNG_2_TAGE_NACH_RUECKFRAGE && !f.nachfassung_2_gesendet_am) {
        const text = erzeugeNachfassung(f, f, 2);
        await db.protokolliereNachfassung(f.fall_id, 2, text);
        aktionen.push({ fall_id: f.fall_id, aktion: "nachfassung_2_gesendet" });
      } else if (tageSeitRueckfrage >= NACHFASSUNG_1_TAGE_NACH_RUECKFRAGE && !f.nachfassung_1_gesendet_am) {
        const text = erzeugeNachfassung(f, f, 1);
        await db.protokolliereNachfassung(f.fall_id, 1, text);
        aktionen.push({ fall_id: f.fall_id, aktion: "nachfassung_1_gesendet" });
      }
    }
    res.json({ geprueft: faelle.length, aktionen });
  } catch (fehler) {
    console.error("[POST /api/sweep/datendiskrepanz]", fehler);
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.listen(PORT, () => {
  console.log(`Feldmark-Klassifikations-Server laeuft auf http://localhost:${PORT}`);
});
