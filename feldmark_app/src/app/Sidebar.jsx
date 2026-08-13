import { NavLink } from "react-router-dom";

const FEATURES = [
  { path: "/pfaendung-auskunftsersuchen", label: "Pfändung & Auskunftsersuchen" },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <p className="sidebar__brand-name">Feldmark Bank AG</p>
        <p className="sidebar__brand-sub">Digitalisierung &amp; Kontenservice</p>
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
