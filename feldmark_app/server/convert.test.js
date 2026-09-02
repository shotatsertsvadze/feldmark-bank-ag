/**
 * Reine Unit-Tests fuer server/convert.js - Testmatrix-Luecke A10 (HEIC/HEIF-
 * Upload, bislang ohne jeden Testlauf). Kein DATABASE_URL noetig.
 *
 * Ein echter HEIC-Fixture liess sich in dieser Umgebung NICHT synthetisieren:
 * sharp().heif({compression:'av1'}) erzeugt ein AVIF (Major-Brand "avif"),
 * kein HEIC (Major-Brand "heic"/"mif1", HEVC-codiert) - heic-decode prueft
 * genau diese Brand-Bytes und lehnt AVIF zurecht ab. compression:'hevc'
 * schlaegt in diesem sharp/libvips-Build mit "Unsupported compression" fehl
 * (HEVC-Encoding ist patentbelastet und selten mitgebaut). Der eigentliche
 * Decode-Pfad (Zeilen unten, HEIC_FIXTURE_PFAD) laeuft deshalb nur mit einer
 * echten HEIC-Datei (z. B. ein iPhone-Foto) unter muster_dateien/ - fehlt sie,
 * wird der Test uebersprungen statt mit einem irrefuehrenden Fake-Fixture zu
 * "bestehen".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { istUnterstuetzterTyp, normalisiereFuerOcr } from "./convert.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEIC_FIXTURE_PFAD = path.join(__dirname, "..", "..", "muster_dateien", "heic-testbild.heic");
const HAT_HEIC_FIXTURE = existsSync(HEIC_FIXTURE_PFAD);
const HEIC_SKIP_GRUND =
  "Kein echtes HEIC-Testbild gefunden - Datei unter muster_dateien/heic-testbild.heic ablegen " +
  "(z. B. ein unbearbeitetes iPhone-Foto), um den echten Decode-Pfad zu pruefen";

async function erzeugePng() {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
}

test("istUnterstuetzterTyp: PDF, HEIC/HEIF, native und generische Bildtypen erkannt", () => {
  assert.equal(istUnterstuetzterTyp("application/pdf"), true);
  assert.equal(istUnterstuetzterTyp("image/heic"), true);
  assert.equal(istUnterstuetzterTyp("image/heif"), true);
  assert.equal(istUnterstuetzterTyp("image/png"), true);
  assert.equal(istUnterstuetzterTyp("image/jpeg"), true);
  assert.equal(istUnterstuetzterTyp("image/webp"), true);
  assert.equal(istUnterstuetzterTyp("application/json"), false);
});

test("normalisiereFuerOcr: PDF bleibt unveraendert", async () => {
  const bytes = Buffer.from("%PDF-1.4 fake");
  const ergebnis = await normalisiereFuerOcr(bytes, "application/pdf");
  assert.equal(ergebnis.mimeType, "application/pdf");
  assert.equal(ergebnis.bytes, bytes);
});

test("normalisiereFuerOcr: natives PNG/JPEG bleibt unveraendert", async () => {
  const png = await erzeugePng();
  const ergebnis = await normalisiereFuerOcr(png, "image/png");
  assert.equal(ergebnis.mimeType, "image/png");
  assert.equal(ergebnis.bytes, png);
});

test("normalisiereFuerOcr: generisches Bildformat (WEBP) wird zu PNG konvertiert", async () => {
  const png = await erzeugePng();
  const webp = await sharp(png).webp().toBuffer();

  const ergebnis = await normalisiereFuerOcr(webp, "image/webp");
  assert.equal(ergebnis.mimeType, "image/png");

  const meta = await sharp(ergebnis.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 20);
  assert.equal(meta.height, 20);
});

test("normalisiereFuerOcr: HEIC wird zu PNG konvertiert (Testmatrix A10)", { skip: !HAT_HEIC_FIXTURE && HEIC_SKIP_GRUND }, async () => {
  const heic = readFileSync(HEIC_FIXTURE_PFAD);

  const ergebnis = await normalisiereFuerOcr(heic, "image/heic");
  assert.equal(ergebnis.mimeType, "image/png");

  const meta = await sharp(ergebnis.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.ok(meta.width > 0 && meta.height > 0);
});

test(
  "normalisiereFuerOcr: HEIF-MIME-Typ nimmt denselben Konvertierungspfad wie HEIC",
  { skip: !HAT_HEIC_FIXTURE && HEIC_SKIP_GRUND },
  async () => {
    const heic = readFileSync(HEIC_FIXTURE_PFAD);
    const ergebnis = await normalisiereFuerOcr(heic, "image/heif");
    assert.equal(ergebnis.mimeType, "image/png");
  }
);

test("normalisiereFuerOcr: nicht unterstuetzter Typ wirft Fehler", async () => {
  await assert.rejects(
    () => normalisiereFuerOcr(Buffer.from("x"), "application/zip"),
    /wird nicht unterstuetzt/
  );
});
