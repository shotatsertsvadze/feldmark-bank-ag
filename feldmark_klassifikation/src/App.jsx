import { useState } from "react";
import Posteingang from "./components/Posteingang.jsx";
import Falluebersicht from "./components/Falluebersicht.jsx";

export default function App() {
  const [ansicht, setAnsicht] = useState("posteingang");
  const [reloadSignal, setReloadSignal] = useState(0);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1 className="masthead__name">Feldmark Bank AG</h1>
          <p className="masthead__sub">Kontenservice · Klassifikation &amp; Fristüberwachung</p>
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
        </nav>
      </header>

      {ansicht === "posteingang" ? (
        <Posteingang onFaelleGeaendert={() => setReloadSignal((n) => n + 1)} />
      ) : (
        <Falluebersicht reloadSignal={reloadSignal} />
      )}
    </div>
  );
}
