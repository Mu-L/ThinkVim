import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { Orderbook, OrderbookLevel } from '../api/polymarket';
import PolymarketAPI from '../api/polymarket';
import PolymarketWebSocket from '../api/websocket';
import config from '../config/env';
import logger from '../utils/logger';
import MathUtils from '../utils/math';

export interface OrderbookSnapshot {
  marketId: string;
  tokenId: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
  bestBid: Decimal;
  bestAsk: Decimal;
  spread: Decimal;
  spreadPercent: Decimal;
  midPrice: Decimal;
  bidDepth: Decimal;
  askDepth: Decimal;
  imbalance: Decimal;
}

export interface OrderbookAnalysis {
  snapshot: OrderbookSnapshot;
  spreadThresholdBreached: boolean;
  liquidityShift: boolean;
  momentum: 'bullish' | 'bearish' | 'neutral';
  volatility: Decimal;
  volumeImbalance: Decimal;
}

export class OrderbookEngine extends EventEmitter {
  private api: PolymarketAPI;
  private ws: PolymarketWebSocket;
  private snapshots = new Map<string, OrderbookSnapshot>();
  private priceHistory = new Map<string, Decimal[]>();
  private maxHistoryLength = 100;

  constructor(api: PolymarketAPI, ws: PolymarketWebSocket) {
    super();
    this.api = api;
    this.ws = ws;

    // Listen for WebSocket orderbook updates
    this.ws.on('orderbook', (orderbook: Orderbook) => {
      this.handleOrderbookUpdate(orderbook);
    });
  }

  /**
   * Subscribe to orderbook updates for a market/token pair
   */
  subscribe(marketId: string, tokenId: string): void {
    const key = `${marketId}:${tokenId}`;
    logger.info(`Subscribing to orderbook: ${key}`);

    this.api.subscribeToOrderbook(marketId, tokenId);
  }

  /**
   * Unsubscribe from orderbook updates
   */
  unsubscribe(marketId: string, tokenId: string): void {
    const key = `${marketId}:${tokenId}`;
    logger.info(`Unsubscribing from orderbook: ${key}`);

    this.api.unsubscribeFromOrderbook(marketId, tokenId);
    this.snapshots.delete(key);
    this.priceHistory.delete(key);
  }

  /**
   * Handle incoming orderbook update from WebSocket
   */
  private handleOrderbookUpdate(orderbook: Orderbook): void {
    const key = `${orderbook.market}:${orderbook.asset_id}`;

    try {
      const snapshot = this.createSnapshot(orderbook);
      const analysis = this.analyzeOrderbook(snapshot);

      // Store snapshot
      this.snapshots.set(key, snapshot);

      // Update price history
      this.updatePriceHistory(key, snapshot.midPrice);

      // Emit events
      this.emit('orderbookUpdate', snapshot);
      this.emit('orderbookAnalysis', analysis);

      // Check for significant events
      this.checkSignificantEvents(snapshot, analysis);

    } catch (error) {
      logger.error(`Failed to process orderbook update for ${key}:`, error);
    }
  }

  /**
   * Create a snapshot with calculated metrics
   */
  private createSnapshot(orderbook: Orderbook): OrderbookSnapshot {
    const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : new Decimal(0);
    const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : new Decimal(0);
    const spread = bestAsk.minus(bestBid);
    const spreadPercent = bestBid.isZero() ? new Decimal(0) : spread.div(bestBid).mul(100);
    const midPrice = bestBid.plus(bestAsk).div(2);

    // Calculate depth (sum of sizes in top 5 levels)
    const bidDepth = orderbook.bids.slice(0, 5).reduce(
      (sum, level) => sum.plus(level.size), new Decimal(0)
    );
    const askDepth = orderbook.asks.slice(0, 5).reduce(
      (sum, level) => sum.plus(level.size), new Decimal(0)
    );

    // Calculate orderbook imbalance
    const totalDepth = bidDepth.plus(askDepth);
    const imbalance = totalDepth.isZero() ? new Decimal(0) :
      bidDepth.minus(askDepth).div(totalDepth);

    return {
      marketId: orderbook.market,
      tokenId: orderbook.asset_id,
      bids: orderbook.bids,
      asks: orderbook.asks,
      timestamp: orderbook.timestamp,
      bestBid,
      bestAsk,
      spread,
      spreadPercent,
      midPrice,
      bidDepth,
      askDepth,
      imbalance,
    };
  }

  /**
   * Analyze orderbook for trading signals
   */
  private analyzeOrderbook(snapshot: OrderbookSnapshot): OrderbookAnalysis {
    const spreadThresholdBreached = snapshot.spreadPercent.greaterThan(config.minSpread.mul(100));
    const liquidityShift = this.detectLiquidityShift(snapshot);
    const momentum = this.calculateMomentum(snapshot);
    const volatility = this.calculateVolatility(snapshot.marketId, snapshot.tokenId);
    const volumeImbalance = snapshot.imbalance;

    return {
      snapshot,
      spreadThresholdBreached,
      liquidityShift,
      momentum,
      volatility,
      volumeImbalance,
    };
  }

  /**
   * Detect significant liquidity shifts
   */
  private detectLiquidityShift(snapshot: OrderbookSnapshot): boolean {
    const key = `${snapshot.marketId}:${snapshot.tokenId}`;
    const previous = this.snapshots.get(key);

    if (!previous) return false;

    const bidDepthChange = Math.abs(snapshot.bidDepth.minus(previous.bidDepth).div(previous.bidDepth).toNumber());
    const askDepthChange = Math.abs(snapshot.askDepth.minus(previous.askDepth).div(previous.askDepth).toNumber());

    // Significant if either side changed by more than 50%
    return bidDepthChange > 0.5 || askDepthChange > 0.5;
  }

  /**
   * Calculate price momentum
   */
  private calculateMomentum(snapshot: OrderbookSnapshot): 'bullish' | 'bearish' | 'neutral' {
    const key = `${snapshot.marketId}:${snapshot.tokenId}`;
    const history = this.priceHistory.get(key) || [];

    if (history.length < 5) return 'neutral';

    const recent = history.slice(-5);
    const older = history.slice(-10, -5);

    if (recent.length === 0 || older.length === 0) return 'neutral';

    const recentAvg = recent.reduce((sum, price) => sum.plus(price), new Decimal(0)).div(recent.length);
    const olderAvg = older.reduce((sum, price) => sum.plus(price), new Decimal(0)).div(older.length);

    const change = recentAvg.minus(olderAvg).div(olderAvg);

    if (change.greaterThan(0.005)) return 'bullish'; // > 0.5% increase
    if (change.lessThan(-0.005)) return 'bearish'; // > 0.5% decrease

    return 'neutral';
  }

  /**
   * Calculate price volatility
   */
  private calculateVolatility(marketId: string, tokenId: string): Decimal {
    const key = `${marketId}:${tokenId}`;
    const history = this.priceHistory.get(key) || [];

    if (history.length < 10) return new Decimal(0);

    return MathUtils.calculateStdDev(history.slice(-20), false); // Population std dev
  }

  /**
   * Update price history for momentum calculations
   */
  private updatePriceHistory(key: string, price: Decimal): void {
    let history = this.priceHistory.get(key) || [];

    history.push(price);

    // Keep only recent history
    if (history.length > this.maxHistoryLength) {
      history = history.slice(-this.maxHistoryLength);
    }

    this.priceHistory.set(key, history);
  }

  /**
   * Check for significant events and emit alerts
   */
  private checkSignificantEvents(snapshot: OrderbookSnapshot, analysis: OrderbookAnalysis): void {
    const key = `${snapshot.marketId}:${snapshot.tokenId}`;

    // Spread threshold breach
    if (analysis.spreadThresholdBreached) {
      this.emit('spreadAlert', {
        marketId: snapshot.marketId,
        tokenId: snapshot.tokenId,
        spread: snapshot.spreadPercent,
        threshold: config.minSpread.mul(100),
      });
    }

    // Liquidity shift
    if (analysis.liquidityShift) {
      this.emit('liquidityShift', {
        marketId: snapshot.marketId,
        tokenId: snapshot.tokenId,
        bidDepth: snapshot.bidDepth,
        askDepth: snapshot.askDepth,
      });
    }

    // High volatility
    if (analysis.volatility.greaterThan(0.1)) { // 10% volatility
      this.emit('highVolatility', {
        marketId: snapshot.marketId,
        tokenId: snapshot.tokenId,
        volatility: analysis.volatility,
      });
    }
  }

  /**
   * Get current snapshot for a market/token pair
   */
  getSnapshot(marketId: string, tokenId: string): OrderbookSnapshot | undefined {
    return this.snapshots.get(`${marketId}:${tokenId}`);
  }

  /**
   * Get all current snapshots
   */
  getAllSnapshots(): OrderbookSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * Check if orderbook is subscribed
   */
  isSubscribed(marketId: string, tokenId: string): boolean {
    return this.snapshots.has(`${marketId}:${tokenId}`);
  }

  /**
   * Get price history for analysis
   */
  getPriceHistory(marketId: string, tokenId: string): Decimal[] {
    return this.priceHistory.get(`${marketId}:${tokenId}`) || [];
  }
}

export default OrderbookEngine;
