import { useEffect, useState } from "react";
import { faelleLaden, sichtpruefungLaden } from "../api.js";
import { berechneFrist, formatiereDatum } from "../fristlogik.js";
import { DOKUMENTTYP_LABEL } from "../dokumenttypen.js";
import Fristleiste from "./Fristleiste.jsx";
import Stempel from "./Stempel.jsx";

const FILTER = [
  { id: "alle", label: "Alle" },
  { id: "pfaendungsschreiben", label: "Pfändungsblock" },
  { id: "auskunftsersuchen", label: "Auskunftsersuchen" },
];

const PFAENDUNGSBLOCK = ["pfaendungsschreiben", "einziehungsverfuegung", "ueberweisungsverfuegung"];

export default function Falluebersicht({ reloadSignal }) {
  const [faelle, setFaelle] = useState([]);
  const [sichtpruefung, setSichtpruefung] = useState([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState(null);
  const [filter, setFilter] = useState("alle");

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);
    Promise.all([faelleLaden(), sichtpruefungLaden()])
      .then(([f, s]) => {
        if (abgebrochen) return;
        setFaelle(f);
        setSichtpruefung(s);
      })
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)))
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
  }, [reloadSignal]);

  const gefiltert = faelle.filter((f) => {
    if (filter === "alle") return true;
    if (filter === "pfaendungsschreiben") return PFAENDUNGSBLOCK.includes(f.dokumenttyp);
    return f.dokumenttyp === filter;
  });

  const dringend = faelle.filter((f) => {
    const { zone } = berechneFrist(f.eingangsdatum, f.antwortfrist_tage);
    return zone !== "ok";
  }).length;

  if (laedt) return <p className="ladeindikator">Fallübersicht wird geladen …</p>;
  if (fehler) return <p className="fehlerbanner">{fehler}</p>;

  return (
    <section className="view">
      <h2 className="view-title">Fallübersicht</h2>
      <p className="view-lede">Offene Fälle aus Pfändungs- und Auskunftsersuchen-Fristüberwachung, plus die Sichtprüfungs-Warteschlange.</p>

      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="kpi-tile__wert">{faelle.length}</div>
          <div className="kpi-tile__label">Offene Fälle</div>
        </div>
        <div className={`kpi-tile${dringend ? " kpi-tile--warn" : ""}`}>
          <div className="kpi-tile__wert">{dringend}</div>
          <div className="kpi-tile__label">Frist ≤ 3 Tage oder überfällig</div>
        </div>
        <div className={`kpi-tile${sichtpruefung.length ? " kpi-tile--kritisch" : ""}`}>
          <div className="kpi-tile__wert">{sichtpruefung.length}</div>
          <div className="kpi-tile__label">In Sichtprüfung</div>
        </div>
      </div>

      <div className="filter-tabs">
        {FILTER.map((f) => (
          <button
            key={f.id}
            className={`filter-tabs__btn${filter === f.id ? " filter-tabs__btn--aktiv" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head">
          <p className="panel__head-title">Fristüberwachung</p>
        </div>
        {gefiltert.length === 0 ? (
          <div className="leer">
            <strong>Keine offenen Fälle</strong>
            In dieser Ansicht ist gerade nichts zu tun.
          </div>
        ) : (
          <div className="fallliste">
            {gefiltert.map((f) => (
              <div className="fall-zeile" key={f.fall_id}>
                <span className="fall-zeile__id">{f.fall_id}</span>
                <div className="fall-zeile__parteien">
                  <div className="fall-zeile__typ">{DOKUMENTTYP_LABEL[f.dokumenttyp] || f.dokumenttyp}</div>
                  <div className="fall-zeile__namen">
                    {f.partei_a} → {f.partei_b}
                  </div>
                </div>
                <span className="fall-zeile__status">{f.status}</span>
                <Fristleiste
                  eingangsdatum={f.eingangsdatum}
                  antwortfristTage={f.antwortfrist_tage}
                  erinnerungenGesendet={f.erinnerungen_gesendet}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <p className="panel__head-title">Sichtprüfungs-Warteschlange</p>
        </div>
        {sichtpruefung.length === 0 ? (
          <div className="leer">
            <strong>Warteschlange leer</strong>
            Alles Aufgelaufene wurde geprüft oder automatisch verarbeitet.
          </div>
        ) : (
          <div>
            {sichtpruefung.map((s) => (
              <div className="sichtpruefung-zeile" key={s.id}>
                <div className="sichtpruefung-zeile__stempel">
                  <Stempel typLabel={DOKUMENTTYP_LABEL[s.dokumenttyp] || s.dokumenttyp} wert="Prüfen" farbe="ochre" />
                </div>
                <div className="sichtpruefung-zeile__info">
                  <span className="sichtpruefung-zeile__datei">{s.dateiname}</span>
                  <p className="sichtpruefung-zeile__begruendung">
                    {s.plausibilitaet_begruendung || "Konfidenz unterhalb der Autofall-Schwelle."}
                  </p>
                  <div className="sichtpruefung-zeile__gruende">
                    {s.routing_gruende.map((g, i) => (
                      <span className="badge badge--ochre" key={i}>
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
