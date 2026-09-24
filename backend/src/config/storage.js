/**
 * Database storage location + durability helpers.
 *
 * Goal: the SQLite file must survive EVERY backend restart, code update,
 * re-clone / zip re-download and `git pull`. The only way to guarantee that
 * is to keep the live database OUT of the project folder by default and to
 * never let the seed code overwrite rows that already exist.
 *
 * Resolution order for the database file:
 *   1. DATABASE_PATH env var — absolute path, or a path relative to the
 *      backend/ folder (NEVER relative to the shell's cwd, so it does not
 *      matter how or from where the server is launched).
 *   2. Otherwise the per-user data directory, outside the repository:
 *        Windows : %APPDATA%\casino-website\casino.db
 *        macOS   : ~/Library/Application Support/casino-website/casino.db
 *        Linux   : $XDG_DATA_HOME/casino-website/casino.db
 *                  (defaults to ~/.local/share/casino-website/casino.db)
 *      Override the folder with DATA_DIR if you want (e.g. a mounted
 *      persistent disk on a hosting provider: DATA_DIR=/var/data).
 *
 * First start with a new location: if a legacy database is found inside the
 * project (backend/casino.db, ./casino.db …) it is copied over with SQLite's
 * online-backup API (WAL content included), so nothing is lost.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const APP_FOLDER_NAME = "casino-website";
const DB_FILE_NAME = "casino.db";

function userDataDir() {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(BACKEND_ROOT, process.env.DATA_DIR.trim());
  }
  const home = os.homedir();
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_FOLDER_NAME);
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_FOLDER_NAME);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), APP_FOLDER_NAME);
  }
}

/** Absolute path of the live database file. */
function resolveDatabasePath() {
  const fromEnv = (process.env.DATABASE_PATH || "").trim();
  if (fromEnv && fromEnv !== ":memory:") {
    // relative paths are anchored to backend/, never to process.cwd()
    return path.resolve(BACKEND_ROOT, fromEnv);
  }
  return path.join(userDataDir(), DB_FILE_NAME);
}

/** Places an older version of this project may have left a database. */
function legacyDatabaseCandidates(target) {
  const candidates = [
    path.join(BACKEND_ROOT, DB_FILE_NAME), // backend/casino.db (old default)
    path.resolve(process.cwd(), DB_FILE_NAME), // ./casino.db relative to the launch dir
    path.resolve(BACKEND_ROOT, "..", DB_FILE_NAME), // repo-root/casino.db
  ];
  const seen = new Set();
  return candidates.filter((p) => {
    if (seen.has(p) || p === target) return false;
    seen.add(p);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Consistent copy of a SQLite database (including anything still sitting in
 * its -wal file) using the online backup API. Synchronous on purpose: it runs
 * before the server starts serving requests.
 */
function copyDatabaseFile(Database, sourcePath, destPath) {
  ensureDir(path.dirname(destPath));
  const src = new Database(sourcePath, { fileMustExist: true });
  try {
    // VACUUM INTO writes a compact, fully-checkpointed copy in one statement
    // (reads through the source's -wal, never modifies the source).
    src.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
}

/** Backups are complete standalone files (written by db.backup) — plain copy. */
function copyPlainFile(sourcePath, destPath) {
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
}

/**
 * Called once, before the live database is opened.
 * If the live file is missing, recover it — newest rolling backup first
 * (it reflects the most recent live state), otherwise a legacy database
 * left inside the project by an older version.
 * Returns { dbPath, created, migratedFrom, restoredFrom }.
 */
function prepareDatabaseLocation(Database) {
  const dbPath = resolveDatabasePath();
  ensureDir(path.dirname(dbPath));

  const existed = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  let migratedFrom = null;
  let restoredFrom = null;

  if (!existed) {
    try {
      restoredFrom = restoreFromBackupIfMissing(Database, dbPath);
    } catch (err) {
      console.error(`⚠️  Could not restore database backup: ${err.message}`);
    }

    if (!restoredFrom) {
      const [legacy] = legacyDatabaseCandidates(dbPath);
      if (legacy) {
        try {
          copyDatabaseFile(Database, legacy, dbPath);
          migratedFrom = legacy;
        } catch (err) {
          console.error(`⚠️  Could not migrate legacy database from ${legacy}: ${err.message}`);
        }
      }
    }
  }

  return { dbPath, created: !existed && !migratedFrom && !restoredFrom, migratedFrom, restoredFrom };
}

/* ------------------------------------------------------------------ */
/* Rolling backups                                                     */
/* ------------------------------------------------------------------ */

const BACKUP_KEEP = Math.max(1, parseInt(process.env.DATABASE_BACKUP_KEEP, 10) || 14);

function backupsDir(dbPath) {
  return path.join(path.dirname(dbPath), "backups");
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Writes <backups>/casino-<timestamp>.db and prunes old ones. */
async function backupDatabase(db, dbPath) {
  const dir = backupsDir(dbPath);
  ensureDir(dir);
  const file = path.join(dir, `casino-${timestamp()}.db`);
  await db.backup(file);
  pruneBackups(dir);
  return file;
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^casino-\d{8}-\d{6}\.db$/.test(f))
    .map((f) => path.join(dir, f))
    .sort(); // timestamped names sort chronologically
}

function pruneBackups(dir) {
  const files = listBackups(dir);
  const excess = files.length - BACKUP_KEEP;
  for (let i = 0; i < excess; i++) {
    for (const f of [files[i], `${files[i]}-wal`, `${files[i]}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * If the live database file is missing but backups exist next to where it
 * should be, restore the newest backup. Returns the backup used or null.
 */
function restoreFromBackupIfMissing(Database, dbPath) {
  const exists = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  if (exists) return null;
  const files = listBackups(backupsDir(dbPath));
  if (!files.length) return null;
  const latest = files[files.length - 1];
  copyPlainFile(latest, dbPath);
  return latest;
}

/**
 * Start periodic backups. Interval in hours via DATABASE_BACKUP_INTERVAL_HOURS
 * (default 6, 0 disables). Returns a stop() function.
 */
function scheduleBackups(db, dbPath, log = console.log) {
  const hours = process.env.DATABASE_BACKUP_INTERVAL_HOURS;
  const every = hours === undefined || hours === "" ? 6 : Number(hours);
  if (!Number.isFinite(every) || every <= 0) return () => {};

  const run = async () => {
    try {
      const file = await backupDatabase(db, dbPath);
      log(`💾 Database backup written: ${file}`);
    } catch (err) {
      console.error("⚠️  Database backup failed:", err.message);
    }
  };

  // one right away (after startup), then on the interval
  const initial = setTimeout(run, 5000);
  const timer = setInterval(run, every * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  if (typeof initial.unref === "function") initial.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}

/* ------------------------------------------------------------------ */
/* Uploaded files (custom-bet images) live next to the database so they */
/* survive updates too. UPLOADS_DIR overrides.                          */
/* ------------------------------------------------------------------ */
function resolveUploadsDir() {
  const fromEnv = (process.env.UPLOADS_DIR || "").trim();
  const dir = fromEnv ? path.resolve(BACKEND_ROOT, fromEnv) : path.join(path.dirname(resolveDatabasePath()), "uploads");
  ensureDir(dir);

  // one-time migration of files an older version stored inside the project
  const legacy = path.join(BACKEND_ROOT, "uploads");
  if (legacy !== dir && fs.existsSync(legacy)) {
    try {
      copyMissingFiles(legacy, dir);
    } catch (err) {
      console.error(`⚠️  Could not migrate uploads from ${legacy}: ${err.message}`);
    }
  }
  return dir;
}

function copyMissingFiles(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyMissingFiles(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

module.exports = {
  BACKEND_ROOT,
  resolveDatabasePath,
  resolveUploadsDir,
  prepareDatabaseLocation,
  restoreFromBackupIfMissing,
  backupDatabase,
  scheduleBackups,
  backupsDir,
};
