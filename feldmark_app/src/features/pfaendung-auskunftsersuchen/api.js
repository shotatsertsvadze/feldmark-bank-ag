export async function schreibenHochladen(dateien, eingang) {
  const formular = new FormData();
  for (const datei of dateien) formular.append("schreiben", datei);
  for (const [feld, wert] of Object.entries(eingang)) {
    if (wert) formular.append(feld, wert);
  }

  const antwort = await fetch("/api/klassifizieren", { method: "POST", body: formular });
  if (!antwort.ok) {
    const daten = await antwort.json().catch(() => ({}));
    throw new Error(daten.fehler || `Server antwortete mit HTTP ${antwort.status}`);
  }
  return (await antwort.json()).ergebnisse;
}

export async function faelleLaden() {
  const antwort = await fetch("/api/faelle");
  if (!antwort.ok) throw new Error(`Server antwortete mit HTTP ${antwort.status}`);
  return (await antwort.json()).faelle;
}

export async function sichtpruefungLaden() {
  const antwort = await fetch("/api/sichtpruefung");
  if (!antwort.ok) throw new Error(`Server antwortete mit HTTP ${antwort.status}`);
  return (await antwort.json()).eintraege;
}

async function json(antwort) {
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(daten.fehler || `Server antwortete mit HTTP ${antwort.status}`);
  return daten;
}

export async function erweiterungLaden(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/erweiterung`))).fall;
}

export async function erweiterungSpeichern(fallId, { istPKonto, freibetragErhoehungEur, guthabenEur, guthabenErfasstVon }) {
  return json(
    await fetch(`/api/faelle/${fallId}/erweiterung`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ist_p_konto: istPKonto,
        freibetrag_erhoehung_eur: freibetragErhoehungEur,
        guthaben_eur: guthabenEur,
        guthaben_erfasst_von: guthabenErfasstVon,
      }),
    })
  );
}

export async function erklaerungErzeugen(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/erklaerung`, { method: "POST" }))).erklaerung_text;
}

// Gibt bei Vier-Augen-Konflikt (409) KEINEN Fehler zurueck, sondern ein
// { vierAugenWarnung, meldung } - die UI zeigt dann eine explizite
// Bestaetigung an, statt den generischen Fehlerbanner. Ein direkter
// API-Aufruf ohne Bestaetigung wird server-seitig trotzdem abgelehnt, siehe
// server/index.js.
export async function erklaerungFreigeben(fallId, freigegebenVon, vierAugenBestaetigt = false) {
  const antwort = await fetch(`/api/faelle/${fallId}/erklaerung/freigeben`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ freigegeben_von: freigegebenVon, vier_augen_bestaetigt: vierAugenBestaetigt }),
  });
  const daten = await antwort.json().catch(() => ({}));
  if (antwort.status === 409 && daten.vier_augen_warnung) {
    return { vierAugenWarnung: true, meldung: daten.fehler };
  }
  if (!antwort.ok) throw new Error(daten.fehler || `Server antwortete mit HTTP ${antwort.status}`);
  return { erweiterung: daten.erweiterung };
}

export async function erklaerungVersenden(fallId, versendetVon) {
  return (
    await json(
      await fetch(`/api/faelle/${fallId}/erklaerung/versenden`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versendet_von: versendetVon }),
      })
    )
  ).erweiterung;
}
