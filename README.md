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

## Crash — how the round works (server-authoritative)

Crash is a **solo** game (no multiplayer feed) and the backend owns every rule:

| Step | Endpoint | What happens |
|------|----------|--------------|
| poll state | `GET /api/games/crash/state` | full UI state (live round, last round, history, balance, cooldown); polled ~4×/s while a round is live |
| public snapshot | `GET /api/games/crash/last` | finished rounds only — used for the first paint, so a refresh can never flash a stale round |
| bet | `POST /api/games/crash/start` | debits atomically, commits `sha256(serverSeed:crashPoint)`, never sends the crash point |
| cash out | `POST /api/games/crash/cashout` | credits at the multiplier at that instant (capped by the crash point) |
| auto cash out | — | executed **server-side by a timer**, so it fires even if the tab is closed or the poll stalls |
| stop | `POST /api/games/crash/stop` | viewer-only: ends the animation after a cash-out |
| tick | `POST /api/games/crash/tick` | compatibility alias of the state poll |

* The crash point is revealed only **after** the round ends for that player.
* Every round is settled by a server timer; while a round is open it is also
  persisted in `crash_rounds`, so a backend restart resumes (or settles) it
  instead of losing the bet.
* After a round ends there is a **1 s cooldown** before the next bet
  (`retryInMs` is returned with a 429).
* `npm run test:crash` (in `backend/`) runs the 51-check engine smoke test
  against a throw-away database.

### Board rules (frontend)

* The multiplier, the curve and the visible "camera" span are **pure functions
  of the current time**, so the number can never freeze while the graph keeps
  moving. The camera grows 10% ahead of the tip, so the tip never touches the
  right wall (no jump when it would).
* History pills show the **crash point** of every finished round — green when
  the player won that round, gray when they lost.
* The rectangular status box only appears when it has something to say:
  `Cashed Out 2.00×` (multiplier in green) after a cash-out, `Crashed` (white)
  once the round crashes; it disappears when the next bet is placed.
* `Total Ns` next to the X axis is **not** part of the chart — it counts
  seconds since the board was loaded (0 on every refresh) and restarts with
  every bet.
* While a bet is live, `RefreshGuard` intercepts F5 / Ctrl+R / Cmd+R with a
  "Refreshing the page will not save" prompt (plus a `beforeunload` fallback for
  the browser's own reload button). Every game reports its own live bet through
  `useActiveBetFlag(key, active)`.

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
