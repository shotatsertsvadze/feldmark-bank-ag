export const DOKUMENTTYP_LABEL = {
  pfaendungsschreiben: "Pfändung",
  auskunftsersuchen: "Auskunft",
  einziehungsverfuegung: "Einziehung",
  ueberweisungsverfuegung: "Überweisung",
  erinnerungsschreiben: "Erinnerung",
  sonstiges: "Sonstiges",
};

/** Stempel-Inhalt aus einem Verarbeitungsergebnis von POST /api/klassifizieren. */
export function stempelAusErgebnis(ergebnis) {
  if (ergebnis.status === "fehler") {
    return { typLabel: "Fehler", wert: "—", farbe: "oxblood" };
  }
  const typLabel = DOKUMENTTYP_LABEL[ergebnis.klassifikation.dokumenttyp] || "Unbekannt";
  const fall = ergebnis.fall;

  if (fall?.angelegt) {
    return { typLabel, wert: fall.fall_id, farbe: "moss" };
  }
  if (fall?.zugeordnet_zu) {
    return { typLabel, wert: fall.zugeordnet_zu, farbe: "slate" };
  }
  return { typLabel, wert: "Prüfen", farbe: "ochre" };
}
