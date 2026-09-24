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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6zm0 4.3a1.35 1.35 0 0 0-1.35 1.45l.4 5.2a.95.95 0 0 0 1.9 0l.4-5.2A1.35 1.35 0 0 0 12 6.5zm0 9.1a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7z"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}
