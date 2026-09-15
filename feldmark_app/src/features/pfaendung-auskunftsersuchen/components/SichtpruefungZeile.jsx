import { useState } from "react";
import { sichtpruefungUebernehmen, sichtpruefungVerwerfen } from "../api.js";
import { DOKUMENTTYP_LABEL, PFAENDUNGSBLOCK_TYPEN } from "../dokumenttypen.js";
import Stempel from "./Stempel.jsx";

// Nur die Typen, aus denen ein Fall entstehen kann - Erinnerungen und
// "sonstiges" gehoeren in den Verwerfen-Pfad bzw. zurueck in den Posteingang.
const FALL_TYPEN = [
  { id: "pfaendungsschreiben", label: "Pfändungsschreiben" },
  { id: "einziehungsverfuegung", label: "Einziehungsverfügung" },
  { id: "ueberweisungsverfuegung", label: "Überweisungsverfügung" },
  { id: "auskunftsersuchen", label: "Auskunftsersuchen" },
];

function heute() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Eine Zeile der Sichtpruefungs-Warteschlange samt der beiden Abschluss-
 * Aktionen. Bis 2026-09-15 war die Warteschlange reine Anzeige - ein
 * Eintrag kam hinein und nie wieder heraus, obwohl das Prozessdiagramm die
 * Schleife "Mensch bestaetigt oder korrigiert -> Fallakte" zeichnet.
 * Die Pflichtfeldpruefung bleibt serverseitig (422), hier wird nur
 * vorbelegt und korrigiert.
 */
export default function SichtpruefungZeile({ eintrag, onAbgeschlossen }) {
  const k = eintrag.klassifikation || {};
  const [offen, setOffen] = useState(false);
  const [modus, setModus] = useState("uebernehmen");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [erfolg, setErfolg] = useState(null);

  const [dokumenttyp, setDokumenttyp] = useState(
    FALL_TYPEN.some((t) => t.id === eintrag.dokumenttyp) ? eintrag.dokumenttyp : "pfaendungsschreiben"
  );
  const [aktenzeichen, setAktenzeichen] = useState(k.kopf?.aktenzeichen || "");
  const [glaeubiger, setGlaeubiger] = useState(k.pfaendung?.glaeubiger_name || "");
  const [schuldner, setSchuldner] = useState(k.pfaendung?.schuldner_name || "");
  const [behoerde, setBehoerde] = useState(k.kopf?.ausstellende_stelle || "");
  const [betroffenePerson, setBetroffenePerson] = useState(k.auskunftsersuchen?.betroffene_person_name || "");
  const [antwortfristTage, setAntwortfristTage] = useState(k.auskunftsersuchen?.antwortfrist_tage ?? 14);
  const [zustelldatum, setZustelldatum] = useState(eintrag.eingangsdatum || heute());
  // Werte identisch zum CHECK auf feldmark.pfaendung_faelle.zustellkanal
  // und zur Auswahl im Posteingang.
  const [zustellkanal, setZustellkanal] = useState("Papier");
  const [bearbeiterEmail, setBearbeiterEmail] = useState("");
  const [geprueftVon, setGeprueftVon] = useState("");
  const [verwurfsgrund, setVerwurfsgrund] = useState("");

  const istPfaendung = PFAENDUNGSBLOCK_TYPEN.includes(dokumenttyp);
  const stempel =
    eintrag.einordnung === "nicht_zugeordnet"
      ? { wert: "Gehört nicht zu diesen Prozessen", farbe: "slate" }
      : eintrag.einordnung === "verarbeitung_fehlgeschlagen"
        ? { wert: "Verarbeitung fehlgeschlagen", farbe: "oxblood" }
        : { wert: "Prüfen", farbe: "ochre" };

  async function uebernehmen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const korrekturen = {
        dokumenttyp,
        kopf: { aktenzeichen: aktenzeichen.trim() || null, ausstellende_stelle: behoerde.trim() || null },
        pfaendung: istPfaendung
          ? { glaeubiger_name: glaeubiger.trim() || null, schuldner_name: schuldner.trim() || null }
          : {},
        auskunftsersuchen: istPfaendung
          ? {}
          : {
              betroffene_person_name: betroffenePerson.trim() || null,
              antwortfrist_tage: Number(antwortfristTage) || 14,
            },
      };
      const ergebnis = await sichtpruefungUebernehmen(eintrag.id, {
        korrekturen,
        eingang: {
          zustelldatum,
          zustellkanal: zustellkanal.trim(),
          bearbeiter_email: bearbeiterEmail.trim(),
        },
        geprueftVon: geprueftVon.trim(),
      });
      setErfolg(`Fall ${ergebnis.fall_id} angelegt.`);
      onAbgeschlossen?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setLaeuft(false);
    }
  }

  async function verwerfen() {
    setLaeuft(true);
    setFehler(null);
    try {
      await sichtpruefungVerwerfen(eintrag.id, { geprueftVon: geprueftVon.trim(), grund: verwurfsgrund.trim() });
      setErfolg("Eintrag verworfen und geschlossen.");
      onAbgeschlossen?.();
    } catch (e) {
      setFehler(String(e.message || e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="sichtpruefung-zeile">
      <div className="sichtpruefung-zeile__stempel">
        <Stempel
          typLabel={DOKUMENTTYP_LABEL[eintrag.dokumenttyp] || eintrag.dokumenttyp}
          wert={stempel.wert}
          farbe={stempel.farbe}
        />
      </div>
      <div className="sichtpruefung-zeile__info">
        <span className="sichtpruefung-zeile__datei">{eintrag.dateiname}</span>
        <p className="sichtpruefung-zeile__begruendung">
          {eintrag.plausibilitaet_begruendung || "Konfidenz unterhalb der Autofall-Schwelle."}
        </p>
        <div className="sichtpruefung-zeile__gruende">
          {eintrag.routing_gruende.map((g, i) => (
            <span className="badge badge--ochre" key={i}>
              {g}
            </span>
          ))}
        </div>

        {erfolg ? (
          <p className="erweiterung__status erweiterung__status--abgeschlossen">{erfolg}</p>
        ) : !offen ? (
          <div className="erweiterung__aktionen">
            <button className="nav-tabs__btn nav-tabs__btn--primary" onClick={() => setOffen(true)}>
              Sichtprüfung abschließen
            </button>
            {eintrag.ansicht_url && (
              <a className="nav-tabs__btn" href={eintrag.ansicht_url} target="_blank" rel="noreferrer">
                Dokument ansehen
              </a>
            )}
          </div>
        ) : (
          <div className="erweiterung">
            <div className="nav-tabs">
              <button
                className={`nav-tabs__btn${modus === "uebernehmen" ? " nav-tabs__btn--primary" : ""}`}
                onClick={() => setModus("uebernehmen")}
              >
                Als Fall übernehmen
              </button>
              <button
                className={`nav-tabs__btn${modus === "verwerfen" ? " nav-tabs__btn--ablehnen" : ""}`}
                onClick={() => setModus("verwerfen")}
              >
                Verwerfen
              </button>
            </div>

            {fehler && <p className="fehlerbanner">{fehler}</p>}

            {modus === "uebernehmen" ? (
              <div className="erweiterung__aktionen erweiterung__aktionen--spalten">
                <label>
                  Dokumenttyp
                  <select value={dokumenttyp} onChange={(e) => setDokumenttyp(e.target.value)}>
                    {FALL_TYPEN.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Aktenzeichen
                  <input type="text" value={aktenzeichen} onChange={(e) => setAktenzeichen(e.target.value)} />
                </label>
                {istPfaendung ? (
                  <>
                    <label>
                      Gläubiger
                      <input type="text" value={glaeubiger} onChange={(e) => setGlaeubiger(e.target.value)} />
                    </label>
                    <label>
                      Schuldner
                      <input type="text" value={schuldner} onChange={(e) => setSchuldner(e.target.value)} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Ausstellende Stelle
                      <input type="text" value={behoerde} onChange={(e) => setBehoerde(e.target.value)} />
                    </label>
                    <label>
                      Betroffene Person
                      <input type="text" value={betroffenePerson} onChange={(e) => setBetroffenePerson(e.target.value)} />
                    </label>
                    <label>
                      Antwortfrist (Tage)
                      <input
                        type="number"
                        min="1"
                        value={antwortfristTage}
                        onChange={(e) => setAntwortfristTage(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label>
                  Zustelldatum (aus Posteingang, nie aus dem Dokument)
                  <input type="date" value={zustelldatum} onChange={(e) => setZustelldatum(e.target.value)} />
                </label>
                <label>
                  Zustellkanal
                  <select value={zustellkanal} onChange={(e) => setZustellkanal(e.target.value)}>
                    <option value="Papier">Papier</option>
                    <option value="eBO">eBO</option>
                    <option value="E-Mail">E-Mail</option>
                    <option value="Fax">Fax</option>
                  </select>
                </label>
                <label>
                  Bearbeiter-E-Mail
                  <input type="email" value={bearbeiterEmail} onChange={(e) => setBearbeiterEmail(e.target.value)} />
                </label>
                <label>
                  Geprüft von (Kürzel/E-Mail)
                  <input type="text" value={geprueftVon} onChange={(e) => setGeprueftVon(e.target.value)} />
                </label>
                <button
                  className="nav-tabs__btn nav-tabs__btn--primary"
                  onClick={uebernehmen}
                  disabled={laeuft || !geprueftVon.trim() || !bearbeiterEmail.trim() || !zustellkanal.trim()}
                >
                  {laeuft ? "Legt an …" : "Fall anlegen"}
                </button>
              </div>
            ) : (
              <div className="erweiterung__aktionen erweiterung__aktionen--spalten">
                <label>
                  Grund
                  <input
                    type="text"
                    placeholder="z. B. Werbeschreiben, kein Vollstreckungsbezug"
                    value={verwurfsgrund}
                    onChange={(e) => setVerwurfsgrund(e.target.value)}
                  />
                </label>
                <label>
                  Geprüft von (Kürzel/E-Mail)
                  <input type="text" value={geprueftVon} onChange={(e) => setGeprueftVon(e.target.value)} />
                </label>
                <button
                  className="nav-tabs__btn nav-tabs__btn--ablehnen"
                  onClick={verwerfen}
                  disabled={laeuft || !geprueftVon.trim() || !verwurfsgrund.trim()}
                >
                  {laeuft ? "Verwirft …" : "Endgültig verwerfen"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
