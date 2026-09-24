export default function DisabledGameStage({ title, message }) {
  const displayTitle = title || "Game is temporarily disabled";
  const displayMessage = message || "The game stage is hidden while we upgrade the experience. Betting is disabled for now.";
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32, textAlign: "center" }}>
      <div>
        <div style={{ fontWeight: 900, fontSize: 20, color: "#ffffff", letterSpacing: 0.2 }}>{displayTitle}</div>
        <div style={{ marginTop: 10, fontSize: 17, fontWeight: 600, color: "var(--color-text-secondary)", maxWidth: 360, lineHeight: 1.4 }}>{displayMessage}</div>
      </div>
    </div>
  );
}
