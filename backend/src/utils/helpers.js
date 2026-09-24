/**
 * Format number to fixed decimal places
 */
function formatNumber(num, decimals = 8) {
  return parseFloat(num.toFixed(decimals));
}

/**
 * Calculate payout with house edge
 */
function calculatePayout(betAmount, multiplier, houseEdge = 0.01) {
  const theoreticalPayout = betAmount * multiplier;
  const edgeAmount = theoreticalPayout * houseEdge;
  return formatNumber(theoreticalPayout - edgeAmount);
}

/**
 * Validate bet amount
 */
function isValidBetAmount(amount, minBet = 0.00000001, maxBet = 1000) {
  if (typeof amount !== "number" || isNaN(amount)) {
    return false;
  }
  return amount >= minBet && amount <= maxBet && amount > 0;
}

/**
 * Get IP address from request
 */
function getIpAddress(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/**
 * Calculate win probability from multiplier
 */
function calculateWinChance(multiplier, houseEdge = 0.01) {
  return formatNumber((1 / multiplier) * (1 - houseEdge) * 100);
}

/**
 * Calculate multiplier from win chance
 */
function calculateMultiplier(winChance, houseEdge = 0.01) {
  return formatNumber(100 / (winChance * (1 - houseEdge)));
}

/**
 * Delay function (for rate limiting)
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random string
 */
function generateRandomString(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Sanitize error message for client
 */
function sanitizeError(error) {
  // Don't expose internal errors to client
  const safeErrors = [
    "Insufficient balance",
    "User not found",
    "Invalid credentials",
    "Game not found",
    "Game is disabled",
    "Bet amount too low",
    "Bet amount too high",
    "Invalid bet",
    "Round not found",
    "Already participating",
    "Bet already resolved",
    "Email already registered",
    "Username already taken",
    "Invalid token",
    "Token expired",
    "Access denied",
    "Admin access required",
    "Owner access required",
  ];

  const message = error.message || "An error occurred";

  // Check if it's a safe error message
  for (const safeError of safeErrors) {
    if (message.includes(safeError)) {
      return message;
    }
  }

  // Return generic error for everything else
  console.error("Internal error:", error);
  return "An error occurred. Please try again.";
}

/**
 * Calculate card value for Blackjack
 */
function getCardValue(card) {
  const v = card?.value ?? card?.r ?? card?.rank;
  if (v === "A") return 11;
  if (["K", "Q", "J"].includes(v)) return 10;
  return parseInt(v);
}

/**
 * Calculate hand total for Blackjack
 */
function calculateHandTotal(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    const value = getCardValue(card);
    total += value;
    if ((card.value ?? card.r ?? card.rank) === "A") aces++;
  }

  // Adjust for aces
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

/**
 * Check if hand is blackjack
 */
function isBlackjack(cards) {
  if (cards.length !== 2) return false;
  const total = calculateHandTotal(cards);
  return total === 21;
}

/**
 * Get roulette number color (European 0-36)
 */
function getRouletteColor(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 0 || n > 36) return "green";
  if (n === 0) return "green";

  const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  return redNumbers.has(n) ? "red" : "black";
}

/**
 * Parse a roulette bet value into list of numbers.
 * Supports: "16-17", "1-2-3", "16-17-19-20", "16,17,19,20"
 */
function parseRouletteNums(value) {
  if (value == null) return [];
  const s = String(value);
  return s
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n));
}

/**
 * Check roulette bet win (UPDATED)
 *
 * Supports NEW API bet shapes:
 * - straight: value = "17"
 * - split/street/corner/sixline: value = "16-17" or "1-2-3" etc
 * - dozen: value = "1" | "2" | "3"
 * - column: value = "1" | "2" | "3"
 * - even: value = "red|black|odd|even|low|high"
 *
 * Also supports legacy bet types:
 * red/black/odd/even/low/high, dozen1..3, column1..3
 */
function checkRouletteBet(number, betType, betValue) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 0 || n > 36) return false;

  const type = String(betType || "").toLowerCase();

  // ---- New format ----
  if (type === "straight") {
    const v = Number(betValue);
    return Number.isInteger(v) && v === n;
  }

  if (type === "split" || type === "street" || type === "corner" || type === "sixline" || type === "line") {
    const nums = parseRouletteNums(betValue);
    return nums.includes(n);
  }

  if (type === "dozen") {
    const d = Number(betValue);
    if (![1, 2, 3].includes(d)) return false;
    if (n === 0) return false;
    if (d === 1) return n >= 1 && n <= 12;
    if (d === 2) return n >= 13 && n <= 24;
    return n >= 25 && n <= 36;
  }

  if (type === "column") {
    const c = Number(betValue);
    if (![1, 2, 3].includes(c)) return false;
    if (n === 0) return false;

    // Column1: 1,4,7..34 => n%3==1
    // Column2: 2,5,8..35 => n%3==2
    // Column3: 3,6,9..36 => n%3==0
    const mod = n % 3;
    if (c === 1) return mod === 1;
    if (c === 2) return mod === 2;
    return mod === 0;
  }

  if (type === "even") {
    const v = String(betValue || "").toLowerCase();
    if (n === 0) return false;

    const color = getRouletteColor(n);
    if (v === "red") return color === "red";
    if (v === "black") return color === "black";
    if (v === "even") return n % 2 === 0;
    if (v === "odd") return n % 2 === 1;
    if (v === "low") return n >= 1 && n <= 18;
    if (v === "high") return n >= 19 && n <= 36;
    return false;
  }

  // ---- Legacy format fallback (keep old clients working) ----
  const color = getRouletteColor(n);

  switch (type) {
    case "red":
      return color === "red";
    case "black":
      return color === "black";
    case "even":
      return n !== 0 && n % 2 === 0;
    case "odd":
      return n !== 0 && n % 2 === 1;
    case "low":
      return n >= 1 && n <= 18;
    case "high":
      return n >= 19 && n <= 36;
    case "dozen1":
      return n >= 1 && n <= 12;
    case "dozen2":
      return n >= 13 && n <= 24;
    case "dozen3":
      return n >= 25 && n <= 36;
    case "column1":
      return n !== 0 && n % 3 === 1;
    case "column2":
      return n !== 0 && n % 3 === 2;
    case "column3":
      return n !== 0 && n % 3 === 0;
    default:
      return false;
  }
}

/**
 * Get roulette bet payout PROFIT multiplier (UPDATED)
 * (Engine pays bet * (payout+1) to include stake)
 */
function getRoulettePayout(betType) {
  const t = String(betType || "").toLowerCase();

  // New format
  const payouts = {
    straight: 35,
    split: 17,
    street: 11,
    corner: 8,
    sixline: 5,

    dozen: 2,
    column: 2,

    even: 1, // red/black/odd/even/low/high

    // Legacy compatibility
    line: 5,
    dozen1: 2,
    dozen2: 2,
    dozen3: 2,
    column1: 2,
    column2: 2,
    column3: 2,
    red: 1,
    black: 1,
    odd: 1,
    low: 1,
    high: 1,
  };

  return payouts[t] ?? 0;
}

module.exports = {
  formatNumber,
  calculatePayout,
  isValidBetAmount,
  getIpAddress,
  calculateWinChance,
  calculateMultiplier,
  delay,
  generateRandomString,
  sanitizeError,
  getCardValue,
  calculateHandTotal,
  isBlackjack,
  getRouletteColor,
  checkRouletteBet,
  getRoulettePayout,
};