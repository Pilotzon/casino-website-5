const crypto = require("crypto");

/**
 * Cryptographically secure random number generator
 * This is the ONLY place in the backend where randomness is generated
 */
class RNG {
  /**
   * Generate a random float between 0 and 1
   */
  static randomFloat() {
    const buffer = crypto.randomBytes(8);
    const value = buffer.readBigUInt64BE(0);
    const denom = 1n << 64n; // exact 2^64
    return Number(value) / Number(denom); // [0,1)
  }

  static randomInt(min, max) {
    const range = max - min + 1;
    return Math.floor(this.randomFloat() * range) + min;
  }

  static randomBool() {
    return this.randomFloat() < 0.5;
  }

  static shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  static pickRandom(array) {
    return array[this.randomInt(0, array.length - 1)];
  }

  static generateSeed() {
    return crypto.randomBytes(32).toString("hex");
  }

  static generateServerSeed() {
    return crypto.randomBytes(32).toString("hex");
  }

  static hashSeed(seed) {
    return crypto.createHash("sha256").update(seed).digest("hex");
  }

  static provablyFairResult(serverSeed, clientSeed, nonce) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHash("sha256").update(combined).digest("hex");
    const value = parseInt(hash.substring(0, 8), 16) / 0xffffffff;
    return value;
  }

  static generateCrashPoint(serverSeed, clientSeed = "", nonce = 0) {
    const hash = crypto
      .createHash("sha256")
      .update(`${serverSeed}:${clientSeed}:${nonce}`)
      .digest("hex");

    const h = parseInt(hash.substring(0, 8), 16);
    const e = Math.pow(2, 32);

    const crashPoint = Math.floor((100 * e - h) / (e - h)) / 100;
    return Math.max(1.0, crashPoint);
  }

  /**
   * Limbo result (crash-style)
   * Higher multipliers are naturally rarer
   */
  static generateLimboResult(houseEdge = 0.01) {
  const r = this.randomFloat(); // [0,1)
  // avoid division by 0
  const rr = Math.max(r, 1e-12);

  // Standard crash/limbo style:
  // P(M >= x) = (1 - houseEdge) / x
  const m = (1 - houseEdge) / rr;

  // floor to 2 decimals (like most sites)
  const rounded = Math.floor(m * 100) / 100;

  return Math.max(1.0, Math.min(1000000, rounded));
}

  static rollDice() {
    return this.randomFloat() * 100;
  }

  static generateMines(gridSize, mineCount) {
    const totalCells = gridSize * gridSize;
    if (mineCount >= totalCells) throw new Error("Too many mines for grid size");
    const positions = Array.from({ length: totalCells }, (_, i) => i);
    const shuffled = this.shuffle(positions);
    return shuffled.slice(0, mineCount).sort((a, b) => a - b);
  }

  static generateDeck() {
    const suits = ["hearts", "diamonds", "clubs", "spades"];
    const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

    const deck = [];
    for (const suit of suits) {
      for (const value of values) deck.push({ suit, value });
    }
    return this.shuffle(deck);
  }

  static generateKenoNumbers(count = 20, max = 80) {
    const numbers = Array.from({ length: max }, (_, i) => i + 1);
    const shuffled = this.shuffle(numbers);
    return shuffled.slice(0, count).sort((a, b) => a - b);
  }

  /**
   * Roulette spin (0-36 European)
   */
  static spinRoulette() {
    return this.randomInt(0, 36);
  }

  // -----------------------------
  // PLINKO (difficulty + rows)
  // -----------------------------

  static getPlinkoMultipliers(rows = 16, difficulty = "medium") {
    const r = Number(rows);

    const sets = {
      low: {
        8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        9: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
        10: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
        11: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
        12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
        14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
        15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
        16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
      },
      medium: {
        8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        9: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
        10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
        11: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
        12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        13: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
        14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
        15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
        16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
      },
      high: {
        8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
        9: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
        10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
        11: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
        12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
        13: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
        14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
        15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
        16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
      },
    };

    const diff = sets[difficulty] ? difficulty : "medium";
    return sets[diff][r] || sets.medium[16];
  }

  static getPlinkoMultiplier(position, rows = 16, difficulty = "medium") {
    const multipliers = this.getPlinkoMultipliers(rows, difficulty);
    if (position < 0 || position >= multipliers.length) return 0;
    return multipliers[position];
  }

  static generatePlinkoPath(rows = 16) {
    const r = Number(rows);
    const path = [];
    for (let i = 0; i < r; i++) {
      path.push(this.randomBool() ? "right" : "left");
    }
    return path;
  }

  static calculatePlinkoPosition(path) {
    let position = 0;
    for (const direction of path) {
      if (direction === "right") position++;
    }
    return position;
  }
}

module.exports = RNG;