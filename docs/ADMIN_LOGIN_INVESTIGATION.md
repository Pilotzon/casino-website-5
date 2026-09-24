# Investigation Report — Admin/Owner Login Failure ("Invalid credentials")

**Status:** Root cause identified (static analysis + live reproduction). **No code has been changed.**
**Date:** 2026-09-21

---

## Step 0 — Codebase scan (summary)

**Stack:** Monorepo — `backend/` (Node + Express 4, better-sqlite3/SQLite, bcrypt 6, jsonwebtoken, dotenv 16, express-rate-limit, multer) + `frontend/` (React 18 + Vite 5, react-router-dom 6, axios, custom toast wrapper around `react-hot-toast`).

**Backend layout**

| Piece | Location |
|---|---|
| Bootstrap (dotenv → DB open → CORS → rate-limit → routes) | `backend/src/server.js` |
| SQLite open + schema (WAL, crash-safe, persistent **outside the repo**) | `backend/src/config/database.js`, `backend/src/config/storage.js` |
| Owner account creation (`npm run init-db`) | `backend/src/config/initDatabase.js` |
| Auth routes / controller / model | `backend/src/routes/auth.js`, `controllers/authController.js`, `models/User.js` |
| JWT middleware | `backend/src/middleware/auth.js` |
| Other routes | games, stocks, custom-bets, dashboard, admin, pages |

**Frontend layout**

| Piece | Location |
|---|---|
| Routing + page gates | `frontend/src/App.jsx` (`/`, `/games`, `/stocks`, `/custom-bets`, `/dashboard`, `/admin`) |
| **Login form (modal, not a page)** | `frontend/src/components/layout/Navigation.jsx` → `handleLogin()` |
| Auth state | `frontend/src/context/AuthContext.jsx` (`login()` calls `POST /api/auth/login`) |
| API client | `frontend/src/services/api.js` — axios, `baseURL = VITE_API_URL \|\| "http://localhost:5000/api"` |
| Toasts | `frontend/src/context/ToastContext.jsx` (wraps `react-hot-toast`) |
| Shared styles | `frontend/src/styles/variables.css`, `global.css`, `animations.css` + per-component CSS modules |

---

## Step 1 — Why login fails

### 1. Where the credentials come from

`backend/.env` (the only `.env` in the repo — no `.env.local`, no `.env.production`):

```ini
OWNER_EMAIL=owner@casino.local
OWNER_PASSWORD=ChangeThisPassword123!
```

Verified byte-for-byte with `cat -A`: **no quotes, no trailing whitespace/newline garbage, no BOM, LF line endings** — the file itself is clean.

Loading is correct and cwd-independent: three separate absolute-path loads (`server.js:6`, `config/database.js:6`, `config/initDatabase.js`) all point at `backend/.env`. These are **backend-only** variables read by Node at runtime — no `VITE_`/`NEXT_PUBLIC_` prefix applies. `.env` is read once at process start (dotenv caches), and `nodemon src/server.js` watches only code extensions by default, so **`.env` edits require a manual backend restart** — but even a restart is *not sufficient*, see the root cause below. The frontend `frontend/.env.example` is empty and no frontend `.env` exists → `VITE_API_URL` is unset → defaults to `http://localhost:5000/api`.

### 2. Where the comparison happens

`POST /api/auth/login` → `validateBody` (checks presence/type only, **no trimming**) → `AuthController.login`:

1. `User.findByEmail(email)` → `SELECT … WHERE email = ?` — **exact, case-sensitive** match (SQLite `=`, column has no `COLLATE NOCASE`).
2. `User.verifyPassword(password, user.password_hash)` → `bcrypt.compare(plain, hash)` — correct plain-text-vs-hash design: the `.env` stores plaintext, `npm run init-db` hashes it once (bcrypt, cost 12).

**The critical defect:** the owner account is a *seed*, not live config. `createOwnerAccount()` in `initDatabase.js`:

```js
const existingOwner = db.prepare("SELECT id FROM users WHERE role = ?").get("owner");
if (existingOwner) {
  console.log("⚠️  Owner account already exists, skipping creation");
  return;
}
```

It runs **only on first init** and **silently skips whenever an owner row already exists**. Editing `OWNER_PASSWORD` in `.env` afterwards does **nothing** — the DB keeps the old bcrypt hash forever. You also *can't* fix it in-app: `changePassword` explicitly refuses for the owner (`"Owner password cannot be changed through the application"`).

And the DB is designed to persist **outside the repository** (Linux `~/.local/share/casino-website/casino.db`, macOS `~/Library/Application Support/casino-website/`, Windows `%APPDATA%\casino-website\`; see README + `storage.js`) — it survives re-clones, restarts and updates. So an owner hash created weeks ago under a different `.env` is still there today.

### 3. Where the toast is triggered

Two different backend failures return the **identical** `401 {"success":false,"message":"Invalid credentials"}`:

| Branch | Code | Audit-log reason |
|---|---|---|
| No user with that exact email | `authController.js:89-92` | `LOGIN_FAILED` … `"reason":"User not found"` |
| Email found, bcrypt mismatch | `authController.js:95-98` | `LOGIN_FAILED` … `"reason":"Invalid password"` |

Frontend: `AuthContext.login()` catches the 401 and returns `error.response.data.message`; `Navigation.jsx → handleLogin()` renders it verbatim via `toast.error(result.message)` (ToastContext / react-hot-toast). The toast therefore can't tell you *which* check failed — the `audit_logs` table **can** (query below).

### 4. Environment context

- Backend runs in dev mode (`NODE_ENV=development`, port 5000); frontend Vite dev server on 3000 proxying `/api`. Only one `.env` exists and it's the one loaded — nothing is overriding it.
- **Live reproduction in this sandbox (fresh machine, no DB):** `npm run init-db` created the owner from `.env`, then `POST /api/auth/login` with `owner@casino.local` / `ChangeThisPassword123!` → **`200 Login successful`.** The code path, dotenv loading, and bcrypt comparison all work.
- **Stale-owner proof:** changed `OWNER_PASSWORD` in `.env` → re-ran `init-db` → `"⚠️ Owner account already exists, skipping creation"` → login with the *new* password → **`401 Invalid credentials`** (old hash kept). `.env` restored afterwards; test DB deleted.
- **Case-sensitivity proof:** `Owner@Casino.Local` → `401 Invalid credentials` (`"User not found"` branch).
- **Whitespace proof:** trailing space in the password → `401 Invalid credentials` (nothing in the chain trims input).

---

## Root cause, ranked

1. **(~90%) Stale owner row in the persistent SQLite DB.** The owner account was created by `npm run init-db` from an *earlier* `.env` (different `OWNER_PASSWORD` and/or `OWNER_EMAIL`), and because `createOwnerAccount()` skips when an owner exists — and in-app password change is blocked for owner — **the current `.env` values can never reach the DB**. The persistent, outside-the-repo DB location guarantees the stale row survives everything.
2. **(~5%) Email case mismatch.** Lookup is case-sensitive; `OWNER@casino.local` ≠ `owner@casino.local`, and the failure toast is identical.
3. **(~5%) Invisible character mismatch at the form.** No input trimming anywhere; a trailing space (or pasted non-breaking space) in email/password produces the same toast. (Quotes/CRLF in `.env` are handled correctly by dotenv 16 and are ruled out here.)

### How to confirm on your machine (1 minute)

```bash
sqlite3 ~/.local/share/casino-website/casino.db \
  "SELECT action_details, created_at FROM audit_logs
   WHERE action_type='LOGIN_FAILED' ORDER BY id DESC LIMIT 5;"
# Windows: %APPDATA%\casino-website\casino.db   macOS: ~/Library/Application Support/casino-website/casino.db
```

- `"reason":"User not found"` → the **email** doesn't match the stored owner row (case or wrong address). Check with `SELECT email, username, created_at FROM users WHERE role='owner';`
- `"reason":"Invalid password"` → the **password** doesn't match the stored hash (stale-owner scenario #1).

## Fix options (decision needed — nothing applied yet)

| Option | Change | Pros / Cons |
|---|---|---|
| **A. Data-only reset** | Delete the owner row, re-run `npm run init-db` → recreated from current `.env` | Zero code changes; keeps current behavior. Loses the owner's audit-log linkage (fresh account). |
| **B. Code fix: sync owner on startup** | On server start, upsert owner email/password-hash from `.env` (only when they differ) | `.env` becomes the source of truth forever; fixes the class of bug. Small, contained change in `database.js`/`initDatabase.js`. |
| **C. Hardening (can combine with B)** | Case-insensitive email lookup (`COLLATE NOCASE`) + trim login inputs | Removes failure modes #2/#3; slightly widens email matching. |

**Recommendation:** B + C (make `.env` authoritative on startup, trim + case-insensitive email), optionally followed by deleting your stale owner row once so the sync takes over cleanly.
