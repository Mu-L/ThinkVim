import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { Market } from '../api/polymarket';
import PolymarketAPI from '../api/polymarket';
import config from '../config/env';
import logger from '../utils/logger';

export interface MarketFilter {
  minVolume: Decimal;
  minLiquidity: Decimal;
  maxTimeToResolutionHours: number;
  excludeResolved: boolean;
  excludeClosed: boolean;
}

export interface ScannedMarket extends Market {
  score: number; // Composite score for ranking
  timeToResolution: number; // Hours until resolution
  meetsCriteria: boolean;
}

export class MarketScanner extends EventEmitter {
  private api: PolymarketAPI;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastScanTime = 0;
  private cachedMarkets: ScannedMarket[] = [];

  constructor(api: PolymarketAPI) {
    super();
    this.api = api;
  }

  /**
   * Start periodic market scanning
   */
  startScanning(intervalMs: number = 300000): void { // Default 5 minutes
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    logger.info(`Starting market scanner with ${intervalMs}ms interval`);
    this.scanInterval = setInterval(() => this.scanMarkets(), intervalMs);
    this.scanMarkets(); // Initial scan
  }

  /**
   * Stop market scanning
   */
  stopScanning(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
      logger.info('Market scanner stopped');
    }
  }

  /**
   * Perform a market scan
   */
  async scanMarkets(): Promise<ScannedMarket[]> {
    try {
      logger.info('Scanning markets...');

      const markets = await this.api.getActiveMarkets(200, 0); // Get first 200 markets
      const scannedMarkets = await this.processMarkets(markets);

      this.cachedMarkets = scannedMarkets;
      this.lastScanTime = Date.now();

      // Emit scan complete event
      this.emit('scanComplete', scannedMarkets);

      logger.info(`Market scan complete. Found ${scannedMarkets.length} qualifying markets`);
      return scannedMarkets;

    } catch (error) {
      logger.error('Market scan failed:', error);
      throw error;
    }
  }

  /**
   * Process raw markets and apply filters
   */
  private async processMarkets(markets: Market[]): Promise<ScannedMarket[]> {
    const scannedMarkets: ScannedMarket[] = [];

    for (const market of markets) {
      try {
        const scanned = await this.analyzeMarket(market);
        if (scanned) {
          scannedMarkets.push(scanned);
        }
      } catch (error) {
        logger.warn(`Failed to analyze market ${market.id}:`, error);
      }
    }

    // Sort by score (highest first)
    scannedMarkets.sort((a, b) => b.score - a.score);

    return scannedMarkets;
  }

  /**
   * Analyze a single market and determine if it meets criteria
   */
  private async analyzeMarket(market: Market): Promise<ScannedMarket | null> {
    const timeToResolution = this.calculateTimeToResolution(market.endDate);

    // Basic filters
    if (market.closed || !market.active) {
      return null;
    }

    if (timeToResolution <= 0 || timeToResolution > config.maxTimeToResolutionHours) {
      return null;
    }

    // Volume and liquidity filters
    if (market.volume.lessThan(config.minVolumeUsd)) {
      return null;
    }

    if (market.liquidity.lessThan(config.minLiquidityUsd)) {
      return null;
    }

    // Must have YES/NO tokens
    if (!market.tokens || market.tokens.length !== 2) {
      return null;
    }

    const yesToken = market.tokens.find(t => t.outcome.toUpperCase() === 'YES');
    const noToken = market.tokens.find(t => t.outcome.toUpperCase() === 'NO');

    if (!yesToken || !noToken) {
      return null;
    }

    // Calculate market score
    const score = this.calculateMarketScore(market, timeToResolution);

    const scannedMarket: ScannedMarket = {
      ...market,
      score,
      timeToResolution,
      meetsCriteria: score > 0,
    };

    return scannedMarket;
  }

  /**
   * Calculate time to market resolution in hours
   */
  private calculateTimeToResolution(endDate: string): number {
    const end = new Date(endDate);
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    return Math.max(0, diffMs / (1000 * 60 * 60)); // Convert to hours
  }

  /**
   * Calculate a composite score for market attractiveness
   */
  private calculateMarketScore(market: Market, timeToResolution: number): number {
    let score = 0;

    // Volume score (0-40 points)
    const volumeScore = Math.min(market.volume.div(1000).toNumber(), 40);
    score += volumeScore;

    // Liquidity score (0-30 points)
    const liquidityScore = Math.min(market.liquidity.div(100).toNumber(), 30);
    score += liquidityScore;

    // Time to resolution score (0-20 points)
    // Prefer markets that resolve in 24-72 hours
    const optimalTimeStart = 24;
    const optimalTimeEnd = 72;
    let timeScore = 0;

    if (timeToResolution >= optimalTimeStart && timeToResolution <= optimalTimeEnd) {
      timeScore = 20;
    } else if (timeToResolution > optimalTimeEnd) {
      // Gradual decrease for longer times
      timeScore = Math.max(0, 20 - (timeToResolution - optimalTimeEnd) / 24);
    } else {
      // Gradual decrease for shorter times (more volatile)
      timeScore = Math.max(0, 10 - (optimalTimeStart - timeToResolution) / 6);
    }
    score += timeScore;

    // Recent activity bonus (0-10 points)
    const hoursSinceUpdate = (Date.now() - new Date(market.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceUpdate < 1) {
      score += 10;
    } else if (hoursSinceUpdate < 6) {
      score += 5;
    }

    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get markets that meet minimum criteria for trading
   */
  getTradableMarkets(): ScannedMarket[] {
    return this.cachedMarkets.filter(market => market.meetsCriteria);
  }

  /**
   * Get top N markets by score
   */
  getTopMarkets(limit: number): ScannedMarket[] {
    return this.cachedMarkets.slice(0, limit);
  }

  /**
   * Find market by ID
   */
  getMarketById(marketId: string): ScannedMarket | undefined {
    return this.cachedMarkets.find(market => market.id === marketId);
  }

  /**
   * Get markets expiring soon (for timing-sensitive strategies)
   */
  getMarketsExpiringSoon(hours: number = 24): ScannedMarket[] {
    return this.cachedMarkets.filter(market => market.timeToResolution <= hours);
  }

  /**
   * Get cached markets
   */
  getCachedMarkets(): ScannedMarket[] {
    return [...this.cachedMarkets];
  }

  /**
   * Get last scan timestamp
   */
  getLastScanTime(): number {
    return this.lastScanTime;
  }
}

export default MarketScanner;
