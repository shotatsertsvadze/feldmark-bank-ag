import { useEffect, useState } from "react";
import {
  erklaerungAblehnen,
  erklaerungErzeugen,
  erklaerungFreigeben,
  erklaerungVersenden,
  erweiterungLaden,
  erweiterungSpeichern,
} from "../api.js";

// Muss mit P_KONTO_GRUNDFREIBETRAG_EUR in server/pkonto_drittschuldner.js
// uebereinstimmen - nur fuer die Live-Vorschau im Formular, die eigentliche
// Berechnung passiert serverseitig beim Erzeugen der Erklaerung.
const P_KONTO_GRUNDFREIBETRAG_EUR = 1590.0;

// Gleicher Wert wie SCHWELLE_KONFIDENZ_BETRAG in server/mistral.js - reiner
// Warnhinweis hier, kein Blocker, siehe Kommentar am Einsatzort.
const SCHWELLE_KONFIDENZ_BETRAG = 85;

// Vereinfachung gegenueber dem Redesign-Konzept ("1 Werktag"): reine
// 24-Stunden-Schwelle statt Wochenend-/Feiertagslogik - fuer einen
// nicht blockierenden Hinweis ist der Zusatzaufwand einer echten
// Werktagsberechnung nicht gerechtfertigt (siehe KONTEXT.md).
const GUTHABEN_ALTER_WARNUNG_STUNDEN = 24;

function berechnePfaendbarenBetragVorschau(guthaben, istPKonto, freibetragErhoehung) {
  if (guthaben === "" || guthaben == null) return null;
  const g = Number(guthaben);
  if (!istPKonto) return Math.max(0, g);
  const freibetrag = P_KONTO_GRUNDFREIBETRAG_EUR + (Number(freibetragErhoehung) || 0);
  return Math.max(0, Math.round((g - freibetrag) * 100) / 100);
}

const eur = (n) => (n == null ? "—" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
const datumUhrzeit = (iso) => new Date(iso).toLocaleString("de-DE");

function guthabenAlterStunden(guthabenErfasstAm) {
  if (!guthabenErfasstAm) return null;
  return (Date.now() - new Date(guthabenErfasstAm).getTime()) / 3_600_000;
}

export default function PfaendungErweiterung({ fallId, onFallGeaendert }) {
  const [erw, setErw] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState(null);
  const [speichertErw, setSpeichertErw] = useState(false);
  const [erzeugtErklaerung, setErzeugtErklaerung] = useState(false);
  const [gibtFrei, setGibtFrei] = useState(false);
  const [freigebenName, setFreigebenName] = useState("");
  const [vierAugenWarnung, setVierAugenWarnung] = useState(null);
  const [versendetVon, setVersendetVon] = useState("");
  const [bestaetigtVersand, setBestaetigtVersand] = useState(false);
  const [zeigtModal, setZeigtModal] = useState(false);
  const [lehntAb, setLehntAb] = useState(false);

  const [istPKonto, setIstPKonto] = useState(false);
  // Tri-State getrennt von istPKonto: "noch nicht geprueft" ist ein
  // eigener Zustand, nicht dasselbe wie "geprueft, kein P-Konto" (Code-
  // Review-Fund 2026-08-27 - siehe Kommentar in server/db.js).
  const [pKontoGeprueft, setPKontoGeprueft] = useState(false);
  const [freibetragErhoehung, setFreibetragErhoehung] = useState("");
  const [guthaben, setGuthaben] = useState("");
  const [guthabenErfasstVon, setGuthabenErfasstVon] = useState("");

  useEffect(() => {
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);
    erweiterungLaden(fallId)
      .then((f) => {
        if (abgebrochen) return;
        setErw(f);
        setIstPKonto(!!f.ist_p_konto);
        setPKontoGeprueft(!!f.p_konto_geprueft);
        setFreibetragErhoehung(f.p_konto_freibetrag_erhoehung && Number(f.p_konto_freibetrag_erhoehung) !== 0 ? String(f.p_konto_freibetrag_erhoehung) : "");
        setGuthaben(f.guthaben_eur != null ? String(f.guthaben_eur) : "");
        setGuthabenErfasstVon(f.guthaben_erfasst_von || "");
      })
      .catch((e) => !abgebrochen && setFehler(String(e.message || e)))
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
  }, [fallId]);

  useEffect(() => {
    if (!zeigtModal) return;
    function aufEscape(e) {
      if (e.key === "Escape") setZeigtModal(false);
    }
    window.addEventListener("keydown", aufEscape);
    return () => window.removeEventListener("keydown", aufEscape);
  }, [zeigtModal]);

  // Gibt { ok, p_konto_benachrichtigung_ausgeloest } statt eines rohen
  // Booleans zurueck - vorher war "false" doppeldeutig zwischen "Speichern
  // fehlgeschlagen" und "erfolgreich gespeichert, nur keine Benachrichtigung
  // ausgeloest", wodurch erklaerungErstellen() einen fehlgeschlagenen
  // Speicherversuch nicht von einem erfolgreichen unterscheiden konnte.
  async function speichern() {
    setSpeichertErw(true);
    setFehler(null);
    try {
      const { erweiterung, p_konto_benachrichtigung_ausgeloest } = await erweiterungSpeichern(fallId, {
        istPKonto,
        freibetragErhoehungEur: freibetragErhoehung === "" ? null : Number(freibetragErhoehung),
        guthabenEur: guthaben === "" ? null : Number(guthaben),
        guthabenErfasstVon: guthabenErfasstVon.trim() === "" ? null : guthabenErfasstVon.trim(),
        pKontoGeprueft,
      });
      setErw(erweiterung);
      return { ok: true, p_konto_benachrichtigung_ausgeloest };
    } catch (e) {
      setFehler(String(e.message || e));
      return { ok: false, p_konto_benachrichtigung_ausgeloest: false };
    } finally {
      setSpeichertErw(false);
    }
  }

  async function erklaerungErstellen() {
    setErzeugtErklaerung(true);
    setFehler(null);
    setVierAugenWarnung(null);
    try {
      const { ok } = await speichern();
      // Ohne diesen Check wuerde bei einem fehlgeschlagenen Speichern (z.B.
      // Netzwerkfehler) trotzdem eine Erklaerung erzeugt - aber auf Basis
      // des zuletzt GESPEICHERTEN, nicht des gerade eingegebenen Guthabens,
      // ohne dass das aus der generischen Fehlermeldung ersichtlich waere.
      if (!ok) return; // finally unten setzt erzeugtErklaerung zurueck
      const text = await erklaerungErzeugen(fallId);
      setErw((vorher) => ({
        ...vorher,
        erklaerung_text: text,
        erklaerung_freigegeben_von: null,
        erklaerung_freigegeben_am: null,
        erklaerung_versendet_von: null,
        erklaerung_versendet_am: null,
      }));
      setFreigebenName("");
      setVersendetVon("");
      setZeigtModal(true);
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setErzeugtErklaerung(false);
    }
  }

  async function freigeben(vierAugenBestaetigt = false) {
    if (!freigebenName.trim()) return;
    setGibtFrei(true);
    setFehler(null);
    try {
      const ergebnis = await erklaerungFreigeben(fallId, freigebenName.trim(), vierAugenBestaetigt);
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

  // Macht den bisher stillen Geprueft-Reset aus erklaerungErstellen()/
  // speichereErklaerung() zu einer expliziten, protokollierten Entscheidung -
  // fuer den Fall, dass die erzeugte Erklaerung inhaltlich nicht stimmt und
  // NICHT freigegeben werden soll. Der Erklaerungstext bleibt erhalten
  // (Modal schliesst sich, "Erklärung anzeigen" fuehrt zur selben Fassung
  // zurueck) - Ablehnung heisst hier "nicht in dieser Form versenden", nicht
  // "Text loeschen". Serverseitig ohnehin nicht mehr moeglich, sobald der
  // Versand schon bestaetigt wurde.
  async function ablehnen() {
    setLehntAb(true);
    setFehler(null);
    try {
      const erweiterung = await erklaerungAblehnen(fallId);
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

  async function versandBestaetigen() {
    if (!versendetVon.trim()) return;
    setBestaetigtVersand(true);
    setFehler(null);
    try {
      const erweiterung = await erklaerungVersenden(fallId, versendetVon.trim());
      setErw(erweiterung);
      onFallGeaendert?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setBestaetigtVersand(false);
    }
  }

  if (laedt) return <p className="ladeindikator">Erweiterung wird geladen …</p>;
  if (!erw) return <p className="fehlerbanner">{fehler || "Fall nicht gefunden."}</p>;

  const pfaendbarVorschau = berechnePfaendbarenBetragVorschau(guthaben, istPKonto, freibetragErhoehung);
  const istFreigegeben = !!erw.erklaerung_freigegeben_am;
  const istVersendet = !!erw.erklaerung_versendet_am;

  const konfidenzWarnung =
    erw.konfidenz_betrag != null && erw.konfidenz_betrag < SCHWELLE_KONFIDENZ_BETRAG
      ? `Forderungsbetrag wurde mit geringer Konfidenz erkannt (${erw.konfidenz_betrag} %). Vor Freigabe gegen das Originaldokument prüfen.`
      : null;
  const guthabenAlter = guthabenAlterStunden(erw.guthaben_erfasst_am);
  const altersWarnung =
    guthabenAlter != null && guthabenAlter > GUTHABEN_ALTER_WARNUNG_STUNDEN
      ? `Guthaben wurde vor ${Math.floor(guthabenAlter / 24) >= 1 ? `${Math.floor(guthabenAlter / 24)} Tag(en)` : `${Math.round(guthabenAlter)} Stunden`} erfasst. Aktuellen Kontostand vor Erzeugung prüfen.`
      : null;

  return (
    <div className="erweiterung">
      {fehler && <p className="fehlerbanner">{fehler}</p>}

      <div className="eingangsform">
        <div className="feld">
          <label>P-Konto-Status</label>
          <div className="pkonto-status">
            {!pKontoGeprueft && (
              <label className="pkonto-status__ungeprueft">
                <input type="radio" name={`pkonto-${fallId}`} checked readOnly disabled /> Noch nicht geprüft
              </label>
            )}
            <label>
              <input
                type="radio"
                name={`pkonto-${fallId}`}
                checked={pKontoGeprueft && !istPKonto}
                onChange={() => {
                  setIstPKonto(false);
                  setPKontoGeprueft(true);
                }}
              />{" "}
              Kein P-Konto
            </label>
            <label>
              <input
                type="radio"
                name={`pkonto-${fallId}`}
                checked={pKontoGeprueft && istPKonto}
                onChange={() => {
                  setIstPKonto(true);
                  setPKontoGeprueft(true);
                }}
              />{" "}
              P-Konto vorhanden
            </label>
          </div>
        </div>
        {istPKonto && (
          <div className="feld feld--optional">
            <label>Freibetrag-Erhöhung (Bescheinigung)</label>
            <input
              type="number"
              step="0.01"
              value={freibetragErhoehung}
              onChange={(e) => setFreibetragErhoehung(e.target.value)}
              placeholder="0,00"
            />
          </div>
        )}
        <div className="feld">
          <label>Guthaben (EUR)</label>
          <input type="number" step="0.01" value={guthaben} onChange={(e) => setGuthaben(e.target.value)} placeholder="0,00" />
        </div>
        <div className="feld feld--optional">
          <label>Erfasst von</label>
          <input
            type="text"
            value={guthabenErfasstVon}
            onChange={(e) => setGuthabenErfasstVon(e.target.value)}
            placeholder="Kürzel/E-Mail"
          />
        </div>
        <div className="feld">
          <label>Forderung (EUR)</label>
          <input type="text" value={erw.forderung_gesamt_eur != null ? eur(Number(erw.forderung_gesamt_eur)) : "aus Klassifikation"} disabled />
        </div>
      </div>

      <p className="erweiterung__vorschau">
        Pfändbarer Betrag (Vorschau): <strong>{eur(pfaendbarVorschau)}</strong>
        {istPKonto && <span className="erweiterung__hinweis"> — P-Konto-Freibetrag {eur(P_KONTO_GRUNDFREIBETRAG_EUR + (Number(freibetragErhoehung) || 0))}</span>}
      </p>

      {erw.p_konto_benachrichtigt_am && (
        <p className="hinweis-batch">
          <strong>P-Konto-Benachrichtigung ausgelöst</strong> am {new Date(erw.p_konto_benachrichtigt_am).toLocaleString("de-DE")}.
        </p>
      )}

      <div className="erweiterung__aktionen">
        <button className="nav-tabs__btn" onClick={speichern} disabled={speichertErw}>
          {speichertErw ? "Speichert …" : "Speichern"}
        </button>
        <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={erklaerungErstellen} disabled={erzeugtErklaerung || guthaben === ""}>
          {erzeugtErklaerung ? "Erzeugt …" : "Drittschuldnererklärung erzeugen"}
        </button>
        {erw.erklaerung_text && (
          <button className="nav-tabs__btn" onClick={() => setZeigtModal(true)}>
            Erklärung anzeigen
          </button>
        )}
      </div>

      {konfidenzWarnung && <p className="erweiterung__warnhinweis">{konfidenzWarnung}</p>}
      {altersWarnung && <p className="erweiterung__warnhinweis">{altersWarnung}</p>}

      {erw.erklaerung_text && zeigtModal && (
        <div className="erweiterung__modal-overlay" onClick={() => setZeigtModal(false)}>
          <div className="erweiterung__modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="erweiterung__modal-kopf">
              <h3>Drittschuldnererklärung — {fallId}</h3>
              <button className="erweiterung__modal-schliessen" onClick={() => setZeigtModal(false)} aria-label="Schließen">
                ×
              </button>
            </div>

            <div className="erweiterung__erklaerung">
              <textarea readOnly value={erw.erklaerung_text} rows={14} />

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
                    placeholder="Kürzel/E-Mail zur Freigabe"
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
                    <strong>Freigegeben</strong> von {erw.erklaerung_freigegeben_von} am {datumUhrzeit(erw.erklaerung_freigegeben_am)}.
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
                  <strong>Versendet</strong> von {erw.erklaerung_versendet_von} am {datumUhrzeit(erw.erklaerung_versendet_am)}
                  {" "}(freigegeben von {erw.erklaerung_freigegeben_von} am {datumUhrzeit(erw.erklaerung_freigegeben_am)}).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
