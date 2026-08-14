import { useEffect, useState } from "react";
import { sweepStatusLaden } from "../api.js";

const SWEEP_LABEL = {
  pfaendung: "Pfändung",
  auskunftsersuchen: "Auskunftsersuchen",
};

function relativeZeit(iso) {
  const datum = new Date(iso);
  const heute = new Date();
  const uhrzeit = datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (datum.toDateString() === heute.toDateString()) return `heute, ${uhrzeit} Uhr`;
  return `${datum.toLocaleDateString("de-DE")}, ${uhrzeit} Uhr`;
}

/**
 * Zeigt, wann die beiden taeglichen n8n-Sweeps zuletzt liefen und ob sie
 * erfolgreich waren - liest ausschliesslich feldmark.sweep_status, das n8n
 * selbst schreibt (siehe feldmark_sweep_status_schema.sql). Die App ruft
 * dafuer bewusst NICHT die n8n-API auf: das wuerde ein eigenes API-Token in
 * der App-Umgebung erfordern, waehrend der bestehende "n8n schreibt, App
 * liest" -Weg ueber Postgres schon fuer alles andere im Projekt gilt.
 */
export default function SweepStatus() {
  const [sweeps, setSweeps] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    sweepStatusLaden()
      .then((s) => !abgebrochen && setSweeps(s))
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)));
    return () => {
      abgebrochen = true;
    };
  }, []);

  const nachName = Object.fromEntries((sweeps || []).map((s) => [s.sweep_name, s]));

  return (
    <div className="panel">
      <div className="panel__head">
        <p className="panel__head-title">n8n-Sweep-Status</p>
      </div>
      <div className="panel__body">
        {fehler && <p className="fehlerbanner">{fehler}</p>}
        {!fehler && sweeps === null && <p className="ladeindikator">Status wird geladen …</p>}
        {!fehler && sweeps && (
          <ul className="sweep-status__liste">
            {Object.keys(SWEEP_LABEL).map((name) => {
              const s = nachName[name];
              const erfolgreich = s?.status === "erfolgreich";
              const punktFarbe = !s ? "faint" : erfolgreich ? "moss" : "oxblood";
              return (
                <li className="sweep-status__eintrag" key={name}>
                  <span className={`sweep-status__punkt sweep-status__punkt--${punktFarbe}`} aria-hidden="true" />
                  <div className="sweep-status__inhalt">
                    <div className="sweep-status__kopf">
                      <span className="sweep-status__name">{SWEEP_LABEL[name]}</span>
                      <span className="sweep-status__zeit">{s ? relativeZeit(s.zuletzt_gelaufen_am) : "noch nie gelaufen"}</span>
                    </div>
                    {s && !erfolgreich && s.meldung && <p className="sweep-status__meldung">{s.meldung}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
