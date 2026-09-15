async function json(antwort) {
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(daten.fehler || `Server antwortete mit HTTP ${antwort.status}`);
  return daten;
}

export async function schreibenHochladen(dateien, eingang) {
  const formular = new FormData();
  for (const datei of dateien) formular.append("schreiben", datei);
  for (const [feld, wert] of Object.entries(eingang)) {
    if (wert) formular.append(feld, wert);
  }

  return (await json(await fetch("/api/klassifizieren", { method: "POST", body: formular }))).ergebnisse;
}

export async function faelleLaden() {
  return (await json(await fetch("/api/faelle"))).faelle;
}

export async function sichtpruefungLaden() {
  return (await json(await fetch("/api/sichtpruefung"))).eintraege;
}

// Schliesst die Sichtpruefungs-Schleife: aus dem Warteschlangen-Eintrag
// wird nach menschlicher Korrektur ein echter Fall.
export async function sichtpruefungUebernehmen(id, { korrekturen, eingang, geprueftVon }) {
  return json(
    await fetch(`/api/sichtpruefung/${id}/uebernehmen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ korrekturen, eingang, geprueft_von: geprueftVon }),
    })
  );
}

export async function sichtpruefungVerwerfen(id, { geprueftVon, grund }) {
  return json(
    await fetch(`/api/sichtpruefung/${id}/verwerfen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geprueft_von: geprueftVon, grund }),
    })
  );
}

export async function aktivitaetLaden(limit = 20) {
  return (await json(await fetch(`/api/aktivitaet?limit=${limit}`))).eintraege;
}

export async function sweepStatusLaden() {
  return (await json(await fetch("/api/sweep-status"))).sweeps;
}

export async function protokollLaden(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/protokoll`))).eintraege;
}

export async function erweiterungLaden(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/erweiterung`))).fall;
}

export async function erweiterungSpeichern(
  fallId,
  {
    istPKonto,
    freibetragErhoehungEur,
    guthabenEur,
    guthabenErfasstVon,
    pKontoGeprueft,
    unpfaendbarkeit907Geprueft,
    unpfaendbarkeit907FestgestelltAm,
    gemeinschaftskontoGeprueft,
    istGemeinschaftskonto,
  }
) {
  return json(
    await fetch(`/api/faelle/${fallId}/erweiterung`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ist_p_konto: istPKonto,
        freibetrag_erhoehung_eur: freibetragErhoehungEur,
        guthaben_eur: guthabenEur,
        guthaben_erfasst_von: guthabenErfasstVon,
        p_konto_geprueft: pKontoGeprueft,
        unpfaendbarkeit_907_geprueft: unpfaendbarkeit907Geprueft,
        unpfaendbarkeit_907_festgestellt_am: unpfaendbarkeit907FestgestelltAm,
        gemeinschaftskonto_geprueft: gemeinschaftskontoGeprueft,
        ist_gemeinschaftskonto: istGemeinschaftskonto,
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

export async function erklaerungAblehnen(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/erklaerung/ablehnen`, { method: "POST" }))).erweiterung;
}

export async function auskunftsersuchenErweiterungLaden(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/auskunftsersuchen-erweiterung`))).fall;
}

export async function auskunftsersuchenErweiterungSpeichern(fallId, { freizugebendePunkte, rechtsgrundlageGeprueftVon, antwortWerte }) {
  return (
    await json(
      await fetch(`/api/faelle/${fallId}/auskunftsersuchen-erweiterung`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          freizugebende_punkte: freizugebendePunkte,
          rechtsgrundlage_geprueft_von: rechtsgrundlageGeprueftVon,
          antwort_werte: antwortWerte,
        }),
      })
    )
  ).erweiterung;
}

export async function antwortErzeugen(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/antwort`, { method: "POST" }))).antwort_text;
}

// Gleiches 409-Vier-Augen-Muster wie erklaerungFreigeben().
export async function antwortFreigeben(fallId, freigegebenVon, vierAugenBestaetigt = false) {
  const antwort = await fetch(`/api/faelle/${fallId}/antwort/freigeben`, {
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

export async function antwortVersenden(fallId, versendetVon) {
  return (
    await json(
      await fetch(`/api/faelle/${fallId}/antwort/versenden`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versendet_von: versendetVon }),
      })
    )
  ).erweiterung;
}

export async function antwortAblehnen(fallId) {
  return (await json(await fetch(`/api/faelle/${fallId}/antwort/ablehnen`, { method: "POST" }))).erweiterung;
}

export async function sperreEntscheiden(fallId, { rechtsgrundlageVorhanden, begruendung, entschiedenVon }) {
  return (
    await json(
      await fetch(`/api/faelle/${fallId}/sperre-entscheidung`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rechtsgrundlage_vorhanden: rechtsgrundlageVorhanden,
          begruendung,
          entschieden_von: entschiedenVon,
        }),
      })
    )
  ).erweiterung;
}

// Gibt null zurueck statt zu werfen, wenn kein Datendiskrepanz-Eintrag
// existiert (404 = Normalfall fuer die meisten Faelle, kein Fehler).
export async function datendiskrepanzLaden(fallId) {
  const antwort = await fetch(`/api/faelle/${fallId}/datendiskrepanz`);
  if (antwort.status === 404) return null;
  return (await json(antwort)).datendiskrepanz;
}

export async function datendiskrepanzReaktivieren(fallId, schuldnerName, reaktiviertVon) {
  return (
    await json(
      await fetch(`/api/faelle/${fallId}/datendiskrepanz/reaktivieren`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schuldner_name: schuldnerName, reaktiviert_von: reaktiviertVon }),
      })
    )
  ).datendiskrepanz;
}
