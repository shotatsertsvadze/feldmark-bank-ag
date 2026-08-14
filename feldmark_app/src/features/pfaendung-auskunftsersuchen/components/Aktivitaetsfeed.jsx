import { useEffect, useState } from "react";
import { aktivitaetLaden } from "../api.js";
import { DOKUMENTTYP_LABEL, EREIGNIS_LABEL } from "../dokumenttypen.js";

const datumUhrzeit = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Fallübergreifender Aktivitäts-Feed: die letzten Ereignisse aus BEIDEN
 * Protokoll-Tabellen zusammen, neueste zuerst - macht sichtbar, dass der
 * taegliche n8n-Sweep tatsaechlich laeuft, ohne dass man jeden Fall einzeln
 * aufklappen muss (das leistet Fallverlauf.jsx bereits pro Fall). Gleiche
 * Zeitleisten-Optik wie dort (verlauf__*-Klassen), nur zusaetzlich mit
 * Fall-Bezug pro Zeile, weil hier mehrere Faelle gemischt auftauchen.
 */
export default function Aktivitaetsfeed({ limit = 10 }) {
  const [eintraege, setEintraege] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    aktivitaetLaden(limit)
      .then((e) => !abgebrochen && setEintraege(e))
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)));
    return () => {
      abgebrochen = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  return (
    <div className="panel">
      <div className="panel__head">
        <p className="panel__head-title">Systemaktivität</p>
      </div>
      <div className="panel__body panel__body--scroll">
        {fehler && <p className="fehlerbanner">{fehler}</p>}
        {!fehler && eintraege === null && <p className="ladeindikator">Aktivität wird geladen …</p>}
        {!fehler && eintraege && eintraege.length === 0 && (
          <p className="verlauf__leer">Noch keine automatischen Ereignisse protokolliert.</p>
        )}
        {!fehler && eintraege && eintraege.length > 0 && (
          <ol className="verlauf__liste verlauf__liste--kompakt">
            {eintraege.map((e) => {
              const { label, farbe } = EREIGNIS_LABEL[e.ereignis] || { label: e.ereignis, farbe: "slate" };
              return (
                <li className="verlauf__eintrag" key={`${e.fall_id}-${e.ereignis}-${e.erzeugt_am}`}>
                  <span className={`verlauf__punkt verlauf__punkt--${farbe}`} aria-hidden="true" />
                  <div className="verlauf__inhalt">
                    <div className="verlauf__kopf">
                      <span className="verlauf__ereignis">{label}</span>
                      <span className="verlauf__zeit">{datumUhrzeit(e.erzeugt_am)}</span>
                    </div>
                    <p className="verlauf__detail">
                      <span className="fall-zeile__id">{e.fall_id}</span>
                      {" · "}
                      {DOKUMENTTYP_LABEL[e.dokumenttyp] || e.dokumenttyp}
                      {" · "}
                      {e.partei_a} → {e.partei_b}
                      {e.empfaenger && ` · an ${e.empfaenger}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
