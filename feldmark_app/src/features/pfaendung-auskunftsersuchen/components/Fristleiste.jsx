import { berechneFrist, formatiereDatum } from "../fristlogik.js";

/**
 * Die Fristleiste ist das zweite Signaturelement: eine Lineal-Darstellung
 * der Antwortfrist statt eines generischen Fortschrittsbalkens. Die
 * Markierungen sitzen exakt dort, wo der n8n-Sweep tatsaechlich handelt
 * (Erinnerung 1 am Fristbeginn, Erinnerung 2 drei Tage vor Fristende,
 * Eskalation einen Tag vorher) - die Grafik zeigt also die echte Regel,
 * nicht nur "noch X Tage".
 */
export default function Fristleiste({ eingangsdatum, antwortfristTage, erinnerungenGesendet = [] }) {
  const { fristende, restTage, vergangeneTage, zone } = berechneFrist(eingangsdatum, antwortfristTage);
  const spanne = antwortfristTage + 3;
  const pos = (tag) => `${Math.min(100, Math.max(0, (tag / spanne) * 100))}%`;
  // Eigene, engere Grenze fuer den "heute"-Punkt + sein Text: der Anker darf
  // nicht bis 100% laufen, sonst schiebt der Beschriftungstext (z.B. "3 Tg
  // ueberfaellig") die Zeile ueber den Viewport-Rand hinaus - besonders auf
  // schmalen Bildschirmen. Ticks/Balken duerfen weiterhin bis 100%.
  const posHeute = `${Math.min(80, Math.max(0, (Math.max(0, Math.min(spanne, vergangeneTage)) / spanne) * 100))}%`;

  const marken = [
    { tag: 0, gesendet: erinnerungenGesendet.includes("erinnerung_1"), label: "E1" },
    { tag: antwortfristTage - 3, gesendet: erinnerungenGesendet.includes("erinnerung_2"), label: "E2" },
    { tag: antwortfristTage - 1, gesendet: erinnerungenGesendet.includes("eskalation"), label: "Esk" },
  ];

  return (
    <div className={`fristleiste fall-zeile--${zone}`} title={`Frist endet ${formatiereDatum(fristende)}`}>
      <div className="fristleiste__spur" />
      <div className="fristleiste__gelaufen" style={{ width: pos(Math.max(0, vergangeneTage)) }} />
      {marken.map((m) => (
        <span
          key={m.label}
          className={`fristleiste__marke${m.gesendet ? " fristleiste__marke--erledigt" : ""}`}
          style={{ left: pos(m.tag) }}
          aria-hidden="true"
        />
      ))}
      <span className="fristleiste__heute" style={{ left: posHeute }} aria-hidden="true" />
      <span className="fristleiste__label" style={{ left: posHeute }}>
        {restTage < 0 ? `${Math.abs(restTage)} Tg überfällig` : `noch ${restTage} Tg`}
      </span>
    </div>
  );
}
