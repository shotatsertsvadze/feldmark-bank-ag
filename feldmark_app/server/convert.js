/**
 * Normalisiert hochgeladene Dateien auf die Formate, die die Mistral OCR
 * API tatsaechlich entgegennimmt: PDF direkt, alle Bilder als PNG.
 * Unveraendert uebernommen aus belegerkennung/server/convert.js - dieselbe
 * Anforderung (Scan oder Foto -> OCR-taugliches Format), derselbe Ansatz.
 */

import sharp from "sharp";
import convertHeic from "heic-convert";

const PDF_TYPES = new Set(["application/pdf"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const NATIV_UNTERSTUETZT = new Set(["image/png", "image/jpeg"]);

export function istUnterstuetzterTyp(mimeType) {
  return (
    PDF_TYPES.has(mimeType) ||
    HEIC_TYPES.has(mimeType) ||
    NATIV_UNTERSTUETZT.has(mimeType) ||
    mimeType.startsWith("image/")
  );
}

/**
 * @returns {Promise<{bytes: Buffer, mimeType: string}>} PDF unveraendert,
 *   sonst immer als PNG.
 */
export async function normalisiereFuerOcr(bytes, mimeType) {
  if (PDF_TYPES.has(mimeType)) {
    return { bytes, mimeType: "application/pdf" };
  }
  if (NATIV_UNTERSTUETZT.has(mimeType)) {
    return { bytes, mimeType };
  }
  if (HEIC_TYPES.has(mimeType)) {
    const png = await convertHeic({ buffer: bytes, format: "PNG" });
    return { bytes: Buffer.from(png), mimeType: "image/png" };
  }
  if (mimeType.startsWith("image/")) {
    const png = await sharp(bytes).png().toBuffer();
    return { bytes: png, mimeType: "image/png" };
  }
  throw new Error(
    `Dateityp "${mimeType}" wird nicht unterstuetzt. Erlaubt sind PDF und gaengige Bildformate (JPG, PNG, HEIC, WEBP, TIFF, BMP, GIF).`
  );
}
