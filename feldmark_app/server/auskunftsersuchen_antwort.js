/**
 * Strukturierte Antwort auf ein Auskunftsersuchen (§§ 161, 161a, 95 StPO).
 * Umsetzung von Ast E (E3/E4) aus Pfaendungsprozess_Analyse_Sollkonzept.html,
 * Abschnitt 3.5 - siehe KONTEXT.md fuer die Redesign-Analyse.
 *
 * Bewusst deterministisch, kein LLM-Aufruf: gleiche Begruendung wie bei
 * erzeugeDrittschuldnererklaerung() in pkonto_drittschuldner.js - die
 * Antwort ist die rechtsverbindliche Aussage der Bank gegenueber der
 * anfragenden Behoerde, kein Zwischenergebnis mit nachgelagerter
 * Sichtpruefung.
 */

function formatiereDatum(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC" });
}

/**
 * @param {object} fall - Zeile aus feldmark.auskunftsersuchen_faelle.
 * @param {object} erweiterung - Zeile aus feldmark.auskunftsersuchen_erweiterung.
 * @returns {{ok:true, text:string} | {ok:false, grund:string}}
 */
export function erzeugeAuskunftsersuchenAntwort(fall, erweiterung) {
  const freizugeben = erweiterung.freizugebende_punkte;
  if (!freizugeben || freizugeben.length === 0) {
    return {
      ok: false,
      grund: "Rechtsgrundlagenpruefung (E3) noch nicht durchgefuehrt - freizugebende Punkte fehlen.",
    };
  }

  const werte = erweiterung.antwort_werte || {};
  const fehlendeWerte = freizugeben.filter((punkt) => !werte[punkt] || !String(werte[punkt]).trim());
  if (fehlendeWerte.length) {
    return {
      ok: false,
      grund: `Antwortwert fehlt fuer: ${fehlendeWerte.join(", ")}.`,
    };
  }

  const zurueckgehalten = (fall.angefragte_punkte || []).filter((p) => !freizugeben.includes(p));
  const heute = new Date().toLocaleDateString("de-DE");

  const auskunftsteile = freizugeben.map((punkt, i) => `${i + 1}. ${punkt}: ${werte[punkt]}`);

  const rechtsgrundlageText =
    erweiterung.rechtsgrundlage && erweiterung.rechtsgrundlage.length
      ? erweiterung.rechtsgrundlage.join(", ")
      : "§§ 161, 161a, 95 StPO";

  const zeilen = [
    `AUSKUNFT gemäß ${rechtsgrundlageText}`,
    ``,
    `An: ${fall.ausstellende_behoerde}`,
    `Ihr Aktenzeichen: ${fall.aktenzeichen}`,
    `Unser Aktenzeichen: ${fall.fall_id}`,
    `Betroffene Person: ${fall.betroffene_person_name}`,
    ...(fall.betroffene_person_geburtsdatum ? [`Geburtsdatum: ${formatiereDatum(fall.betroffene_person_geburtsdatum)}`] : []),
    ...(fall.tatvorwurf ? [`Tatvorwurf: ${fall.tatvorwurf}`] : []),
    ``,
    `Sehr geehrte Damen und Herren,`,
    ``,
    `zu Ihrem Ersuchen vom ${formatiereDatum(fall.eingangsdatum)} erteilen wir auf Grundlage von ${rechtsgrundlageText} folgende Auskunft:`,
    ``,
    ...auskunftsteile,
  ];

  if (zurueckgehalten.length) {
    zeilen.push(
      ``,
      `Zu folgenden angefragten Punkten wird nach Prüfung keine Auskunft erteilt: ${zurueckgehalten.join(", ")}.`
    );
  }

  zeilen.push(
    ``,
    `Mit freundlichen Grüßen`,
    `Feldmark Bank AG`,
    ``,
    `— automatisch erzeugt am ${heute} aus den geprüften Angaben, vor Versand durch Mitarbeiter zu bestätigen —`
  );

  return { ok: true, text: zeilen.join("\n") };
}
