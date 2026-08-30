/**
 * Client-seitige Fristanzeige - rein informativ fuer das Dashboard. Die
 * massgebliche Berechnung (inkl. Wochenend-/Feiertagsverschiebung nach
 * § 222 Abs. 2 ZPO) macht ausschliesslich der n8n-Sweep beim Versand von
 * Erinnerungen/Eskalationen. Hier bewusst ohne Feiertagslogik, nur fuer
 * die visuelle Einordnung "wie dringend ist das".
 */

const TAG_MS = 86_400_000;

function heuteOhneZeit() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function berechneFrist(eingangsdatum, antwortfristTage) {
  // Nur die ersten 10 Zeichen (YYYY-MM-DD) verwenden, falls doch mal ein
  // voller ISO-Zeitstempel ankommt - sonst haengt sich die Konkatenation
  // unten auf und ergibt ein Invalid Date (-> NaN).
  const start = new Date(`${String(eingangsdatum).slice(0, 10)}T00:00:00`);
  const fristende = new Date(start.getTime() + antwortfristTage * TAG_MS);
  const restTage = Math.round((fristende.getTime() - heuteOhneZeit().getTime()) / TAG_MS);
  const vergangeneTage = antwortfristTage - restTage;

  let zone = "ok";
  if (restTage < 0) zone = "ueberfaellig";
  else if (restTage <= 1) zone = "kritisch";
  else if (restTage <= 3) zone = "faellig";

  return { fristende, restTage, vergangeneTage, zone };
}

export function formatiereDatum(d) {
  const datum = d instanceof Date ? d : new Date(d);
  return datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Zwei Formatierungen, weil sie tatsaechlich unterschiedlich aussehen sollen
// (Listenzeilen kompakt, Modal-/Verlauf-Zeitstempel vollstaendig) - nicht
// versehentliche Doppelung, siehe jeweilige Verwendungsstellen.
export function formatiereDatumUhrzeit(iso) {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export function formatiereZeitstempel(iso) {
  return new Date(iso).toLocaleString("de-DE");
}
