/**
 * Reine, testbare Entscheidungslogik fuer die taegliche Fristueberwachung -
 * 1:1 die Regel-Engine aus den Code-Nodes "Fristen berechnen (§ 840 ZPO)"
 * (Pfaendung, Workflow Ix9jAYFWgh73fPv9) und "Fristen berechnen (§ 161
 * StPO)" (Auskunftsersuchen, Workflow vAHlgWXDJXIS2cps) in den beiden
 * n8n-Fristueberwachungs-Workflows.
 *
 * n8n kann diesen Server-Code nicht zur Laufzeit importieren (der n8n-
 * Container hat keinen Zugriff auf dieses Repo) - diese Datei ist daher
 * NICHT der tatsaechlich laufende Code, sondern die getestete
 * Referenzimplementierung, gegen die die beiden Code-Nodes von Hand
 * synchron gehalten werden. Bei einer Aenderung hier IMMER auch in beiden
 * Code-Nodes nachziehen (und umgekehrt) - siehe RALPH-PROGRESS.md
 * Iteration 3 fuer den Anlass: die beiden Code-Nodes waren bereits einmal
 * auseinandergelaufen (Auskunftsersuchen fehlte ein Fix, den der
 * Pfaendungs-Node am 2026-08-27 bekommen hatte), genau dieses Risiko soll
 * dieses Modul + seine Tests kuenftig frueher auffangen.
 *
 * RALPH-PROGRESS.md Backlog #3 (Escalation logic) - Timing bewusst NICHT
 * "50% Erinnerung / 75-100% Eskalation" (generische Bauplan-Vorlage),
 * sondern feste Tage-Offsets vor Fristende (siehe VORLAUF_*): Erinnerung 1
 * am Fristbeginn, Erinnerung 2 drei Tage vor Fristende, Eskalation einen
 * Tag vor Fristende. Bewusste, bereits getestete Design-Entscheidung
 * (siehe docs/testmatrix.md Abschnitt E) - nicht versehentlich falsch
 * umgesetzt.
 */

export const VORLAUF_ERINNERUNG_2_TAGE = 3;
export const VORLAUF_ESKALATION_TAGE = 1;

/**
 * Ostersonntag nach der Gauss'schen Osterformel. Basis fuer die vier
 * beweglichen bundeseinheitlichen Feiertage.
 */
function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

/**
 * Bundeseinheitliche Feiertage eines Jahres. Wird berechnet statt gepflegt -
 * eine fest eingetragene Liste galt bis 2026 und haette ab 2027 stillschweigend
 * nur noch Wochenenden erkannt, ein Fristende waere dann faelschlich auf einen
 * Feiertag gefallen. Laendergesetzliche Feiertage (Fronleichnam, Reformationstag
 * usw.) bewusst nicht enthalten: sie gelten nicht bundesweit und der
 * Gerichtsstandort ist hier nicht bekannt.
 */
export function bundesweiteFeiertage(jahr) {
  const ostern = ostersonntag(jahr);
  const relativZuOstern = (tage) => iso(addDays(ostern, tage));
  return [
    `${jahr}-01-01`, // Neujahr
    relativZuOstern(-2), // Karfreitag
    relativZuOstern(1), // Ostermontag
    `${jahr}-05-01`, // Tag der Arbeit
    relativZuOstern(39), // Christi Himmelfahrt
    relativZuOstern(50), // Pfingstmontag
    `${jahr}-10-03`, // Tag der Deutschen Einheit
    `${jahr}-12-25`,
    `${jahr}-12-26`,
  ];
}

/** Feiertage fuer das Jahr eines Datums und das Folgejahr - eine Frist kann
 *  ueber den Jahreswechsel laufen. */
function feiertageUm(datum) {
  const jahr = datum.getUTCFullYear();
  return [...bundesweiteFeiertage(jahr), ...bundesweiteFeiertage(jahr + 1)];
}

function toDate(s) {
  return new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
}
function iso(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function istWerktag(d, feiertage) {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !feiertage.includes(iso(d));
}
function naechsterWerktag(d, feiertage) {
  let x = new Date(d);
  while (!istWerktag(x, feiertage)) x = addDays(x, 1);
  return x;
}
function tageDiff(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function normalisiereGesendet(gesendet) {
  if (typeof gesendet === "string") {
    return gesendet.replace(/[{}"]/g, "").split(",").filter(Boolean);
  }
  return Array.isArray(gesendet) ? gesendet : [];
}

/**
 * @param {object} eingabe
 * @param {string} eingabe.startdatumIso - zustelldatum (Pfaendung) bzw. eingangsdatum (Auskunftsersuchen)
 * @param {number} eingabe.fristTage - fest 14 (Pfaendung) oder pro Fall aus antwortfrist_tage (Auskunftsersuchen)
 * @param {string} eingabe.status - aktueller fall.status
 * @param {string[]} eingabe.statusErledigt - Statuswerte, bei denen die Ueberwachung endet
 * @param {string[]|string} eingabe.erinnerungenGesendet - bereits gesendete Marker
 * @param {Date} [eingabe.heute] - fuer Tests injizierbar, Default = jetzt
 * @param {string[]} [eingabe.feiertage] - Default: berechnete bundesweite
 *   Feiertage des Fristjahres und des Folgejahres
 * @returns {{ aktion: "erinnerung_1"|"erinnerung_2"|"eskalation"|"fristversaeumnis"|"keine", fristende: string, restTage: number, grund: string }}
 */
export function ermittleFristAktion({
  startdatumIso,
  fristTage,
  status,
  statusErledigt,
  erinnerungenGesendet,
  heute = new Date(),
  feiertage = null,
}) {
  const start = toDate(startdatumIso);
  const fristRoh = addDays(start, fristTage);
  const frist = naechsterWerktag(fristRoh, feiertage || feiertageUm(fristRoh));

  const h = new Date(heute);
  h.setUTCHours(0, 0, 0, 0);
  const restTage = tageDiff(frist, h);

  const gesendet = normalisiereGesendet(erinnerungenGesendet);
  const fristende = iso(frist);

  if (statusErledigt.includes(status)) {
    return { aktion: "keine", fristende, restTage, grund: "erledigt" };
  }
  if (restTage < 0) {
    if (!gesendet.includes("fristversaeumnis")) {
      return { aktion: "fristversaeumnis", fristende, restTage, grund: "frist_abgelaufen" };
    }
    return { aktion: "keine", fristende, restTage, grund: "fristversaeumnis_bereits_dokumentiert" };
  }
  if (restTage <= VORLAUF_ESKALATION_TAGE && !gesendet.includes("eskalation")) {
    return { aktion: "eskalation", fristende, restTage, grund: "eskalationsfenster" };
  }
  // Signal-Downgrade-Schutz: ist bereits eskaliert (oder schon Erinnerung 2
  // raus), wird keine niedrigerprioritaere Erinnerung mehr nachgereicht -
  // genau die Bedingung, die im Auskunftsersuchen-Code-Node bis
  // RALPH-PROGRESS.md Iteration 3 gefehlt hat (siehe Modul-Kommentar oben).
  if (restTage <= VORLAUF_ERINNERUNG_2_TAGE && !gesendet.includes("erinnerung_2") && !gesendet.includes("eskalation")) {
    return { aktion: "erinnerung_2", fristende, restTage, grund: "erinnerung_2_fenster" };
  }
  if (!gesendet.includes("erinnerung_1") && !gesendet.includes("erinnerung_2") && !gesendet.includes("eskalation")) {
    return { aktion: "erinnerung_1", fristende, restTage, grund: "fristbeginn" };
  }
  return { aktion: "keine", fristende, restTage, grund: "puffer_bereits_gesendet" };
}
