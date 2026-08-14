/**
 * Datendiskrepanz-Workflow (Sollkonzept Abschnitt 3.1, "Ast A —
 * Datendiskrepanz, parallel zur Frist").
 *
 * Deckt in DIESEM System den Fall ab: ein Dokument ist mit ausreichender
 * Konfidenz ein Pfaendungsschreiben/eine Einziehungs-/Ueberweisungsverfuegung,
 * Aktenzeichen und Glaeubiger sind bekannt, aber der Schuldnername fehlt in
 * der Extraktion. Siehe feldmark_pfaendung_datendiskrepanz_schema.sql fuer
 * die Begruendung dieser Scope-Praezisierung gegenueber dem Sollkonzept
 * (kein echter Kernbank-Kundenstamm-Abgleich vorhanden).
 *
 * Bewusst deterministisch, kein LLM - gleiches Prinzip wie
 * pkonto_drittschuldner.js: Rueckfrage und Nachfassungen sind operative
 * Korrespondenz, die fristwahrende Erklaerung ist eine rechtsverbindliche
 * Aussage der Bank.
 */

// Sollkonzept 3.1, A1: Antwortfrist fuer die Rueckfrage an den Glaeubiger.
export const ANTWORTFRIST_WERKTAGE = 3;

// Sollkonzept 3.1, A2: Nachfassungen am Tag 3 und Tag 6 NACH DER RUECKFRAGE
// (nicht nach Zustelldatum). A3: fristwahrende Erklaerung spaetestens
// Tag 10 der GESAMTFRIST (ab Zustelldatum), unabhaengig vom Klaerungsstand.
// A4: Schliessung nach 30 Tagen ohne Antwort, gerechnet ab der Rueckfrage.
export const NACHFASSUNG_1_TAGE_NACH_RUECKFRAGE = 3;
export const NACHFASSUNG_2_TAGE_NACH_RUECKFRAGE = 6;
export const FRISTWAHREND_SPAETESTENS_TAG = 10;
export const SCHLIESSEN_NACH_TAGEN_OHNE_ANTWORT = 30;

const heute = () => new Date().toLocaleDateString("de-DE");
const datum = (iso) => new Date(iso).toLocaleDateString("de-DE");

/**
 * A1 - sofortige strukturierte Rueckfrage an den Glaeubiger.
 * @param {{aktenzeichen:string, fall_id:string}} fall
 */
export function erzeugeRueckfrage(fall) {
  return [
    `RÜCKFRAGE zur Schuldner-Identifikation`,
    ``,
    `Ihr Aktenzeichen: ${fall.aktenzeichen}`,
    `Unser Aktenzeichen: ${fall.fall_id}`,
    ``,
    `Sehr geehrte Damen und Herren,`,
    ``,
    `zu Ihrem oben genannten Schreiben können wir den darin bezeichneten Schuldner anhand der uns vorliegenden Angaben nicht eindeutig identifizieren.`,
    ``,
    `Bitte teilen Sie uns innerhalb von ${ANTWORTFRIST_WERKTAGE} Werktagen ergänzende Angaben zur Person des Schuldners mit (z. B. vollständiger Name, Geburtsdatum, Adresse oder IBAN), damit wir die Zuordnung vornehmen können.`,
    ``,
    `Wir weisen darauf hin, dass die gesetzliche Frist zur Abgabe der Drittschuldnererklärung von dieser Rückfrage unberührt bleibt und unabhängig von deren Ausgang eingehalten wird.`,
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute()} —`,
  ].join("\n");
}

/**
 * A2 - automatische Nachfassung (Nummer 1 oder 2), ohne menschliches Zutun.
 * @param {{aktenzeichen:string, fall_id:string}} fall
 * @param {{rueckfrage_gesendet_am:string}} diskrepanz
 * @param {1|2} nummer
 */
export function erzeugeNachfassung(fall, diskrepanz, nummer) {
  return [
    `NACHFASSUNG ${nummer} zur Rückfrage vom ${datum(diskrepanz.rueckfrage_gesendet_am)}`,
    ``,
    `Ihr Aktenzeichen: ${fall.aktenzeichen}`,
    `Unser Aktenzeichen: ${fall.fall_id}`,
    ``,
    `Sehr geehrte Damen und Herren,`,
    ``,
    `wir haben Ihnen am ${datum(diskrepanz.rueckfrage_gesendet_am)} eine Rückfrage zur Identifikation des Schuldners im oben genannten Vorgang übersandt und bislang keine Antwort erhalten.`,
    ``,
    `Bitte teilen Sie uns die angefragten Angaben kurzfristig mit.`,
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute()} —`,
  ].join("\n");
}

/**
 * A3 - fristwahrende Erklaerung nach § 840 ZPO bei nicht zuordenbarem
 * Schuldner. Die vierte, im urspruenglichen P-Konto-Baustein bewusst nicht
 * implementierte Variante (siehe Docstring von erzeugeDrittschuldnererklaerung
 * in pkonto_drittschuldner.js) - hier jetzt erreichbar, weil ein echtes
 * Fallobjekt mit laufender Frist existiert statt eines reinen
 * Sichtpruefungs-Eintrags.
 * @param {{aktenzeichen:string, fall_id:string, zustelldatum:string}} fall
 * @param {{rueckfrage_gesendet_am:string}} diskrepanz
 */
export function erzeugeFristwahrendeErklaerung(fall, diskrepanz) {
  const text = [
    `DRITTSCHULDNERERKLÄRUNG gemäß § 840 ZPO`,
    ``,
    `Ihr Aktenzeichen: ${fall.aktenzeichen}`,
    `Unser Aktenzeichen: ${fall.fall_id}`,
    `Zustellung des Schreibens: ${datum(fall.zustelldatum)}`,
    ``,
    `Sehr geehrte Damen und Herren,`,
    ``,
    `zu dem oben genannten Vorgang erklären wir gemäß § 840 Abs. 1 ZPO wie folgt:`,
    ``,
    `1. Eine Geschäftsverbindung zu dem in Ihrem Schreiben bezeichneten Schuldner konnte anhand der uns vorliegenden Daten nicht festgestellt werden. Wir haben Sie hierzu am ${datum(diskrepanz.rueckfrage_gesendet_am)} um ergänzende Angaben gebeten; eine für die Zuordnung ausreichende Antwort liegt bis heute nicht vor.`,
    `2. Diese Erklärung wahrt die gesetzliche Frist. Sollte die Zuordnung anhand nachträglich eingehender Angaben gelingen, wird der Vorgang unverzüglich erneut geprüft und, falls zutreffend, eine ergänzende Erklärung nach § 840 ZPO abgegeben.`,
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute()}, vor Versand durch Mitarbeiter zu bestätigen —`,
  ].join("\n");
  return { ok: true, text };
}
