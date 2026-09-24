// backend/config/towerPayoutTable.js

/**
 * Dragon Tower payout model:
 * - 4 columns, 1 safe tile per row => p = 1/4
 * - House edge 2% => RTP 98%
 *
 * Multiplier after n safe picks:
 *   multiplier(n) = (1 - houseEdge) / (p^n)
 *
 * This is a clean provably-fair style curve.
 */

const HOUSE_EDGE = 0.2;

// If you later want columns/difficulty to change probability, expand this map.
const DIFFICULTY = {
  easy: { p: 1 / 4 },
  medium: { p: 1 / 4 },
  hard: { p: 1 / 4 },
  expert: { p: 1 / 4 },
  master: { p: 1 / 4 },
};

function getTowerMultiplier(difficulty, stepsCleared) {
  const d = DIFFICULTY[String(difficulty || "easy")];
  if (!d) return null;

  const n = Number(stepsCleared);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return 1.0;

  const mult = (1 - HOUSE_EDGE) / Math.pow(d.p, n);
  return mult;
}

module.exports = { getTowerMultiplier, HOUSE_EDGE };