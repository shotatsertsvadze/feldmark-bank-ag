import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";

import { istUnterstuetzterTyp, normalisiereFuerOcr } from "./convert.js";
import { ocrDokument, klassifiziereUndExtrahiere, bestimmeRouting, PFAENDUNGSBLOCK_TYPEN } from "./mistral.js";
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
      fallergebnis = { angelegt: false, tabelle: "feldmark_sichtpruefung_warteschlange" };
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
      fallergebnis = { angelegt: false, tabelle: "feldmark_sichtpruefung_warteschlange" };
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
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.get("/api/sichtpruefung", async (req, res) => {
  try {
    res.json({ eintraege: await db.listeSichtpruefung() });
  } catch (fehler) {
    res.status(500).json({ fehler: String(fehler.message || fehler) });
  }
});

app.listen(PORT, () => {
  console.log(`Feldmark-Klassifikations-Server laeuft auf http://localhost:${PORT}`);
});
