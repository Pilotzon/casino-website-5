const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
// .env lives next to package.json in backend/ — load it regardless of cwd
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

// Import database (opens the persistent SQLite file — see config/storage.js)
const { db, dbPath, closeDatabase, summarizePersistedState } = require("./config/database");
const { scheduleBackups, resolveUploadsDir } = require("./config/storage");

// Import routes
const authRoutes = require("./routes/auth");
const gamesRoutes = require("./routes/games");
const customBetsRoutes = require("./routes/customBets");
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require("./routes/admin");
const pagesRoutes = require("./routes/pages");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Middleware
 */

// In development we allow any origin (including LAN IPs like 192.168.x.x:3000
// so you can test from a phone on the same Wi-Fi). In production restrict
// this to the real frontend origin via the FRONTEND_URL env var.
const _corsOrigin =
  process.env.NODE_ENV === "production"
    ? (process.env.FRONTEND_URL || "https://your-frontend-domain.com")
    : true; // reflect the request origin (any LAN host)

app.use(
  cors({
    origin: _corsOrigin,
    credentials: true,
  })
);

// Schema + defaults. Everything here is idempotent (CREATE IF NOT EXISTS,
// INSERT OR IGNORE): existing rows — users, balances, disabled games/pages,
// settings — are NEVER overwritten on a restart.
const { initializeDatabase, initializeGames, initializeSettings } = require("./config/database");
initializeDatabase();
initializeGames();
initializeSettings();
{
  const st = summarizePersistedState();
  console.log(
    `📊 Persisted state: ${st.users} user(s), ${st.games} game(s) (${st.disabledGames} disabled), ` +
      `${st.pages} page(s) (${st.disabledPages} disabled), ${st.rounds} round(s)`
  );
}

// Owner account: .env is the source of truth. Creates it on first run and
// syncs OWNER_EMAIL / OWNER_PASSWORD into the existing row whenever they
// differ (fixes "Invalid credentials" after .env changes). See config/ownerSync.js
const { syncOwnerAccount } = require("./config/ownerSync");
syncOwnerAccount().catch((err) => console.error("⚠️  Owner account sync failed:", err.message));

// ✅ Serve uploaded files (custom bets images)
app.use("/uploads", express.static(resolveUploadsDir()));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", globalLimiter);

// Request logging (development only)
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

/**
 * Routes
 */

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

console.log("ROUTES TYPES", {
  authRoutes: typeof authRoutes,
  gamesRoutes: typeof gamesRoutes,
  customBetsRoutes: typeof customBetsRoutes,
  dashboardRoutes: typeof dashboardRoutes,
  adminRoutes: typeof adminRoutes,
  pagesRoutes: typeof pagesRoutes,
});

console.log("ROUTES KEYS", {
  authRoutes: authRoutes && Object.keys(authRoutes),
  gamesRoutes: gamesRoutes && Object.keys(gamesRoutes),
  customBetsRoutes: customBetsRoutes && Object.keys(customBetsRoutes),
  dashboardRoutes: dashboardRoutes && Object.keys(dashboardRoutes),
  adminRoutes: adminRoutes && Object.keys(adminRoutes),
  pagesRoutes: pagesRoutes && Object.keys(pagesRoutes),
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/custom-bets", customBetsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pages", pagesRoutes);

// Root route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Casino Platform API",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      games: "/api/games",
      customBets: "/api/custom-bets",
      dashboard: "/api/dashboard",
      admin: "/api/admin",
      pages: "/api/pages",
      uploads: "/uploads",
    },
  });
});

// 404 handler - MUST be last
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    path: req.path,
  });
});

/**
 * Error handling
 */
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);

  if (error.code === "SQLITE_CONSTRAINT") {
    return res.status(400).json({
      success: false,
      message: "Database constraint violation",
    });
  }

  if (error.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }

  if (error.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    });
  }

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message,
  });
});

/**
 * Background tasks
 */
setInterval(async () => {
  try {
  } catch (error) {
    console.error("Stock bet resolution error:", error);
  }
}, 60000);

/**
 * Start server + graceful shutdown
 * Every way the process can stop flushes the WAL and closes the database:
 * Ctrl+C (SIGINT), process managers / containers (SIGTERM, SIGHUP),
 * nodemon restarts (SIGUSR2) and crashes (uncaughtException).
 */
let shuttingDown = false;
let stopBackups = () => {};

function shutdown(reason, { exitCode = 0, resignal = null } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${reason} — closing server and saving database...`);

  const finish = () => {
    stopBackups();
    closeDatabase();
    console.log("💾 Database saved and closed");
    if (resignal) {
      // nodemon: re-raise the signal so it can restart us
      process.kill(process.pid, resignal);
    } else {
      process.exit(exitCode);
    }
  };

  // give in-flight requests a moment, but never hang
  const timer = setTimeout(finish, 3000);
  if (typeof server !== "undefined" && server) {
    server.close(() => {
      clearTimeout(timer);
      finish();
    });
  } else {
    clearTimeout(timer);
    finish();
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM received"));
process.on("SIGINT", () => shutdown("SIGINT received"));
process.on("SIGHUP", () => shutdown("SIGHUP received"));
process.once("SIGUSR2", () => shutdown("Restart requested (nodemon)", { resignal: "SIGUSR2" }));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("Fatal error", { exitCode: 1 });
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
process.on("exit", () => closeDatabase()); // last resort — synchronous checkpoint + close

const server = app.listen(PORT, () => {
  stopBackups = scheduleBackups(db, dbPath);
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║                                                        ║");
  console.log("║       🎰 CASINO PLATFORM - BACKEND SERVER 🎰          ║");
  console.log("║                                                        ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log(`║  Server running on: http://localhost:${PORT}`.padEnd(57) + "║");
  console.log(`║  Environment: ${process.env.NODE_ENV || "development"}`.padEnd(57) + "║");
  console.log("║                                                        ║");
  console.log("║  API Endpoints:                                        ║");
  console.log(`║  • Health: http://localhost:${PORT}/api/health`.padEnd(57) + "║");
  console.log(`║  • Auth: http://localhost:${PORT}/api/auth`.padEnd(57) + "║");
  console.log(`║  • Games: http://localhost:${PORT}/api/games`.padEnd(57) + "║");
  console.log(`║  • Custom Bets: http://localhost:${PORT}/api/custom-bets`.padEnd(57) + "║");
  console.log(`║  • Dashboard: http://localhost:${PORT}/api/dashboard`.padEnd(57) + "║");
  console.log(`║  • Admin: http://localhost:${PORT}/api/admin`.padEnd(57) + "║");
  console.log(`║  • Pages: http://localhost:${PORT}/api/pages`.padEnd(57) + "║");
  console.log(`║  • Uploads: http://localhost:${PORT}/uploads`.padEnd(57) + "║");
  console.log("║                                                        ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log("║  Database (persistent, survives restarts/updates):     ║");
  console.log(`║  ${dbPath}`.slice(0, 56).padEnd(57) + "║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log("║  ⚠️  REMEMBER:                                          ║");
  console.log("║  • Virtual credits only - no real money               ║");
  console.log("║  • For private use between friends only               ║");
  console.log("╚════════════════════════════════════════════════════════╝");
});

module.exports = app;