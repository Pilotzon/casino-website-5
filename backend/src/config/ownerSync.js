/**
 * Owner account sync — makes backend/.env the source of truth for the owner account.
 *
 * WHY THIS EXISTS
 * The owner account used to be seeded only on first database initialization
 * (createOwnerAccount in initDatabase.js). If an owner row already existed, the
 * seed was skipped silently — so changing OWNER_EMAIL / OWNER_PASSWORD in .env
 * never reached the database and login kept failing with "Invalid credentials".
 * The persistent SQLite file lives outside the repo, so the stale hash survived
 * re-clones, restarts and updates.
 *
 * WHAT IT DOES
 * Called on every backend start (and by `npm run init-db`). It compares the
 * owner row against .env and updates ONLY what actually differs:
 *   - email     → updated when it differs from OWNER_EMAIL
 *   - password  → re-hashed (bcrypt, cost 12) when OWNER_PASSWORD no longer
 *                 matches the stored hash
 * The username is left untouched (unique, user-visible value).
 * Missing/empty OWNER_* values are never synced, so an incomplete .env can
 * never wipe the stored credentials.
 */

const bcrypt = require("bcrypt");
const { db } = require("./database");

const DEFAULT_OWNER_EMAIL = "owner@casino.local";
const DEFAULT_OWNER_PASSWORD = "ChangeThisPassword123!";

function logOwnerEvent(ownerId, actionType, details) {
  db.prepare(
    `
    INSERT INTO audit_logs (user_id, action_type, action_details)
    VALUES (?, ?, ?)
  `
  ).run(ownerId, actionType, JSON.stringify(details));
}

/**
 * Create the owner account from .env (first initialization only).
 */
async function createOwnerAccount() {
  const ownerEmail = (process.env.OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim();
  const ownerPassword = process.env.OWNER_PASSWORD || DEFAULT_OWNER_PASSWORD;

  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  // Generate username from email (same rule as the original seed)
  const username = ownerEmail.split("@")[0] + "_owner";

  const result = db
    .prepare(
      `
      INSERT INTO users (email, password_hash, username, balance, role)
      VALUES (?, ?, ?, 100.0, 'owner')
    `
    )
    .run(ownerEmail, passwordHash, username);

  logOwnerEvent(result.lastInsertRowid, "ACCOUNT_CREATED", {
    role: "owner",
    method: "database_initialization",
  });

  console.log("✅ Owner account created:");
  console.log(`   Email: ${ownerEmail}`);
  console.log(`   Password: ${ownerPassword}`);
  console.log(`   ⚠️  CHANGE THE PASSWORD AFTER FIRST LOGIN!`);

  return { created: true };
}

/**
 * Sync the owner account with .env on startup.
 * - No owner row  → creates one from .env (same as the original seed).
 * - Owner exists  → updates only the fields whose .env value changed.
 */
async function syncOwnerAccount() {
  const owner = db
    .prepare("SELECT id, email, password_hash FROM users WHERE role = ?")
    .get("owner");

  if (!owner) {
    return createOwnerAccount();
  }

  const envEmail = (process.env.OWNER_EMAIL || "").trim();
  const envPassword = process.env.OWNER_PASSWORD || "";

  const changes = [];

  if (envEmail && envEmail !== owner.email) {
    db.prepare("UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      envEmail,
      owner.id
    );
    changes.push("email");
  }

  if (envPassword) {
    const matches = await bcrypt.compare(envPassword, owner.password_hash);
    if (!matches) {
      const passwordHash = await bcrypt.hash(envPassword, 12);
      db.prepare(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(passwordHash, owner.id);
      changes.push("password");
    }
  }

  if (changes.length === 0) {
    console.log("✅ Owner account is in sync with .env");
    return { inSync: true };
  }

  logOwnerEvent(owner.id, "OWNER_ACCOUNT_SYNCED", {
    changes,
    source: "backend/.env",
  });

  console.log(`🔄 Owner account synced from .env (updated: ${changes.join(", ")})`);
  console.log("   Login with the OWNER_EMAIL / OWNER_PASSWORD values from backend/.env");
  return { synced: changes };
}

module.exports = { syncOwnerAccount };
