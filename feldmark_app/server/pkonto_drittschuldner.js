/**
 * P-Konto-Pfaendbarkeitsberechnung und automatisierte Drittschuldner-
 * erklaerung (§ 840 ZPO). Siehe
 * Pfaendung_PKonto_Drittschuldnererklaerung_Ergaenzung.html fuer die
 * vollstaendige Herleitung.
 *
 * Bewusst deterministisch, kein LLM-Aufruf: die Erklaerung ist die
 * rechtsverbindliche Aussage der Bank gegenueber dem Glaeubiger, nicht
 * ein Zwischenergebnis, das noch durch eine Sichtpruefung laeuft wie bei
 * der Klassifikation. Ein Sprachmodell darf hier keinen Betrag erfinden
 * oder umformulieren.
 */

// Pfaendungsfreigrenzenbekanntmachung 2026, gueltig ab 1.7.2026.
// Aendert sich turnusmaessig per Gesetz - siehe Ergaenzungskonzept
// Abschnitt 1.2 fuer die Quellen. Regelmaessig pruefen/aktualisieren.
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
 * Deckt die drei aus vorhandenen Falldaten erreichbaren Zustaende ab
 * (voll / teilweise / kein pfaendbares Guthaben). Die vierte im
 * Ergaenzungskonzept beschriebene Variante (fristwahrende Negativerklaerung
 * bei nicht zuordenbarem Schuldner) ist hier nicht implementiert, weil
 * solche Faelle im aktuellen Routing gar nicht in
 * feldmark.pfaendung_faelle landen, sondern in der Sichtpruefung - es gibt
 * also aktuell keinen erreichbaren Zustand, der sie ausloesen wuerde.
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
    `zu dem oben genannten Pfändungs- und Überweisungsbeschluss erklären wir gemäß § 840 Abs. 1 ZPO wie folgt:`,
    ``,
    `1. ${anerkennung}`,
    `2. ${pflichtangabe2}`,
    `3. ${pflichtangabe3}`,
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute}, vor Versand durch Mitarbeiter zu bestätigen —`,
  ].join("\n");

  return { ok: true, text };
}
