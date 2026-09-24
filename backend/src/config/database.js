const Database = require("better-sqlite3");
const path = require("path");
const { systemSettings } = require("../config/classifiedConfig");
const storage = require("./storage");
// .env lives in backend/ — load it from there no matter what the cwd is
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

/* ------------------------------------------------------------------
   Open the ONE persistent database file.
   - Location resolved by storage.js (outside the repo by default, or
     DATABASE_PATH); the folder is created if needed.
   - If the file is missing, a legacy copy inside the project is migrated,
     or the newest rolling backup is restored — nothing is silently reset.
   ------------------------------------------------------------------ */
const location = storage.prepareDatabaseLocation(Database);
const restoredFrom = location.restoredFrom;

const dbPath = location.dbPath;
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL"); // durable, crash-safe write-ahead log
db.pragma("synchronous = FULL"); // fsync on every commit: survives power loss / hard kills
db.pragma("busy_timeout = 5000");

const dbInfo = {
  path: dbPath,
  isNew: location.created && !restoredFrom,
  migratedFrom: location.migratedFrom,
  restoredFrom,
};

if (dbInfo.migratedFrom) {
  console.log(`📦 Migrated existing database from ${dbInfo.migratedFrom}`);
  console.log(`   (the old file was left untouched — you can delete it once you have verified the move)`);
}
if (dbInfo.restoredFrom) {
  console.log(`♻️  Database file was missing — restored newest backup ${dbInfo.restoredFrom}`);
}
console.log(`🗄️  Database file: ${dbPath} ${dbInfo.isNew ? "(new — first run)" : "(existing data loaded)"}`);

function addColumnIfNotExists(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`✅ Added column ${table}.${column}`);
  }
}

function initializePages() {
  const pages = [
    { key: "games", display_name: "Games" },
    { key: "custom_bets", display_name: "Custom Bets" },
    { key: "dashboard", display_name: "Dashboard" },
    { key: "admin", display_name: "Admin Panel" },
  ];

  const insertPage = db.prepare(`
    INSERT OR IGNORE INTO pages (page_key, display_name, is_enabled)
    VALUES (?, ?, 1)
  `);

  const insertMany = db.transaction((arr) => {
    for (const p of arr) insertPage.run(p.key, p.display_name);
  });

  insertMany(pages);
  console.log("✅ Default pages initialized");
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      balance REAL NOT NULL DEFAULT 100.0,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin', 'owner')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  addColumnIfNotExists("users", "banned_until", "DATETIME");
  addColumnIfNotExists("users", "timed_out_until", "DATETIME");

  addColumnIfNotExists("users", "banned_by", "INTEGER");
  addColumnIfNotExists("users", "timed_out_by", "INTEGER");
  addColumnIfNotExists("users", "deactivated_by", "INTEGER");

  addColumnIfNotExists("users", "can_bypass_disabled", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "can_manage_games", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_manage_pages", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_adjust_others_balance", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_adjust_own_balance", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "can_change_roles", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_change_admin_roles", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "can_timeout_users", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfNotExists("users", "can_timeout_admins", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "can_ban_users", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_ban_admins", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "can_deactivate_users", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfNotExists("users", "can_deactivate_admins", "INTEGER NOT NULL DEFAULT 0");

  // per-admin permissions for custom bets moderation
  addColumnIfNotExists("users", "can_close_custom_bets", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "can_remove_custom_bets", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_mobile_enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  addColumnIfNotExists("games", "is_mobile_enabled", "INTEGER NOT NULL DEFAULT 1");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      page_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_uuid TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      bet_amount REAL NOT NULL,
      payout_amount REAL NOT NULL DEFAULT 0,
      multiplier REAL,
      outcome TEXT,
      game_state TEXT,
      is_autobet INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      admin_id INTEGER,
      action_type TEXT NOT NULL,
      action_details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
      entry_price REAL NOT NULL,
      exit_price REAL,
      bet_amount REAL NOT NULL,
      payout_amount REAL NOT NULL DEFAULT 0,
      timeframe TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'won', 'lost')),
      expires_at DATETIME NOT NULL,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // OLD custom bet tables (unused for v2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      bet_amount REAL NOT NULL,
      total_pool REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'resolved')),
      outcome TEXT,
      resolved_by INTEGER,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bet_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      custom_bet_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      bet_amount REAL NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('for', 'against')),
      payout_amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (custom_bet_id) REFERENCES custom_bets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(custom_bet_id, user_id)
    )
  `);

  // =========================
  // Custom Bets v2 (multi-option)
  // =========================
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bets_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      show_graph INTEGER NOT NULL DEFAULT 1,
      show_percentages INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'resolved', 'removed')),
      end_at DATETIME NOT NULL,
      closed_at DATETIME,
      closed_by INTEGER,
      resolved_at DATETIME,
      resolved_by INTEGER,
      winning_option_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // In case DB existed without image_url
  addColumnIfNotExists("custom_bets_v2", "image_url", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bet_options_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      creator_percent REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bet_id) REFERENCES custom_bets_v2(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bet_bets_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','refunded')),
      payout_amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bet_id) REFERENCES custom_bets_v2(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES custom_bet_options_v2(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // =========================
  // Comments v2
  // =========================
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bet_comments_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (bet_id) REFERENCES custom_bets_v2(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ✅ NEW: replies (threading)
  // Add column in existing DBs too
  addColumnIfNotExists("custom_bet_comments_v2", "parent_id", "INTEGER");

  // ✅ NEW: likes
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_bet_comment_likes_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id),
      FOREIGN KEY (bet_id) REFERENCES custom_bets_v2(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES custom_bet_comments_v2(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // =========================
  // Indexes
  // =========================
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rounds_user_id ON rounds(user_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_game_id ON rounds(game_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_bets_user_id ON stock_bets(user_id);
    CREATE INDEX IF NOT EXISTS idx_stock_bets_status ON stock_bets(status);

    CREATE INDEX IF NOT EXISTS idx_custom_bets_v2_status ON custom_bets_v2(status);
    CREATE INDEX IF NOT EXISTS idx_custom_bets_v2_creator ON custom_bets_v2(creator_id);
    CREATE INDEX IF NOT EXISTS idx_custom_bet_options_v2_bet ON custom_bet_options_v2(bet_id);
    CREATE INDEX IF NOT EXISTS idx_custom_bet_bets_v2_bet ON custom_bet_bets_v2(bet_id);
    CREATE INDEX IF NOT EXISTS idx_custom_bet_bets_v2_user ON custom_bet_bets_v2(user_id);

    CREATE INDEX IF NOT EXISTS idx_custom_bet_comments_v2_bet ON custom_bet_comments_v2(bet_id);
    CREATE INDEX IF NOT EXISTS idx_custom_bet_comments_v2_user ON custom_bet_comments_v2(user_id);

    -- ✅ NEW: reply queries
    CREATE INDEX IF NOT EXISTS idx_custom_bet_comments_v2_bet_parent_created
      ON custom_bet_comments_v2 (bet_id, parent_id, created_at);

    -- ✅ NEW: likes queries
    CREATE INDEX IF NOT EXISTS idx_custom_bet_comment_likes_v2_comment
      ON custom_bet_comment_likes_v2 (comment_id);
    CREATE INDEX IF NOT EXISTS idx_custom_bet_comment_likes_v2_user
      ON custom_bet_comment_likes_v2 (user_id);
  `);

  initializePages();

  console.log("✅ Database tables initialized successfully");
}

function initializeGames() {
  const games = [
    { name: "flip", display_name: "Coin Flip", config: JSON.stringify({ house_edge: 0.02 }) },
    { name: "dice", display_name: "Dice", config: JSON.stringify({ house_edge: 0.01 }) },
    { name: "limbo", display_name: "Limbo", config: JSON.stringify({ house_edge: 0.01 }) },
    { name: "crash", display_name: "Crash", config: JSON.stringify({ house_edge: 0.01 }) },
    { name: "mines", display_name: "Mines", config: JSON.stringify({ house_edge: 0.01 }) },
    { name: "roulette", display_name: "Roulette", config: JSON.stringify({ house_edge: 0.027 }) },
    { name: "blackjack", display_name: "Blackjack", config: JSON.stringify({ house_edge: 0.005 }) },
    { name: "keno", display_name: "Keno", config: JSON.stringify({ house_edge: 0.25 }) },
    { name: "plinko", display_name: "Plinko", config: JSON.stringify({ house_edge: 0.01 }) },
    { name: "tower", display_name: "Dragon Tower", config: JSON.stringify({ house_edge: 0.02 }) },
    { name: "russian_roulette", display_name: "Russian Roulette", config: JSON.stringify({ house_edge: 0.02 }) },
    { name: "wheel", display_name: "Wheel", config: JSON.stringify({ house_edge: 0.03 }) },
    { name: "snakes", display_name: "Snakes", config: JSON.stringify({ house_edge: 0.03 }) },
    { name: "rps", display_name: "Rock Paper Scissors", config: JSON.stringify({ house_edge: 0.02 }) },
  ];

  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (name, display_name, config)
    VALUES (?, ?, ?)
  `);

  const insertMany = db.transaction((arr) => {
    for (const g of arr) insertGame.run(g.name, g.display_name, g.config);
  });

  insertMany(games);
  console.log("✅ Default games initialized");
}

/**
 * Seed DEFAULT settings only for keys that do not exist yet.
 * classifiedConfig.js provides first-run defaults; anything the owner has
 * changed through the admin panel is kept across restarts.
 */
function initializeSettings() {
  const settings = [
    { key: "signup_enabled", value: systemSettings.signup_enabled },
    { key: "maintenance_mode", value: systemSettings.maintenance_mode },
    { key: "max_bet_amount", value: systemSettings.max_bet_amount },
    { key: "min_bet_amount", value: systemSettings.min_bet_amount },
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const tx = db.transaction((arr) => {
    let added = 0;
    for (const s of arr) added += insertSetting.run(s.key, s.value).changes;
    return added;
  });

  const added = tx(settings);
  console.log(added ? `✅ Seeded ${added} default system setting(s)` : "✅ System settings loaded (existing values kept)");
}

/** Row counts of the persisted state — printed on boot so persistence is verifiable. */
function summarizePersistedState() {
  const count = (sql) => {
    try {
      return db.prepare(sql).get().n;
    } catch {
      return 0;
    }
  };
  return {
    users: count("SELECT COUNT(*) AS n FROM users"),
    games: count("SELECT COUNT(*) AS n FROM games"),
    disabledGames: count("SELECT COUNT(*) AS n FROM games WHERE is_enabled = 0"),
    pages: count("SELECT COUNT(*) AS n FROM pages"),
    disabledPages: count("SELECT COUNT(*) AS n FROM pages WHERE is_enabled = 0"),
    rounds: count("SELECT COUNT(*) AS n FROM rounds"),
  };
}

function getDatabase() {
  return db;
}

let closed = false;
/**
 * Flush the write-ahead log into the main file and close. Safe to call more
 * than once; used by every shutdown path (SIGINT/SIGTERM/nodemon restarts…).
 */
function closeDatabase() {
  if (closed) return;
  closed = true;
  try {
    if (db.open) {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    }
  } catch (err) {
    console.error("⚠️  Error while closing the database:", err.message);
  }
}

module.exports = {
  db,
  dbPath,
  dbInfo,
  getDatabase,
  closeDatabase,
  summarizePersistedState,
  initializeDatabase,
  initializeGames,
  initializeSettings,
  addColumnIfNotExists,
};