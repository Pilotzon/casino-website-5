const {
  initializeDatabase,
  initializeGames,
  initializeSettings,
  addColumnIfNotExists,
  closeDatabase,
} = require("./database");
const { syncOwnerAccount } = require("./ownerSync");
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

/**
 * Initialize the entire database with schema and owner account
 */
async function initDB() {
  try {
    console.log("🚀 Starting database initialization...\n");

    // Initialize schema + defaults
    initializeDatabase();
    initializeGames();
    initializeSettings();

    // Ensure moderation columns exist (safe if already added)
    addColumnIfNotExists("users", "banned_until", "DATETIME");
    addColumnIfNotExists("users", "rr_attempt_index", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfNotExists("users", "timed_out_until", "DATETIME");

    // Create the owner account (or sync it with .env if it already exists)
    await syncOwnerAccount();

    console.log("\n✅ Database initialization completed successfully!");
    console.log("\n📝 Next steps:");
    console.log("1. Start the backend: npm run dev");
    console.log("2. Start the frontend: cd ../frontend && npm start");
    console.log("3. Login with owner credentials from your .env file\n");

    closeDatabase(); // flush the WAL into the file before exiting
    process.exit(0);
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    closeDatabase();
    process.exit(1);
  }
}

// Run initialization
initDB();