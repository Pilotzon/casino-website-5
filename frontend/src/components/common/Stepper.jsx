import { IconPlus, IconMinus } from "./Icons";

/* Vertical +/− stepper — sits flush on the RIGHT edge of a numeric input
   group (same fill/hover/press as the sidebar ½ / 2× split buttons, but
   narrower). Rounded only on the outer-right corners.
     value/onChange: current string|number and setter (receives a string)
     step, min, max, decimals: numeric behaviour
   When disabled the stepper stays mounted (dimmed): its space is reserved
   so disabling it mid-round never shifts the input's layout. */
export default function Stepper({ value, onChange, step = 1, min, max, decimals, disabled = false }) {
  const d = decimals ?? (String(step).split(".")[1]?.length ?? 0);
  const bump = (dir) => {
    if (disabled) return;
    const cur = parseFloat(value);
    let next = (isNaN(cur) ? (min ?? 0) : cur) + dir * step;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(next.toFixed(d));
  };
  return (
    <div className={disabled ? "ui-stepper ui-stepper-disabled" : "ui-stepper"} aria-hidden={disabled ? true : false}>
      <button type="button" onClick={() => bump(1)} aria-label="Increase" tabIndex={-1} disabled={disabled}>
        <IconPlus />
      </button>
      <button type="button" onClick={() => bump(-1)} aria-label="Decrease" tabIndex={-1} disabled={disabled}>
        <IconMinus />
      </button>
    </div>
  );
}
