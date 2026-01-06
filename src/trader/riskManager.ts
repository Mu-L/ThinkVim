import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { TradeSignal } from '../strategy/baseStrategy';
import config from '../config/env';
import logger from '../utils/logger';

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  adjustedSize?: Decimal;
  warnings: string[];
}

export interface DailyStats {
  date: string;
  totalPnL: Decimal;
  totalVolume: Decimal;
  winRate: number;
  numTrades: number;
  maxDrawdown: Decimal;
}

export interface PositionRisk {
  marketId: string;
  tokenId: string;
  size: Decimal;
  entryPrice: Decimal;
  currentPrice: Decimal;
  unrealizedPnL: Decimal;
  riskPercent: Decimal;
}

export class RiskManager extends EventEmitter {
  private dailyStats: DailyStats;
  private positions = new Map<string, PositionRisk>();
  private tradeHistory: Array<{
    timestamp: number;
    marketId: string;
    tokenId: string;
    side: 'BUY' | 'SELL';
    size: Decimal;
    price: Decimal;
    pnl?: Decimal;
  }> = [];
  private cooldownMarkets = new Set<string>();
  private lastTradeTime = 0;
  private circuitBreaker = false;

  constructor() {
    super();
    this.dailyStats = this.initializeDailyStats();

    // Reset daily stats at midnight
    this.scheduleDailyReset();
  }

  /**
   * Check if a trade signal passes risk management rules
   */
  checkTradeSignal(signal: TradeSignal): RiskCheckResult {
    const warnings: string[] = [];
    let approved = true;
    let adjustedSize = signal.size;

    // Circuit breaker check
    if (this.circuitBreaker) {
      return {
        approved: false,
        reason: 'Circuit breaker activated due to excessive losses',
        warnings: [],
      };
    }

    // Cooldown check
    if (this.cooldownMarkets.has(signal.marketId)) {
      return {
        approved: false,
        reason: 'Market in cooldown period',
        warnings: [],
      };
    }

    // Daily loss limit check
    if (this.dailyStats.totalPnL.lessThan(config.maxDailyLossUsd.negated())) {
      this.activateCircuitBreaker();
      return {
        approved: false,
        reason: `Daily loss limit exceeded: ${this.dailyStats.totalPnL.toFixed(2)}`,
        warnings: [],
      };
    }

    // Position size limit check
    const positionKey = `${signal.marketId}:${signal.tokenId}`;
    const existingPosition = this.positions.get(positionKey);
    const newTotalSize = existingPosition ? existingPosition.size.plus(adjustedSize) : adjustedSize;

    if (newTotalSize.greaterThan(config.maxPositionUsd)) {
      if (existingPosition) {
        adjustedSize = config.maxPositionUsd.minus(existingPosition.size);
        if (adjustedSize.lessThanOrEqualTo(0)) {
          return {
            approved: false,
            reason: 'Position size limit would be exceeded',
            warnings: [],
          };
        }
        warnings.push(`Position size adjusted to meet limit: ${adjustedSize.toFixed(2)}`);
      } else {
        return {
          approved: false,
          reason: 'Position size exceeds limit',
          warnings: [],
        };
      }
    }

    // Market concentration check
    const marketPositions = Array.from(this.positions.values())
      .filter(p => p.marketId === signal.marketId);

    const marketExposure = marketPositions.reduce(
      (sum, p) => sum.plus(p.size), new Decimal(0)
    ).plus(adjustedSize);

    if (marketExposure.greaterThan(config.maxPositionUsd)) {
      return {
        approved: false,
        reason: 'Market exposure limit would be exceeded',
        warnings: [],
      };
    }

    // Trade frequency check (prevent overtrading)
    const now = Date.now();
    if (now - this.lastTradeTime < 1000) { // Max 1 trade per second
      return {
        approved: false,
        reason: 'Trade frequency limit exceeded',
        warnings: [],
      };
    }

    // Confidence threshold check
    if (signal.confidence < 0.3) {
      warnings.push(`Low confidence signal: ${signal.confidence}`);
    }

    // Size validation
    if (adjustedSize.lessThan(1)) {
      return {
        approved: false,
        reason: 'Trade size too small',
        warnings: [],
      };
    }

    return {
      approved,
      adjustedSize,
      warnings,
    };
  }

  /**
   * Record a new position
   */
  recordPosition(marketId: string, tokenId: string, size: Decimal, entryPrice: Decimal): void {
    const positionKey = `${marketId}:${tokenId}`;

    this.positions.set(positionKey, {
      marketId,
      tokenId,
      size,
      entryPrice,
      currentPrice: entryPrice,
      unrealizedPnL: new Decimal(0),
      riskPercent: size.div(config.maxPositionUsd).mul(100),
    });

    logger.info(`Recorded position: ${positionKey}, size: ${size.toFixed(2)}, price: ${entryPrice.toFixed(4)}`);
  }

  /**
   * Update position with current price
   */
  updatePosition(marketId: string, tokenId: string, currentPrice: Decimal): void {
    const positionKey = `${marketId}:${tokenId}`;
    const position = this.positions.get(positionKey);

    if (position) {
      position.currentPrice = currentPrice;
      position.unrealizedPnL = position.size.mul(currentPrice.minus(position.entryPrice));

      // Check for stop loss conditions
      this.checkStopLoss(position);
    }
  }

  /**
   * Close a position and record P&L
   */
  closePosition(marketId: string, tokenId: string, exitPrice: Decimal, size?: Decimal): void {
    const positionKey = `${marketId}:${tokenId}`;
    const position = this.positions.get(positionKey);

    if (!position) {
      logger.warn(`Attempted to close non-existent position: ${positionKey}`);
      return;
    }

    const closedSize = size || position.size;
    const pnl = closedSize.mul(exitPrice.minus(position.entryPrice));

    // Record trade
    this.recordTrade({
      timestamp: Date.now(),
      marketId,
      tokenId,
      side: 'SELL', // Assuming we're closing
      size: closedSize,
      price: exitPrice,
      pnl,
    });

    // Update position size
    position.size = position.size.minus(closedSize);
    if (position.size.lessThanOrEqualTo(0)) {
      this.positions.delete(positionKey);
    }

    // Update daily stats
    this.updateDailyStats(pnl);

    // Check for loss and apply cooldown if needed
    if (pnl.isNegative()) {
      this.applyCooldown(marketId);
    }

    logger.info(`Closed position: ${positionKey}, P&L: ${pnl.toFixed(4)}, remaining size: ${position.size.toFixed(2)}`);
  }

  /**
   * Check for stop loss conditions
   */
  private checkStopLoss(position: PositionRisk): void {
    const lossPercent = position.unrealizedPnL.div(position.size.mul(position.entryPrice)).mul(100);

    // Emergency stop loss at 10%
    if (lossPercent.lessThan(-10)) {
      logger.warn(`Emergency stop loss triggered for ${position.marketId}:${position.tokenId}, loss: ${lossPercent.toFixed(2)}%`);
      this.emit('emergencyStopLoss', {
        marketId: position.marketId,
        tokenId: position.tokenId,
        lossPercent,
        position,
      });
    }
  }

  /**
   * Record a trade for statistics
   */
  private recordTrade(trade: {
    timestamp: number;
    marketId: string;
    tokenId: string;
    side: 'BUY' | 'SELL';
    size: Decimal;
    price: Decimal;
    pnl?: Decimal;
  }): void {
    this.tradeHistory.push(trade);
    this.lastTradeTime = trade.timestamp;

    // Keep only recent trades (last 1000)
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory = this.tradeHistory.slice(-1000);
    }
  }

  /**
   * Update daily statistics
   */
  private updateDailyStats(pnl: Decimal): void {
    this.dailyStats.totalPnL = this.dailyStats.totalPnL.plus(pnl);
    this.dailyStats.totalVolume = this.dailyStats.totalVolume.plus(pnl.abs());
    this.dailyStats.numTrades++;

    // Calculate win rate
    const winningTrades = this.tradeHistory.filter(t => t.pnl && t.pnl.greaterThan(0)).length;
    this.dailyStats.winRate = this.dailyStats.numTrades > 0 ? winningTrades / this.dailyStats.numTrades : 0;

    // Update max drawdown
    if (this.dailyStats.totalPnL.lessThan(this.dailyStats.maxDrawdown)) {
      this.dailyStats.maxDrawdown = this.dailyStats.totalPnL;
    }

    this.emit('dailyStatsUpdate', this.dailyStats);
  }

  /**
   * Apply cooldown to a market after a loss
   */
  private applyCooldown(marketId: string): void {
    this.cooldownMarkets.add(marketId);

    // Remove cooldown after 5 minutes
    setTimeout(() => {
      this.cooldownMarkets.delete(marketId);
      logger.info(`Cooldown expired for market: ${marketId}`);
    }, 5 * 60 * 1000);

    logger.info(`Applied cooldown to market: ${marketId}`);
  }

  /**
   * Activate circuit breaker
   */
  private activateCircuitBreaker(): void {
    this.circuitBreaker = true;
    logger.error('Circuit breaker activated - trading suspended');

    // Reset after 1 hour
    setTimeout(() => {
      this.circuitBreaker = false;
      this.resetDailyStats();
      logger.info('Circuit breaker reset - trading resumed');
    }, 60 * 60 * 1000);

    this.emit('circuitBreaker', true);
  }

  /**
   * Get current risk metrics
   */
  getRiskMetrics(): {
    totalExposure: Decimal;
    dailyPnL: Decimal;
    dailyWinRate: number;
    activePositions: number;
    cooldownMarkets: string[];
    circuitBreaker: boolean;
  } {
    const totalExposure = Array.from(this.positions.values())
      .reduce((sum, pos) => sum.plus(pos.size), new Decimal(0));

    return {
      totalExposure,
      dailyPnL: this.dailyStats.totalPnL,
      dailyWinRate: this.dailyStats.winRate,
      activePositions: this.positions.size,
      cooldownMarkets: Array.from(this.cooldownMarkets),
      circuitBreaker: this.circuitBreaker,
    };
  }

  /**
   * Get all active positions
   */
  getActivePositions(): PositionRisk[] {
    return Array.from(this.positions.values());
  }

  /**
   * Initialize daily stats
   */
  private initializeDailyStats(): DailyStats {
    return {
      date: new Date().toISOString().split('T')[0],
      totalPnL: new Decimal(0),
      totalVolume: new Decimal(0),
      winRate: 0,
      numTrades: 0,
      maxDrawdown: new Decimal(0),
    };
  }

  /**
   * Reset daily statistics
   */
  private resetDailyStats(): void {
    this.dailyStats = this.initializeDailyStats();
    logger.info('Daily statistics reset');
  }

  /**
   * Schedule daily reset at midnight
   */
  private scheduleDailyReset(): void {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      this.resetDailyStats();
      // Schedule next reset
      setInterval(() => this.resetDailyStats(), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
  }

  /**
   * Check if trading is allowed (not in cooldown or circuit breaker)
   */
  canTrade(marketId?: string): boolean {
    if (this.circuitBreaker) return false;
    if (marketId && this.cooldownMarkets.has(marketId)) return false;
    return true;
  }
}

export default RiskManager;
