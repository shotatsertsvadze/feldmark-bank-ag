// Einziehungs-/Ueberweisungsverfuegung sind Varianten der Pfaendung (gleiche
// Tabelle, gleiches Routing - siehe PFAENDUNGSBLOCK_TYPEN in mistral.js),
// lesen sich deshalb hier auch als "Pfändung" statt als eigene Prozesse.
export const DOKUMENTTYP_LABEL = {
  pfaendungsschreiben: "Pfändung",
  einziehungsverfuegung: "Pfändung",
  ueberweisungsverfuegung: "Pfändung",
  auskunftsersuchen: "Auskunft",
  pfaendungserinnerung: "Pfändungserinnerung",
  auskunftsersuchenerinnerung: "Auskunftserinnerung",
  sonstiges: "Nicht zugeordnet",
};

// Bewusst dieselbe Farbsemantik wie ueberall sonst im Projekt (moss=neutral/
// erledigt, ochre=Achtung, oxblood=kritisch, slate=in Bearbeitung) - keine
// neue Farbwelt nur fuer Verlauf/Aktivitaetsfeed. Von Fallverlauf.jsx UND
// Aktivitaetsfeed.jsx genutzt, damit ein Ereignis ueberall gleich aussieht.
export const EREIGNIS_LABEL = {
  fall_angelegt: { label: "Fall angelegt", farbe: "slate" },
  erinnerung_erhalten: { label: "Erinnerungsschreiben erhalten", farbe: "slate" },
  erinnerung_1: { label: "Erinnerung 1 gesendet", farbe: "slate" },
  erinnerung_2: { label: "Erinnerung 2 gesendet", farbe: "ochre" },
  eskalation: { label: "Eskalation an Vorgesetzte:n", farbe: "oxblood" },
  fristversaeumnis: { label: "Fristversäumnis dokumentiert", farbe: "oxblood" },
  vier_augen_erforderlich: { label: "Vier-Augen-Prüfung erforderlich", farbe: "ochre" },
  vier_augen_erklaerung_uebersteuert: { label: "Vier-Augen-Warnung übersteuert", farbe: "oxblood" },
  datendiskrepanz_rueckfrage_gesendet: { label: "Rückfrage wegen Datendiskrepanz gesendet", farbe: "ochre" },
  compliance_informiert: { label: "Compliance informiert", farbe: "slate" },
  vier_augen_antwort_uebersteuert: { label: "Vier-Augen-Warnung übersteuert", farbe: "oxblood" },
  kontosperre_ausgeloest: { label: "Kontosperre-Entscheidung: Sperre ausgelöst", farbe: "oxblood" },
  kontosperre_nicht_ausgeloest: { label: "Kontosperre-Entscheidung: keine Sperre", farbe: "moss" },
  erklaerung_abgelehnt: { label: "Drittschuldnererklärung abgelehnt", farbe: "oxblood" },
  antwort_abgelehnt: { label: "Antwort abgelehnt", farbe: "oxblood" },
  // Audit-Trail-Nachtrag (RALPH-PROGRESS.md, Backlog #1) - diese Ereignisse
  // wurden bisher an keiner Stelle protokolliert, siehe db.js-Kommentare an
  // den jeweiligen Fundstellen.
  erklaerung_erzeugt: { label: "Drittschuldnererklärung erzeugt", farbe: "slate" },
  erklaerung_freigegeben: { label: "Drittschuldnererklärung freigegeben", farbe: "slate" },
  erklaerung_versendet: { label: "Drittschuldnererklärung versendet", farbe: "moss" },
  antwort_erzeugt: { label: "Antwort erzeugt", farbe: "slate" },
  antwort_freigegeben: { label: "Antwort freigegeben", farbe: "slate" },
  antwort_versendet: { label: "Antwort versendet", farbe: "moss" },
  datendiskrepanz_fristwahrend_erklaert: { label: "Fristwahrende Erklärung abgegeben", farbe: "ochre" },
  datendiskrepanz_geschlossen_ungeklaert: { label: "Datendiskrepanz geschlossen (ungeklärt)", farbe: "oxblood" },
  datendiskrepanz_reaktiviert: { label: "Datendiskrepanz-Fall reaktiviert", farbe: "moss" },
  datendiskrepanz_nachfassung_1_gesendet: { label: "Nachfassung 1 gesendet (Datendiskrepanz)", farbe: "ochre" },
  datendiskrepanz_nachfassung_2_gesendet: { label: "Nachfassung 2 gesendet (Datendiskrepanz)", farbe: "ochre" },
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
