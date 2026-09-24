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
* `npm run test:crash` (in `backend/`) runs the 63-check engine smoke test
  against a throw-away database; `npm run test:http` boots the real server on a
  spare port and drives the same endpoints over HTTP (22 checks, also against a
  throw-away database). `npm test` runs both.

### Toasts

One toast system for the whole site (`context/ToastContext.jsx`), with these
kinds: `success`, `error`, `info`, `warning` and **`loss`**. A lost round is an
outcome, not a failure — `toast.loss("You lost 20.00 $ this round")` renders the
"Loss" title with a falling-chart icon instead of the red "Error" cross
(`toast.error` stays for real failures: rejected bets, network problems, …).

### Disabled betting

When an administrator disables a game (or the site enters maintenance), every
game shows a red hazard badge on the top-right corner of its bet button. The
badge is a **sibling** of the button — a disabled `<button>` swallows clicks, so
a badge inside it could never work — and clicking it opens the same modal
anatomy as "Sign-up Disabled", explaining exactly why betting is off. Games wire
it with one line: `<BetLockBadge locked={isLocked} title={disabledTitle}
description={disabledDesc} />` inside a `.ui-bet-wrap` element.

That wrapper is why the button keeps its full sidebar width: several games style
their bet button as `inline-flex` (or leave the inline default), and an
inline-level box inside a plain block wrapper shrink-wraps to its own label —
`global.css` therefore gives `.ui-bet-wrap > button { width: 100% }`.

**Who is actually blocked?** Only players *without* the admin-panel permission
**"Bypass disabled games/pages"**. The owner always bypasses; a user needs
`users.can_bypass_disabled`, which nobody has by default and which is granted
per user in Admin → Users. The rule lives in exactly one place per layer —
`services/gameAccess.js` (backend, carried with the request through
`AsyncLocalStorage`, so the deep engine checks and Crash's own start route all
agree) and `hooks/useGameDisabled.js` (frontend) — and the games grid does not
label a bypassable game "Unavailable" either.

### Admin panel on a phone

Nothing in the admin panel scrolls sideways: at ≤640 px the tables drop their
column headers, each row becomes a two-line card (name/key, then status + the
action buttons) and the row buttons turn **icon-only** — 44 × 44 tiles with
24 px icons, so the power / phone glyphs stay readable — while keeping their
`aria-label` and `title`, so the meaning survives the missing text.
* `npm run test:board` (in `frontend/`) runs the 92-check DOM test of the Crash
  board in jsdom (see `frontend/tests/crash-board/`) — it drives the real
  component (polling, cash-out, render pump) against a scripted server and
  measures what the board actually renders.
* `npm run test:ui` (in `frontend/`) runs the 183-check site UI suite
  (`frontend/tests/site-ui/`): the toast kinds, the games-page filter row, the
  admin panel's phone layout, the bet-button hazard badge on **every** game, the
  Scroll-up pill and the bypass permission in the UI.
* `npm test` runs both frontend suites.

### Scroll up

Every page carries one app-wide pill in the bottom-right corner
(`components/common/BackToTop.jsx`, mounted in `App.jsx`): it slides up from
below the fold once the user scrolls past 300 px, scrolls smoothly back to the
top when clicked, and on a mouse-driven PC shows the same white tooltip as the
icon buttons in the toolbar under the game box ("Scroll up"). On phones it
floats above the fixed bottom navigation bar, and pages must not ship a second
back-to-top button of their own.

### Board rules (frontend)

* The multiplier, the curve and the visible "camera" span are **pure functions
  of the current time**, so the number can never freeze while the graph keeps
  moving. The camera grows 10% ahead of the tip, so the tip never touches the
  right wall (no jump when it would). Once the crash point is known, the curve,
  the camera and the tip are clipped to that moment — nothing keeps travelling
  to the right after the crash.
* The board's clock is estimated from a **window of server samples** (best of
  the last few) and only ever corrected forward, so a slow response can never
  pull the multiplier, the curve or the tip backwards.
* Stale responses cannot rewind the view: a payload older than what is on
  screen is dropped — except when it carries terminal news about the round on
  screen ("your cash-out was too late, it crashed"), which is always applied.
  That pair of rules is what removes the "shows Crashed, then goes back to
  running seconds later" glitch.
* History pills show the **crash point** of every finished round — green when
  the player won that round, gray when they lost.
* The post-round cooldown lives **on the button itself** (`Wait 1s`) — there is
  no extra sentence under it.
* The rectangular status box only appears when it has something to say:
  `Cashed Out 2.00×` (multiplier in green) after a cash-out, `Crashed` (white)
  once the round crashes; it disappears when the next bet is placed.
* A cash-out is applied **immediately** (before the response comes back), and a
  late response can never take it away again.
* `Total Ns` is **not** part of the chart: it is the elapsed time of the ROUND,
  taken from the round's own start time on the server — so it is identical on
  every device, survives a page refresh mid-round (it does not restart at 0), is
  unaffected by a cash-out, and stops at the crash. A round restored from the
  database (no timestamps) falls back to `ln(crashPoint) / k`, which is exactly
  how long it ran. It is rounded to the **nearest** second — the second the curve
  is currently on — so the clock and the X axis can never disagree (flooring made
  6.9s read as "6s" while the tip already sat next to the 7s tick). On phones the
  clock moves to the top right, under the history pills, which frees the whole
  axis row for the ticks.
* The X axis is labelled in **real seconds of the round**, positioned by the
  same `dispX` the curve is drawn with, so dropping a perpendicular from the tip
  of the graph onto the axis lands on the second that has really passed (the DOM
  suite asserts exactly that). Short rounds get **one tick per second**; the step
  coarsens (2s, 3s, 5s, 10s …) as the visible span grows, phones keep at most ~6
  labels, and the right-hand room is measured so the last label never collides
  with the clock.
* The Y tick labels sit in rounded `#253844` boxes with the (thicker) spine
  running through their centre; the curve carries ONE soft blurred shadow, and
  the tip dot is a plain circle with no outline ring that turns muted `#2E4552`
  with the line when the round crashes. The multiplier and the status box are the
  top layer of the board — above the curve and above the tip dot.
* Phones (≤900 px): the betting panel drops below the board, the chart gets an
  explicit height so it never collapses, labels/pills get a bigger font, and
  the history pills scroll horizontally with the newest round pinned at the
  right edge.
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
