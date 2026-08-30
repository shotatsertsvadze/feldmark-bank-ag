/**
 * P-Konto-Pfaendbarkeitsberechnung und automatisierte Drittschuldner-
 * erklaerung (§ 840 ZPO).
 *
 * Bewusst deterministisch, kein LLM-Aufruf: die Erklaerung ist die
 * rechtsverbindliche Aussage der Bank gegenueber dem Glaeubiger, nicht
 * ein Zwischenergebnis, das noch durch eine Sichtpruefung laeuft wie bei
 * der Klassifikation. Ein Sprachmodell darf hier keinen Betrag erfinden
 * oder umformulieren.
 */

// Pfaendungsfreigrenzenbekanntmachung 2026, gueltig ab 1.7.2026.
// Aendert sich turnusmaessig per Gesetz - regelmaessig pruefen/aktualisieren.
export const P_KONTO_GRUNDFREIBETRAG_EUR = 1590.0;

function runden2(zahl) {
  return Math.round(zahl * 100) / 100;
}

/**
 * Reine Berechnung, keine DB-/Netzwerkzugriffe.
 * @param {{guthabenEur:number|null, istPKonto:boolean, freibetragErhoehungEur?:number}} eingabe
 * @returns {number|null} pfaendbarer Betrag in EUR, oder null wenn kein Guthaben erfasst ist.
 */
export function berechnePfaendbarenBetrag({ guthabenEur, istPKonto, freibetragErhoehungEur = 0 }) {
  if (guthabenEur == null) return null;
  if (!istPKonto) return Math.max(0, runden2(guthabenEur));
  const freibetrag = P_KONTO_GRUNDFREIBETRAG_EUR + (freibetragErhoehungEur || 0);
  return Math.max(0, runden2(guthabenEur - freibetrag));
}

/**
 * Rang eines Falls unter mehreren offenen Pfaendungen auf denselben
 * Schuldner - frueheste Zustellung = Rang 1. Wird zur Laufzeit berechnet,
 * nicht gespeichert (siehe Schema-Kommentar in
 * feldmark_pfaendung_erweiterung_schema.sql).
 * @param {string} fallId
 * @param {{fall_id:string, zustelldatum:string}[]} alleOffenenFaelleDesSchuldners
 *   Muss den Fall selbst enthalten.
 */
export function berechneRang(fallId, alleOffenenFaelleDesSchuldners) {
  const sortiert = [...alleOffenenFaelleDesSchuldners].sort((a, b) =>
    a.zustelldatum < b.zustelldatum ? -1 : a.zustelldatum > b.zustelldatum ? 1 : a.fall_id.localeCompare(b.fall_id)
  );
  const index = sortiert.findIndex((f) => f.fall_id === fallId);
  return index === -1 ? null : index + 1;
}

/**
 * Erzeugt den Text der Drittschuldnererklaerung nach § 840 ZPO.
 * Deckt die drei Pflichtangaben nach § 840 Abs. 1 ZPO ab (voll / teilweise
 * / kein pfaendbares Guthaben, Ansprueche anderer Personen, Vorpfaendungen)
 * sowie die zwei zusaetzlichen, nach § 840 Abs. 2 ZPO speziell fuer
 * Kontopfaendungen vorgeschriebenen Angaben (Unpfaendbarkeit nach § 907
 * ZPO, Kontoart). Eine fristwahrende Negativerklaerung bei nicht
 * zuordenbarem Schuldner ist hier nicht implementiert, weil solche Faelle
 * im aktuellen Routing gar nicht in feldmark.pfaendung_faelle landen,
 * sondern in der Sichtpruefung - es gibt also aktuell keinen erreichbaren
 * Zustand, der sie ausloesen wuerde.
 *
 * @param {object} fall - Zeile aus feldmark.pfaendung_faelle.
 * @param {object} erweiterung - Zeile aus feldmark.pfaendung_erweiterung.
 * @param {{fall_id:string, glaeubiger:string, zustelldatum:string}[]} andereOffenePfaendungen
 *   Andere offene Pfaendungen desselben Schuldners, OHNE den Fall selbst.
 * @returns {{ok:true, text:string} | {ok:false, grund:string}}
 */
export function erzeugeDrittschuldnererklaerung(fall, erweiterung, andereOffenePfaendungen = []) {
  const forderung = erweiterung.forderung_gesamt_eur == null ? null : Number(erweiterung.forderung_gesamt_eur);
  if (forderung == null) {
    return { ok: false, grund: "Forderungshoehe (forderung_gesamt_eur) fehlt - Erklaerung kann nicht erzeugt werden." };
  }

  const pfaendbar = berechnePfaendbarenBetrag({
    guthabenEur: erweiterung.guthaben_eur == null ? null : Number(erweiterung.guthaben_eur),
    istPKonto: erweiterung.ist_p_konto,
    freibetragErhoehungEur: erweiterung.p_konto_freibetrag_erhoehung == null ? 0 : Number(erweiterung.p_konto_freibetrag_erhoehung),
  });
  if (pfaendbar === null) {
    return { ok: false, grund: "Guthaben ist noch nicht erfasst - Erklaerung kann nicht erzeugt werden." };
  }
  // § 840 Abs. 2 ZPO: zwei weitere Pflichtangaben bei Kontopfaendungen, die
  // bis 2026-08-30 in dieser Erklaerung fehlten (siehe docs/code_review/).
  // Gleiche Disziplin wie oben: nicht generieren, solange nicht explizit
  // geprueft - eine rechtsverbindliche Erklaerung darf keine unbestaetigte
  // Angabe enthalten.
  if (erweiterung.unpfaendbarkeit_907_geprueft !== true) {
    return { ok: false, grund: "Unpfändbarkeit nach § 907 ZPO ist noch nicht geprüft - Erklärung kann nicht erzeugt werden." };
  }
  if (erweiterung.gemeinschaftskonto_geprueft !== true) {
    return { ok: false, grund: "Kontoart (Gemeinschaftskonto) ist noch nicht geprüft - Erklärung kann nicht erzeugt werden." };
  }

  const eur = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const heute = new Date().toLocaleDateString("de-DE");

  let anerkennung;
  if (pfaendbar <= 0) {
    anerkennung =
      `Ein pfändbarer Betrag ist derzeit nicht vorhanden` +
      (erweiterung.ist_p_konto ? ` (Guthaben von ${eur(Number(erweiterung.guthaben_eur))} EUR liegt unter dem P-Konto-Freibetrag).` : `.`) +
      ` Die Forderung bleibt gepfändet; künftige Zahlungseingänge werden geprüft.`;
  } else if (pfaendbar >= forderung) {
    anerkennung = `Die Forderung wird in Höhe von ${eur(forderung)} EUR in vollem Umfang anerkannt. Der Betrag wird nach Ablauf der gesetzlichen Wartefrist (§ 835 Abs. 3 ZPO) überwiesen.`;
  } else {
    anerkennung = `Die Forderung wird in Höhe von ${eur(pfaendbar)} EUR anerkannt und nach Ablauf der gesetzlichen Wartefrist überwiesen. Für den Restbetrag von ${eur(runden2(forderung - pfaendbar))} EUR bleibt das Konto in Überwachung.`;
  }

  let pflichtangabe2 =
    "Ansprüche anderer Personen an der gepfändeten Forderung sind uns nicht bekannt.";

  let pflichtangabe3;
  if (andereOffenePfaendungen.length === 0) {
    pflichtangabe3 = "Die Forderung ist für keinen anderen Gläubiger gepfändet.";
  } else {
    const rang = berechneRang(fall.fall_id, [
      { fall_id: fall.fall_id, zustelldatum: fall.zustelldatum },
      ...andereOffenePfaendungen,
    ]);
    const liste = andereOffenePfaendungen
      .map((f) => `${f.glaeubiger} (Az. ${f.fall_id}, zugestellt ${new Date(f.zustelldatum).toLocaleDateString("de-DE")})`)
      .join("; ");
    pflichtangabe3 = `Die Forderung ist bereits für ${andereOffenePfaendungen.length} weitere${andereOffenePfaendungen.length === 1 ? "n" : ""} Gläubiger gepfändet: ${liste}. Die vorliegende Pfändung steht im Rang ${rang} von ${andereOffenePfaendungen.length + 1}.`;
  }

  let pflichtangabe4;
  if (erweiterung.unpfaendbarkeit_907_festgestellt_am) {
    const festgestelltAm = new Date(erweiterung.unpfaendbarkeit_907_festgestellt_am);
    const zwoelfMonateVorher = new Date();
    zwoelfMonateVorher.setUTCFullYear(zwoelfMonateVorher.getUTCFullYear() - 1);
    const innerhalbZwoelfMonaten = festgestelltAm >= zwoelfMonateVorher;
    pflichtangabe4 = innerhalbZwoelfMonaten
      ? `Innerhalb der letzten zwölf Monate wurde die Unpfändbarkeit des Guthabens nach § 907 ZPO festgestellt, und zwar am ${festgestelltAm.toLocaleDateString("de-DE")}.`
      : `Eine Unpfändbarkeitsfeststellung nach § 907 ZPO liegt vor (${festgestelltAm.toLocaleDateString("de-DE")}), diese liegt jedoch außerhalb der letzten zwölf Monate.`;
  } else {
    pflichtangabe4 = "Innerhalb der letzten zwölf Monate wurde keine Unpfändbarkeit des Guthabens nach § 907 ZPO festgestellt.";
  }

  let pflichtangabe5;
  if (erweiterung.ist_p_konto && erweiterung.ist_gemeinschaftskonto) {
    pflichtangabe5 = "Bei dem gepfändeten Konto handelt es sich um ein Pfändungsschutzkonto (P-Konto), zugleich geführt als Gemeinschaftskonto.";
  } else if (erweiterung.ist_p_konto) {
    pflichtangabe5 = "Bei dem gepfändeten Konto handelt es sich um ein Pfändungsschutzkonto (P-Konto); es ist kein Gemeinschaftskonto.";
  } else if (erweiterung.ist_gemeinschaftskonto) {
    pflichtangabe5 = "Bei dem gepfändeten Konto handelt es sich um ein Gemeinschaftskonto; es ist kein Pfändungsschutzkonto (P-Konto).";
  } else {
    pflichtangabe5 = "Bei dem gepfändeten Konto handelt es sich weder um ein Pfändungsschutzkonto (P-Konto) noch um ein Gemeinschaftskonto.";
  }

  const text = [
    `DRITTSCHULDNERERKLÄRUNG gemäß § 840 ZPO`,
    ``,
    `Ihr Aktenzeichen: ${fall.aktenzeichen}`,
    `Unser Aktenzeichen: ${fall.fall_id}`,
    `Schuldner: ${fall.schuldner}`,
    `Zustellung des Pfändungsbeschlusses: ${new Date(fall.zustelldatum).toLocaleDateString("de-DE")}`,
    ``,
    `Sehr geehrte Damen und Herren,`,
    ``,
    `zu dem oben genannten Pfändungs- und Überweisungsbeschluss erklären wir gemäß § 840 Abs. 1 und Abs. 2 ZPO wie folgt:`,
    ``,
    `1. ${anerkennung}`,
    `2. ${pflichtangabe2}`,
    `3. ${pflichtangabe3}`,
    `4. ${pflichtangabe4}`,
    `5. ${pflichtangabe5}`,
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute}, vor Versand durch Mitarbeiter zu bestätigen —`,
  ].join("\n");

  return { ok: true, text };
}
