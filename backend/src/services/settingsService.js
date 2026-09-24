const { db } = require("../config/database");

// cache
let cache = null;
let cacheAt = 0;
const TTL_MS = 5000; // refresh every 5 seconds

function loadSettings() {
  const rows = db.prepare("SELECT setting_key, setting_value FROM system_settings").all();
  const obj = {};
  for (const r of rows) obj[r.setting_key] = r.setting_value;
  return obj;
}

function getSettings() {
  const now = Date.now();
  if (!cache || now - cacheAt > TTL_MS) {
    cache = loadSettings();
    cacheAt = now;
  }
  return cache;
}

function getNumberSetting(key, fallback) {
  const raw = getSettings()[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  getSettings,
  getNumberSetting,
};