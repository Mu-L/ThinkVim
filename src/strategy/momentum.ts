import { Decimal } from 'decimal.js';
import { ScannedMarket } from '../market/marketScanner';
import { OrderbookSnapshot } from '../market/orderbook';
import BaseStrategy, { TradeSignal, StrategyConfig } from './baseStrategy';
import MathUtils from '../utils/math';
import config from '../config/env';
import logger from '../utils/logger';

interface MomentumConfig extends StrategyConfig {
  parameters: {
    lookbackPeriod: number; // Number of price points to analyze
    momentumThreshold: Decimal; // Minimum momentum change to trigger
    volumeThreshold: Decimal; // Minimum volume spike multiplier
    entryThreshold: Decimal; // Price break above/below this threshold
    trailingStopPercent: Decimal; // Trailing stop loss percentage
    maxHoldTime: number; // Max time to hold position (seconds)
    minBreakoutStrength: Decimal; // Minimum breakout strength
  };
}

export class MomentumStrategy extends BaseStrategy {
  private config: MomentumConfig;
  private priceHistory = new Map<string, Decimal[]>();
  private volumeHistory = new Map<string, Decimal[]>();
  private positions = new Map<string, {
    entryTime: number;
    entryPrice: Decimal;
    size: Decimal;
    side: 'BUY' | 'SELL';
    marketId: string;
    tokenId: string;
    stopPrice: Decimal;
    highestPrice: Decimal;
    lowestPrice: Decimal;
  }>();

  constructor() {
    const strategyConfig: MomentumConfig = {
      enabled: config.momentumEnabled,
      name: 'Momentum Trading',
      description: 'Trade based on price momentum and volume spikes',
      parameters: {
        lookbackPeriod: 20,
        momentumThreshold: new Decimal(0.02), // 2% momentum change
        volumeThreshold: new Decimal(1.5), // 50% volume increase
        entryThreshold: new Decimal(0.01), // 1% breakout threshold
        trailingStopPercent: config.trailingStopPercent,
        maxHoldTime: 600, // 10 minutes
        minBreakoutStrength: new Decimal(0.005), // 0.5% minimum breakout
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

    // Find the token we're trading (simplified - would need both YES/NO in practice)
    const token = market.tokens[0]; // Simplified - would need proper token selection
    const key = `${market.id}:${token.tokenId}`;

    // Update price and volume history
    this.updateHistory(key, orderbook);

    // Analyze momentum
    const momentum = this.analyzeMomentum(key);
    const volumeSpike = this.detectVolumeSpike(key);

    if (momentum.hasSignal && volumeSpike) {
      const signal = this.createMomentumSignal(market, token, momentum, orderbook);
      if (signal) {
        signals.push(signal);
      }
    }

    // Check trailing stops and exit conditions
    const exitSignals = this.checkExitConditions(market, orderbook);
    signals.push(...exitSignals);

    return signals;
  }

  private updateHistory(key: string, orderbook: OrderbookSnapshot): void {
    // Update price history
    let prices = this.priceHistory.get(key) || [];
    prices.push(orderbook.midPrice);

    if (prices.length > this.config.parameters.lookbackPeriod * 2) {
      prices = prices.slice(-this.config.parameters.lookbackPeriod * 2);
    }
    this.priceHistory.set(key, prices);

    // Update volume history (simplified - would need actual volume data)
    let volumes = this.volumeHistory.get(key) || [];
    const volume = orderbook.bidDepth.plus(orderbook.askDepth); // Proxy for volume
    volumes.push(volume);

    if (volumes.length > this.config.parameters.lookbackPeriod * 2) {
      volumes = volumes.slice(-this.config.parameters.lookbackPeriod * 2);
    }
    this.volumeHistory.set(key, volumes);
  }

  private analyzeMomentum(key: string): {
    hasSignal: boolean;
    direction: 'bullish' | 'bearish';
    strength: Decimal;
    breakoutPrice: Decimal;
  } {
    const prices = this.priceHistory.get(key) || [];
    if (prices.length < this.config.parameters.lookbackPeriod) {
      return { hasSignal: false, direction: 'bullish', strength: new Decimal(0), breakoutPrice: new Decimal(0) };
    }

    const recent = prices.slice(-this.config.parameters.lookbackPeriod);
    const older = prices.slice(-this.config.parameters.lookbackPeriod * 2, -this.config.parameters.lookbackPeriod);

    if (recent.length === 0 || older.length === 0) {
      return { hasSignal: false, direction: 'bullish', strength: new Decimal(0), breakoutPrice: new Decimal(0) };
    }

    // Calculate moving averages
    const recentMA = MathUtils.calculateEMA(recent, Math.floor(recent.length / 2));
    const olderMA = MathUtils.calculateEMA(older, Math.floor(older.length / 2));

    // Calculate momentum (rate of change)
    const momentum = recentMA.minus(olderMA).div(olderMA);

    // Check for breakout above recent range
    const recentHigh = Decimal.max(...recent);
    const recentLow = Decimal.min(...recent);
    const currentPrice = recent[recent.length - 1];

    const bullishBreakout = currentPrice.greaterThan(recentHigh.plus(this.config.parameters.minBreakoutStrength));
    const bearishBreakout = currentPrice.lessThan(recentLow.minus(this.config.parameters.minBreakoutStrength));

    if (bullishBreakout && momentum.greaterThan(this.config.parameters.momentumThreshold)) {
      return {
        hasSignal: true,
        direction: 'bullish',
        strength: momentum,
        breakoutPrice: currentPrice,
      };
    }

    if (bearishBreakout && momentum.lessThan(this.config.parameters.momentumThreshold.negated())) {
      return {
        hasSignal: true,
        direction: 'bearish',
        strength: momentum.abs(),
        breakoutPrice: currentPrice,
      };
    }

    return { hasSignal: false, direction: 'bullish', strength: new Decimal(0), breakoutPrice: new Decimal(0) };
  }

  private detectVolumeSpike(key: string): boolean {
    const volumes = this.volumeHistory.get(key) || [];
    if (volumes.length < this.config.parameters.lookbackPeriod) {
      return false;
    }

    const recent = volumes.slice(-5); // Last 5 volume readings
    const older = volumes.slice(-this.config.parameters.lookbackPeriod, -5);

    if (recent.length === 0 || older.length === 0) {
      return false;
    }

    const recentAvg = recent.reduce((sum, vol) => sum.plus(vol), new Decimal(0)).div(recent.length);
    const olderAvg = older.reduce((sum, vol) => sum.plus(vol), new Decimal(0)).div(older.length);

    if (olderAvg.isZero()) return false;

    const volumeRatio = recentAvg.div(olderAvg);
    return volumeRatio.greaterThan(this.config.parameters.volumeThreshold);
  }

  private createMomentumSignal(
    market: ScannedMarket,
    token: any,
    momentum: { direction: 'bullish' | 'bearish'; strength: Decimal; breakoutPrice: Decimal },
    orderbook: OrderbookSnapshot
  ): TradeSignal | null {
    const positionKey = `${market.id}:${token.tokenId}`;
    if (this.positions.has(positionKey)) {
      return null; // Already have position
    }

    const side = momentum.direction === 'bullish' ? 'BUY' : 'SELL';
    const price = momentum.direction === 'bullish' ? orderbook.bestAsk : orderbook.bestBid;
    const size = new Decimal(10); // Fixed size for now

    // Calculate confidence based on momentum strength
    const confidence = Math.min(momentum.strength.mul(10).toNumber(), 0.9);

    return {
      marketId: market.id,
      tokenId: token.tokenId,
      side,
      size,
      price,
      reason: `Momentum ${momentum.direction}: strength ${momentum.strength.mul(100).toFixed(2)}%, breakout at ${momentum.breakoutPrice}`,
      confidence,
      timestamp: Date.now(),
    };
  }

  private checkExitConditions(market: ScannedMarket, orderbook: OrderbookSnapshot): TradeSignal[] {
    const signals: TradeSignal[] = [];
    const now = Date.now();

    for (const [positionKey, position] of this.positions.entries()) {
      const [marketId, tokenId] = positionKey.split(':');

      if (marketId !== market.id) continue;

      // Update trailing stop
      if (position.side === 'BUY') {
        if (orderbook.midPrice.greaterThan(position.highestPrice)) {
          position.highestPrice = orderbook.midPrice;
          position.stopPrice = position.highestPrice.mul(new Decimal(1).minus(this.config.parameters.trailingStopPercent));
        }

        // Check trailing stop
        if (orderbook.midPrice.lessThanOrEqualTo(position.stopPrice)) {
          signals.push(this.createExitSignal(position, 'Trailing stop triggered'));
          continue;
        }
      } else {
        if (orderbook.midPrice.lessThan(position.lowestPrice)) {
          position.lowestPrice = orderbook.midPrice;
          position.stopPrice = position.lowestPrice.mul(new Decimal(1).plus(this.config.parameters.trailingStopPercent));
        }

        // Check trailing stop
        if (orderbook.midPrice.greaterThanOrEqualTo(position.stopPrice)) {
          signals.push(this.createExitSignal(position, 'Trailing stop triggered'));
          continue;
        }
      }

      // Check time limit
      const holdTime = (now - position.entryTime) / 1000;
      if (holdTime > this.config.parameters.maxHoldTime) {
        signals.push(this.createExitSignal(position, 'Time limit reached'));
        continue;
      }

      // Check profit target (2x the entry threshold)
      const profitTarget = this.config.parameters.entryThreshold.mul(2);
      const profitPercent = position.side === 'BUY'
        ? orderbook.midPrice.minus(position.entryPrice).div(position.entryPrice)
        : position.entryPrice.minus(orderbook.midPrice).div(position.entryPrice);

      if (profitPercent.greaterThan(profitTarget)) {
        signals.push(this.createExitSignal(position, `Profit target reached: ${profitPercent.mul(100).toFixed(2)}%`));
        continue;
      }
    }

    return signals;
  }

  private createExitSignal(position: any, reason: string): TradeSignal {
    return {
      marketId: position.marketId,
      tokenId: position.tokenId,
      side: position.side === 'BUY' ? 'SELL' : 'BUY', // Close the position
      size: position.size,
      price: new Decimal(0), // Market order
      reason: `Exit momentum position: ${reason}`,
      confidence: 0.8,
      timestamp: Date.now(),
    };
  }

  canTrade(market: ScannedMarket): boolean {
    if (!this.config.enabled) return false;

    // Must have sufficient time to resolution for momentum to play out
    return market.timeToResolution > 1; // At least 1 hour
  }

  getMarketFilter() {
    return {
      minVolume: config.minVolumeUsd.mul(2), // Higher volume requirement for momentum
      minLiquidity: config.minLiquidityUsd.mul(2), // Higher liquidity requirement
      maxTimeToResolution: config.maxTimeToResolutionHours,
    };
  }

  onOrderFill(order: any): void {
    super.onOrderFill(order);

    const positionKey = `${order.marketId}:${order.tokenId}`;

    if (order.side === 'BUY' || order.side === 'SELL') {
      // Opening position
      this.positions.set(positionKey, {
        entryTime: Date.now(),
        entryPrice: order.price,
        size: order.size,
        side: order.side,
        marketId: order.marketId,
        tokenId: order.tokenId,
        stopPrice: order.price.mul(new Decimal(1).minus(this.config.parameters.trailingStopPercent)),
        highestPrice: order.price,
        lowestPrice: order.price,
      });

      logger.info(`Opened momentum position: ${positionKey} at ${order.price}`);
    } else {
      // Closing position
      const position = this.positions.get(positionKey);
      if (position) {
        const profit = position.side === 'BUY'
          ? order.price.minus(position.entryPrice).mul(position.size)
          : position.entryPrice.minus(order.price).mul(position.size);
        logger.info(`Closed momentum position: ${positionKey}, P&L: ${profit.toFixed(4)}`);
        this.positions.delete(positionKey);
      }
    }
  }

  getActivePositions() {
    return Array.from(this.positions.values());
  }
}

export default MomentumStrategy;
