/* Vertical +/− stepper — sits flush on the RIGHT edge of a numeric input
   group (same fill/hover/press as the sidebar ½ / 2× split buttons, but
   narrower). Rounded only on the outer-right corners.
     value/onChange: current string|number and setter (receives a string)
     step, min, max, decimals: numeric behaviour                           */
export default function Stepper({ value, onChange, step = 1, min, max, decimals, disabled = false }) {
  const d = decimals ?? (String(step).split(".")[1]?.length ?? 0);
  const bump = (dir) => {
    const cur = parseFloat(value);
    let next = (isNaN(cur) ? (min ?? 0) : cur) + dir * step;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(next.toFixed(d));
  };
  if (disabled) return null;
  return (
    <div className="ui-stepper" aria-hidden="false">
      <button type="button" onClick={() => bump(1)} aria-label="Increase" tabIndex={-1}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 6v12M6 12h12" /></svg>
      </button>
      <button type="button" onClick={() => bump(-1)} aria-label="Decrease" tabIndex={-1}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 12h12" /></svg>
      </button>
    </div>
  );
}
