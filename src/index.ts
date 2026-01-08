import { EventEmitter } from 'events';
import PolymarketAPI from './api/polymarket';
import PolymarketWebSocket from './api/websocket';
import MarketScanner from './market/marketScanner';
import OrderbookEngine from './market/orderbook';
import SpreadArbitrageStrategy from './strategy/spreadArb';
import MomentumStrategy from './strategy/momentum';
import RiskManager from './trader/riskManager';
import OrderManager from './trader/orderManager';
import PositionManager from './trader/positionManager';
import config from './config/env';
import logger from './utils/logger';

/**
 * Main trading bot class for Polymarket prediction markets
 *
 * This bot implements automated trading strategies including spread arbitrage
 * and momentum trading. It connects to Polymarket's WebSocket API for real-time
 * market data and manages risk through configurable limits and circuit breakers.
 *
 * @example
 * ```typescript
 * const bot = new PolymarketTradingBot();
 * await bot.start();
 * ```
 *
 * @fires started - Emitted when the bot successfully starts
 * @fires stopped - Emitted when the bot stops
 * @fires emergencyStop - Emitted when emergency stop is triggered
 */
class PolymarketTradingBot extends EventEmitter {
  private api: PolymarketAPI;
  private ws: PolymarketWebSocket;
  private marketScanner: MarketScanner;
  private orderbookEngine: OrderbookEngine;
  private strategies: (SpreadArbitrageStrategy | MomentumStrategy)[] = [];
  private riskManager: RiskManager;
  private orderManager: OrderManager;
  private positionManager: PositionManager;

  private running = false;
  private strategyInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();

    logger.info('Initializing Polymarket Trading Bot...');

    // Initialize API clients
    this.api = new PolymarketAPI();
    this.ws = new PolymarketWebSocket(this.api);

    // Initialize market components
    this.marketScanner = new MarketScanner(this.api);
    this.orderbookEngine = new OrderbookEngine(this.api, this.ws);

    // Initialize trading components
    this.riskManager = new RiskManager();
    this.orderManager = new OrderManager(this.api, this.riskManager);
    this.positionManager = new PositionManager(this.api, this.riskManager);

    // Initialize strategies
    this.initializeStrategies();

    // Setup event handlers
    this.setupEventHandlers();

    logger.info('Polymarket Trading Bot initialized successfully');
  }

  /**
   * Start the trading bot and all its components
   *
   * This method initializes the WebSocket connection, starts market scanning,
   * synchronizes positions, and begins strategy execution.
   *
   * @throws {Error} If the bot fails to start due to connection or initialization issues
   * @returns {Promise<void>} Resolves when the bot is fully started
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Bot is already running');
      return;
    }

    try {
      logger.info('Starting Polymarket Trading Bot...');

      // Connect WebSocket
      this.ws.connect();

      // Start market scanning
      this.marketScanner.startScanning();

      // Start position synchronization
      await this.positionManager.syncPositions();

      // Start strategy execution
      this.startStrategyExecution();

      this.running = true;
      logger.info('Polymarket Trading Bot started successfully');

      this.emit('started');

    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Stop the trading bot and clean up resources
   *
   * This method cancels all open orders, stops strategy execution,
   * disconnects from WebSocket, and performs cleanup operations.
   *
   * @throws {Error} If the bot fails to stop gracefully
   * @returns {Promise<void>} Resolves when the bot is fully stopped
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.info('Bot is not running');
      return;
    }

    try {
      logger.info('Stopping Polymarket Trading Bot...');

      // Stop strategy execution
      this.stopStrategyExecution();

      // Cancel all open orders
      await this.orderManager.cancelAllOrders();

      // Stop market scanning
      this.marketScanner.stopScanning();

      // Disconnect WebSocket
      this.ws.disconnect();

      // Cleanup components
      this.cleanup();

      this.running = false;
      logger.info('Polymarket Trading Bot stopped successfully');

      this.emit('stopped');

    } catch (error) {
      logger.error('Error stopping bot:', error);
      throw error;
    }
  }

  /**
   * Initialize trading strategies
   */
  private initializeStrategies(): void {
    if (config.spreadArbEnabled) {
      this.strategies.push(new SpreadArbitrageStrategy());
      logger.info('Spread Arbitrage strategy enabled');
    }

    if (config.momentumEnabled) {
      this.strategies.push(new MomentumStrategy());
      logger.info('Momentum strategy enabled');
    }

    if (this.strategies.length === 0) {
      logger.warn('No strategies enabled - bot will not execute trades');
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Market scanner events
    this.marketScanner.on('scanComplete', (markets) => {
      this.handleMarketScanComplete(markets);
    });

    // Orderbook events
    this.orderbookEngine.on('orderbookUpdate', (snapshot) => {
      this.positionManager.updatePositionPrices(snapshot);
    });

    this.orderbookEngine.on('spreadAlert', (alert) => {
      logger.info(`Spread alert: ${alert.marketId} - ${alert.spread.toFixed(2)}%`);
    });

    this.orderbookEngine.on('liquidityShift', (shift) => {
      logger.info(`Liquidity shift: ${shift.marketId} - bid: ${shift.bidDepth.toFixed(2)}, ask: ${shift.askDepth.toFixed(2)}`);
    });

    // Order manager events
    this.orderManager.on('orderFill', (fill) => {
      this.handleOrderFill(fill);
    });

    this.orderManager.on('orderExpired', (order) => {
      logger.warn(`Order expired: ${order.id}`);
    });

    // Risk manager events
    this.riskManager.on('circuitBreaker', (activated) => {
      if (activated) {
        logger.error('Circuit breaker activated - emergency stop');
        this.emergencyStop();
      }
    });

    this.riskManager.on('dailyStatsUpdate', (stats) => {
      logger.info(`Daily P&L: ${stats.totalPnL.toFixed(2)}, Win Rate: ${(stats.winRate * 100).toFixed(1)}%`);
    });
  }

  /**
   * Handle market scan completion
   */
  private handleMarketScanComplete(markets: any[]): void {
    const tradableMarkets = markets.filter(m => m.meetsCriteria);

    if (tradableMarkets.length === 0) {
      logger.debug('No tradable markets found in scan');
      return;
    }

    logger.info(`Found ${tradableMarkets.length} tradable markets`);

    // Subscribe to orderbooks for top markets
    const topMarkets = tradableMarkets.slice(0, 10); // Top 10 markets
    for (const market of topMarkets) {
      // Subscribe to both YES and NO tokens
      for (const token of market.tokens) {
        this.orderbookEngine.subscribe(market.id, token.tokenId);
      }
    }
  }

  /**
   * Handle order fill
   */
  private handleOrderFill(fill: any): void {
    const { order, filledSize, fillPrice } = fill;

    // Update position manager
    if (order.side === 'BUY') {
      this.positionManager.addOrUpdatePosition(
        order.marketId,
        order.tokenId,
        order.tokenId, // Simplified outcome mapping
        filledSize,
        fillPrice
      );
    } else {
      this.positionManager.closePosition(
        order.marketId,
        order.tokenId,
        filledSize,
        fillPrice
      );
    }

    // Notify strategies
    for (const strategy of this.strategies) {
      strategy.onOrderFill(order);
    }

    logger.info(`Order fill: ${order.id} ${order.side} ${filledSize.toFixed(2)} @ ${fillPrice.toFixed(4)}`);
  }

  /**
   * Start strategy execution loop
   */
  private startStrategyExecution(): void {
    this.strategyInterval = setInterval(async () => {
      await this.executeStrategies();
    }, 10000); // Execute strategies every 10 seconds

    logger.info('Strategy execution started');
  }

  /**
   * Stop strategy execution
   */
  private stopStrategyExecution(): void {
    if (this.strategyInterval) {
      clearInterval(this.strategyInterval);
      this.strategyInterval = null;
      logger.info('Strategy execution stopped');
    }
  }

  /**
   * Execute all enabled strategies
   */
  private async executeStrategies(): Promise<void> {
    if (!this.running) return;

    const tradableMarkets = this.marketScanner.getTradableMarkets();

    for (const market of tradableMarkets) {
      for (const strategy of this.strategies) {
        if (!strategy.isEnabled()) continue;

        try {
          // Get orderbook for this market (simplified - would need both tokens)
          const orderbook = this.orderbookEngine.getSnapshot(market.id, market.tokens[0].tokenId);
          if (!orderbook) continue;

          // Evaluate strategy
          const signals = await strategy.evaluate(market, orderbook);

          // Execute signals
          for (const signal of signals) {
            const result = await this.orderManager.executeSignal(signal);

            if (result.success) {
              logger.info(`Strategy ${strategy.constructor.name} executed signal: ${signal.side} ${signal.marketId}`);
            } else {
              logger.warn(`Strategy ${strategy.constructor.name} signal failed: ${result.error}`);
            }
          }

        } catch (error) {
          logger.error(`Strategy ${strategy.constructor.name} execution error:`, error);
        }
      }
    }
  }

  /**
   * Emergency stop - cancel all orders and close positions
   */
  private async emergencyStop(): Promise<void> {
    logger.error('Executing emergency stop...');

    try {
      // Cancel all orders
      await this.orderManager.cancelAllOrders();

      // Force close all positions
      await this.positionManager.forceCloseAllPositions();

      // Stop trading
      this.stopStrategyExecution();

      logger.error('Emergency stop completed');
      this.emit('emergencyStop');

    } catch (error) {
      logger.error('Emergency stop failed:', error);
    }
  }

  /**
   * Get comprehensive status information about the bot
   *
   * @returns {Object} Status object containing:
   *   - running: Whether the bot is currently running
   *   - paperTrading: Whether paper trading mode is enabled
   *   - strategies: Array of enabled strategy names
   *   - activePositions: Number of active positions
   *   - openOrders: Number of open orders
   *   - riskMetrics: Current risk management metrics
   *   - portfolioSummary: Summary of portfolio performance
   */
  getStatus(): {
    running: boolean;
    paperTrading: boolean;
    strategies: string[];
    activePositions: number;
    openOrders: number;
    riskMetrics: any;
    portfolioSummary: any;
  } {
    return {
      running: this.running,
      paperTrading: config.enablePaperTrading,
      strategies: this.strategies.map(s => s.constructor.name),
      activePositions: this.positionManager.getAllPositions().length,
      openOrders: this.orderManager.getOpenOrders().length,
      riskMetrics: this.riskManager.getRiskMetrics(),
      portfolioSummary: this.positionManager.getPortfolioSummary(),
    };
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.strategies.forEach(strategy => strategy.cleanup());
    this.orderManager.cleanup();
    this.positionManager.cleanup();

    this.removeAllListeners();
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Polymarket Trading Bot...');

    if (this.running) {
      await this.stop();
    }

    this.cleanup();
    logger.info('Polymarket Trading Bot shutdown complete');
  }
}

// Handle process signals
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  const bot = (global as any).bot as PolymarketTradingBot;
  if (bot) {
    await bot.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  const bot = (global as any).bot as PolymarketTradingBot;
  if (bot) {
    await bot.shutdown();
  }
  process.exit(0);
});

// Main execution
async function main() {
  try {
    const bot = new PolymarketTradingBot();
    (global as any).bot = bot;

    logger.info(`Starting Polymarket Trading Bot (Paper Trading: ${config.enablePaperTrading})`);
    await bot.start();

    // Keep the process running
    process.stdin.resume();

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Export for testing
export default PolymarketTradingBot;

// Run if called directly
if (require.main === module) {
  main();
}
