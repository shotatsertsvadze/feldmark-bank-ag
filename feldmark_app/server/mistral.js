/**
 * Klassifikation und Extraktion eingehender Schreiben ueber die Mistral-API
 * - zwei Schritte, analog belegerkennung/server/mistral.js:
 *
 * 1. OCR (POST /v1/ocr, Modell mistral-ocr-latest) liest das Schreiben
 *    (Bild oder PDF) als Rohtext aus.
 * 2. Klassifikation + Extraktion (POST /v1/chat/completions, JSON-Mode) in
 *    einem Aufruf - kein separater Klassifikations-Schritt vor der
 *    Extraktion, siehe klassifikations_schema.md: das Modell leitet den Typ
 *    ohnehin aus demselben Volltextverstaendnis ab, das auch die Felder
 *    liefert.
 *
 * Schema, System-Prompt und Konfidenz-/Plausibilitaets-Schwellen sind
 * 1:1 aus klassifikations_schema.md uebernommen.
 */

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";
const OCR_MODEL = "mistral-ocr-latest";
const EXTRAKTIONS_MODEL = process.env.MISTRAL_EXTRAKTIONS_MODELL || "mistral-small-latest";

const ERLAUBTE_DOKUMENTTYPEN = [
  "pfaendungsschreiben",
  "auskunftsersuchen",
  "einziehungsverfuegung",
  "ueberweisungsverfuegung",
  "pfaendungserinnerung",
  "auskunftsersuchenerinnerung",
  "sonstiges",
];

function apiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY fehlt in der Umgebung (.env).");
  return key;
}

const TIMEOUT_MS = Number(process.env.MISTRAL_TIMEOUT_MS) || 60000;
// Kurze Pause vor dem Wiederholungsversuch. Ohne sie laeuft der Retry bei
// einem 429 sofort in dasselbe Rate-Limit - am 2026-09-15 genau so gemessen:
// zweiter Versuch nach 127ms, wieder 429.
const RETRY_PAUSE_MS = Number(process.env.MISTRAL_RETRY_PAUSE_MS) || 1500;

/**
 * fetch mit Timeout und genau einem Wiederholungsversuch. Ohne das haengt
 * ein Upload unbegrenzt an einem stehenden API-Aufruf, und ein einzelner
 * 429/5xx kostet das ganze Dokument - bei einem fristgebundenen Schreiben
 * der teuerste Fehlerfall. Bewusst nur EIN Retry und nur bei Fehlern, die
 * erfahrungsgemaess transient sind (Timeout, 429, 5xx); ein 400/401 wird
 * sofort durchgereicht, weil Wiederholen daran nichts aendert.
 */
export async function fetchMitTimeout(url, optionen, beschreibung) {
  for (let versuch = 1; versuch <= 2; versuch++) {
    const abbruch = new AbortController();
    const timer = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
    const start = Date.now();
    try {
      const antwort = await fetch(url, { ...optionen, signal: abbruch.signal });
      if ((antwort.status === 429 || antwort.status >= 500) && versuch === 1) {
        console.error(`[mistral] ${beschreibung}: HTTP ${antwort.status}, Wiederholung in ${RETRY_PAUSE_MS}ms`);
        await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        continue;
      }
      console.error(`[mistral] ${beschreibung}: HTTP ${antwort.status} nach ${Date.now() - start}ms`);
      return antwort;
    } catch (fehler) {
      const istTimeout = fehler.name === "AbortError";
      const grund = istTimeout ? `Timeout nach ${TIMEOUT_MS}ms` : String(fehler.message || fehler);
      if (versuch === 1) {
        console.error(`[mistral] ${beschreibung}: ${grund}, Wiederholung in ${RETRY_PAUSE_MS}ms`);
        await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        continue;
      }
      throw new Error(`${beschreibung} fehlgeschlagen: ${grund}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Ruft die Mistral OCR API fuer ein einzelnes Dokument auf.
 * Unveraendert uebernommen aus belegerkennung - gleiche API, gleicher Bedarf.
 * @param {Buffer} bytes Dateiinhalt.
 * @param {string} mimeType z.B. "image/png" oder "application/pdf".
 * @returns {Promise<{markdown:string, seiten:number, ocr_confidence:{durchschnitt:number,minimum:number}|null}>}
 */
export async function ocrDokument(bytes, mimeType) {
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const document =
    mimeType === "application/pdf"
      ? { type: "document_url", document_url: dataUrl }
      : { type: "image_url", image_url: dataUrl };

  const antwort = await fetchMitTimeout(
    `${MISTRAL_API_BASE}/ocr`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        document,
        confidence_scores_granularity: "word",
      }),
    },
    "OCR"
  );

  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    throw new Error(`Mistral OCR antwortete mit HTTP ${antwort.status}: ${text.slice(0, 500)}`);
  }

  const daten = await antwort.json();
  const seiten = daten.pages || [];
  if (!seiten.length) throw new Error("Mistral OCR lieferte keine Seite zurueck.");

  const markdown = seiten.map((s) => s.markdown || "").join("\n\n---\n\n");

  const confidences = seiten
    .map((s) => s.confidence_scores?.average_page_confidence_score)
    .filter((v) => typeof v === "number");
  const minima = seiten
    .map((s) => s.confidence_scores?.minimum_page_confidence_score)
    .filter((v) => typeof v === "number");

  return {
    markdown,
    seiten: seiten.length,
    ocr_confidence: confidences.length
      ? {
          durchschnitt: Math.round((confidences.reduce((a, v) => a + v, 0) / confidences.length) * 1000) / 10,
          minimum: Math.round(Math.min(...minima) * 1000) / 10,
        }
      : null,
  };
}

const JSON_SCHEMA = `{
  "dokumenttyp": "pfaendungsschreiben | auskunftsersuchen | einziehungsverfuegung | ueberweisungsverfuegung | pfaendungserinnerung | auskunftsersuchenerinnerung | sonstiges",
  "konfidenz_typ": 0,
  "plausibilitaet_ok": true,
  "plausibilitaet_begruendung": "string, 1 Satz",

  "kopf": {
    "ausstellende_stelle": null,
    "aktenzeichen": null,
    "ausstellungsdatum": null,
    "empfaenger_bezeichnung": null,
    "rechtsgrundlage": []
  },

  "pfaendung": {
    "glaeubiger_name": null,
    "glaeubiger_vertretung": null,
    "schuldner_name": null,
    "vollstreckungstitel_aktenzeichen": null,
    "vollstreckungstitel_datum": null,
    "forderung_hauptforderung_eur": null,
    "forderung_zinsen_prozent": null,
    "forderung_kosten_eur": null,
    "forderung_gesamt_eur": null,
    "drittschuldner_bezeichnung": null,
    "konfidenz_betrag": 0
  },

  "auskunftsersuchen": {
    "betroffene_person_name": null,
    "betroffene_person_geburtsdatum": null,
    "tatvorwurf": null,
    "angefragte_punkte": [],
    "antwortfrist_tage": null,
    "vertraulich": false
  },

  "erinnerung": {
    "bezug_aktenzeichen": null,
    "hinweis_text": null
  },

  "rohtext_auszug": "string, erste 300 Zeichen - fuer die Sichtpruefungsmaske bei niedriger Konfidenz"
}`;

const SYSTEM_PROMPT = `Du bist Klassifikations- und Extraktionsassistent im Kontenservice der
Feldmark Bank AG. Du bekommst den vollstaendigen OCR-Text eines eingehenden
Schreibens (Scan oder E-Mail-Anhang).

Aufgabe:
1. Ordne das Dokument genau einem der sieben Typen zu: pfaendungsschreiben,
   auskunftsersuchen, einziehungsverfuegung, ueberweisungsverfuegung,
   pfaendungserinnerung, auskunftsersuchenerinnerung, sonstiges.
   Ein Erinnerungsschreiben ist pfaendungserinnerung, wenn es sich auf
   einen Pfaendungs- und Ueberweisungsbeschluss/eine Kontopfaendung
   bezieht, und auskunftsersuchenerinnerung, wenn es sich auf ein
   behoerdliches Auskunftsersuchen bezieht. Ist das aus dem Text nicht
   eindeutig erkennbar, waehle den Typ, auf den der Text ueberwiegend
   hindeutet - die Zuordnung wird serverseitig zusaetzlich gegen das
   referenzierte Aktenzeichen geprueft, bevor sie uebernommen wird.
2. Fuelle nur die Felder, die zum erkannten Typ gehoeren, aus dem
   JSON-Schema aus.
3. Trage ausschliesslich das ein, was woertlich oder eindeutig im Text
   steht. Erfinde, schaetze oder ergaenze keine Werte. Unklare oder fehlende
   Angaben bleiben null. Fuer kopf.aktenzeichen gilt das besonders streng:
   nimm ausschliesslich den Wert, der direkt einem Label wie "Aktenzeichen:",
   "Az.:" oder "Geschaeftszeichen:" folgt. Steht dort nichts, ist der Wert
   null - nimm niemals eine Ueberschrift, einen Dokumenttitel oder eine
   Paragraphenangabe als Aktenzeichen.
4. Pruefe die Plausibilitaet: Passt der Inhalt wirklich zu einer bankbezogenen
   Vollstreckungs- oder Ermittlungsangelegenheit? Fehlen zentrale Anker
   (Aktenzeichen, Bezug auf ein Konto oder einen Kunden, erkennbare
   Vollstreckungs-/Ermittlungsbehoerde als Absender), setze
   plausibilitaet_ok auf false und dokumenttyp auf sonstiges - auch wenn
   ein Begriff wie "Auskunftsersuchen" im Text vorkommt.
5. Vergib konfidenz_typ und konfidenz_betrag ehrlich und konservativ.
   Ein Wert ueber 90 bedeutet: du bist dir wirklich sicher, nicht nur,
   dass es wahrscheinlich stimmt. Bei Scan-Artefakten, unklarer
   Handschrift oder mehrdeutigen Zahlen: Wert senken, nicht raten.
6. Gib niemals ein Zustelldatum an - dieses Feld existiert absichtlich
   nicht im Schema.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt genau nach diesem Schema
(Werte sind Beispiele fuer den erwarteten Typ, keine Vorgaben):
${JSON_SCHEMA}`;

// Zeichengrenze fuer den Chat-Aufruf. Dokumente darueber werden gekuerzt -
// das Modell sieht dann nicht den ganzen Text, kann das aber nicht wissen
// und meldet fehlende Felder ununterscheidbar von "steht wirklich nicht
// im Dokument". klassifiziereUndExtrahiere() haengt deshalb ein eigenes,
// vom Code (nicht vom Modell) gesetztes wurde_gekuerzt-Flag an, das
// bestimmeRouting() unten fuer Pfaendungsblock und Auskunftsersuchen hart
// auf Sichtpruefung zwingt.
const MAX_MARKDOWN_ZEICHEN = 12000;

/**
 * Klassifiziert und extrahiert in einem Aufruf. Wirft bei ungueltiger
 * Modellantwort statt eine erfundene Struktur zurueckzugeben - analog
 * extrahiereFelder() in belegerkennung.
 * @param {string} markdown OCR-Rohtext.
 * @param {{durchschnitt:number,minimum:number}|null} ocrConfidence Aus
 *   ocrDokument() - wird dem Modell als Kontext mitgegeben, damit eine
 *   objektiv unsichere Zeichenerkennung nicht nur indirekt (ueber
 *   verstuemmelten Text) in die Selbsteinschaetzung einfliesst.
 */
export async function klassifiziereUndExtrahiere(markdown, ocrConfidence = null) {
  const wurdeGekuerzt = markdown.length > MAX_MARKDOWN_ZEICHEN;
  const ocrHinweis = ocrConfidence
    ? `OCR-Gesamtkonfidenz: ${ocrConfidence.durchschnitt}%, Minimum: ${ocrConfidence.minimum}%\n\n---\n\n`
    : "";

  const antwort = await fetchMitTimeout(
    `${MISTRAL_API_BASE}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EXTRAKTIONS_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: ocrHinweis + markdown.slice(0, MAX_MARKDOWN_ZEICHEN) },
        ],
      }),
    },
    "Klassifikation"
  );

  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    throw new Error(`Mistral Chat (Klassifikation) antwortete mit HTTP ${antwort.status}: ${text.slice(0, 500)}`);
  }

  const daten = await antwort.json();
  const inhalt = daten.choices?.[0]?.message?.content;
  if (!inhalt) throw new Error("Mistral Chat lieferte keine Klassifikation zurueck.");

  let klassifikation;
  try {
    klassifikation = JSON.parse(inhalt);
  } catch {
    throw new Error("Mistral Chat lieferte kein gueltiges JSON fuer die Klassifikation.");
  }

  if (!ERLAUBTE_DOKUMENTTYPEN.includes(klassifikation.dokumenttyp)) {
    throw new Error(
      `Mistral Chat lieferte einen unbekannten dokumenttyp: "${klassifikation.dokumenttyp}".`
    );
  }

  // Fehlende Unterbloecke defensiv mit den Schema-Nullwerten auffuellen,
  // falls das Modell einen fuer den Typ nicht relevanten Block ganz
  // wegliess statt ihn (wie im Prompt verlangt) auf null zu lassen.
  klassifikation.kopf ??= {
    ausstellende_stelle: null,
    aktenzeichen: null,
    ausstellungsdatum: null,
    empfaenger_bezeichnung: null,
    rechtsgrundlage: [],
  };
  klassifikation.pfaendung ??= {
    glaeubiger_name: null,
    glaeubiger_vertretung: null,
    schuldner_name: null,
    vollstreckungstitel_aktenzeichen: null,
    vollstreckungstitel_datum: null,
    forderung_hauptforderung_eur: null,
    forderung_zinsen_prozent: null,
    forderung_kosten_eur: null,
    forderung_gesamt_eur: null,
    drittschuldner_bezeichnung: null,
    konfidenz_betrag: 0,
  };
  klassifikation.auskunftsersuchen ??= {
    betroffene_person_name: null,
    betroffene_person_geburtsdatum: null,
    tatvorwurf: null,
    angefragte_punkte: [],
    antwortfrist_tage: null,
    vertraulich: false,
  };
  klassifikation.erinnerung ??= { bezug_aktenzeichen: null, hinweis_text: null };
  klassifikation.wurde_gekuerzt = wurdeGekuerzt;
  // Fail-closed: fehlt konfidenz_typ (Modellantwort weicht vom Schema ab),
  // soll das wie "keine Konfidenz" und nicht wie "Schwelle eingehalten"
  // behandelt werden (undefined < SCHWELLE waere sonst false).
  klassifikation.konfidenz_typ ??= 0;

  return klassifikation;
}

// Konfidenz-Schwellen aus klassifikations_schema.md - Startwerte, noch
// nicht anhand echter Testlaeufe kalibriert (siehe "Offene Punkte" dort).
// SCHWELLE_OCR_KONFIDENZ ist genauso ein ungemessener Startwert und gehoert
// in denselben spaeteren Kalibrierungs-Durchlauf.
const SCHWELLE_KONFIDENZ_TYP = 70;
const SCHWELLE_KONFIDENZ_BETRAG = 85;
const SCHWELLE_OCR_KONFIDENZ = 60;
export const PFAENDUNGSBLOCK_TYPEN = ["pfaendungsschreiben", "einziehungsverfuegung", "ueberweisungsverfuegung"];
export const ERINNERUNG_TYPEN = ["pfaendungserinnerung", "auskunftsersuchenerinnerung"];

// Welche Falltabelle fuer welchen Erinnerungstyp erwartet wird - Grundlage
// fuer den Abgleichs-Check unten (Modell-Zuordnung vs. tatsaechlicher
// Tabellenfund per Aktenzeichen).
const ERWARTETE_TABELLE_ERINNERUNG = {
  pfaendungserinnerung: "feldmark.pfaendung_faelle",
  auskunftsersuchenerinnerung: "feldmark.auskunftsersuchen_faelle",
};

/**
 * Reine Routing-Entscheidung nach der Tabelle in klassifikations_schema.md,
 * erweitert um Regeln aus der Prozessanalyse:
 *  - Wurde der OCR-Text vor dem Chat-Aufruf gekuerzt, koennen Felder im
 *    Pfaendungsblock oder Auskunftsersuchen nicht als "sicher nicht
 *    vorhanden" gelten - Zwang zur Sichtpruefung statt eines stillen
 *    Datenverlusts.
 *  - Eine niedrige OCR-Zeichenerkennungssicherheit (objektives Signal,
 *    unabhaengig von der Modell-Selbsteinschaetzung) erzwingt ebenfalls
 *    Sichtpruefung - genauso wenn gar keine OCR-Konfidenz vorliegt (fail
 *    closed statt die Pruefung stillschweigend zu ueberspringen).
 *
 * Die Erinnerungsschreiben-Regel braucht einen DB-Abgleich - der Aufrufer
 * (server/index.js) fuehrt den vorher aus (findeFallZuAktenzeichen) und
 * uebergibt das volle Ergebnis als erinnerungTreffer. Ohne Treffer wird
 * konservativ auf Sichtpruefung geroutet; bei einem Treffer in der falschen
 * Tabelle (Modell sagt pfaendungserinnerung, Aktenzeichen existiert aber nur
 * in auskunftsersuchen_faelle) ebenso - das ist ein staerkeres
 * Plausibilitaetssignal als vor der Typ-Aufspaltung moeglich war, weil das
 * Modell jetzt einen eigenstaendigen Typ behauptet statt dass der Typ erst
 * durch den Tabellenfund entsteht.
 */
export function bestimmeRouting(
  klassifikation,
  { erinnerungTreffer = null, ocrConfidence = null } = {}
) {
  const gruende = [];
  let pfad = "autofall";

  // ?? 0 statt direktem Vergleich: fehlt konfidenz_typ, soll das wie
  // "keine Konfidenz" wirken (undefined < SCHWELLE waere sonst false und
  // liesse den Fall unbemerkt durch).
  if ((klassifikation.konfidenz_typ ?? 0) < SCHWELLE_KONFIDENZ_TYP) {
    pfad = "sichtpruefung";
    gruende.push(`konfidenz_typ (${klassifikation.konfidenz_typ}) unter Schwelle ${SCHWELLE_KONFIDENZ_TYP}`);
  }
  if (klassifikation.plausibilitaet_ok === false) {
    pfad = "sichtpruefung";
    gruende.push("plausibilitaet_ok = false");
  }
  if (klassifikation.dokumenttyp === "sonstiges") {
    pfad = "sichtpruefung";
    gruende.push("dokumenttyp = sonstiges, nie Autofall");
  }
  if (ERINNERUNG_TYPEN.includes(klassifikation.dokumenttyp)) {
    if (!erinnerungTreffer) {
      pfad = "sichtpruefung";
      gruende.push(`${klassifikation.dokumenttyp}: bezug_aktenzeichen nicht im Bestand auffindbar`);
    } else if (erinnerungTreffer.tabelle !== ERWARTETE_TABELLE_ERINNERUNG[klassifikation.dokumenttyp]) {
      pfad = "sichtpruefung";
      gruende.push(
        `${klassifikation.dokumenttyp}: Aktenzeichen gefunden, aber in ${erinnerungTreffer.tabelle} statt im erwarteten ${ERWARTETE_TABELLE_ERINNERUNG[klassifikation.dokumenttyp]} - Typzuordnung unsicher`
      );
    }
  }
  if (
    klassifikation.wurde_gekuerzt &&
    (PFAENDUNGSBLOCK_TYPEN.includes(klassifikation.dokumenttyp) || klassifikation.dokumenttyp === "auskunftsersuchen")
  ) {
    pfad = "sichtpruefung";
    gruende.push("Dokument wurde vor der Klassifikation gekuerzt - fehlende Felder nicht verlaesslich");
  }
  if (!ocrConfidence) {
    pfad = "sichtpruefung";
    gruende.push("keine OCR-Konfidenz verfuegbar - Qualitaet des Texts nicht einschaetzbar");
  } else if (ocrConfidence.minimum < SCHWELLE_OCR_KONFIDENZ) {
    pfad = "sichtpruefung";
    gruende.push(`ocr_confidence.minimum (${ocrConfidence.minimum}) unter Schwelle ${SCHWELLE_OCR_KONFIDENZ}`);
  }

  const vierAugenErforderlich =
    PFAENDUNGSBLOCK_TYPEN.includes(klassifikation.dokumenttyp) &&
    (klassifikation.pfaendung?.konfidenz_betrag ?? 0) < SCHWELLE_KONFIDENZ_BETRAG;
  if (vierAugenErforderlich) {
    gruende.push(
      `konfidenz_betrag (${klassifikation.pfaendung?.konfidenz_betrag}) unter Schwelle ${SCHWELLE_KONFIDENZ_BETRAG}`
    );
  }

  return { pfad, vier_augen_erforderlich: vierAugenErforderlich, gruende };
}
