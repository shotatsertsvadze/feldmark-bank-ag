import Stempel from "./Stempel.jsx";
import { DOKUMENTTYP_LABEL, stempelAusErgebnis } from "../dokumenttypen.js";

function ausgabeZeile(ergebnis) {
  const { klassifikation: k, routing, fall } = ergebnis;

  if (fall?.angelegt) {
    return (
      <p className="ergebnis-karte__zeile">
        Fall <strong>{fall.fall_id}</strong> angelegt in <code>{fall.tabelle}</code>.
        {routing.vier_augen_erforderlich && " Vier-Augen-Pflicht vor Weiterverarbeitung."}
      </p>
    );
  }
  if (fall?.zugeordnet_zu) {
    return (
      <p className="ergebnis-karte__zeile">
        Als Erinnerung zugeordnet zu Fall <strong>{fall.zugeordnet_zu}</strong> — kein neuer Fall angelegt.
      </p>
    );
  }
  return (
    <p className="ergebnis-karte__zeile">
      Geht in die Sichtprüfung: {routing.gruende.join("; ")}
      {k.plausibilitaet_ok === false && ` — ${k.plausibilitaet_begruendung}`}
    </p>
  );
}

export default function ErgebnisKarte({ ergebnis, animiertesStempel }) {
  if (ergebnis.status === "fehler") {
    const { typLabel, wert, farbe } = stempelAusErgebnis(ergebnis);
    return (
      <div className="ergebnis-karte ergebnis-karte--fehler">
        <Stempel typLabel={typLabel} wert={wert} farbe={farbe} animiert={animiertesStempel} />
        <div className="ergebnis-karte__info">
          <div className="ergebnis-karte__kopf">
            <span className="ergebnis-karte__datei">{ergebnis.dateiname}</span>
          </div>
          <p className="ergebnis-karte__zeile">{ergebnis.fehler}</p>
        </div>
      </div>
    );
  }

  const { klassifikation: k } = ergebnis;
  const { typLabel, wert, farbe } = stempelAusErgebnis(ergebnis);

  return (
    <div className="ergebnis-karte">
      <Stempel typLabel={typLabel} wert={wert} farbe={farbe} animiert={animiertesStempel} />
      <div className="ergebnis-karte__info">
        <div className="ergebnis-karte__kopf">
          <span className="ergebnis-karte__typ">{DOKUMENTTYP_LABEL[k.dokumenttyp] || k.dokumenttyp}</span>
          <span className="ergebnis-karte__konfidenz">{k.konfidenz_typ}% Konfidenz</span>
          <span className="ergebnis-karte__datei">{ergebnis.dateiname}</span>
        </div>
        {ausgabeZeile(ergebnis)}
      </div>
    </div>
  );
}
