import { useEffect } from "react";

// Schliesst ein Modal per Escape - identisch in PfaendungErweiterung.jsx und
// AuskunftsersuchenErweiterung.jsx gebraucht, deshalb hier einmal statt
// zweimal verdrahtet. setAktiv ist der useState-Setter selbst (stabile
// Identitaet), keine Inline-Arrow-Funktion - sonst haengt der Effekt bei
// jedem Render neu ein/aus statt nur bei einem Wechsel von aktiv.
export function useEscapeKey(aktiv, setAktiv) {
  useEffect(() => {
    if (!aktiv) return;
    function aufEscape(e) {
      if (e.key === "Escape") setAktiv(false);
    }
    window.addEventListener("keydown", aufEscape);
    return () => window.removeEventListener("keydown", aufEscape);
  }, [aktiv, setAktiv]);
}
