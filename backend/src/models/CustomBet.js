const { db } = require("../config/database");

/**
 * REQUIRED DB MIGRATION (SQLite)
 * --------------------------------
 * -- Add parent_id (threading) to comments
 * ALTER TABLE custom_bet_comments_v2 ADD COLUMN parent_id INTEGER;
 *
 * -- Index for faster lookups
 * CREATE INDEX IF NOT EXISTS idx_custom_bet_comments_v2_bet_parent_created
 * ON custom_bet_comments_v2 (bet_id, parent_id, created_at);
 *
 * -- Likes table
 * CREATE TABLE IF NOT EXISTS custom_bet_comment_likes_v2 (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   bet_id INTEGER NOT NULL,
 *   comment_id INTEGER NOT NULL,
 *   user_id INTEGER NOT NULL,
 *   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   UNIQUE(comment_id, user_id)
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_custom_bet_comment_likes_v2_comment
 * ON custom_bet_comment_likes_v2 (comment_id);
 */

function toIntBool(v) {
  return v ? 1 : 0;
}

class CustomBet {
  static createMarket({ creatorId, title, description, imageUrl, options, showGraph, showPercentages, endAt }) {
    return db.transaction(() => {
      const res = db
        .prepare(
          `
        INSERT INTO custom_bets_v2
          (creator_id, title, description, image_url, show_graph, show_percentages, end_at, status)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, 'open')
      `
        )
        .run(
          creatorId,
          title,
          description ?? null,
          imageUrl ?? null,
          toIntBool(showGraph),
          toIntBool(showPercentages),
          endAt
        );

      const betId = res.lastInsertRowid;

      const insertOpt = db.prepare(`
        INSERT INTO custom_bet_options_v2 (bet_id, label, sort_index, creator_percent)
        VALUES (?, ?, ?, ?)
      `);

      options.forEach((opt, idx) => {
        insertOpt.run(betId, opt.label, idx, opt.creator_percent ?? null);
      });

      return this.getMarketById(betId);
    })();
  }

  static getOptions(betId) {
    return db
      .prepare(
        `
      SELECT id, bet_id, label, sort_index, creator_percent
      FROM custom_bet_options_v2
      WHERE bet_id = ?
      ORDER BY sort_index ASC, id ASC
    `
      )
      .all(betId);
  }

  static getMarketById(betId) {
    const bet = db
      .prepare(
        `
      SELECT b.*,
             u.username as creator_username
      FROM custom_bets_v2 b
      JOIN users u ON u.id = b.creator_id
      WHERE b.id = ?
    `
      )
      .get(betId);

    if (!bet) return null;

    const options = this.getOptions(betId);

    const totals = db
      .prepare(
        `
      SELECT option_id, SUM(amount) as total
      FROM custom_bet_bets_v2
      WHERE bet_id = ?
      GROUP BY option_id
    `
      )
      .all(betId);

    const map = new Map(totals.map((r) => [r.option_id, Number(r.total || 0)]));
    const pool = options.reduce((sum, o) => sum + (map.get(o.id) || 0), 0);

    return {
      ...bet,
      show_graph: Boolean(bet.show_graph),
      show_percentages: Boolean(bet.show_percentages),
      pool_total: pool,
      options: options.map((o) => ({ ...o, total: map.get(o.id) || 0 })),
    };
  }

  static listMarkets({ status = "open", limit = 50, offset = 0, q = "" }) {
    const where = [];
    const params = [];

    if (status) {
      where.push("b.status = ?");
      params.push(status);
    }
    if (q && q.trim()) {
      where.push("(b.title LIKE ? OR b.description LIKE ?)");
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const ids = db
      .prepare(
        `
      SELECT b.id
      FROM custom_bets_v2 b
      ${whereSql}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, limit, offset);

    return ids.map((r) => this.getMarketById(r.id));
  }

  static placeBet({ betId, optionId, userId, amount }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status !== "open") throw new Error("Market closed");

      const endAt = new Date(bet.end_at).getTime();
      if (!Number.isFinite(endAt)) throw new Error("Invalid market end time");
      if (Date.now() >= endAt) throw new Error("Betting ended");

      const opt = db
        .prepare("SELECT id FROM custom_bet_options_v2 WHERE id = ? AND bet_id = ?")
        .get(optionId, betId);
      if (!opt) throw new Error("Option not found");

      const row = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
      if (!row) throw new Error("User not found");
      const bal = Number(row.balance);
      if (bal < amount) throw new Error("Insufficient balance");

      const newBal = bal - amount;
      db.prepare("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        newBal,
        userId
      );

      const res = db
        .prepare(
          `
        INSERT INTO custom_bet_bets_v2 (bet_id, option_id, user_id, amount)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(betId, optionId, userId, amount);

      db.prepare(`INSERT INTO audit_logs (user_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        userId,
        "CUSTOM_BET_PLACED",
        JSON.stringify({ bet_id: betId, option_id: optionId, amount })
      );

      return { bet: this.getMarketById(betId), betSlipId: res.lastInsertRowid, newBalance: newBal };
    })();
  }

  static updateCreatorPercents({ betId, creatorId, percentsByOptionId }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (Number(bet.creator_id) !== Number(creatorId)) throw new Error("Access denied");
      if (!bet.show_percentages) throw new Error("Percentages disabled");

      const options = db.prepare("SELECT id FROM custom_bet_options_v2 WHERE bet_id = ?").all(betId);
      const validIds = new Set(options.map((o) => o.id));

      const update = db.prepare(`
        UPDATE custom_bet_options_v2
        SET creator_percent = ?
        WHERE id = ? AND bet_id = ?
      `);

      for (const [k, v] of Object.entries(percentsByOptionId || {})) {
        const optId = Number(k);
        if (!validIds.has(optId)) continue;
        const num = Number(v);
        if (!Number.isFinite(num) || num < 0 || num > 100) continue;
        update.run(num, optId, betId);
      }

      db.prepare("UPDATE custom_bets_v2 SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(betId);
      return this.getMarketById(betId);
    })();
  }

  static closeMarket({ betId, adminId }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status !== "open") return this.getMarketById(betId);

      db.prepare(
        `
        UPDATE custom_bets_v2
        SET status = 'closed',
            closed_at = CURRENT_TIMESTAMP,
            closed_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(adminId, betId);

      db.prepare(`INSERT INTO audit_logs (admin_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        adminId,
        "CUSTOM_BET_CLOSED",
        JSON.stringify({ bet_id: betId })
      );

      return this.getMarketById(betId);
    })();
  }

  static reopenMarket({ betId, adminId }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status === "removed") throw new Error("Bet removed");
      if (bet.status === "resolved") throw new Error("Bet already resolved");

      const endAt = new Date(bet.end_at).getTime();
      if (!Number.isFinite(endAt)) throw new Error("Invalid market end time");
      if (Date.now() >= endAt) throw new Error("Betting ended");

      db.prepare(
        `
        UPDATE custom_bets_v2
        SET status = 'open',
            closed_at = NULL,
            closed_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(betId);

      db.prepare(`INSERT INTO audit_logs (admin_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        adminId,
        "CUSTOM_BET_REOPENED",
        JSON.stringify({ bet_id: betId })
      );

      return this.getMarketById(betId);
    })();
  }

  static resolveMarket({ betId, adminId, winningOptionId }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status === "removed") throw new Error("Bet removed");
      if (bet.status === "resolved") throw new Error("Bet already resolved");

      const opt = db
        .prepare("SELECT id FROM custom_bet_options_v2 WHERE id = ? AND bet_id = ?")
        .get(winningOptionId, betId);
      if (!opt) throw new Error("Option not found");

      if (bet.status === "open") {
        db.prepare(
          `
          UPDATE custom_bets_v2
          SET status = 'closed',
              closed_at = CURRENT_TIMESTAMP,
              closed_by = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        ).run(adminId, betId);
      }

      db.prepare(
        `
        UPDATE custom_bets_v2
        SET status = 'resolved',
            winning_option_id = ?,
            resolved_by = ?,
            resolved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(winningOptionId, adminId, betId);

      const winners = db
        .prepare(
          `
        SELECT id, user_id, amount
        FROM custom_bet_bets_v2
        WHERE bet_id = ? AND option_id = ? AND status = 'pending'
      `
        )
        .all(betId, winningOptionId);

      const losers = db
        .prepare(
          `
        SELECT id
        FROM custom_bet_bets_v2
        WHERE bet_id = ? AND option_id != ? AND status = 'pending'
      `
        )
        .all(betId, winningOptionId);

      const updBet = db.prepare(`UPDATE custom_bet_bets_v2 SET status = ?, payout_amount = ? WHERE id = ?`);
      const updBal = db.prepare(`UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

      for (const w of winners) {
        const payout = Number(w.amount) * 2;
        updBet.run("won", payout, w.id);
        updBal.run(payout, w.user_id);
      }
      for (const l of losers) {
        updBet.run("lost", 0, l.id);
      }

      db.prepare(`INSERT INTO audit_logs (admin_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        adminId,
        "CUSTOM_BET_RESOLVED",
        JSON.stringify({ bet_id: betId, winning_option_id: winningOptionId })
      );

      return this.getMarketById(betId);
    })();
  }

  static removeMarket({ betId, adminId }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status === "removed") return true;

      const pending = db
        .prepare(`SELECT id, user_id, amount FROM custom_bet_bets_v2 WHERE bet_id = ? AND status = 'pending'`)
        .all(betId);

      const updBet = db.prepare(`UPDATE custom_bet_bets_v2 SET status = 'refunded', payout_amount = ? WHERE id = ?`);
      const updBal = db.prepare(`UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

      for (const p of pending) {
        updBet.run(Number(p.amount), p.id);
        updBal.run(Number(p.amount), p.user_id);
      }

      db.prepare(`UPDATE custom_bets_v2 SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(betId);

      db.prepare(`INSERT INTO audit_logs (admin_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        adminId,
        "CUSTOM_BET_REMOVED",
        JSON.stringify({ bet_id: betId, refunded: pending.length })
      );

      return true;
    })();
  }

  // =========================
  // Comments (threaded + likes)
  // =========================

  static _commentExistsInBet({ betId, commentId }) {
    const row = db
      .prepare(`SELECT id FROM custom_bet_comments_v2 WHERE id = ? AND bet_id = ?`)
      .get(commentId, betId);
    return Boolean(row?.id);
  }

  static addComment({ betId, userId, body, parentId = null }) {
    return db.transaction(() => {
      const bet = db.prepare(`SELECT id FROM custom_bets_v2 WHERE id = ?`).get(betId);
      if (!bet) throw new Error("Bet not found");

      if (parentId != null) {
        const parent = db
          .prepare(`SELECT id, bet_id FROM custom_bet_comments_v2 WHERE id = ?`)
          .get(parentId);
        if (!parent) throw new Error("Parent comment not found");
        if (Number(parent.bet_id) !== Number(betId)) throw new Error("Parent comment mismatch");
      }

      const res = db
        .prepare(
          `INSERT INTO custom_bet_comments_v2 (bet_id, user_id, body, parent_id) VALUES (?, ?, ?, ?)`
        )
        .run(betId, userId, body, parentId);

      // Return the new comment with counts
      const inserted = db
        .prepare(
          `
          SELECT c.id, c.bet_id, c.user_id, c.parent_id, c.body, c.created_at, c.updated_at,
                 u.username
          FROM custom_bet_comments_v2 c
          JOIN users u ON u.id = c.user_id
          WHERE c.id = ?
        `
        )
        .get(res.lastInsertRowid);

      return {
        ...inserted,
        like_count: 0,
        viewer_liked: false,
        reply_count: 0,
      };
    })();
  }

  static editComment({ commentId, userId, body, isAdmin }) {
    return db.transaction(() => {
      const row = db
        .prepare(`SELECT id, user_id FROM custom_bet_comments_v2 WHERE id = ?`)
        .get(commentId);
      if (!row) throw new Error("Comment not found");
      if (!isAdmin && Number(row.user_id) !== Number(userId)) throw new Error("Access denied");

      db.prepare(`UPDATE custom_bet_comments_v2 SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        body,
        commentId
      );

      const updated = db
        .prepare(
          `
        SELECT c.id, c.bet_id, c.user_id, c.parent_id, c.body, c.created_at, c.updated_at, u.username
        FROM custom_bet_comments_v2 c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
      `
        )
        .get(commentId);

      const likeCount = db
        .prepare(`SELECT COUNT(*) as cnt FROM custom_bet_comment_likes_v2 WHERE comment_id = ?`)
        .get(commentId)?.cnt;

      const replyCount = db
        .prepare(`SELECT COUNT(*) as cnt FROM custom_bet_comments_v2 WHERE parent_id = ?`)
        .get(commentId)?.cnt;

      const viewerLiked = db
        .prepare(`SELECT 1 as ok FROM custom_bet_comment_likes_v2 WHERE comment_id = ? AND user_id = ?`)
        .get(commentId, userId);

      return {
        ...updated,
        like_count: Number(likeCount || 0),
        reply_count: Number(replyCount || 0),
        viewer_liked: Boolean(viewerLiked),
      };
    })();
  }

  static deleteComment({ commentId, userId, isAdmin }) {
    return db.transaction(() => {
      const row = db
        .prepare(`SELECT id, user_id FROM custom_bet_comments_v2 WHERE id = ?`)
        .get(commentId);
      if (!row) throw new Error("Comment not found");
      if (!isAdmin && Number(row.user_id) !== Number(userId)) throw new Error("Access denied");

      // Delete likes for this comment and its replies
      const childIds = db
        .prepare(`SELECT id FROM custom_bet_comments_v2 WHERE parent_id = ?`)
        .all(commentId)
        .map((r) => r.id);

      const allIds = [commentId, ...childIds];

      const delLikes = db.prepare(`DELETE FROM custom_bet_comment_likes_v2 WHERE comment_id = ?`);
      const delComment = db.prepare(`DELETE FROM custom_bet_comments_v2 WHERE id = ?`);

      for (const id of allIds) delLikes.run(id);
      for (const id of childIds) delComment.run(id);
      delComment.run(commentId);

      return true;
    })();
  }

  static toggleCommentLike({ betId, commentId, userId }) {
    return db.transaction(() => {
      if (!this._commentExistsInBet({ betId, commentId })) throw new Error("Comment not found");

      const existing = db
        .prepare(`SELECT id FROM custom_bet_comment_likes_v2 WHERE comment_id = ? AND user_id = ?`)
        .get(commentId, userId);

      if (existing?.id) {
        db.prepare(`DELETE FROM custom_bet_comment_likes_v2 WHERE id = ?`).run(existing.id);
      } else {
        db.prepare(
          `INSERT OR IGNORE INTO custom_bet_comment_likes_v2 (bet_id, comment_id, user_id) VALUES (?, ?, ?)`
        ).run(betId, commentId, userId);
      }

      const likeCount = db
        .prepare(`SELECT COUNT(*) as cnt FROM custom_bet_comment_likes_v2 WHERE comment_id = ?`)
        .get(commentId)?.cnt;

      const viewerLiked = db
        .prepare(`SELECT 1 as ok FROM custom_bet_comment_likes_v2 WHERE comment_id = ? AND user_id = ?`)
        .get(commentId, userId);

      return {
        comment_id: commentId,
        like_count: Number(likeCount || 0),
        viewer_liked: Boolean(viewerLiked),
      };
    })();
  }

  static listCommentsThreaded({ betId, limit = 100, offset = 0, viewerId = null }) {
    // We fetch a flat list for the bet, then assemble threads in JS
    const rows = db
      .prepare(
        `
      SELECT
        c.id, c.bet_id, c.user_id, c.parent_id, c.body, c.created_at, c.updated_at,
        u.username,
        (SELECT COUNT(*) FROM custom_bet_comment_likes_v2 l WHERE l.comment_id = c.id) as like_count,
        (SELECT COUNT(*) FROM custom_bet_comments_v2 r WHERE r.parent_id = c.id) as reply_count
      FROM custom_bet_comments_v2 c
      JOIN users u ON u.id = c.user_id
      WHERE c.bet_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(betId, limit, offset);

    const likedSet = new Set();
    if (viewerId) {
      const liked = db
        .prepare(
          `
          SELECT comment_id
          FROM custom_bet_comment_likes_v2
          WHERE bet_id = ? AND user_id = ?
        `
        )
        .all(betId, viewerId);

      for (const r of liked) likedSet.add(Number(r.comment_id));
    }

    const norm = rows.map((r) => ({
      ...r,
      like_count: Number(r.like_count || 0),
      reply_count: Number(r.reply_count || 0),
      viewer_liked: viewerId ? likedSet.has(Number(r.id)) : false,
      replies: [],
    }));

    const byId = new Map(norm.map((c) => [Number(c.id), c]));
    const roots = [];

    // Build threads: parent -> replies
    for (const c of norm) {
      if (c.parent_id) {
        const parent = byId.get(Number(c.parent_id));
        if (parent) parent.replies.push(c);
        else roots.push(c); // orphan safety
      } else {
        roots.push(c);
      }
    }

    // Sort replies ascending (oldest first feels nicer inside a thread)
    for (const r of roots) {
      if (r.replies?.length) {
        r.replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
    }

    return roots;
  }

  // =========================
  // Graph points
  // =========================
  static getGraphPoints(betId, optionId, bucketMinutes = 60, maxPoints = 140) {
    const opts = this.getOptions(betId);
    if (!opts.length) return [];

    const bets = db
      .prepare(
        `
      SELECT option_id, amount, created_at
      FROM custom_bet_bets_v2
      WHERE bet_id = ?
      ORDER BY created_at ASC
    `
      )
      .all(betId);

    if (!bets.length) return [];

    const bucketMs = bucketMinutes * 60 * 1000;
    const totals = new Map(opts.map((o) => [o.id, 0]));
    const points = [];

    let lastBucket = null;

    for (const b of bets) {
      const t = new Date(b.created_at).getTime();
      if (!Number.isFinite(t)) continue;

      const bucket = Math.floor(t / bucketMs) * bucketMs;

      totals.set(b.option_id, (totals.get(b.option_id) || 0) + Number(b.amount || 0));

      if (lastBucket === null) lastBucket = bucket;

      if (bucket !== lastBucket) {
        const sum = Array.from(totals.values()).reduce((a, x) => a + x, 0) || 0;
        const pct = sum ? ((totals.get(optionId) || 0) / sum) * 100 : 0;
        points.push({ t: new Date(lastBucket).toISOString(), v: pct });
        lastBucket = bucket;
      }
    }

    if (lastBucket !== null) {
      const sum = Array.from(totals.values()).reduce((a, x) => a + x, 0) || 0;
      const pct = sum ? ((totals.get(optionId) || 0) / sum) * 100 : 0;
      points.push({ t: new Date(lastBucket).toISOString(), v: pct });
    }

    if (points.length > maxPoints) {
      const step = Math.ceil(points.length / maxPoints);
      return points.filter((_, i) => i % step === 0);
    }

    return points;
  }

  static extendEndAt({ betId, adminId, endAt }) {
    return db.transaction(() => {
      const bet = db.prepare("SELECT * FROM custom_bets_v2 WHERE id = ?").get(betId);
      if (!bet) throw new Error("Bet not found");
      if (bet.status === "removed") throw new Error("Bet removed");
      if (bet.status === "resolved") throw new Error("Bet already resolved");

      db.prepare(
        `
        UPDATE custom_bets_v2
        SET end_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(endAt, betId);

      db.prepare(`INSERT INTO audit_logs (admin_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        adminId,
        "CUSTOM_BET_END_AT_EXTENDED",
        JSON.stringify({ bet_id: betId, end_at: endAt })
      );

      return this.getMarketById(betId);
    })();
  }

  static getMarketGraphPoints(betId, bucketMinutes = 60, maxPoints = 180) {
    const opts = this.getOptions(betId);
    if (!opts.length) return [];

    const bets = db
      .prepare(
        `
      SELECT option_id, amount, created_at
      FROM custom_bet_bets_v2
      WHERE bet_id = ?
      ORDER BY created_at ASC
    `
      )
      .all(betId);

    if (!bets.length) return [];

    const bucketMs = bucketMinutes * 60 * 1000;
    const totals = new Map(opts.map((o) => [o.id, 0]));

    const points = [];
    let lastBucket = null;

    const findDominant = () => {
      let bestId = null;
      let best = -1;
      let sum = 0;
      for (const [id, v] of totals.entries()) {
        const n = Number(v) || 0;
        sum += n;
        if (n > best) {
          best = n;
          bestId = id;
        }
      }
      const pct = sum ? (best / sum) * 100 : 0;
      const label = opts.find((o) => o.id === bestId)?.label || "Option";
      return { pct, label };
    };

    for (const b of bets) {
      const t = new Date(b.created_at).getTime();
      if (!Number.isFinite(t)) continue;
      const bucket = Math.floor(t / bucketMs) * bucketMs;

      totals.set(b.option_id, (totals.get(b.option_id) || 0) + Number(b.amount || 0));

      if (lastBucket === null) lastBucket = bucket;

      if (bucket !== lastBucket) {
        const dom = findDominant();
        points.push({ t: new Date(lastBucket).toISOString(), v: dom.pct, label: dom.label });
        lastBucket = bucket;
      }
    }

    if (lastBucket !== null) {
      const dom = findDominant();
      points.push({ t: new Date(lastBucket).toISOString(), v: dom.pct, label: dom.label });
    }

    if (points.length === 1)
      points.push({ t: new Date().toISOString(), v: points[0].v, label: points[0].label });

    if (points.length > maxPoints) {
      const step = Math.ceil(points.length / maxPoints);
      return points.filter((_, i) => i % step === 0);
    }

    return points;
  }

  // =========================
  // Dashboard helpers (missing — caused 500 on /dashboard)
  // =========================
  static getCreatorStats(userId) {
    const total_markets = db.prepare(`SELECT COUNT(*) as c FROM custom_bets_v2 WHERE creator_id=?`).get(userId)?.c || 0;
    const active_markets = db.prepare(`SELECT COUNT(*) as c FROM custom_bets_v2 WHERE creator_id=? AND status='open'`).get(userId)?.c || 0;
    const volume_row = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM custom_bet_bets_v2 WHERE bet_id IN (SELECT id FROM custom_bets_v2 WHERE creator_id=?)`).get(userId);
    const total_volume = Number(volume_row?.s || 0);
    const total_bets_row = db.prepare(`SELECT COUNT(*) as c FROM custom_bet_bets_v2 WHERE user_id=?`).get(userId);
    const total_bets = total_bets_row?.c || 0;
    const profit_row = db.prepare(`SELECT COALESCE(SUM(payout_amount - amount),0) as p FROM custom_bet_bets_v2 WHERE user_id=? AND status IN ('won','lost')`).get(userId);
    const net_profit = Number(profit_row?.p || 0);
    return { total_markets, active_markets, total_volume, total_bets, net_profit, total_pool: total_volume, total: total_markets, open: active_markets, profit: net_profit, participated: total_bets };
  }

  static getUserBets(userId, limit = 50) {
    try {
      return db.prepare(`SELECT * FROM custom_bets_v2 WHERE creator_id=? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
    } catch { return []; }
  }

  static getUserParticipations(userId, limit = 50) {
    try {
      return db.prepare(`
      SELECT b.id, b.bet_id, b.option_id, b.amount, b.payout_amount, b.status, b.created_at,
             m.title, m.status as market_status, o.label as option_label
      FROM custom_bet_bets_v2 b
      JOIN custom_bets_v2 m ON b.bet_id=m.id
      LEFT JOIN custom_bet_options_v2 o ON b.option_id=o.id
      WHERE b.user_id=?
      ORDER BY b.created_at DESC
      LIMIT ?
    `).all(userId, limit);
    } catch { return []; }
  }
}

module.exports = CustomBet;