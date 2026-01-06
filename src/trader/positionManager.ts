import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { OrderbookSnapshot } from '../market/orderbook';
import PolymarketAPI, { Position } from '../api/polymarket';
import RiskManager, { PositionRisk } from './riskManager';
import logger from '../utils/logger';

export interface PortfolioPosition {
  marketId: string;
  tokenId: string;
  outcome: string;
  size: Decimal;
  avgEntryPrice: Decimal;
  currentPrice: Decimal;
  marketValue: Decimal;
  unrealizedPnL: Decimal;
  unrealizedPnLPercent: Decimal;
  riskPercent: Decimal;
  lastUpdated: number;
}

export interface PortfolioSummary {
  totalValue: Decimal;
  totalUnrealizedPnL: Decimal;
  totalRealizedPnL: Decimal;
  winRate: number;
  activePositions: number;
  totalRisk: Decimal;
  sharpeRatio?: Decimal;
  maxDrawdown: Decimal;
}

export class PositionManager extends EventEmitter {
  private api: PolymarketAPI;
  private riskManager: RiskManager;
  private positions = new Map<string, PortfolioPosition>();
  private realizedPnL = new Decimal(0);
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private lastSyncTime = 0;

  constructor(api: PolymarketAPI, riskManager: RiskManager) {
    super();
    this.api = api;
    this.riskManager = riskManager;

    // Start periodic position updates
    this.startPositionUpdates();
  }

  /**
   * Sync positions from API
   */
  async syncPositions(): Promise<void> {
    try {
      const apiPositions = await this.api.getPositions();
      const syncedPositions = new Map<string, PortfolioPosition>();

      for (const apiPos of apiPositions) {
        const key = `${apiPos.market}:${apiPos.outcome}`;

        // Get current price (simplified - would need orderbook data)
        const currentPrice = new Decimal(apiPos.avgPrice); // Placeholder

        const position: PortfolioPosition = {
          marketId: apiPos.market,
          tokenId: apiPos.outcome, // Simplified mapping
          outcome: apiPos.outcome,
          size: new Decimal(apiPos.size),
          avgEntryPrice: new Decimal(apiPos.avgPrice),
          currentPrice,
          marketValue: new Decimal(apiPos.size).mul(currentPrice),
          unrealizedPnL: new Decimal(apiPos.unrealizedPnl),
          unrealizedPnLPercent: new Decimal(apiPos.unrealizedPnl).div(new Decimal(apiPos.size).mul(new Decimal(apiPos.avgPrice))).mul(100),
          riskPercent: new Decimal(apiPos.size).div(100).mul(100), // Simplified risk calculation
          lastUpdated: Date.now(),
        };

        syncedPositions.set(key, position);

        // Update risk manager
        this.riskManager.updatePosition(apiPos.market, apiPos.outcome, currentPrice);
      }

      this.positions = syncedPositions;
      this.lastSyncTime = Date.now();

      logger.info(`Synced ${apiPositions.length} positions from API`);
      this.emit('positionsSynced', Array.from(this.positions.values()));

    } catch (error) {
      logger.error('Failed to sync positions:', error);
    }
  }

  /**
   * Update position prices from orderbook data
   */
  updatePositionPrices(orderbook: OrderbookSnapshot): void {
    const key = `${orderbook.marketId}:${orderbook.tokenId}`;
    const position = this.positions.get(key);

    if (position) {
      const oldPnL = position.unrealizedPnL;
      position.currentPrice = orderbook.midPrice;
      position.marketValue = position.size.mul(orderbook.midPrice);
      position.unrealizedPnL = position.marketValue.minus(position.size.mul(position.avgEntryPrice));
      position.unrealizedPnLPercent = position.unrealizedPnL.div(position.size.mul(position.avgEntryPrice)).mul(100);
      position.lastUpdated = Date.now();

      // Update risk manager
      this.riskManager.updatePosition(position.marketId, position.tokenId, position.currentPrice);

      // Emit update if P&L changed significantly
      const pnlChange = position.unrealizedPnL.minus(oldPnL);
      if (pnlChange.abs().greaterThan(0.1)) { // $0.10 threshold
        this.emit('positionUpdated', position);
      }
    }
  }

  /**
   * Add or update a position
   */
  addOrUpdatePosition(
    marketId: string,
    tokenId: string,
    outcome: string,
    size: Decimal,
    price: Decimal,
    isNewPosition = false
  ): void {
    const key = `${marketId}:${tokenId}`;
    const existing = this.positions.get(key);

    if (existing && !isNewPosition) {
      // Update existing position (partial fill)
      const totalSize = existing.size.plus(size);
      const totalValue = existing.size.mul(existing.avgEntryPrice).plus(size.mul(price));
      existing.avgEntryPrice = totalValue.div(totalSize);
      existing.size = totalSize;
      existing.lastUpdated = Date.now();

      logger.info(`Updated position ${key}: size ${existing.size.toFixed(2)}, avg price ${existing.avgEntryPrice.toFixed(4)}`);
    } else {
      // New position
      const position: PortfolioPosition = {
        marketId,
        tokenId,
        outcome,
        size,
        avgEntryPrice: price,
        currentPrice: price,
        marketValue: size.mul(price),
        unrealizedPnL: new Decimal(0),
        unrealizedPnLPercent: new Decimal(0),
        riskPercent: size.div(100).mul(100), // Simplified
        lastUpdated: Date.now(),
      };

      this.positions.set(key, position);
      logger.info(`Added new position ${key}: size ${size.toFixed(2)}, price ${price.toFixed(4)}`);
    }

    this.emit('positionChanged', this.positions.get(key));
  }

  /**
   * Close a position (full or partial)
   */
  closePosition(
    marketId: string,
    tokenId: string,
    size: Decimal,
    exitPrice: Decimal
  ): boolean {
    const key = `${marketId}:${tokenId}`;
    const position = this.positions.get(key);

    if (!position) {
      logger.warn(`Attempted to close non-existent position: ${key}`);
      return false;
    }

    if (size.greaterThan(position.size)) {
      logger.warn(`Attempted to close more than position size: ${size} > ${position.size}`);
      size = position.size;
    }

    // Calculate realized P&L
    const exitValue = size.mul(exitPrice);
    const entryValue = size.mul(position.avgEntryPrice);
    const realizedPnL = exitValue.minus(entryValue);

    this.realizedPnL = this.realizedPnL.plus(realizedPnL);

    // Update position size
    position.size = position.size.minus(size);
    position.lastUpdated = Date.now();

    if (position.size.lessThanOrEqualTo(0)) {
      this.positions.delete(key);
      logger.info(`Closed position ${key}: realized P&L ${realizedPnL.toFixed(4)}`);
    } else {
      logger.info(`Partially closed position ${key}: closed ${size.toFixed(2)}, remaining ${position.size.toFixed(2)}, realized P&L ${realizedPnL.toFixed(4)}`);
    }

    // Notify risk manager
    this.riskManager.closePosition(marketId, tokenId, exitPrice, size);

    this.emit('positionClosed', {
      marketId,
      tokenId,
      closedSize: size,
      exitPrice,
      realizedPnL,
      remainingSize: position.size,
    });

    return true;
  }

  /**
   * Get position by market and token
   */
  getPosition(marketId: string, tokenId: string): PortfolioPosition | undefined {
    return this.positions.get(`${marketId}:${tokenId}`);
  }

  /**
   * Get all positions
   */
  getAllPositions(): PortfolioPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get positions for a specific market
   */
  getMarketPositions(marketId: string): PortfolioPosition[] {
    return Array.from(this.positions.values())
      .filter(pos => pos.marketId === marketId);
  }

  /**
   * Get portfolio summary
   */
  getPortfolioSummary(): PortfolioSummary {
    const positions = Array.from(this.positions.values());

    const totalValue = positions.reduce(
      (sum, pos) => sum.plus(pos.marketValue), new Decimal(0)
    );

    const totalUnrealizedPnL = positions.reduce(
      (sum, pos) => sum.plus(pos.unrealizedPnL), new Decimal(0)
    );

    const totalRisk = positions.reduce(
      (sum, pos) => sum.plus(pos.riskPercent), new Decimal(0)
    );

    // Calculate win rate (positions with positive P&L)
    const winningPositions = positions.filter(pos => pos.unrealizedPnL.greaterThan(0)).length;
    const winRate = positions.length > 0 ? winningPositions / positions.length : 0;

    // Get risk metrics
    const riskMetrics = this.riskManager.getRiskMetrics();

    return {
      totalValue,
      totalUnrealizedPnL,
      totalRealizedPnL: this.realizedPnL,
      winRate,
      activePositions: positions.length,
      totalRisk,
      maxDrawdown: riskMetrics.dailyPnL, // Simplified
    };
  }

  /**
   * Get positions sorted by P&L
   */
  getPositionsByPnL(ascending = false): PortfolioPosition[] {
    return Array.from(this.positions.values())
      .sort((a, b) => {
        const comparison = a.unrealizedPnL.compare(b.unrealizedPnL);
        return ascending ? comparison : -comparison;
      });
  }

  /**
   * Get positions sorted by size
   */
  getPositionsBySize(ascending = false): PortfolioPosition[] {
    return Array.from(this.positions.values())
      .sort((a, b) => {
        const comparison = a.size.compare(b.size);
        return ascending ? comparison : -comparison;
      });
  }

  /**
   * Get positions near resolution (high risk)
   */
  getPositionsNearResolution(hoursThreshold = 24): PortfolioPosition[] {
    // This would need market data to determine time to resolution
    // For now, return empty array
    return [];
  }

  /**
   * Force close all positions (emergency)
   */
  async forceCloseAllPositions(): Promise<number> {
    const positions = Array.from(this.positions.values());
    let closedCount = 0;

    for (const position of positions) {
      // Use current price as exit price (market order)
      if (this.closePosition(position.marketId, position.tokenId, position.size, position.currentPrice)) {
        closedCount++;
      }
    }

    logger.warn(`Force closed ${closedCount} positions`);
    return closedCount;
  }

  /**
   * Get position statistics
   */
  getPositionStats(): {
    totalPositions: number;
    totalValue: Decimal;
    avgPositionSize: Decimal;
    largestPosition: Decimal;
    positionsWithProfit: number;
    positionsWithLoss: number;
  } {
    const positions = Array.from(this.positions.values());

    if (positions.length === 0) {
      return {
        totalPositions: 0,
        totalValue: new Decimal(0),
        avgPositionSize: new Decimal(0),
        largestPosition: new Decimal(0),
        positionsWithProfit: 0,
        positionsWithLoss: 0,
      };
    }

    const totalValue = positions.reduce((sum, pos) => sum.plus(pos.marketValue), new Decimal(0));
    const largestPosition = positions.reduce((max, pos) =>
      pos.marketValue.greaterThan(max) ? pos.marketValue : max, new Decimal(0)
    );

    return {
      totalPositions: positions.length,
      totalValue,
      avgPositionSize: totalValue.div(positions.length),
      largestPosition,
      positionsWithProfit: positions.filter(p => p.unrealizedPnL.greaterThan(0)).length,
      positionsWithLoss: positions.filter(p => p.unrealizedPnL.lessThan(0)).length,
    };
  }

  /**
   * Start periodic position updates
   */
  private startPositionUpdates(): void {
    this.priceUpdateInterval = setInterval(async () => {
      // Sync positions every 5 minutes
      if (Date.now() - this.lastSyncTime > 5 * 60 * 1000) {
        await this.syncPositions();
      }
    }, 60000); // Check every minute
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }

    this.positions.clear();
    this.removeAllListeners();
  }
}

export default PositionManager;
