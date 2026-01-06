import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { ScannedMarket } from '../market/marketScanner';
import { OrderbookSnapshot } from '../market/orderbook';
import logger from '../utils/logger';

export interface TradeSignal {
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: Decimal;
  price: Decimal;
  reason: string;
  confidence: number; // 0-1
  timestamp: number;
}

export interface StrategyConfig {
  enabled: boolean;
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export abstract class BaseStrategy extends EventEmitter {
  protected config: StrategyConfig;
  protected activePositions = new Map<string, any>();

  constructor(config: StrategyConfig) {
    super();
    this.config = config;
  }

  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Update strategy configuration
   */
  updateConfig(newConfig: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`Strategy ${this.config.name} configuration updated`);
  }

  /**
   * Check if strategy is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable/disable strategy
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info(`Strategy ${this.config.name} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Evaluate market conditions and generate trading signals
   */
  abstract evaluate(
    market: ScannedMarket,
    orderbook: OrderbookSnapshot
  ): Promise<TradeSignal[]>;

  /**
   * Handle position updates
   */
  onPositionUpdate(position: any): void {
    const key = `${position.marketId}:${position.tokenId}`;
    this.activePositions.set(key, position);
  }

  /**
   * Handle order fills
   */
  onOrderFill(order: any): void {
    // Override in subclasses for specific logic
  }

  /**
   * Check if market meets strategy requirements
   */
  abstract canTrade(market: ScannedMarket): boolean;

  /**
   * Get strategy-specific market filter
   */
  getMarketFilter(): Partial<{
    minVolume: Decimal;
    minLiquidity: Decimal;
    maxTimeToResolution: number;
  }> {
    return {};
  }

  /**
   * Get active positions for this strategy
   */
  getActivePositions(): any[] {
    return Array.from(this.activePositions.values());
  }

  /**
   * Clean up strategy resources
   */
  cleanup(): void {
    this.activePositions.clear();
    this.removeAllListeners();
  }

  /**
   * Validate trade signal
   */
  protected validateSignal(signal: TradeSignal): boolean {
    if (!signal.marketId || !signal.tokenId) {
      logger.warn(`Invalid signal: missing market or token ID`);
      return false;
    }

    if (signal.size.isZero() || signal.size.isNegative()) {
      logger.warn(`Invalid signal: invalid size ${signal.size}`);
      return false;
    }

    if (signal.price.isZero() || signal.price.isNegative()) {
      logger.warn(`Invalid signal: invalid price ${signal.price}`);
      return false;
    }

    if (signal.confidence < 0 || signal.confidence > 1) {
      logger.warn(`Invalid signal: confidence out of range ${signal.confidence}`);
      return false;
    }

    return true;
  }

  /**
   * Emit trade signal if valid
   */
  protected emitSignal(signal: TradeSignal): void {
    if (this.validateSignal(signal)) {
      this.emit('signal', signal);
    }
  }
}

export default BaseStrategy;
