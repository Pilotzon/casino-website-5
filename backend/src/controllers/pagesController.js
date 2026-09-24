const { db } = require("../config/database");

function canBypass(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === "owner") return true;
  return Boolean(u.can_bypass_disabled);
}

class PagesController {
  static async getSiteStatus(req, res) {
    try {
      const rows = db
        .prepare(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('signup_enabled','maintenance_mode')`)
        .all();
      const map = Object.fromEntries(rows.map((r) => [r.setting_key, String(r.setting_value).toLowerCase() === "true"]));
      res.json({
        success: true,
        data: {
          signup_enabled: map.signup_enabled !== false,
          maintenance_mode: map.maintenance_mode === true,
        },
      });
    } catch (e) {
      console.error("Site status error:", e);
      res.status(500).json({ success: false, message: "Failed to load site status" });
    }
  }

  static async getPages(req, res) {
    try {
      const bypass = canBypass(req);
      const rows = db
        .prepare(`SELECT page_key, display_name, is_enabled, updated_at FROM pages ORDER BY page_key`)
        .all();

      res.json({ success: true, data: rows, meta: { bypass } });
    } catch (e) {
      console.error("Pages get error:", e);
      res.status(500).json({ success: false, message: "Failed to fetch pages" });
    }
  }
}

module.exports = PagesController;