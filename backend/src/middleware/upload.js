const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { resolveUploadsDir } = require("../config/storage");

// stored next to the database (outside the project folder by default) so
// images survive restarts, updates and re-downloads exactly like the DB
const baseDir = path.join(resolveUploadsDir(), "custom-bets");
fs.mkdirSync(baseDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, baseDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
    const name = `${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Invalid image type"), ok);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

module.exports = { upload };