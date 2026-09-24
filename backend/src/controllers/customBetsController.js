const CustomBet = require("../models/CustomBet");
const { sanitizeString, validateBetAmount } = require("../middleware/validation");

function parseEndAt(endAt) {
  if (!endAt) return null;
  const t = new Date(endAt).getTime(); // accepts ISO or "YYYY-MM-DDTHH:mm"
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

class CustomBetsController {
  static list(req, res) {
    const status = req.query.status || "open";
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = req.query.q || "";
    const data = CustomBet.listMarkets({ status, limit, offset, q });
    res.json({ success: true, data });
  }

  static getOne(req, res) {
    const betId = Number(req.params.betId);
    const bet = CustomBet.getMarketById(betId);
    if (!bet) return res.status(404).json({ success: false, message: "Bet not found" });
    res.json({ success: true, data: bet });
  }

  // multipart create: title, description, showGraph, showPercentages, endAt, options(JSON), image(optional)
  static create(req, res) {
    const creatorId = req.user.id;
    const body = req.body || {};

    const title = sanitizeString(body.title, 140);
    const description = sanitizeString(body.description || "", 1000);

    const showGraph = String(body.showGraph).toLowerCase() === "true" || body.showGraph === true;
    const showPercentages =
      String(body.showPercentages).toLowerCase() === "true" || body.showPercentages === true;

    const endAt = parseEndAt(body.endAt);
    if (!endAt) return res.status(400).json({ success: false, message: "Invalid end time" });

    // cannot create past-ended markets
    const endMs = new Date(endAt).getTime();
    if (!Number.isFinite(endMs))
      return res.status(400).json({ success: false, message: "Invalid end time" });
    if (endMs <= Date.now() + 30 * 1000) {
      return res.status(400).json({ success: false, message: "End time must be in the future" });
    }

    let optionsIn = body.options;
    if (typeof optionsIn === "string") {
      try {
        optionsIn = JSON.parse(optionsIn);
      } catch {
        optionsIn = [];
      }
    }
    optionsIn = Array.isArray(optionsIn) ? optionsIn : [];

    if (title.length < 3)
      return res.status(400).json({ success: false, message: "Prediction Name is required" });
    if (optionsIn.length < 2)
      return res.status(400).json({ success: false, message: "At least 2 options required" });

    const options = optionsIn
      .map((o) => ({
        label: sanitizeString(o.label ?? o, 140),
        creator_percent: showPercentages ? Number(o.creator_percent) : null,
      }))
      .filter((o) => o.label.length > 0);

    if (options.length < 2)
      return res
        .status(400)
        .json({ success: false, message: "At least 2 valid options required" });

    if (showPercentages) {
      let sum = 0;
      for (const o of options) {
        const n = Number(o.creator_percent);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return res.status(400).json({ success: false, message: "Invalid percentages" });
        }
        sum += n;
      }
      if (Math.abs(sum - 100) > 0.000001) {
        return res
          .status(400)
          .json({ success: false, message: "Percentages must add up to exactly 100%" });
      }
    }

    const imageUrl = req.file ? `/uploads/custom-bets/${req.file.filename}` : null;

    const bet = CustomBet.createMarket({
      creatorId,
      title,
      description,
      imageUrl,
      options,
      showGraph,
      showPercentages,
      endAt,
    });

    res.json({ success: true, data: bet });
  }

  static placeBet(req, res) {
    const userId = req.user.id;
    const betId = Number(req.params.betId);
    const optionId = Number(req.body.optionId);
    const amount = Number(req.body.amount);

    const v = validateBetAmount(amount);
    if (!v.valid) return res.status(400).json({ success: false, message: v.message });

    const out = CustomBet.placeBet({ betId, optionId, userId, amount });
    res.json({ success: true, data: out });
  }

  static adminClose(req, res) {
    const betId = Number(req.params.betId);
    const bet = CustomBet.closeMarket({ betId, adminId: req.user.id });
    res.json({ success: true, data: bet });
  }

  static adminReopen(req, res) {
    const betId = Number(req.params.betId);
    const bet = CustomBet.reopenMarket({ betId, adminId: req.user.id });
    res.json({ success: true, data: bet });
  }

  static adminExtendEndAt(req, res) {
    const betId = Number(req.params.betId);
    const endAt = parseEndAt(req.body.endAt);
    if (!endAt) return res.status(400).json({ success: false, message: "Invalid end time" });

    const endMs = new Date(endAt).getTime();
    if (!Number.isFinite(endMs))
      return res.status(400).json({ success: false, message: "Invalid end time" });
    if (endMs <= Date.now() + 30 * 1000) {
      return res.status(400).json({ success: false, message: "End time must be in the future" });
    }

    const bet = CustomBet.extendEndAt({ betId, adminId: req.user.id, endAt });
    res.json({ success: true, data: bet });
  }

  static adminResolve(req, res) {
    const betId = Number(req.params.betId);
    const winningOptionId = Number(req.body.winningOptionId);
    if (!Number.isFinite(winningOptionId))
      return res.status(400).json({ success: false, message: "winningOptionId required" });
    const bet = CustomBet.resolveMarket({ betId, adminId: req.user.id, winningOptionId });
    res.json({ success: true, data: bet });
  }

  static adminRemove(req, res) {
    const betId = Number(req.params.betId);
    CustomBet.removeMarket({ betId, adminId: req.user.id });
    res.json({ success: true, data: { removed: true } });
  }

  static graph(req, res) {
    const betId = Number(req.params.betId);
    const optionId = Number(req.query.optionId);
    const bucketMinutes = Math.max(1, Math.min(360, Number(req.query.bucketMinutes || 60)));
    if (!Number.isFinite(optionId))
      return res.status(400).json({ success: false, message: "optionId required" });

    const points = CustomBet.getGraphPoints(betId, optionId, bucketMinutes, 160);

    if (points.length === 1) {
      points.push({ t: new Date().toISOString(), v: points[0].v });
    }

    res.json({ success: true, data: points });
  }

  // =========================
  // Comments (threaded + likes)
  // =========================
  static listComments(req, res) {
    const betId = Number(req.params.betId);
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const offset = parseInt(req.query.offset) || 0;

    const viewerId = req.user?.id ?? null; // optionalAuth route
    const data = CustomBet.listCommentsThreaded({ betId, limit, offset, viewerId });

    res.json({ success: true, data });
  }

  static addComment(req, res) {
    const betId = Number(req.params.betId);
    const body = sanitizeString(req.body.body || "", 1000);
    if (!body) return res.status(400).json({ success: false, message: "Comment required" });

    const row = CustomBet.addComment({ betId, userId: req.user.id, body, parentId: null });
    res.json({ success: true, data: row });
  }

  static replyToComment(req, res) {
    const betId = Number(req.params.betId);
    const parentCommentId = Number(req.params.commentId);
    const body = sanitizeString(req.body.body || "", 1000);
    if (!body) return res.status(400).json({ success: false, message: "Comment required" });

    const row = CustomBet.addComment({
      betId,
      userId: req.user.id,
      body,
      parentId: parentCommentId,
    });

    res.json({ success: true, data: row });
  }

  static editComment(req, res) {
    const commentId = Number(req.params.commentId);
    const body = sanitizeString(req.body.body || "", 1000);
    if (!body) return res.status(400).json({ success: false, message: "Comment required" });

    const isAdmin = req.user.role === "admin" || req.user.role === "owner";
    const row = CustomBet.editComment({ commentId, userId: req.user.id, body, isAdmin });
    res.json({ success: true, data: row });
  }

  static deleteComment(req, res) {
    const commentId = Number(req.params.commentId);
    const isAdmin = req.user.role === "admin" || req.user.role === "owner";
    CustomBet.deleteComment({ commentId, userId: req.user.id, isAdmin });
    res.json({ success: true, data: { deleted: true } });
  }

  static toggleCommentLike(req, res) {
    const betId = Number(req.params.betId);
    const commentId = Number(req.params.commentId);
    const out = CustomBet.toggleCommentLike({ betId, commentId, userId: req.user.id });
    res.json({ success: true, data: out });
  }

  static graphMarket(req, res) {
    const betId = Number(req.params.betId);
    const bucketMinutes = Math.max(1, Math.min(360, Number(req.query.bucketMinutes || 60)));
    const points = CustomBet.getMarketGraphPoints(betId, bucketMinutes, 200);
    res.json({ success: true, data: points });
  }
}

module.exports = CustomBetsController;