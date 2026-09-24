/**
 * Keno payout table test.
 *
 *   npm run test:keno        (from backend/)
 *
 * Checks the thing the UI depends on: every difficulty has its own ladder,
 * easy pays MORE hit counts with SMALLER multipliers, high pays FEWER hit
 * counts with BIGGER multipliers, every row has a sane RTP, and the copy of
 * the table that lives in the frontend (Keno.jsx) is identical to this one.
 *
 * No database, no server — pure table maths.
 */
const path = require("path");
const BACKEND = path.resolve(__dirname, "..");
const FRONTEND = path.resolve(BACKEND, "..", "frontend");

const { KENO_PAYOUTS, KENO_DIFFICULTIES, getKenoMultiplier } = require(
  path.join(BACKEND, "src/config/kenoPayoutTable")
);
const GameEngine = require(path.join(BACKEND, "src/services/gameEngine"));

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};

const N = 40;      // numbers on the board
const DRAWN = 10;  // numbers drawn

const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
};
/** probability of exactly `hits` hits when picking `picks` of 40 (10 drawn) */
const hitProb = (hits, picks) => choose(DRAWN, hits) * choose(N - DRAWN, picks - hits) / choose(N, picks);
const rowRtp = (row, picks) =>
  Object.entries(row).reduce((sum, [h, m]) => sum + hitProb(Number(h), picks) * m, 0);

console.log("=== 1. the table answers to the difficulty names the API uses ===");
{
  const keys = Object.keys(KENO_PAYOUTS).sort();
  ok(JSON.stringify(keys) === JSON.stringify(["easy", "high", "medium"]),
    "table keys are exactly easy / medium / high", JSON.stringify(keys));
  ok(!("low" in KENO_PAYOUTS), "the old `low` key is gone (it silently fell back to medium)");
  ok(JSON.stringify(KENO_DIFFICULTIES) === JSON.stringify(["easy", "medium", "high"]),
    "KENO_DIFFICULTIES export matches the engine", JSON.stringify(KENO_DIFFICULTIES));

  // the engine only accepts easy|medium|high, so every one of them must resolve
  const easy = getKenoMultiplier("easy", 10, 5);
  const medium = getKenoMultiplier("medium", 10, 5);
  const high = getKenoMultiplier("high", 10, 5);
  ok(easy !== medium && medium !== high,
    "10 picks / 5 hits pays a different multiplier per difficulty", `${easy} / ${medium} / ${high}`);
  ok(getKenoMultiplier("EASY", 10, 5) === easy, "difficulty is case-insensitive");
  ok(getKenoMultiplier("nonsense", 10, 5) === medium, "an unknown difficulty still falls back to medium");

  const ladder = GameEngine.getKenoLadder("easy", 10);
  ok(ladder.success === true && ladder.difficulty === "easy",
    "GameEngine.getKenoLadder('easy', 10) resolves", JSON.stringify(ladder.difficulty));
  const l5 = ladder.ladder.find((t) => t.hits === 5);
  ok(l5.multiplier === easy, "the ladder serves the easy table", JSON.stringify(l5));
  ok(GameEngine.getKenoPayoutTableVersion() !== "keno_v1_40_10",
    "payout table version bumped (client cache busts)",
    GameEngine.getKenoPayoutTableVersion());
}

console.log("\n=== 2. every difficulty is visibly different ===");
{
  for (let picks = 1; picks <= 10; picks += 1) {
    const rows = {};
    for (const d of KENO_DIFFICULTIES) rows[d] = KENO_PAYOUTS[d][picks];
    const first = (r) => Number(Object.keys(r)[0]);
    const top = (r) => Math.max(...Object.values(r));
    const label = `${picks} pick(s)`;

    ok(first(rows.easy) <= first(rows.medium) && first(rows.medium) <= first(rows.high),
      `${label}: easier pays from an equal-or-lower hit count`,
      `${first(rows.easy)} / ${first(rows.medium)} / ${first(rows.high)}`);
    ok(top(rows.easy) < top(rows.medium) && top(rows.medium) < top(rows.high),
      `${label}: the top prize grows with difficulty`,
      `${top(rows.easy)} / ${top(rows.medium)} / ${top(rows.high)}`);
    ok(JSON.stringify(rows.easy) !== JSON.stringify(rows.medium) &&
       JSON.stringify(rows.medium) !== JSON.stringify(rows.high),
      `${label}: no two difficulties share a ladder`);

    for (const d of KENO_DIFFICULTIES) {
      const r = rows[d];
      ok(Math.max(...Object.keys(r).map(Number)) === picks,
        `${label}: ${d} pays the maximum hit count`, JSON.stringify(r));
      ok(Math.min(...Object.values(r)) >= 1,
        `${label}: ${d} never pays below 1x on a paying tier`, JSON.stringify(r));
    }
  }

  // shared tiers: harder = bigger
  for (let picks = 5; picks <= 10; picks += 1) {
    const [e, m, h] = KENO_DIFFICULTIES.map((d) => KENO_PAYOUTS[d][picks]);
    const shared = Object.keys(e).filter((k) => k in m && k in h);
    ok(shared.length > 0 && shared.every((k) => e[k] < m[k] && m[k] < h[k]),
      `${picks} picks: on a shared hit count easy < medium < high`,
      shared.map((k) => `${k}:${e[k]}/${m[k]}/${h[k]}`).join(" "));
    const cheapest = (r) => Math.min(...Object.values(r));
    ok(cheapest(e) < cheapest(m) && cheapest(m) < cheapest(h),
      `${picks} picks: the cheapest payout grows with difficulty`,
      `${cheapest(e)} / ${cheapest(m)} / ${cheapest(h)}`);
  }
}

console.log("\n=== 3. RTP sanity (exact hypergeometric distribution) ===");
{
  for (const d of KENO_DIFFICULTIES) {
    const rtps = [];
    for (let picks = 1; picks <= 10; picks += 1) {
      const rtp = rowRtp(KENO_PAYOUTS[d][picks], picks);
      rtps.push(rtp);
      ok(rtp >= 0.8 && rtp <= 0.965, `${d} ${picks} picks: RTP ${(rtp * 100).toFixed(1)}% is inside [80%, 96.5%]`);
    }
    const avg = rtps.reduce((a, b) => a + b, 0) / rtps.length;
    console.log(`     (${d}: average RTP ${(avg * 100).toFixed(1)}%)`);
    ok(avg >= 0.85, `${d}: average RTP above 85%`, avg.toFixed(3));
  }
}

console.log("\n=== 4. the frontend mirror is byte-for-byte the same table ===");
{
  const fs = require("fs");
  const src = fs.readFileSync(path.join(FRONTEND, "src/components/games/Keno.jsx"), "utf8");
  const start = src.indexOf("const KENO_PAYOUTS = ");
  ok(start !== -1, "Keno.jsx still declares KENO_PAYOUTS");
  const open = src.indexOf("{", src.indexOf("=", start));
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  ok(end !== -1, "the object literal closes");
  // eslint-disable-next-line no-new-func
  const mirror = new Function(`return (${src.slice(open, end)});`)();
  for (const d of KENO_DIFFICULTIES) {
    for (let picks = 1; picks <= 10; picks += 1) {
      if (JSON.stringify(mirror[d]?.[picks]) !== JSON.stringify(KENO_PAYOUTS[d][picks])) {
        ok(false, `mirror mismatch: ${d} ${picks} picks`,
          `${JSON.stringify(mirror[d]?.[picks])} vs ${JSON.stringify(KENO_PAYOUTS[d][picks])}`);
      }
    }
  }
  ok(JSON.stringify(Object.keys(mirror).sort()) === JSON.stringify(KENO_DIFFICULTIES.slice().sort()),
    "the mirror has the same difficulty keys", JSON.stringify(Object.keys(mirror)));
  console.log("     (every difficulty / picks row compared — silent means identical)");
}

console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────`);
process.exit(fail === 0 ? 0 : 1);
