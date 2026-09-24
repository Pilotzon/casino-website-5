const { db } = require("../config/database");

function requireNotMaintenance(req, res, next) {
  try {
    const row = db
      .prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'maintenance_mode'")
      .get();

    const enabled = row && String(row.setting_value).toLowerCase() === "true";
    if (!enabled) return next();

    return res.status(503).json({
      success: false,
      message: "Maintenance mode is enabled. Betting is temporarily disabled.",
    });
  } catch (e) {
    // If settings table is missing or DB error, fail open or closed?
    // Safer: fail closed for betting routes.
    return res.status(503).json({
      success: false,
      message: "Maintenance mode check failed. Please try again later.",
    });
  }
}

module.exports = { requireNotMaintenance };