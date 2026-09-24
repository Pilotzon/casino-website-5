const express = require("express");
const router = express.Router();

const GamesController = require("../controllers/gamesController");
const {
  authenticateToken,
  optionalAuth,
  userRateLimit,
  requireNotTimedOut,
} = require("../middleware/auth");
const { requireNotMaintenance } = require("../middleware/maintenance");
const gamesController = require("../controllers/gamesController");
const crashHandler = require("../services/crashHandler");

/**
 * Games Routes
 */

// Get all games (public browsing, but requires auth to play)
router.get("/", optionalAuth, GamesController.getGames);

// Get specific game
router.get("/:gameName", optionalAuth, GamesController.getGame);

// ---- Betting / playing routes (blocked during maintenance) ----

// Play Coin Flip
router.post(
  "/flip/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playFlip
);

// Play Dice
router.post(
  "/dice/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playDice
);

// Play Limbo
router.post(
  "/limbo/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playLimbo
);

// ------------------------------
// Crash (solo, no websockets)
// ------------------------------
// The state/tick endpoints are polled while a round is on screen, so they
// have their own (generous but finite) per-user budget instead of eating the
// global one — see the `skip` in server.js for /api/games/crash/state.
router.post(
  "/crash/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(60, 60000),
  crashHandler.startCrash
);
router.post(
  "/crash/cashout",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(120, 60000),
  crashHandler.cashoutCrash
);
router.post(
  "/crash/stop",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(60, 60000),
  crashHandler.stopCrash
);
// Reconciliation poll (POST kept for compatibility with older clients)
router.post(
  "/crash/tick",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(900, 60000),
  crashHandler.tickCrash
);
// Lightweight reconciliation poll (used by the client every ~250ms)
router.get(
  "/crash/state",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(900, 60000),
  crashHandler.tickCrash
);
router.get(
  "/crash/active",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(900, 60000),
  crashHandler.getActiveCrash
);
// Public snapshot of FINISHED rounds only (safe for guests + first paint)
router.get(
  "/crash/last",
  optionalAuth,
  requireNotMaintenance,
  userRateLimit(900, 60000),
  crashHandler.getLastCrashRounds
);

// Start Mines
router.post(
  "/mines/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startMines
);

// Reveal Mines cell
router.post(
  "/mines/reveal",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.revealMinesCell
);

// Cashout Mines
router.post(
  "/mines/cashout",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.cashoutMines
);

// Play Roulette
router.post(
  "/roulette/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playRoulette
);

// Start Blackjack
router.post(
  "/blackjack/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startBlackjack
);

// Blackjack action (hit/stand/double/split)
router.post(
  "/blackjack/action",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.blackjackAction
);

// Keno payout ladder (for UI)
router.get(
  "/keno/ladder",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.getKenoLadder
);

// Play Keno
router.post(
  "/keno/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playKeno
);

// Play Plinko
router.post(
  "/plinko/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playPlinko
);

// ------------------------------
// Dragon Tower
// ------------------------------

// Start Dragon Tower
router.post(
  "/tower/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startTower
);

// Pick tile
router.post(
  "/tower/pick",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.towerPick
);

// Cashout
router.post(
  "/tower/cashout",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.cashoutTower
);

// Autobet
router.post(
  "/autobet",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(10, 60000),
  GamesController.processAutobet
);

router.post(
  "/russian-roulette/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playRussianRoulette
);

router.post(
  "/russian-roulette/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startRussianRoulette
);

router.post(
  "/russian-roulette/bet-shot",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.russianRoulettePlaceShotBet
);

router.post(
  "/russian-roulette/resolve-shot",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(150, 60000),
  GamesController.russianRouletteResolveShot
);

// ------------------------------
// Wheel (NEW)
// ------------------------------
router.post(
  "/wheel/play",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.playWheel
);

router.post("/wheel/layout", GamesController.wheelLayout);

// ------------------------------
// Snakes (NEW)
// ------------------------------
// ------------------------------
// Snakes (v2)
// ------------------------------
// Layout is a harmless random preview (no user data, no bets) — it is
// served signed-out too so the board's snakes + hover tooltip render
// for guests. Betting (/snakes/start) still requires auth.
router.post(
  "/snakes/layout",
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.snakesLayout
);

router.post(
  "/snakes/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startSnakes
);

router.post(
  "/snakes/roll",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.snakesRoll
);

router.post(
  "/snakes/cashout",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.cashoutSnakes
);

// ------------------------------
// Rock Paper Scissors (NEW)
// ------------------------------
// ------------------------------
// Rock Paper Scissors (STAKE-LIKE)
// ------------------------------
router.post(
  "/rps/start",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.startRPS
);

router.post(
  "/rps/choose",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(200, 60000),
  GamesController.chooseRPS
);

router.post(
  "/rps/cashout",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(100, 60000),
  GamesController.cashoutRPS
);

// ---- Non-betting authenticated routes ----

// Get user rounds
router.get("/rounds/user", authenticateToken, GamesController.getUserRounds);

// Get round details
router.get("/rounds/:roundId", authenticateToken, GamesController.getRound);

module.exports = router;