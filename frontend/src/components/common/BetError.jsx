import { IconWarningCircle } from "./Icons";

/**
 * Inline bet error — red text with a FILLED exclamation-circle icon (the
 * "!" is cut out of the disc), rendered right below the bet amount input.
 * Being in normal flow, it pushes the elements below it down and releases
 * them when it clears. Spacing above/below is identical in every sidebar
 * (see .bet-error in global.css).
 */
export default function BetError({ message }) {
  if (!message) return null;
  return (
    <div className="bet-error" role="alert">
      <IconWarningCircle />
      <span>{message}</span>
    </div>
  );
}
