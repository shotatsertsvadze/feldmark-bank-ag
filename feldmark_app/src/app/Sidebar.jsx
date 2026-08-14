import { NavLink } from "react-router-dom";

const FEATURES = [
  { path: "/pfaendung-auskunftsersuchen", label: "Pfändung & Auskunftsersuchen" },
];

function Siegel() {
  // Grenzstein-Motiv: Feldmark = die Markierung einer Feldgrenze durch einen
  // Grenzstein. Eigenstaendiges Zeichen statt eines generischen Bank-/
  // Saeulen-Icons, direkt aus dem Namen abgeleitet.
  return (
    <svg className="sidebar__seal" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path
        d="M14 27.5V18.5L20 12L26 18.5V27.5H14Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <line x1="10.5" y1="27.5" x2="29.5" y2="27.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="20" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Siegel />
        <div className="sidebar__brand-text">
          <p className="sidebar__brand-name">Feldmark Bank AG</p>
          <p className="sidebar__brand-sub">Digitalisierung &amp; Kontenservice</p>
        </div>
      </div>
      <nav className="sidebar__nav">
        {FEATURES.map((feature) => (
          <NavLink
            key={feature.path}
            to={feature.path}
            className={({ isActive }) =>
              `sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`
            }
          >
            {feature.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
