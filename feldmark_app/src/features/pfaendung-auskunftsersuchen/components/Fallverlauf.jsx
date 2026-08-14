import { useEffect, useState } from "react";
import { protokollLaden } from "../api.js";
import { EREIGNIS_LABEL } from "../dokumenttypen.js";

const datumUhrzeit = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Zeigt, was der taegliche n8n-Sweep (und die App selbst) fuer diesen Fall
 * bereits protokolliert hat - Erinnerung 1/2, Eskalation, Fristversaeumnis,
 * Vier-Augen-Ereignisse. Die Protokoll-Tabellen (feldmark.pfaendung_protokoll /
 * -auskunftsersuchen_protokoll) existierten schon als KPI-Basis, wurden aber
 * nirgends angezeigt - dieser Verlauf macht sie erstmals sichtbar.
 */
// reloadSignal ist optional: Fallverlauf wird als Geschwister-Komponente
// gerendert (nicht als Kind von PfaendungErweiterung/AuskunftsersuchenErweiterung),
// bekommt also von deren Aktionen (Freigabe, Versand, Sperr-Entscheidung) nichts
// automatisch mit - fallId allein aendert sich bei sowas nicht, der Effekt liefe
// also nie erneut. Falluebersicht.jsx reicht dafuer internerReload durch, das
// bei jedem onFallGeaendert()-Aufruf hochgezaehlt wird.
export default function Fallverlauf({ fallId, reloadSignal }) {
  const [eintraege, setEintraege] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    setEintraege(null);
    setFehler(null);
    protokollLaden(fallId)
      .then((e) => !abgebrochen && setEintraege(e))
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)));
    return () => {
      abgebrochen = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallId, reloadSignal]);

  if (fehler) return <p className="fehlerbanner">{fehler}</p>;
  if (eintraege === null) return <p className="ladeindikator">Verlauf wird geladen …</p>;

  return (
    <div className="verlauf">
      <p className="panel__head-title verlauf__titel">Verlauf</p>
      {eintraege.length === 0 ? (
        <p className="verlauf__leer">Noch keine automatischen Ereignisse protokolliert.</p>
      ) : (
        <ol className="verlauf__liste">
          {eintraege.map((e) => {
            const { label, farbe } = EREIGNIS_LABEL[e.ereignis] || { label: e.ereignis, farbe: "slate" };
            return (
              <li className="verlauf__eintrag" key={e.id}>
                <span className={`verlauf__punkt verlauf__punkt--${farbe}`} aria-hidden="true" />
                <div className="verlauf__inhalt">
                  <div className="verlauf__kopf">
                    <span className="verlauf__ereignis">{label}</span>
                    <span className="verlauf__zeit">{datumUhrzeit(e.erzeugt_am)}</span>
                  </div>
                  {e.empfaenger && <p className="verlauf__detail">an {e.empfaenger}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
