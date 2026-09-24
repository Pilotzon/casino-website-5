const AuditLog = require('../models/AuditLog');
const { getIpAddress } = require('../utils/helpers');

/**
 * Audit Service
 * Centralized logging for all platform actions
 */
class AuditService {
  
  /**
   * Log user login
   */
  static logLogin(userId, req) {
    return AuditLog.create({
      userId,
      actionType: AuditLog.ACTION_TYPES.LOGIN,
      actionDetails: {
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent']
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log user logout
   */
  static logLogout(userId, req) {
    return AuditLog.create({
      userId,
      actionType: AuditLog.ACTION_TYPES.LOGOUT,
      actionDetails: {
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log balance adjustment by admin
   */
  static logBalanceAdjustment(userId, adminId, amount, reason, req) {
    return AuditLog.create({
      userId,
      adminId,
      actionType: AuditLog.ACTION_TYPES.BALANCE_ADJUSTED,
      actionDetails: {
        amount,
        reason,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log role change
   */
  static logRoleChange(userId, adminId, oldRole, newRole, req) {
    return AuditLog.create({
      userId,
      adminId,
      actionType: AuditLog.ACTION_TYPES.ROLE_CHANGED,
      actionDetails: {
        old_role: oldRole,
        new_role: newRole,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log account status change
   */
  static logAccountStatusChange(userId, adminId, isActive, req) {
    return AuditLog.create({
      userId,
      adminId,
      actionType: AuditLog.ACTION_TYPES.ACCOUNT_STATUS_CHANGED,
      actionDetails: {
        is_active: isActive,
        action: isActive ? 'activated' : 'deactivated',
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log game status change
   */
  static logGameStatusChange(adminId, gameId, gameName, isEnabled, req) {
    return AuditLog.create({
      adminId,
      actionType: AuditLog.ACTION_TYPES.GAME_STATUS_CHANGED,
      actionDetails: {
        game_id: gameId,
        game_name: gameName,
        is_enabled: isEnabled,
        action: isEnabled ? 'enabled' : 'disabled',
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log setting change
   */
  static logSettingChange(adminId, settingKey, oldValue, newValue, req) {
    return AuditLog.create({
      adminId,
      actionType: AuditLog.ACTION_TYPES.SETTING_CHANGED,
      actionDetails: {
        setting_key: settingKey,
        old_value: oldValue,
        new_value: newValue,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log bet placement
   */
  static logBetPlaced(userId, gameId, gameName, betAmount, req) {
    return AuditLog.create({
      userId,
      actionType: AuditLog.ACTION_TYPES.BET_PLACED,
      actionDetails: {
        game_id: gameId,
        game_name: gameName,
        bet_amount: betAmount,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log bet resolution
   */
  static logBetResolved(userId, betId, betType, outcome, payout, req = null) {
    return AuditLog.create({
      userId,
      actionType: AuditLog.ACTION_TYPES.BET_RESOLVED,
      actionDetails: {
        bet_id: betId,
        bet_type: betType,
        outcome,
        payout,
        timestamp: new Date().toISOString()
      },
      ipAddress: req ? getIpAddress(req) : null
    });
  }

  /**
   * Log custom bet creation
   */
  static logCustomBetCreated(userId, betId, title, amount, req) {
    return AuditLog.create({
      userId,
      actionType: 'CUSTOM_BET_CREATED',
      actionDetails: {
        bet_id: betId,
        title,
        amount,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log custom bet joined
   */
  static logCustomBetJoined(userId, betId, amount, side, req) {
    return AuditLog.create({
      userId,
      actionType: 'CUSTOM_BET_JOINED',
      actionDetails: {
        bet_id: betId,
        amount,
        side,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log stock bet placement
   */
  static logStockBetPlaced(userId, symbol, direction, entryPrice, amount, timeframe, req) {
    return AuditLog.create({
      userId,
      actionType: 'STOCK_BET_PLACED',
      actionDetails: {
        symbol,
        direction,
        entry_price: entryPrice,
        amount,
        timeframe,
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log failed login attempt
   */
  static logFailedLogin(email, reason, req) {
    return AuditLog.create({
      actionType: 'LOGIN_FAILED',
      actionDetails: {
        email,
        reason,
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent']
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log suspicious activity
   */
  static logSuspiciousActivity(userId, activityType, details, req) {
    return AuditLog.create({
      userId,
      actionType: 'SUSPICIOUS_ACTIVITY',
      actionDetails: {
        activity_type: activityType,
        details,
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent']
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Log password change
   */
  static logPasswordChange(userId, req) {
    return AuditLog.create({
      userId,
      actionType: AuditLog.ACTION_TYPES.PASSWORD_CHANGED,
      actionDetails: {
        timestamp: new Date().toISOString()
      },
      ipAddress: getIpAddress(req)
    });
  }

  /**
   * Get user activity summary
   */
  static getUserActivitySummary(userId, hours = 24) {
    const logs = AuditLog.getUserLogs(userId, 1000);
    const recentLogs = logs.filter(log => {
      const logTime = new Date(log.created_at);
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      return logTime > cutoff;
    });

    const summary = {
      total_actions: recentLogs.length,
      logins: 0,
      bets_placed: 0,
      balance_changes: 0,
      actions_by_type: {}
    };

    recentLogs.forEach(log => {
      summary.actions_by_type[log.action_type] = 
        (summary.actions_by_type[log.action_type] || 0) + 1;

      if (log.action_type === 'LOGIN') summary.logins++;
      if (log.action_type === 'BET_PLACED') summary.bets_placed++;
      if (log.action_type === 'BALANCE_CHANGE' || log.action_type === 'BALANCE_ADJUSTED') {
        summary.balance_changes++;
      }
    });

    return summary;
  }

  /**
   * Get admin activity summary
   */
  static getAdminActivitySummary(adminId, hours = 24) {
    const logs = AuditLog.getAdminActions(adminId, 1000);
    const recentLogs = logs.filter(log => {
      const logTime = new Date(log.created_at);
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      return logTime > cutoff;
    });

    const summary = {
      total_actions: recentLogs.length,
      balance_adjustments: 0,
      role_changes: 0,
      account_status_changes: 0,
      actions_by_type: {}
    };

    recentLogs.forEach(log => {
      summary.actions_by_type[log.action_type] = 
        (summary.actions_by_type[log.action_type] || 0) + 1;

      if (log.action_type === 'BALANCE_ADJUSTED') summary.balance_adjustments++;
      if (log.action_type === 'ROLE_CHANGED') summary.role_changes++;
      if (log.action_type === 'ACCOUNT_STATUS_CHANGED') summary.account_status_changes++;
    });

    return summary;
  }

  /**
   * Detect unusual patterns
   */
  static detectUnusualPatterns(userId) {
    const logs = AuditLog.getUserLogs(userId, 500);
    const last24h = logs.filter(log => {
      const logTime = new Date(log.created_at);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return logTime > cutoff;
    });

    const patterns = {
      warnings: [],
      isUnusual: false
    };

    // Check for excessive betting
    const betsPlaced = last24h.filter(l => l.action_type === 'BET_PLACED').length;
    if (betsPlaced > 1000) {
      patterns.warnings.push(`Excessive betting: ${betsPlaced} bets in 24 hours`);
      patterns.isUnusual = true;
    }

    // Check for multiple logins from different IPs
    const loginIps = new Set(
      last24h.filter(l => l.action_type === 'LOGIN').map(l => l.ip_address)
    );
    if (loginIps.size > 5) {
      patterns.warnings.push(`Multiple IPs: ${loginIps.size} different IPs in 24 hours`);
      patterns.isUnusual = true;
    }

    // Check for rapid balance changes
    const balanceChanges = last24h.filter(
      l => l.action_type === 'BALANCE_CHANGE' || l.action_type === 'BALANCE_ADJUSTED'
    ).length;
    if (balanceChanges > 500) {
      patterns.warnings.push(`Rapid balance changes: ${balanceChanges} changes in 24 hours`);
      patterns.isUnusual = true;
    }

    return patterns;
  }

  /**
   * Export audit logs for a user (for compliance)
   */
  static exportUserLogs(userId, format = 'json') {
    const logs = AuditLog.getUserLogs(userId, 10000); // Get all logs
    
    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    if (format === 'csv') {
      const headers = ['Timestamp', 'Action Type', 'Details', 'IP Address'];
      const rows = logs.map(log => [
        log.created_at,
        log.action_type,
        JSON.stringify(log.action_details),
        log.ip_address || 'N/A'
      ]);

      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    throw new Error('Unsupported format');
  }
}

module.exports = AuditService;