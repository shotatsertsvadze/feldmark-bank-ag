// Feste Hex-Werte statt CSS-Variablen: SVG-<marker>-Kinder erben var() nicht
// zuverlaessig ueber alle Browser hinweg (kein context-stroke), darum hier
// bewusst dieselben Werte wie in index.css :root dupliziert statt referenziert.
const FARBE = {
  brand: "#16324a",
  brandDeep: "#0b1e30",
  brass: "#a97d3a",
  ochre: "#855511",
  slate: "#35516d",
  oxblood: "#7a2727",
  moss: "#285339",
  ink: "#101a26",
  inkSoft: "#48586a",
  surface: "#ffffff",
  line: "#cdd3c6",
};

function Box({ x, y, w, h, titel, untertitel, rand = FARBE.brand, fuellung = FARBE.surface, textFarbe, untertitelFarbe }) {
  const titelFarbe = textFarbe || FARBE.ink;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill={fuellung} stroke={rand} strokeWidth="1.6" />
      <text x={x + w / 2} y={y + h / 2 + (untertitel ? -6 : 5)} textAnchor="middle" fontFamily="'Source Serif 4', Georgia, serif" fontWeight="600" fontSize="15" fill={titelFarbe}>
        {titel}
      </text>
      {untertitel && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10.5" fill={untertitelFarbe || FARBE.inkSoft}>
          {untertitel}
        </text>
      )}
    </g>
  );
}

function Pfeil({ punkte, farbe = FARBE.line, gestrichelt = false }) {
  return (
    <polyline
      points={punkte}
      fill="none"
      stroke={farbe}
      strokeWidth="1.6"
      strokeDasharray={gestrichelt ? "4 3" : undefined}
      markerEnd="url(#pfeilspitze)"
    />
  );
}

const CHIPS = [
  { label: "Erinnerung 1", farbe: FARBE.slate },
  { label: "Erinnerung 2", farbe: FARBE.ochre },
  { label: "Eskalation", farbe: FARBE.oxblood },
  { label: "Fristversäumnis", farbe: FARBE.oxblood },
];

/**
 * Zeigt den kompletten Weg eines Schreibens durch das System als
 * Flussdiagramm - was in Postgres/Supabase und n8n "hinter den Kulissen"
 * passiert, ohne dass man dafuer in beide Systeme wechseln muss. Rein
 * erklaerend (kein Live-Status - den liefert SweepStatus.jsx), darum eine
 * eigene, statische Ansicht statt Teil der Fallübersicht.
 */
export default function Prozessdiagramm() {
  return (
    <section className="view">
      <h2 className="view-title">Prozess</h2>
      <p className="view-lede">
        Der Weg eines Schreibens durch das System — von der Poststelle bis zur täglichen Fristüberwachung.
        Zwei Systeme arbeiten dabei im Hintergrund: <strong>Supabase</strong> (Postgres) als alleinige
        Datenquelle für App und Automatisierung gemeinsam, und <strong>n8n</strong> als der Motor, der die
        Fristüberwachung jeden Morgen ohne menschliches Zutun durchgeht.
      </p>

      <div className="panel">
        <div className="panel__body prozess__wrapper">
          <svg viewBox="0 0 640 800" className="prozess__svg" role="img" aria-label="Ablaufdiagramm: Posteingang bis Fristüberwachung">
            <defs>
              <marker id="pfeilspitze" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 Z" fill={FARBE.line} />
              </marker>
            </defs>

            {/* 1 Posteingang */}
            <Box x={100} y={16} w={440} h={62} titel="Posteingang" untertitel="Papier · eBO · E-Mail · Fax" />
            <Pfeil punkte="320,78 320,106" />

            {/* 2 OCR */}
            <Box x={100} y={106} w={440} h={62} titel="OCR" untertitel="Mistral liest den Dokumenttext" />
            <Pfeil punkte="320,168 320,196" />

            {/* 3 Klassifikation */}
            <Box x={100} y={196} w={440} h={62} titel="Klassifikation & Extraktion" untertitel="ein KI-Aufruf: Typ + Felder + Konfidenz" />
            <Pfeil punkte="320,258 320,286" />

            {/* 4 Routing-Entscheidung (Raute) */}
            <polygon points="320,286 462,340 320,394 178,340" fill={FARBE.brass} fillOpacity="0.12" stroke={FARBE.brass} strokeWidth="1.6" />
            <text x="320" y="332" textAnchor="middle" fontFamily="'Source Serif 4', Georgia, serif" fontWeight="600" fontSize="14" fill={FARBE.ink}>
              Konfidenz &amp; Plausibilität
            </text>
            <text x="320" y="350" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10.5" fill={FARBE.inkSoft}>
              ausreichend?
            </text>

            {/* Nein -> Sichtpruefung */}
            <Pfeil punkte="178,340 90,340 90,380" />
            <text x="128" y="332" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill={FARBE.ochre}>
              nein / unsicher
            </text>
            <Box x={20} y={380} w={280} h={60} titel="Sichtprüfung" untertitel="Mensch korrigiert & übernimmt — oder verwirft" rand={FARBE.ochre} fuellung="#f2e3c4" />
            <Pfeil punkte="160,440 160,500 320,500" />

            {/* Ja -> direkt runter */}
            <Pfeil punkte="320,394 320,500" />
            <text x="336" y="380" fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill={FARBE.moss}>
              ja
            </text>

            <Pfeil punkte="320,500 320,540" />

            {/* 6 Fallakte / Supabase */}
            <Box x={100} y={540} w={440} h={62} titel="Fallakte" untertitel="Supabase · Postgres, Schema »feldmark«" rand={FARBE.slate} fuellung="#dde5ea" />
            <Pfeil punkte="320,602 320,630" />

            {/* 7 Fristueberwachung / n8n */}
            <Box
              x={100}
              y={630}
              w={440}
              h={64}
              titel="Fristüberwachung"
              untertitel="n8n · täglich 07:00 & 07:15 Uhr"
              rand={FARBE.brand}
              fuellung={FARBE.brand}
              textFarbe="#ffffff"
              untertitelFarbe="#c9d4dc"
            />
            <Pfeil punkte="320,694 320,722" />

            {/* 8 Terminal-Chips */}
            {CHIPS.map((c, i) => {
              const w = 100;
              const gap = 13.3;
              const x = 100 + i * (w + gap);
              return (
                <g key={c.label}>
                  <rect x={x} y={730} width={w} height={36} rx="18" fill={c.farbe} fillOpacity="0.12" stroke={c.farbe} strokeWidth="1.3" />
                  <text x={x + w / 2} y={752} textAnchor="middle" fontFamily="'IBM Plex Sans', sans-serif" fontWeight="600" fontSize="10.5" fill={c.farbe}>
                    {c.label}
                  </text>
                </g>
              );
            })}
            <text x="320" y="784" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill={FARBE.inkSoft}>
              genau eine Aktion pro Fall und Tag, oder keine
            </text>
          </svg>
        </div>
      </div>

      <div className="panel">
        <div className="panel__body prozess__notizen">
          <div className="prozess__notiz">
            <p className="prozess__notiz-titel">Warum ein Mensch dazwischensteht</p>
            <p>
              Nicht jedes Schreiben wird automatisch zum Fall — bei niedriger Konfidenz, unplausiblen
              Feldern oder fehlenden Pflichtangaben geht es bewusst in die Sichtprüfung statt blind
              durchzulaufen. Das ist der Kern des Routings: die KI übernimmt die eindeutigen Fälle, ein
              Mensch die unsicheren.
            </p>
          </div>
          <div className="prozess__notiz">
            <p className="prozess__notiz-titel">Warum n8n und nicht die App selbst</p>
            <p>
              Die Fristüberwachung läuft unabhängig davon, ob die App gerade läuft — n8n verbindet sich
              direkt mit Supabase und arbeitet die offenen Fälle jeden Morgen automatisch ab, mit
              Idempotenz-Sperre gegen doppelte Erinnerungen.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
