import { useEffect, useState } from "react";
import { faelleLaden, sichtpruefungLaden } from "../api.js";
import { berechneFrist, formatiereDatum } from "../fristlogik.js";
import { DOKUMENTTYP_LABEL } from "../dokumenttypen.js";
import Fristleiste from "./Fristleiste.jsx";
import Stempel from "./Stempel.jsx";
import PfaendungErweiterung from "./PfaendungErweiterung.jsx";
import AuskunftsersuchenErweiterung from "./AuskunftsersuchenErweiterung.jsx";
import DatendiskrepanzFall from "./DatendiskrepanzFall.jsx";
import Fallverlauf from "./Fallverlauf.jsx";
import Aktivitaetsfeed from "./Aktivitaetsfeed.jsx";
import SweepStatus from "./SweepStatus.jsx";

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
  const [aufgeklapptFallId, setAufgeklapptFallId] = useState(null);
  const [internerReload, setInternerReload] = useState(0);

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);
    Promise.all([faelleLaden(), sichtpruefungLaden()])
      .then(([f, s]) => {
        if (abgebrochen) return;
        setFaelle(f);
        setSichtpruefung(s);
        // Freigegebene Faelle verschwinden aus der offenen Liste (Status
        // "Erklaerung versandt" wird vom Backend gefiltert) - aufgeklappte
        // Zeile dann schliessen, statt eine verwaiste Ansicht zu zeigen.
        if (aufgeklapptFallId && !f.some((x) => x.fall_id === aufgeklapptFallId)) {
          setAufgeklapptFallId(null);
        }
      })
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)))
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal, internerReload]);

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

      <div className="fallansicht">
        <div className="fallansicht__haupt">
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
            {gefiltert.map((f) => {
              const istPfaendungsblock = PFAENDUNGSBLOCK.includes(f.dokumenttyp);
              const istAufgeklappt = aufgeklapptFallId === f.fall_id;
              return (
                <div key={f.fall_id}>
                  <div
                    className="fall-zeile fall-zeile--klickbar"
                    role="button"
                    tabIndex={0}
                    aria-expanded={istAufgeklappt}
                    onClick={() => setAufgeklapptFallId(istAufgeklappt ? null : f.fall_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setAufgeklapptFallId(istAufgeklappt ? null : f.fall_id);
                      }
                    }}
                  >
                    <span className="fall-zeile__id">{f.fall_id}</span>
                    <div className="fall-zeile__parteien">
                      <div className="fall-zeile__typ">
                        {DOKUMENTTYP_LABEL[f.dokumenttyp] || f.dokumenttyp}
                        {f.vertraulich && <span className="badge badge--oxblood"> Vertraulich</span>}
                      </div>
                      <div className="fall-zeile__namen">
                        {f.partei_a} → {f.partei_b}
                      </div>
                      <div className="fall-zeile__status">{f.status}</div>
                    </div>
                    <Fristleiste
                      eingangsdatum={f.eingangsdatum}
                      antwortfristTage={f.antwortfrist_tage}
                      erinnerungenGesendet={f.erinnerungen_gesendet}
                    />
                  </div>
                  {istAufgeklappt && (
                    <div className="fall-zeile__erweiterung">
                      {istPfaendungsblock ? (
                        <>
                          <DatendiskrepanzFall fallId={f.fall_id} onFallGeaendert={() => setInternerReload((n) => n + 1)} />
                          <PfaendungErweiterung fallId={f.fall_id} onFallGeaendert={() => setInternerReload((n) => n + 1)} />
                        </>
                      ) : (
                        f.dokumenttyp === "auskunftsersuchen" && (
                          <AuskunftsersuchenErweiterung fallId={f.fall_id} onFallGeaendert={() => setInternerReload((n) => n + 1)} />
                        )
                      )}
                      <Fallverlauf fallId={f.fall_id} reloadSignal={internerReload} />
                    </div>
                  )}
                </div>
              );
            })}
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
        </div>

        <div className="fallansicht__seite">
          <SweepStatus />
          <Aktivitaetsfeed />
        </div>
      </div>
    </section>
  );
}
