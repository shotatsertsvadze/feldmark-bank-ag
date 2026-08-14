import { useEffect, useState } from "react";
import { datendiskrepanzLaden, datendiskrepanzReaktivieren } from "../api.js";

const datumUhrzeit = (iso) => new Date(iso).toLocaleString("de-DE");

// Rendert nichts, wenn der Fall keinen offenen (oder je abgeschlossenen)
// Datendiskrepanz-Eintrag hat - betrifft die meisten Faelle. Wird als
// Geschwisterelement zu PfaendungErweiterung in Falluebersicht.jsx
// eingehaengt, nicht als Ersatz dafuer.
export default function DatendiskrepanzFall({ fallId, onFallGeaendert }) {
  const [eintrag, setEintrag] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState(null);
  const [schuldnerName, setSchuldnerName] = useState("");
  const [reaktiviertVon, setReaktiviertVon] = useState("");
  const [reaktiviert, setReaktiviert] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    datendiskrepanzLaden(fallId)
      .then((d) => !abgebrochen && setEintrag(d))
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)))
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
  }, [fallId]);

  async function reaktivieren() {
    if (!schuldnerName.trim() || !reaktiviertVon.trim()) return;
    setReaktiviert(true);
    setFehler(null);
    try {
      const ergebnis = await datendiskrepanzReaktivieren(fallId, schuldnerName.trim(), reaktiviertVon.trim());
      setEintrag(ergebnis);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setReaktiviert(false);
    }
  }

  if (laedt || !eintrag) return null;

  const istOffen = !eintrag.geklaert_am && !eintrag.geschlossen_am;

  return (
    <div className="erweiterung diskrepanz">
      <p className="erweiterung__status erweiterung__status--ausstehend">
        <strong>Datendiskrepanz</strong> — Schuldner konnte nicht zugeordnet werden. Rückfrage an den Gläubiger
        gesendet am {datumUhrzeit(eintrag.rueckfrage_gesendet_am)}.
        {eintrag.nachfassung_1_gesendet_am && <> Nachfassung 1 am {datumUhrzeit(eintrag.nachfassung_1_gesendet_am)}.</>}
        {eintrag.nachfassung_2_gesendet_am && <> Nachfassung 2 am {datumUhrzeit(eintrag.nachfassung_2_gesendet_am)}.</>}
        {eintrag.fristwahrend_erklaert_am && (
          <> Fristwahrend erklärt am {datumUhrzeit(eintrag.fristwahrend_erklaert_am)} — siehe Drittschuldnererklärung unten.</>
        )}
      </p>

      {fehler && <p className="fehlerbanner">{fehler}</p>}

      <div className="erweiterung__erklaerung">
        <textarea readOnly value={eintrag.rueckfrage_text} rows={8} />
      </div>

      {istOffen ? (
        <div className="erweiterung__aktionen">
          <input
            type="text"
            placeholder="Schuldnername (aus Antwort des Gläubigers)"
            value={schuldnerName}
            onChange={(e) => setSchuldnerName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Kürzel/E-Mail"
            value={reaktiviertVon}
            onChange={(e) => setReaktiviertVon(e.target.value)}
          />
          <button
            className="nav-tabs__btn"
            onClick={reaktivieren}
            disabled={reaktiviert || !schuldnerName.trim() || !reaktiviertVon.trim()}
          >
            {reaktiviert ? "Trägt nach …" : "Schuldner nachtragen & reaktivieren"}
          </button>
        </div>
      ) : eintrag.geklaert_am ? (
        <p className="erweiterung__status erweiterung__status--abgeschlossen">
          <strong>Reaktiviert</strong> von {eintrag.geklaert_von} am {datumUhrzeit(eintrag.geklaert_am)} — Schuldner:{" "}
          {eintrag.geklaert_schuldner_name}.
        </p>
      ) : (
        <p className="fehlerbanner">
          <strong>Geschlossen</strong> am {datumUhrzeit(eintrag.geschlossen_am)}: {eintrag.geschlossen_grund}
        </p>
      )}
    </div>
  );
}
