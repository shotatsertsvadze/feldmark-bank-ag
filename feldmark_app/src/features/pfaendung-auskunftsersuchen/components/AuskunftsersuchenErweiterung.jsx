import { useEffect, useState } from "react";
import {
  antwortAblehnen,
  antwortErzeugen,
  antwortFreigeben,
  antwortVersenden,
  auskunftsersuchenErweiterungLaden,
  auskunftsersuchenErweiterungSpeichern,
  sperreEntscheiden,
} from "../api.js";
import { formatiereZeitstempel } from "../fristlogik.js";
import { useEscapeKey } from "../hooks.js";

export default function AuskunftsersuchenErweiterung({ fallId, onFallGeaendert }) {
  const [erw, setErw] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState(null);
  const [speichertPruefung, setSpeichertPruefung] = useState(false);
  const [erzeugtAntwort, setErzeugtAntwort] = useState(false);
  const [gibtFrei, setGibtFrei] = useState(false);
  const [freigebenName, setFreigebenName] = useState("");
  const [vierAugenWarnung, setVierAugenWarnung] = useState(null);
  const [versendetVon, setVersendetVon] = useState("");
  const [bestaetigtVersand, setBestaetigtVersand] = useState(false);
  const [zeigtModal, setZeigtModal] = useState(false);
  const [speichertSperre, setSpeichertSperre] = useState(false);
  const [lehntAb, setLehntAb] = useState(false);

  const [ausgewaehltePunkte, setAusgewaehltePunkte] = useState([]);
  const [antwortWerte, setAntwortWerte] = useState({});
  const [geprueftVon, setGeprueftVon] = useState("");
  const [sperreVorhanden, setSperreVorhanden] = useState(null);
  const [sperreBegruendung, setSperreBegruendung] = useState("");
  const [sperreEntschiedenVon, setSperreEntschiedenVon] = useState("");

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);
    auskunftsersuchenErweiterungLaden(fallId)
      .then((f) => {
        if (abgebrochen) return;
        setErw(f);
        setAusgewaehltePunkte(f.freizugebende_punkte || []);
        setAntwortWerte(f.antwort_werte || {});
        setGeprueftVon(f.rechtsgrundlage_geprueft_von || "");
        setSperreVorhanden(f.sperre_entschieden_am ? f.sperre_rechtsgrundlage_vorhanden : null);
        setSperreBegruendung(f.sperre_begruendung || "");
        setSperreEntschiedenVon(f.sperre_entschieden_von || "");
      })
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)))
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
  }, [fallId]);

  useEscapeKey(zeigtModal, setZeigtModal);

  function punktUmschalten(punkt) {
    setAusgewaehltePunkte((vorher) => (vorher.includes(punkt) ? vorher.filter((p) => p !== punkt) : [...vorher, punkt]));
  }

  async function pruefungSpeichern() {
    setSpeichertPruefung(true);
    setFehler(null);
    try {
      const erweiterung = await auskunftsersuchenErweiterungSpeichern(fallId, {
        freizugebendePunkte: ausgewaehltePunkte,
        rechtsgrundlageGeprueftVon: geprueftVon.trim() === "" ? null : geprueftVon.trim(),
        antwortWerte,
      });
      setErw(erweiterung);
      return true;
    } catch (e) {
      setFehler(String(e.message || e));
      return false;
    } finally {
      setSpeichertPruefung(false);
    }
  }

  async function antwortErstellen() {
    setErzeugtAntwort(true);
    setFehler(null);
    setVierAugenWarnung(null);
    try {
      const ok = await pruefungSpeichern();
      if (!ok) return;
      const text = await antwortErzeugen(fallId);
      setErw((vorher) => ({
        ...vorher,
        antwort_text: text,
        antwort_freigegeben_von: null,
        antwort_freigegeben_am: null,
        antwort_versendet_von: null,
        antwort_versendet_am: null,
      }));
      setFreigebenName("");
      setVersendetVon("");
      setZeigtModal(true);
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setErzeugtAntwort(false);
    }
  }

  async function freigeben(vierAugenBestaetigt = false) {
    if (!freigebenName.trim()) return;
    setGibtFrei(true);
    setFehler(null);
    try {
      const ergebnis = await antwortFreigeben(fallId, freigebenName.trim(), vierAugenBestaetigt);
      if (ergebnis.vierAugenWarnung) {
        setVierAugenWarnung(ergebnis.meldung);
        return;
      }
      setVierAugenWarnung(null);
      setErw(ergebnis.erweiterung);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setGibtFrei(false);
    }
  }

  async function versandBestaetigen() {
    if (!versendetVon.trim()) return;
    setBestaetigtVersand(true);
    setFehler(null);
    try {
      const erweiterung = await antwortVersenden(fallId, versendetVon.trim());
      setErw(erweiterung);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setBestaetigtVersand(false);
    }
  }

  // Gleiches Muster wie ablehnen() in PfaendungErweiterung.jsx - siehe
  // dortiger Kommentar.
  async function ablehnen() {
    setLehntAb(true);
    setFehler(null);
    try {
      const erweiterung = await antwortAblehnen(fallId);
      setErw(erweiterung);
      setVierAugenWarnung(null);
      setZeigtModal(false);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setLehntAb(false);
    }
  }

  async function sperreSpeichern() {
    if (sperreVorhanden === null || !sperreEntschiedenVon.trim()) return;
    if (sperreVorhanden && !sperreBegruendung.trim()) {
      setFehler("Bei einer Sperre ist eine Begründung (Beschlagnahme-/Arrestbeschluss) erforderlich.");
      return;
    }
    setSpeichertSperre(true);
    setFehler(null);
    try {
      const erweiterung = await sperreEntscheiden(fallId, {
        rechtsgrundlageVorhanden: sperreVorhanden,
        begruendung: sperreBegruendung.trim() || null,
        entschiedenVon: sperreEntschiedenVon.trim(),
      });
      setErw(erweiterung);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setSpeichertSperre(false);
    }
  }

  if (laedt) return <p className="ladeindikator">Erweiterung wird geladen …</p>;
  if (!erw) return <p className="fehlerbanner">{fehler || "Fall nicht gefunden."}</p>;

  const istFreigegeben = !!erw.antwort_freigegeben_am;
  const istVersendet = !!erw.antwort_versendet_am;
  const angefragtePunkte = erw.angefragte_punkte || [];

  return (
    <div className="erweiterung">
      {fehler && <p className="fehlerbanner">{fehler}</p>}

      {erw.vertraulich && (
        <p className="erweiterung__warnhinweis">
          <strong>Vertraulich — keine Kundeninformation.</strong> Dieses Ersuchen darf der betroffenen Person nicht
          mitgeteilt werden (§§ 161, 161a StPO — Vertraulichkeitsproblem, siehe docs/SOLL-PROZESS.md, Ast E).
        </p>
      )}

      {erw.compliance_informiert_am && (
        <p className="hinweis-batch">
          <strong>Compliance informiert</strong> am {formatiereZeitstempel(erw.compliance_informiert_am)}.
        </p>
      )}

      <div className="eingangsform">
        {angefragtePunkte.map((punkt) => (
          <div className="feld feld--optional" key={punkt}>
            <label>
              <input type="checkbox" checked={ausgewaehltePunkte.includes(punkt)} onChange={() => punktUmschalten(punkt)} /> {punkt}{" "}
              freigeben
            </label>
            {ausgewaehltePunkte.includes(punkt) && (
              <input
                type="text"
                value={antwortWerte[punkt] || ""}
                onChange={(e) => setAntwortWerte((vorher) => ({ ...vorher, [punkt]: e.target.value }))}
                placeholder={`Antwortwert für „${punkt}“`}
              />
            )}
          </div>
        ))}
        <div className="feld feld--optional">
          <label>Geprüft von (E3)</label>
          <input type="text" value={geprueftVon} onChange={(e) => setGeprueftVon(e.target.value)} placeholder="Kürzel/E-Mail" />
        </div>
      </div>

      <div className="erweiterung__aktionen">
        <button className="nav-tabs__btn" onClick={pruefungSpeichern} disabled={speichertPruefung}>
          {speichertPruefung ? "Speichert …" : "Prüfung speichern"}
        </button>
        <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={antwortErstellen} disabled={erzeugtAntwort || ausgewaehltePunkte.length === 0}>
          {erzeugtAntwort ? "Erzeugt …" : "Antwort erzeugen"}
        </button>
        {erw.antwort_text && (
          <button className="nav-tabs__btn" onClick={() => setZeigtModal(true)}>
            Antwort anzeigen
          </button>
        )}
      </div>

      <div className="erweiterung__sperre">
        <p className="erweiterung__vorschau">
          <strong>Kontosperre (E5)</strong> — nur bei eigener Rechtsgrundlage (Beschlagnahme/Arrest). Ein reines
          Auskunftsersuchen führt zu keiner Sperre.
        </p>
        {erw.sperre_entschieden_am && (
          <p className="hinweis-batch">
            Zuletzt entschieden: <strong>{erw.sperre_rechtsgrundlage_vorhanden ? "Sperre ausgelöst" : "Keine Sperre"}</strong> von{" "}
            {erw.sperre_entschieden_von} am {formatiereZeitstempel(erw.sperre_entschieden_am)}
            {erw.sperre_begruendung ? ` — ${erw.sperre_begruendung}` : ""}.
          </p>
        )}
        <div className="eingangsform">
          <div className="feld">
            <label>
              <input type="radio" name={`sperre-${fallId}`} checked={sperreVorhanden === false} onChange={() => setSperreVorhanden(false)} />{" "}
              Keine Rechtsgrundlage — keine Sperre
            </label>
          </div>
          <div className="feld">
            <label>
              <input type="radio" name={`sperre-${fallId}`} checked={sperreVorhanden === true} onChange={() => setSperreVorhanden(true)} />{" "}
              Beschlagnahme/Arrest liegt vor — Sperre auslösen
            </label>
          </div>
          {sperreVorhanden && (
            <div className="feld">
              <label>Begründung (Beschluss-Az.)</label>
              <input type="text" value={sperreBegruendung} onChange={(e) => setSperreBegruendung(e.target.value)} />
            </div>
          )}
          <div className="feld feld--optional">
            <label>Entschieden von</label>
            <input type="text" value={sperreEntschiedenVon} onChange={(e) => setSperreEntschiedenVon(e.target.value)} placeholder="Kürzel/E-Mail" />
          </div>
        </div>
        <div className="erweiterung__aktionen">
          <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={sperreSpeichern} disabled={speichertSperre || sperreVorhanden === null || !sperreEntschiedenVon.trim()}>
            {speichertSperre ? "Speichert …" : "Entscheidung speichern"}
          </button>
        </div>
      </div>

      {erw.antwort_text && zeigtModal && (
        <div className="erweiterung__modal-overlay" onClick={() => setZeigtModal(false)}>
          <div className="erweiterung__modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="erweiterung__modal-kopf">
              <h3>Auskunft — {fallId}</h3>
              <button className="erweiterung__modal-schliessen" onClick={() => setZeigtModal(false)} aria-label="Schließen">
                ×
              </button>
            </div>

            <div className="erweiterung__erklaerung">
              <textarea readOnly value={erw.antwort_text} rows={14} />

              {!istVersendet && (
                <div className="erweiterung__aktionen">
                  <button className="nav-tabs__btn nav-tabs__btn--ablehnen" onClick={ablehnen} disabled={lehntAb}>
                    {lehntAb ? "Lehnt ab …" : "Ablehnen"}
                  </button>
                </div>
              )}

              {!istFreigegeben && (
                <div className="erweiterung__aktionen">
                  <input
                    type="text"
                    placeholder="Kürzel/E-Mail zur Freigabe (Compliance)"
                    value={freigebenName}
                    onChange={(e) => {
                      setFreigebenName(e.target.value);
                      setVierAugenWarnung(null);
                    }}
                  />
                  <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={() => freigeben(false)} disabled={gibtFrei || !freigebenName.trim()}>
                    {gibtFrei ? "Gibt frei …" : "Freigeben"}
                  </button>
                </div>
              )}

              {vierAugenWarnung && (
                <div className="erweiterung__vier-augen">
                  {vierAugenWarnung}
                  <div className="erweiterung__aktionen">
                    <button className="nav-tabs__btn" onClick={() => freigeben(true)} disabled={gibtFrei}>
                      {gibtFrei ? "Gibt frei …" : "Trotzdem freigeben"}
                    </button>
                  </div>
                </div>
              )}

              {istFreigegeben && !istVersendet && (
                <>
                  <p className="erweiterung__status erweiterung__status--ausstehend">
                    <strong>Freigegeben</strong> von {erw.antwort_freigegeben_von} am {formatiereZeitstempel(erw.antwort_freigegeben_am)}.
                    Versand noch ausstehend — nach dem tatsächlichen Versand hier bestätigen.
                  </p>
                  <div className="erweiterung__aktionen">
                    <input
                      type="text"
                      placeholder="Kürzel/E-Mail (wer hat versendet)"
                      value={versendetVon}
                      onChange={(e) => setVersendetVon(e.target.value)}
                    />
                    <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={versandBestaetigen} disabled={bestaetigtVersand || !versendetVon.trim()}>
                      {bestaetigtVersand ? "Bestätigt …" : "Versand bestätigen"}
                    </button>
                  </div>
                </>
              )}

              {istVersendet && (
                <p className="erweiterung__status erweiterung__status--abgeschlossen">
                  <strong>Versendet</strong> von {erw.antwort_versendet_von} am {formatiereZeitstempel(erw.antwort_versendet_am)}
                  {" "}(freigegeben von {erw.antwort_freigegeben_von} am {formatiereZeitstempel(erw.antwort_freigegeben_am)}).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
