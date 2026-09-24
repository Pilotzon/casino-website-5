// backend/config/kenoPayoutTable.js
// Keno: 1-40 draw 10
// Difficulty changes payouts (and thus RTP).
// Table format: table[difficulty][picks][hits] = multiplier
//
// Notes:
// - "multiplier" here is TOTAL return multiplier (includes stake).
// - Difficulty keys MUST stay `easy` / `medium` / `high` — those are the exact
//   strings the engine (GameEngine.processKeno / getKenoLadder) and the client
//   accept. A key mismatch silently falls back to `medium` and both
//   difficulties then look identical.
// - Design (per user request: easier = MORE hit counts pay, SMALLER multipliers):
//     * easy   ✱ pays from the lowest hit count, cheapest payout ≈ 1.0–1.75x,
//                top prize ≈ 32x…53k
//     * medium ✱ one hit count fewer, mid multipliers, top prize ≈ 33x…93k
//     * high   ✱ only the high hit counts pay, big multipliers, top ≈ 90x…198k
// - Every row is RTP-checked against the exact hypergeometric hit distribution
//   (see backend/scripts/keno-payout-test.js): no row pays more than ~96% back.

const KENO_PAYOUTS = {
  easy: {
    1: { 1: 3.40 },
    2: { 1: 1.45, 2: 4.60 },
    3: { 1: 1.15, 2: 2.20, 3: 8.20 },
    4: { 2: 2.60, 3: 6.70, 4: 32.00 },
    5: { 2: 1.75, 3: 3.50, 4: 11.20, 5: 66.00 },
    6: { 2: 1.35, 3: 2.20, 4: 5.60, 5: 22.00, 6: 160.00 },
    7: { 2: 1.10, 3: 1.60, 4: 3.40, 5: 10.40, 6: 50.00, 7: 445.00 },
    8: { 2: 1.00, 3: 1.25, 4: 2.30, 5: 5.90, 6: 22.00, 7: 130.00, 8: 1475.00 },
    9: { 3: 1.55, 4: 2.50, 5: 5.60, 6: 17.80, 7: 83.00, 8: 620.00, 9: 9175.00 },
    10: { 3: 1.30, 4: 1.85, 5: 3.70, 6: 10.10, 7: 39.00, 8: 230.00, 9: 2300.00, 10: 52900.00 },
  },

  medium: {
    1: { 1: 3.60 },
    2: { 1: 1.60, 2: 4.90 },
    3: { 2: 5.10, 3: 19.30 },
    4: { 2: 2.70, 3: 6.90, 4: 33.00 },
    5: { 3: 7.90, 4: 25.00, 5: 150.00 },
    6: { 3: 4.40, 4: 11.10, 5: 44.00, 6: 315.00 },
    7: { 3: 2.90, 4: 6.00, 5: 18.70, 6: 90.00, 7: 795.00 },
    8: { 3: 2.10, 4: 3.80, 5: 9.80, 6: 37.00, 7: 220.00, 8: 2425.00 },
    9: { 4: 4.80, 5: 10.60, 6: 34.00, 7: 155.00, 8: 1175.00, 9: 17300.00 },
    10: { 4: 3.30, 5: 6.50, 6: 17.80, 7: 69.00, 8: 405.00, 9: 4050.00, 10: 93100.00 },
  },

  high: {
    1: { 1: 3.80 },
    2: { 2: 16.50 },
    3: { 3: 78.00 },
    4: { 3: 18.90, 4: 90.00 },
    5: { 4: 80.00, 5: 470.00 },
    6: { 4: 29.00, 5: 115.00, 6: 810.00 },
    7: { 4: 13.60, 5: 42.00, 6: 200.00, 7: 1800.00 },
    8: { 4: 7.70, 5: 19.80, 6: 75.00, 7: 445.00, 8: 4925.00 },
    9: { 5: 25.00, 6: 78.00, 7: 360.00, 8: 2700.00, 9: 40200.00 },
    10: { 5: 13.80, 6: 38.00, 7: 145.00, 8: 860.00, 9: 8575.00, 10: 197600.00 },
  },
};

const KENO_DIFFICULTIES = ["easy", "medium", "high"];

function getKenoMultiplier(difficulty, picks, hits) {
  const diff = String(difficulty || "medium").toLowerCase();
  const key = diff === "low" ? "easy" : diff;
  const table = KENO_PAYOUTS[key] || KENO_PAYOUTS.medium;
  const p = Number(picks);
  const h = Number(hits);
  const entry = table?.[p]?.[h];
  return typeof entry === "number" ? entry : 0;
}

module.exports = {
  KENO_PAYOUTS,
  KENO_DIFFICULTIES,
  getKenoMultiplier,
};
