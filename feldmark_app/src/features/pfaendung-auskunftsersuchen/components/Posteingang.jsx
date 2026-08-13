import { useState } from "react";
import Dropzone from "./Dropzone.jsx";
import ErgebnisKarte from "./ErgebnisKarte.jsx";
import { schreibenHochladen } from "../api.js";

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Posteingang({ onFaelleGeaendert }) {
  const [eingang, setEingang] = useState({
    zustelldatum: heuteIso(),
    zustellkanal: "",
    bearbeiter_email: "",
    vertretung_email: "",
    vorgesetzte_email: "",
  });
  const [ergebnisse, setErgebnisse] = useState([]);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState(null);

  function feldAendern(name, wert) {
    setEingang((e) => ({ ...e, [name]: wert }));
  }

  async function dateienVerarbeiten(dateien) {
    setFehler(null);
    setLaedt(true);
    try {
      const neu = await schreibenHochladen(dateien, eingang);
      setErgebnisse((bisherige) => [...neu, ...bisherige]);
      if (neu.some((e) => e.fall?.angelegt || e.fall?.zugeordnet_zu)) onFaelleGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setLaedt(false);
    }
  }

  return (
    <section className="view">
      <h2 className="view-title">Posteingang</h2>
      <p className="view-lede">
        Schreiben hochladen — Mistral OCR liest den Text, ein Klassifikations-Schritt ordnet Typ und Felder zu,
        und je nach Konfidenz landet das Ergebnis als Fall in der Fristüberwachung oder in der Sichtprüfung.
      </p>

      <div className="panel">
        <div className="panel__head">
          <p className="panel__head-title">Eingangsmetadaten für diesen Stapel</p>
        </div>
        <div className="panel__body">
          <div className="eingangsform">
            <div className="feld">
              <label htmlFor="zustelldatum">Zustelldatum</label>
              <input
                id="zustelldatum"
                type="date"
                value={eingang.zustelldatum}
                onChange={(e) => feldAendern("zustelldatum", e.target.value)}
              />
            </div>
            <div className="feld">
              <label htmlFor="zustellkanal">Zustellkanal</label>
              <select
                id="zustellkanal"
                value={eingang.zustellkanal}
                onChange={(e) => feldAendern("zustellkanal", e.target.value)}
              >
                <option value="">Bitte wählen</option>
                <option value="Papier">Papier</option>
                <option value="eBO">eBO</option>
                <option value="E-Mail">E-Mail</option>
                <option value="Fax">Fax</option>
              </select>
            </div>
            <div className="feld">
              <label htmlFor="bearbeiter_email">Bearbeiter:in</label>
              <input
                id="bearbeiter_email"
                type="email"
                placeholder="bearbeiter@feldmark-bank.example"
                value={eingang.bearbeiter_email}
                onChange={(e) => feldAendern("bearbeiter_email", e.target.value)}
              />
            </div>
            <div className="feld feld--optional">
              <label htmlFor="vertretung_email">Vertretung</label>
              <input
                id="vertretung_email"
                type="email"
                value={eingang.vertretung_email}
                onChange={(e) => feldAendern("vertretung_email", e.target.value)}
              />
            </div>
            <div className="feld feld--optional">
              <label htmlFor="vorgesetzte_email">Vorgesetzte:r</label>
              <input
                id="vorgesetzte_email"
                type="email"
                value={eingang.vorgesetzte_email}
                onChange={(e) => feldAendern("vorgesetzte_email", e.target.value)}
              />
            </div>
          </div>
          <p className="hinweis-batch">
            Zustelldatum, -kanal und Bearbeiter:in gelten für <strong>alle</strong> Dateien in diesem Stapel. Lade nur Post
            desselben Tages gemeinsam hoch — ein gemischter Stapel setzt für ältere Schreiben ein falsches Fristbeginn-Datum.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel__body">
          <Dropzone onDateien={dateienVerarbeiten} sperren={laedt} />
        </div>
      </div>

      {fehler && <p className="fehlerbanner" style={{ marginTop: 16 }}>{fehler}</p>}

      {ergebnisse.length > 0 && (
        <div className="panel">
          <div className="panel__head">
            <p className="panel__head-title">Ergebnisse dieser Sitzung</p>
          </div>
          <div className="panel__body">
            <div className="ergebnisliste">
              {ergebnisse.map((e, i) => (
                <ErgebnisKarte key={e.id} ergebnis={e} animiertesStempel={i < ergebnisse.length} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
