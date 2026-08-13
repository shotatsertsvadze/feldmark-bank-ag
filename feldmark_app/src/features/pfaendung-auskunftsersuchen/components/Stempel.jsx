/**
 * Der Eingangsstempel als wiederkehrendes Signaturelement - nicht
 * Dekoration, sondern eine Anspielung auf die wichtigste fachliche Regel
 * im ganzen Projekt: das Zustelldatum kommt aus einem echten Stempel,
 * nie aus dem Dokumenttext oder vom Modell erfunden (siehe
 * klassifikations_schema.md). Jeder Stempel hier zeigt eine echte
 * Systementscheidung, kein Platzhalter.
 */
export default function Stempel({ typLabel, wert, farbe = "ink", animiert = false }) {
  return (
    <div className={`stempel stempel--${farbe}${animiert ? " stempel--animiert" : ""}`} aria-hidden="true">
      <span className="stempel__typ">{typLabel}</span>
      <span className="stempel__wert">{wert}</span>
    </div>
  );
}
