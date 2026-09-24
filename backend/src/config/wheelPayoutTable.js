// backend/src/config/wheelPayoutTable.js

const WHEEL_PAYOUT_TABLE = {
  low: {
    10: [
      { multiplier: 0.0, weight: 2, color: "#406C82" },
      { multiplier: 1.2, weight: 7, color: "#D5E8F2" },
      { multiplier: 1.5, weight: 1, color: "#00E403" },
    ],
    20: [
      { multiplier: 0.0, weight: 4, color: "#406C82" },
      { multiplier: 1.2, weight: 14, color: "#D5E8F2" },
      { multiplier: 1.5, weight: 2, color: "#00E403" },
    ],
    30: [
      { multiplier: 0.0, weight: 6, color: "#406C82" },
      { multiplier: 1.2, weight: 21, color: "#D5E8F2" },
      { multiplier: 1.5, weight: 3, color: "#00E403" },
    ],
    40: [
      { multiplier: 0.0, weight: 8, color: "#406C82" },
      { multiplier: 1.2, weight: 28, color: "#D5E8F2" },
      { multiplier: 1.5, weight: 4, color: "#00E403" },
    ],
    50: [
      { multiplier: 0.0, weight: 10, color: "#406C82" },
      { multiplier: 1.2, weight: 35, color: "#D5E8F2" },
      { multiplier: 1.5, weight: 5, color: "#00E403" },
    ],
  },

  medium: {
    10: [
      { multiplier: 0.0, weight: 5, color: "#406C82" },
      { multiplier: 1.5, weight: 2, color: "#00E403" },
      { multiplier: 1.9, weight: 1, color: "#D5E8F2" },
      { multiplier: 2.0, weight: 1, color: "#FDE905" },
      { multiplier: 3.0, weight: 1, color: "#7F46FD" },
    ],
    20: [
      { multiplier: 0.0, weight: 10, color: "#406C82" },
      { multiplier: 1.5, weight: 2, color: "#00E403" },
      { multiplier: 1.8, weight: 1, color: "#D5E8F2" },
      { multiplier: 2.0, weight: 6, color: "#FDE905" },
      { multiplier: 3.0, weight: 1, color: "#7F46FD" },
    ],
    30: [
      { multiplier: 0.0, weight: 15, color: "#406C82" },
      { multiplier: 1.5, weight: 6, color: "#00E403" },
      { multiplier: 1.7, weight: 1, color: "#D5E8F2" },
      { multiplier: 2.0, weight: 6, color: "#FDE905" },
      { multiplier: 3.0, weight: 1, color: "#7F46FD" },
      { multiplier: 4.0, weight: 1, color: "#FCA32F" },
    ],
    40: [
      { multiplier: 0.0, weight: 20, color: "#406C82" },
      { multiplier: 1.5, weight: 8, color: "#00E403" },
      { multiplier: 1.6, weight: 1, color: "#D5E8F2" },
      { multiplier: 2.0, weight: 7, color: "#FDE905" },
      { multiplier: 3.0, weight: 4, color: "#7F46FD" },
    ],
    50: [
      { multiplier: 0.0, weight: 25, color: "#406C82" },
      { multiplier: 1.5, weight: 13, color: "#00E403" },
      { multiplier: 2.0, weight: 8, color: "#D5E8F2" },
      { multiplier: 3.0, weight: 3, color: "#FDE905" },
      { multiplier: 5.0, weight: 1, color: "#007BFF" },
    ],
  },

  high: {
    10: [
      { multiplier: 0.0, weight: 9, color: "#406C82" },
      { multiplier: 9.9, weight: 1, color: "#FC1144" },
    ],
    20: [
      { multiplier: 0.0, weight: 19, color: "#406C82" },
      { multiplier: 19.8, weight: 1, color: "#FC1144" },
    ],
    30: [
      { multiplier: 0.0, weight: 29, color: "#406C82" },
      { multiplier: 29.7, weight: 1, color: "#FC1144" },
    ],
    40: [
      { multiplier: 0.0, weight: 39, color: "#406C82" },
      { multiplier: 36.6, weight: 1, color: "#FC1144" },
    ],
    50: [
      { multiplier: 0.0, weight: 49, color: "#406C82" },
      { multiplier: 49.5, weight: 1, color: "#FC1144" },
    ],
  },
};

function getWheelDefinition(riskLevel, segments) {
  const risk = WHEEL_PAYOUT_TABLE[String(riskLevel || "").toLowerCase()];
  if (!risk) throw new Error("Invalid risk level");

  const segCount = Number(segments);
  const defs = risk[segCount];
  if (!defs) throw new Error("Invalid segment count");

  const total = defs.reduce((s, d) => s + (Number(d.weight) || 0), 0);
  if (total !== segCount) {
    throw new Error(`Wheel payout table invalid: weights sum ${total} != segments ${segCount}`);
  }

  return defs;
}

module.exports = { WHEEL_PAYOUT_TABLE, getWheelDefinition };