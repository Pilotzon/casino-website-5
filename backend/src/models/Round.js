const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Round {
  /**
   * Create a new round
   */
  static create({
    userId,
    gameId,
    betAmount,
    payoutAmount,
    multiplier,
    outcome,
    gameState,
    isAutobet = false,
  }) {
    const roundUuid = uuidv4();

    const result = db.prepare(`
      INSERT INTO rounds (
        round_uuid, user_id, game_id, bet_amount,
        payout_amount, multiplier, outcome, game_state, is_autobet
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      roundUuid,
      userId,
      gameId,
      betAmount,
      payoutAmount,
      multiplier,
      JSON.stringify(outcome),
      JSON.stringify(gameState),
      isAutobet ? 1 : 0
    );

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Persist updated game state (IMPORTANT for Mines)
   */
  static updateGameState(id, gameState) {
    db.prepare(`
      UPDATE rounds
      SET game_state = ?
      WHERE id = ?
    `).run(JSON.stringify(gameState), id);

    return this.findById(id);
  }

  /**
   * Persist updated outcome (optional helper)
   */
  static updateOutcome(id, outcome) {
    db.prepare(`
      UPDATE rounds
      SET outcome = ?
      WHERE id = ?
    `).run(JSON.stringify(outcome), id);

    return this.findById(id);
  }

  /**
   * Update payout/multiplier/outcome (optional helper)
   */
  static updatePayout(id, payoutAmount, multiplier, outcome) {
    db.prepare(`
      UPDATE rounds
      SET payout_amount = ?, multiplier = ?, outcome = ?
      WHERE id = ?
    `).run(
      payoutAmount,
      multiplier,
      JSON.stringify(outcome),
      id
    );

    return this.findById(id);
  }

  /**
   * Find round by ID
   */
  static findById(id) {
    const round = db.prepare(`
      SELECT
        r.*,
        g.name as game_name,
        g.display_name as game_display_name,
        u.username
      FROM rounds r
      JOIN games g ON r.game_id = g.id
      JOIN users u ON r.user_id = u.id
      WHERE r.id = ?
    `).get(id);

    if (round) {
      round.outcome = JSON.parse(round.outcome);
      round.game_state = JSON.parse(round.game_state);
    }

    return round;
  }

  /**
   * Find round by UUID
   */
  static findByUuid(uuid) {
    const round = db.prepare(`
      SELECT
        r.*,
        g.name as game_name,
        g.display_name as game_display_name,
        u.username
      FROM rounds r
      JOIN games g ON r.game_id = g.id
      JOIN users u ON r.user_id = u.id
      WHERE r.round_uuid = ?
    `).get(uuid);

    if (round) {
      round.outcome = JSON.parse(round.outcome);
      round.game_state = JSON.parse(round.game_state);
    }

    return round;
  }

  static getUserRounds(userId, limit = 50, offset = 0) {
    return db.prepare(`
      SELECT
        r.id,
        r.round_uuid,
        r.bet_amount,
        r.payout_amount,
        r.multiplier,
        r.is_autobet,
        r.created_at,
        g.name as game_name,
        g.display_name as game_display_name
      FROM rounds r
      JOIN games g ON r.game_id = g.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
  }

  static getRecentRounds(limit = 100) {
    return db.prepare(`
      SELECT
        r.id,
        r.round_uuid,
        r.bet_amount,
        r.payout_amount,
        r.multiplier,
        r.is_autobet,
        r.created_at,
        g.name as game_name,
        g.display_name as game_display_name,
        u.username
      FROM rounds r
      JOIN games g ON r.game_id = g.id
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  static getGameRounds(gameId, limit = 50, offset = 0) {
    return db.prepare(`
      SELECT
        r.id,
        r.round_uuid,
        r.bet_amount,
        r.payout_amount,
        r.multiplier,
        r.is_autobet,
        r.created_at,
        u.username
      FROM rounds r
      JOIN users u ON r.user_id = u.id
      WHERE r.game_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(gameId, limit, offset);
  }

  static getUserStats(userId, timeframe = '24h') {
    let whereClause = 'WHERE user_id = ?';
    const params = [userId];

    if (timeframe !== 'all') {
      const hours = parseInt(timeframe.replace('h', ''));
      whereClause += ` AND created_at >= datetime('now', '-${hours} hours')`;
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_rounds,
        SUM(bet_amount) as total_wagered,
        SUM(payout_amount) as total_payout,
        SUM(payout_amount - bet_amount) as net_profit,
        MAX(payout_amount) as biggest_win,
        MIN(payout_amount - bet_amount) as biggest_loss,
        SUM(CASE WHEN payout_amount > bet_amount THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN payout_amount <= bet_amount THEN 1 ELSE 0 END) as losses
      FROM rounds
      ${whereClause}
    `).get(...params);

    return {
      total_rounds: stats.total_rounds || 0,
      total_wagered: stats.total_wagered || 0,
      total_payout: stats.total_payout || 0,
      net_profit: stats.net_profit || 0,
      biggest_win: stats.biggest_win || 0,
      biggest_loss: stats.biggest_loss || 0,
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      win_rate: stats.total_rounds > 0 ? ((stats.wins / stats.total_rounds) * 100).toFixed(2) : 0,
    };
  }

  static getPlatformStats(timeframe = '24h') {
    let whereClause = '';

    if (timeframe !== 'all') {
      const hours = parseInt(timeframe.replace('h', ''));
      whereClause = `WHERE created_at >= datetime('now', '-${hours} hours')`;
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_rounds,
        COUNT(DISTINCT user_id) as active_users,
        SUM(bet_amount) as total_wagered,
        SUM(payout_amount) as total_payout,
        SUM(bet_amount - payout_amount) as house_profit,
        MAX(payout_amount) as biggest_win
      FROM rounds
      ${whereClause}
    `).get();

    return {
      total_rounds: stats.total_rounds || 0,
      active_users: stats.active_users || 0,
      total_wagered: stats.total_wagered || 0,
      total_payout: stats.total_payout || 0,
      house_profit: stats.house_profit || 0,
      biggest_win: stats.biggest_win || 0,
      house_edge: stats.total_wagered > 0
        ? ((stats.house_profit / stats.total_wagered) * 100).toFixed(2)
        : 0,
    };
  }

  static getGameBreakdown(userId, timeframe = '24h') {
    let whereClause = 'WHERE r.user_id = ?';
    const params = [userId];

    if (timeframe !== 'all') {
      const hours = parseInt(timeframe.replace('h', ''));
      whereClause += ` AND r.created_at >= datetime('now', '-${hours} hours')`;
    }

    return db.prepare(`
      SELECT
        g.name,
        g.display_name,
        COUNT(*) as rounds,
        SUM(r.bet_amount) as wagered,
        SUM(r.payout_amount - r.bet_amount) as profit
      FROM rounds r
      JOIN games g ON r.game_id = g.id
      ${whereClause}
      GROUP BY g.id, g.name, g.display_name
      ORDER BY rounds DESC
    `).all(...params);
  }

  static deleteOlderThan(days = 90) {
    const result = db.prepare(`
      DELETE FROM rounds
      WHERE created_at < datetime('now', '-${days} days')
    `).run();

    return result.changes;
  }
}

module.exports = Round;