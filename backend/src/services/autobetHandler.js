const GameEngine = require('./gameEngine');
const User = require('../models/User');
const { delay } = require('../utils/helpers');

/**
 * Autobet Handler
 * Processes automated betting sequences with safety controls
 */
class AutobetHandler {
  
  /**
   * Process autobet sequence for Flip
   */
  static async processAutobetFlip(userId, config) {
    const {
      betAmount,
      numberOfBets,
      selectedSide,
      onWinIncrease = 0,
      onLossIncrease = 0,
      stopOnProfit = null,
      stopOnLoss = null
    } = config;

    const results = [];
    let currentBet = betAmount;
    let totalProfit = 0;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;

    const maxBets = numberOfBets === 0 ? 1000 : numberOfBets; // Cap infinite at 1000 per session

    for (let i = 0; i < maxBets; i++) {
      // Check if user has sufficient balance
      const user = User.findById(userId);
      if (user.balance < currentBet) {
        break; // Stop if insufficient balance
      }

      // Rate limiting - small delay between bets
      if (i > 0) {
        await delay(100); // 100ms between bets
      }

      // Process the bet
      try {
        const result = await GameEngine.processFlip(userId, currentBet, selectedSide);
        
        const profit = result.result.payout - currentBet;
        totalProfit += profit;

        results.push({
          betNumber: i + 1,
          betAmount: currentBet,
          outcome: result.result.outcome,
          won: result.result.won,
          profit,
          balance: result.result.balance
        });

        // Update consecutive counters
        if (result.result.won) {
          consecutiveWins++;
          consecutiveLosses = 0;
          
          // Increase bet on win
          if (onWinIncrease > 0) {
            currentBet = currentBet * (1 + onWinIncrease / 100);
          }
        } else {
          consecutiveLosses++;
          consecutiveWins = 0;
          
          // Increase bet on loss
          if (onLossIncrease > 0) {
            currentBet = currentBet * (1 + onLossIncrease / 100);
          }
        }

        // Check stop conditions
        if (stopOnProfit && totalProfit >= stopOnProfit) {
          break;
        }
        if (stopOnLoss && totalProfit <= -stopOnLoss) {
          break;
        }

      } catch (error) {
        console.error('Autobet error:', error);
        break;
      }
    }

    return {
      success: true,
      totalBets: results.length,
      totalProfit,
      results
    };
  }

  /**
   * Process autobet sequence for Dice
   */
  static async processAutobetDice(userId, config) {
    const {
      betAmount,
      numberOfBets,
      targetNumber,
      rollUnder = true,
      onWinIncrease = 0,
      onLossIncrease = 0,
      stopOnProfit = null,
      stopOnLoss = null
    } = config;

    const results = [];
    let currentBet = betAmount;
    let totalProfit = 0;

    const maxBets = numberOfBets === 0 ? 1000 : numberOfBets;

    for (let i = 0; i < maxBets; i++) {
      const user = User.findById(userId);
      if (user.balance < currentBet) break;

      if (i > 0) await delay(100);

      try {
        const result = await GameEngine.processDice(userId, currentBet, targetNumber, rollUnder);
        
        const profit = result.result.payout - currentBet;
        totalProfit += profit;

        results.push({
          betNumber: i + 1,
          betAmount: currentBet,
          roll: result.result.roll,
          won: result.result.won,
          profit,
          balance: result.result.balance
        });

        if (result.result.won) {
          if (onWinIncrease > 0) {
            currentBet = currentBet * (1 + onWinIncrease / 100);
          }
        } else {
          if (onLossIncrease > 0) {
            currentBet = currentBet * (1 + onLossIncrease / 100);
          }
        }

        if (stopOnProfit && totalProfit >= stopOnProfit) break;
        if (stopOnLoss && totalProfit <= -stopOnLoss) break;

      } catch (error) {
        console.error('Autobet error:', error);
        break;
      }
    }

    return {
      success: true,
      totalBets: results.length,
      totalProfit,
      results
    };
  }

  /**
   * Process autobet sequence for Limbo
   */
  static async processAutobetLimbo(userId, config) {
    const {
      betAmount,
      numberOfBets,
      targetMultiplier,
      onWinIncrease = 0,
      onLossIncrease = 0,
      stopOnProfit = null,
      stopOnLoss = null
    } = config;

    const results = [];
    let currentBet = betAmount;
    let totalProfit = 0;

    const maxBets = numberOfBets === 0 ? 1000 : numberOfBets;

    for (let i = 0; i < maxBets; i++) {
      const user = User.findById(userId);
      if (user.balance < currentBet) break;

      if (i > 0) await delay(100);

      try {
        const result = await GameEngine.processLimbo(userId, currentBet, targetMultiplier);
        
        const profit = result.result.payout - currentBet;
        totalProfit += profit;

        results.push({
          betNumber: i + 1,
          betAmount: currentBet,
          multiplier: result.result.multiplier,
          won: result.result.won,
          profit,
          balance: result.result.balance
        });

        if (result.result.won) {
          if (onWinIncrease > 0) {
            currentBet = currentBet * (1 + onWinIncrease / 100);
          }
        } else {
          if (onLossIncrease > 0) {
            currentBet = currentBet * (1 + onLossIncrease / 100);
          }
        }

        if (stopOnProfit && totalProfit >= stopOnProfit) break;
        if (stopOnLoss && totalProfit <= -stopOnLoss) break;

      } catch (error) {
        console.error('Autobet error:', error);
        break;
      }
    }

    return {
      success: true,
      totalBets: results.length,
      totalProfit,
      results
    };
  }

  /**
   * Process autobet sequence for Plinko
   */
  static async processAutobetPlinko(userId, config) {
    const {
      betAmount,
      numberOfBets,
      rows = 16,
      onWinIncrease = 0,
      onLossIncrease = 0,
      stopOnProfit = null,
      stopOnLoss = null
    } = config;

    const results = [];
    let currentBet = betAmount;
    let totalProfit = 0;

    const maxBets = numberOfBets === 0 ? 1000 : numberOfBets;

    for (let i = 0; i < maxBets; i++) {
      const user = User.findById(userId);
      if (user.balance < currentBet) break;

      if (i > 0) await delay(150); // Plinko takes longer to animate

      try {
        const result = await GameEngine.processPlinko(userId, currentBet, rows);
        
        const profit = result.result.payout - currentBet;
        totalProfit += profit;

        results.push({
          betNumber: i + 1,
          betAmount: currentBet,
          path: result.result.path,
          finalPosition: result.result.finalPosition,
          multiplier: result.result.multiplier,
          profit,
          balance: result.result.balance
        });

        if (profit > 0) {
          if (onWinIncrease > 0) {
            currentBet = currentBet * (1 + onWinIncrease / 100);
          }
        } else {
          if (onLossIncrease > 0) {
            currentBet = currentBet * (1 + onLossIncrease / 100);
          }
        }

        if (stopOnProfit && totalProfit >= stopOnProfit) break;
        if (stopOnLoss && totalProfit <= -stopOnLoss) break;

      } catch (error) {
        console.error('Autobet error:', error);
        break;
      }
    }

    return {
      success: true,
      totalBets: results.length,
      totalProfit,
      results
    };
  }

  /**
   * Process autobet sequence for Keno
   */
  static async processAutobetKeno(userId, config) {
    const {
      betAmount,
      numberOfBets,
      selectedNumbers,
      onWinIncrease = 0,
      onLossIncrease = 0,
      stopOnProfit = null,
      stopOnLoss = null
    } = config;

    const results = [];
    let currentBet = betAmount;
    let totalProfit = 0;

    const maxBets = numberOfBets === 0 ? 1000 : numberOfBets;

    for (let i = 0; i < maxBets; i++) {
      const user = User.findById(userId);
      if (user.balance < currentBet) break;

      if (i > 0) await delay(200);

      try {
        const result = await GameEngine.processKeno(userId, currentBet, selectedNumbers);
        
        const profit = result.result.payout - currentBet;
        totalProfit += profit;

        results.push({
          betNumber: i + 1,
          betAmount: currentBet,
          matchCount: result.result.matchCount,
          multiplier: result.result.multiplier,
          profit,
          balance: result.result.balance
        });

        if (profit > 0) {
          if (onWinIncrease > 0) {
            currentBet = currentBet * (1 + onWinIncrease / 100);
          }
        } else {
          if (onLossIncrease > 0) {
            currentBet = currentBet * (1 + onLossIncrease / 100);
          }
        }

        if (stopOnProfit && totalProfit >= stopOnProfit) break;
        if (stopOnLoss && totalProfit <= -stopOnLoss) break;

      } catch (error) {
        console.error('Autobet error:', error);
        break;
      }
    }

    return {
      success: true,
      totalBets: results.length,
      totalProfit,
      results
    };
  }

  /**
   * Validate autobet configuration
   */
  static validateConfig(config) {
    const { betAmount, numberOfBets, onWinIncrease, onLossIncrease } = config;

    if (!betAmount || betAmount <= 0) {
      throw new Error('Invalid bet amount');
    }

    if (numberOfBets < 0) {
      throw new Error('Invalid number of bets');
    }

    if (numberOfBets > 10000) {
      throw new Error('Maximum 10,000 bets per autobet session');
    }

    if (onWinIncrease < 0 || onWinIncrease > 1000) {
      throw new Error('On win increase must be between 0 and 1000%');
    }

    if (onLossIncrease < 0 || onLossIncrease > 1000) {
      throw new Error('On loss increase must be between 0 and 1000%');
    }

    return true;
  }

  /**
   * Get autobet status (for real-time updates)
   */
  static getStatus(userId) {
    // This would be implemented with WebSocket for real-time status
    // For now, just return a placeholder
    return {
      isRunning: false,
      currentBet: 0,
      totalBets: 0,
      totalProfit: 0
    };
  }
}

module.exports = AutobetHandler;