import { Decimal } from 'decimal.js';
import { ScannedMarket } from '../market/marketScanner';
import { OrderbookSnapshot } from '../market/orderbook';
import BaseStrategy, { TradeSignal, StrategyConfig } from './baseStrategy';
import MathUtils from '../utils/math';
import config from '../config/env';
import logger from '../utils/logger';

interface SpreadArbConfig extends StrategyConfig {
  parameters: {
    minSpread: Decimal; // Minimum spread percentage to trigger
    maxSpread: Decimal; // Maximum spread before exiting
    positionSize: Decimal; // Size of each arbitrage position
    fee: Decimal; // Trading fee percentage
    maxHoldTime: number; // Max time to hold position (seconds)
  };
}

export class SpreadArbitrageStrategy extends BaseStrategy {
  private config: SpreadArbConfig;
  private positions = new Map<string, {
    entryTime: number;
    entryPrice: Decimal;
    size: Decimal;
    side: 'BUY' | 'SELL';
    marketId: string;
    tokenId: string;
  }>();

  constructor() {
    const strategyConfig: SpreadArbConfig = {
      enabled: config.spreadArbEnabled,
      name: 'Spread Arbitrage',
      description: 'Arbitrage between YES and NO tokens when spread exceeds threshold',
      parameters: {
        minSpread: config.minSpread,
        maxSpread: new Decimal(0.05), // 5% max spread before exiting
        positionSize: new Decimal(10), // $10 positions
        fee: new Decimal(0.001), // 0.1% fee
        maxHoldTime: 300, // 5 minutes
      },
    };

    super(strategyConfig);
    this.config = strategyConfig;
  }

  async evaluate(market: ScannedMarket, orderbook: OrderbookSnapshot): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];

    if (!this.canTrade(market)) {
      return signals;
    }

    // Find YES and NO tokens
    const yesToken = market.tokens.find(t => t.outcome.toUpperCase() === 'YES');
    const noToken = market.tokens.find(t => t.outcome.toUpperCase() === 'NO');

    if (!yesToken || !noToken) {
      return signals;
    }

    // Get orderbooks for both tokens (assuming we have them)
    // In practice, we'd need to subscribe to both token orderbooks
    const yesOrderbook = orderbook; // This would be filtered for YES token
    const noOrderbook = orderbook; // This would be filtered for NO token

    // Calculate arbitrage opportunity
    const arbitrage = this.calculateArbitrageOpportunity(yesOrderbook, noOrderbook);

    if (arbitrage.opportunity) {
      const signal = this.createArbitrageSignal(market, arbitrage);
      if (signal) {
        signals.push(signal);
      }
    }

    // Check for exit conditions on existing positions
    const exitSignals = this.checkExitConditions(market, orderbook);
    signals.push(...exitSignals);

    return signals;
  }

  private calculateArbitrageOpportunity(
    yesOrderbook: OrderbookSnapshot,
    noOrderbook: OrderbookSnapshot
  ): {
    opportunity: boolean;
    side: 'YES' | 'NO';
    entryPrice: Decimal;
    expectedProfit: Decimal;
  } {
    const yesBestBid = yesOrderbook.bestBid;
    const yesBestAsk = yesOrderbook.bestAsk;
    const noBestBid = noOrderbook.bestBid;
    const noBestAsk = noOrderbook.bestAsk;

    // Strategy: Buy YES if bestAsk_YES < (1 - bestBid_NO) - fee
    const yesArbPrice = new Decimal(1).minus(noBestBid).minus(this.config.parameters.fee);
    const yesProfit = yesArbPrice.minus(yesBestAsk);

    // Strategy: Buy NO if bestAsk_NO < (1 - bestBid_YES) - fee
    const noArbPrice = new Decimal(1).minus(yesBestBid).minus(this.config.parameters.fee);
    const noProfit = noArbPrice.minus(noBestAsk);

    // Check if profitable after fees
    if (yesProfit.greaterThan(0)) {
      return {
        opportunity: true,
        side: 'YES',
        entryPrice: yesBestAsk,
        expectedProfit: yesProfit,
      };
    }

    if (noProfit.greaterThan(0)) {
      return {
        opportunity: true,
        side: 'NO',
        entryPrice: noBestAsk,
        expectedProfit: noProfit,
      };
    }

    return {
      opportunity: false,
      side: 'YES',
      entryPrice: new Decimal(0),
      expectedProfit: new Decimal(0),
    };
  }

  private createArbitrageSignal(
    market: ScannedMarket,
    arbitrage: { side: 'YES' | 'NO'; entryPrice: Decimal; expectedProfit: Decimal }
  ): TradeSignal | null {
    const token = market.tokens.find(t =>
      t.outcome.toUpperCase() === arbitrage.side
    );

    if (!token) return null;

    const positionKey = `${market.id}:${token.tokenId}`;
    if (this.positions.has(positionKey)) {
      return null; // Already have position
    }

    return {
      marketId: market.id,
      tokenId: token.tokenId,
      side: 'BUY',
      size: this.config.parameters.positionSize,
      price: arbitrage.entryPrice,
      reason: `Spread arbitrage: expected profit ${arbitrage.expectedProfit.mul(100).toFixed(2)}%`,
      confidence: Math.min(arbitrage.expectedProfit.mul(100).toNumber() / 2, 0.9), // Scale confidence
      timestamp: Date.now(),
    };
  }

  private checkExitConditions(market: ScannedMarket, orderbook: OrderbookSnapshot): TradeSignal[] {
    const signals: TradeSignal[] = [];
    const now = Date.now();

    for (const [positionKey, position] of this.positions.entries()) {
      const [marketId, tokenId] = positionKey.split(':');

      if (marketId !== market.id) continue;

      // Check time limit
      const holdTime = (now - position.entryTime) / 1000;
      if (holdTime > this.config.parameters.maxHoldTime) {
        signals.push(this.createExitSignal(position, 'Time limit reached'));
        continue;
      }

      // Check if spread has collapsed (profit taking)
      const currentPrice = position.side === 'BUY' ? orderbook.bestAsk : orderbook.bestBid;
      const profitPercent = position.side === 'BUY'
        ? currentPrice.minus(position.entryPrice).div(position.entryPrice)
        : position.entryPrice.minus(currentPrice).div(position.entryPrice);

      if (profitPercent.greaterThan(0.01)) { // 1% profit target
        signals.push(this.createExitSignal(position, `Profit target reached: ${profitPercent.mul(100).toFixed(2)}%`));
        continue;
      }

      // Check if spread widened too much (stop loss)
      if (profitPercent.lessThan(-0.02)) { // 2% stop loss
        signals.push(this.createExitSignal(position, `Stop loss triggered: ${profitPercent.mul(100).toFixed(2)}%`));
        continue;
      }
    }

    return signals;
  }

  private createExitSignal(position: any, reason: string): TradeSignal {
    return {
      marketId: position.marketId,
      tokenId: position.tokenId,
      side: 'SELL', // Close the position
      size: position.size,
      price: new Decimal(0), // Market order
      reason: `Exit arbitrage position: ${reason}`,
      confidence: 0.8,
      timestamp: Date.now(),
    };
  }

  canTrade(market: ScannedMarket): boolean {
    if (!this.config.enabled) return false;

    // Must have YES/NO tokens
    const hasYesToken = market.tokens.some(t => t.outcome.toUpperCase() === 'YES');
    const hasNoToken = market.tokens.some(t => t.outcome.toUpperCase() === 'NO');

    return hasYesToken && hasNoToken;
  }

  getMarketFilter() {
    return {
      minVolume: config.minVolumeUsd,
      minLiquidity: config.minLiquidityUsd,
      maxTimeToResolution: config.maxTimeToResolutionHours,
    };
  }

  onOrderFill(order: any): void {
    super.onOrderFill(order);

    const positionKey = `${order.marketId}:${order.tokenId}`;

    if (order.side === 'BUY') {
      // Opening position
      this.positions.set(positionKey, {
        entryTime: Date.now(),
        entryPrice: order.price,
        size: order.size,
        side: order.side,
        marketId: order.marketId,
        tokenId: order.tokenId,
      });

      logger.info(`Opened arbitrage position: ${positionKey} at ${order.price}`);
    } else {
      // Closing position
      const position = this.positions.get(positionKey);
      if (position) {
        const profit = order.price.minus(position.entryPrice).mul(position.size);
        logger.info(`Closed arbitrage position: ${positionKey}, P&L: ${profit.toFixed(4)}`);
        this.positions.delete(positionKey);
      }
    }
  }

  getActivePositions() {
    return Array.from(this.positions.values());
  }
}

export default SpreadArbitrageStrategy;
