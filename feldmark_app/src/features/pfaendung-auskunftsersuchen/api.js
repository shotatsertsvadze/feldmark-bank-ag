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
