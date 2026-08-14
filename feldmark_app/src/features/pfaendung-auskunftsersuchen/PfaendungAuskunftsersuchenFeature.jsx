import { useState } from "react";
import Posteingang from "./components/Posteingang.jsx";
import Falluebersicht from "./components/Falluebersicht.jsx";
import Prozessdiagramm from "./components/Prozessdiagramm.jsx";

export default function PfaendungAuskunftsersuchenFeature() {
  const [ansicht, setAnsicht] = useState("posteingang");
  const [reloadSignal, setReloadSignal] = useState(0);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1 className="masthead__name">Pfändung &amp; Auskunftsersuchen</h1>
          <p className="masthead__sub">Klassifikation &amp; Fristüberwachung eingehender Schreiben</p>
        </div>
        <nav className="nav-tabs">
          <button
            className={`nav-tabs__btn${ansicht === "posteingang" ? " nav-tabs__btn--active" : ""}`}
            onClick={() => setAnsicht("posteingang")}
          >
            Posteingang
          </button>
          <button
            className={`nav-tabs__btn${ansicht === "falluebersicht" ? " nav-tabs__btn--active" : ""}`}
            onClick={() => setAnsicht("falluebersicht")}
          >
            Fallübersicht
          </button>
          <button
            className={`nav-tabs__btn${ansicht === "prozess" ? " nav-tabs__btn--active" : ""}`}
            onClick={() => setAnsicht("prozess")}
          >
            Prozess
          </button>
        </nav>
      </header>

      {ansicht === "posteingang" && <Posteingang onFaelleGeaendert={() => setReloadSignal((n) => n + 1)} />}
      {ansicht === "falluebersicht" && <Falluebersicht reloadSignal={reloadSignal} />}
      {ansicht === "prozess" && <Prozessdiagramm />}
    </div>
  );
}
