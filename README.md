# casino-website

Virtual-credits casino for a private friend group. React/Vite frontend, Node/Express + SQLite backend.

## Run it

```bash
# backend (port 5000)
cd backend
npm install
npm run init-db     # first time only: creates tables + the owner account from .env
npm run dev         # or: npm start

# frontend (port 3000, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

## Database persistence — how it works

**Nothing in the database is ever reset by a restart.** Users, balances, rounds,
which games/pages are enabled, and the admin settings all live in one SQLite
file, and every startup path is non-destructive:

- **The file lives outside the project folder by default**, so updating the
  code, re-cloning, downloading a fresh ZIP or `git pull` can never delete it:

  | OS      | Location                                                   |
  |---------|------------------------------------------------------------|
  | Windows | `%APPDATA%\casino-website\casino.db`                       |
  | macOS   | `~/Library/Application Support/casino-website/casino.db`   |
  | Linux   | `~/.local/share/casino-website/casino.db`                  |

  The backend prints the exact path in its startup banner, together with a
  `📊 Persisted state: N user(s), … (X disabled)` line so you can verify
  after every restart that the same data was loaded.
- **Seeds only add what is missing** (`CREATE TABLE IF NOT EXISTS`,
  `INSERT OR IGNORE`). Disabling a game or a page, or changing a setting in
  the admin panel, is kept forever — the defaults in `classifiedConfig.js`
  are only used the very first time.
- **Crash-safe writes**: WAL journal + `synchronous=FULL`, and every way the
  process can stop (Ctrl+C, SIGTERM from a process manager / container,
  nodemon restarts, fatal errors) flushes and closes the database first.
- **Rolling backups**: `backups/casino-<timestamp>.db` next to the database,
  every 6 hours (keeps the last 14). If the live file ever goes missing the
  newest backup is restored automatically on the next start.
- **Automatic migration**: the first start with the new location copies an
  existing `backend/casino.db` from an older version, so nothing is lost when
  you upgrade. Uploaded custom-bet images move alongside it (`uploads/`).

### Configuration (`backend/.env`)

```ini
OWNER_EMAIL=            # login email of the owner/admin account
OWNER_PASSWORD=         # its login password (plain text here; stored hashed in the DB)
DATABASE_PATH=          # empty = the per-user location above
DATA_DIR=               # or: a folder for casino.db + backups/ + uploads/
DATABASE_BACKUP_INTERVAL_HOURS=6
DATABASE_BACKUP_KEEP=14
```

**The owner account follows `.env`.** It is created on first initialization, and
on every backend start the stored owner email/password are compared against
`OWNER_EMAIL` / `OWNER_PASSWORD` — anything that differs is synced (the password
is re-hashed; empty values are ignored). This means if you ever change the
owner credentials in `.env`, just restart the backend and log in with the new
values — no re-init needed.

`DATABASE_PATH` may be absolute or relative to `backend/` (never to the shell's
working directory, so it does not matter how the server is launched).

### Hosting providers (Render, Railway, Fly, Docker …)

Their default filesystem is **ephemeral** — it is wiped on every deploy and
often on every restart, and no application code can survive that. Mount a
persistent disk/volume and point the backend at it:

```ini
DATA_DIR=/var/data      # e.g. a Render disk mounted at /var/data
```

### Upgrading from an older checkout

Older versions kept `backend/casino.db` **inside the repository and tracked it in
git**, which is exactly what overwrote live data on every pull / re-download.
Before pulling this version, copy `backend/casino.db` (plus `-wal`/`-shm` if
present) somewhere safe. After pulling, either leave it at `backend/casino.db`
(it is migrated automatically on first start) or put it at the new location.
Make sure `backend/casino.db*` is no longer tracked: `git rm --cached backend/casino.db*`.
