import { BlockchainProvider } from './core/provider';
import { WalletManager } from './core/walletManager';
import { FactoryListener, NewTokenInfo } from './scanner/factoryListener';
import { SafetyScanner, SafetyConfig } from './scanner/safetyScanner';
import { SniperEngine, SniperConfig } from './sniper/sniperEngine';
import { SellEngine, SellConfig } from './sniper/sellEngine';
import { ConfigLoader } from './config/configLoader';
import { logger } from './utils/logger';

/**
 * Main bot orchestrator
 */
export class FourMemeSniperBot {
  private config: ConfigLoader;
  private provider: BlockchainProvider;
  private walletManager: WalletManager;
  private factoryListener: FactoryListener;
  private safetyScanner: SafetyScanner;
  private sniperEngine: SniperEngine;
  private sellEngine: SellEngine;
  private isRunning: boolean = false;

  constructor() {
    this.config = new ConfigLoader();

    const envConfig = this.config.getEnvConfig();
    const botConfig = this.config.getBotConfig();

    // Initialize blockchain provider
    this.provider = new BlockchainProvider(
      envConfig.RPC_WSS_URL,
      envConfig.RPC_HTTPS_URL
    );

    // Initialize wallet manager
    this.walletManager = new WalletManager(
      this.provider,
      envConfig.PRIVATE_KEYS,
      botConfig.monitoring.maxPendingTx
    );

    // Get PancakeSwap factory from router
    const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

    // Initialize factory listener
    this.factoryListener = new FactoryListener(
      this.provider,
      envConfig.FOUR_MEME_FACTORY,
      PANCAKE_FACTORY
    );

    // Initialize safety scanner
    this.safetyScanner = new SafetyScanner(
      this.provider,
      envConfig.PANCAKE_ROUTER_V2
    );

    // Initialize sniper engine
    this.sniperEngine = new SniperEngine(
      this.provider,
      this.walletManager,
      envConfig.PANCAKE_ROUTER_V2
    );

    // Initialize sell engine
    this.sellEngine = new SellEngine(
      this.provider,
      this.walletManager,
      envConfig.PANCAKE_ROUTER_V2,
      botConfig.monitoring.checkInterval
    );
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warning('Bot is already running');
      return;
    }

    try {
      logger.banner();
      this.config.displaySummary();

      logger.info('🚀 Starting Four.Meme Sniper Bot...');

      // Connect to blockchain
      await this.provider.connect();

      // Sync wallet nonces
      await this.walletManager.syncNonces();

      // Check wallet balances
      const botConfig = this.config.getBotConfig();
      const minBalance = BigInt(Number(botConfig.trading.buyAmount) * 1.1 * 1e18); // 10% buffer
      const hasSufficientBalance = await this.walletManager.checkBalances(minBalance);

      if (!hasSufficientBalance) {
        logger.warning('⚠️ Some wallets have insufficient balance. Continue anyway? (Ctrl+C to abort)');
        // Wait 5 seconds before continuing
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Initialize factory listener
      await this.factoryListener.initialize();

      // Register new token callback
      this.factoryListener.onNewToken(async (tokenInfo) => {
        await this.handleNewToken(tokenInfo);
      });

      // Start listening for new tokens
      await this.factoryListener.startListening();

      this.isRunning = true;
      logger.success('✅ Bot is running and listening for new tokens...');
      logger.info('Press Ctrl+C to stop');
    } catch (error) {
      logger.error('Failed to start bot', error);
      throw error;
    }
  }

  /**
   * Handle new token detection
   */
  private async handleNewToken(tokenInfo: NewTokenInfo): Promise<void> {
    try {
      const botConfig = this.config.getBotConfig();

      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║  🆕 NEW TOKEN DETECTED                                    ║
╚═══════════════════════════════════════════════════════════╝
  Symbol: ${tokenInfo.symbol || 'Unknown'}
  Address: ${tokenInfo.tokenAddress}
  Pair: ${tokenInfo.pairAddress}
  Creator: ${tokenInfo.creator}
      `);

      // Run safety analysis if enabled
      if (botConfig.safety.enableSafetyScanner) {
        const safetyConfig: SafetyConfig = {
          minSafetyScore: botConfig.safety.minSafetyScore,
          minLiquidity: botConfig.safety.minLiquidity,
          maxBuyTax: botConfig.safety.maxBuyTax,
          maxSellTax: botConfig.safety.maxSellTax,
          checkHoneypot: botConfig.safety.checkHoneypot,
          checkOwnership: botConfig.safety.checkOwnership,
          checkLiquidity: botConfig.safety.checkLiquidity,
        };

        const safetyReport = await this.safetyScanner.analyzeToken(tokenInfo, safetyConfig);

        // Check if token passes safety requirements
        if (safetyReport.safetyScore < safetyConfig.minSafetyScore) {
          logger.warning(`❌ Token rejected: Safety score ${safetyReport.safetyScore}/100`);
          return;
        }

        if (safetyReport.isHoneypot) {
          logger.warning('❌ Token rejected: Honeypot detected');
          return;
        }

        logger.success(`✅ Token passed safety checks: ${safetyReport.safetyScore}/100`);

        // Execute snipe
        const sniperConfig: SniperConfig = {
          buyAmount: botConfig.trading.buyAmount,
          maxSlippage: botConfig.trading.maxSlippage,
          gasLimit: botConfig.trading.gasLimit,
          maxPriorityFeePerGas: botConfig.trading.maxPriorityFeePerGas,
          autoApprove: botConfig.trading.autoApprove,
          retryFailedTx: botConfig.monitoring.retryFailedTx,
          maxRetries: botConfig.monitoring.maxRetries,
        };

        const buyResult = await this.sniperEngine.snipe(tokenInfo, safetyReport, sniperConfig);

        // If buy successful and auto-sell enabled, add position for monitoring
        if (buyResult.success && botConfig.selling.autoSell) {
          const sellConfig: SellConfig = {
            autoSell: botConfig.selling.autoSell,
            takeProfit: botConfig.selling.takeProfit,
            stopLoss: botConfig.selling.stopLoss,
            trailingStop: botConfig.selling.trailingStop,
            trailingStopPercent: botConfig.selling.trailingStopPercent,
            timedSell: botConfig.selling.timedSell,
            timedSellMinutes: botConfig.selling.timedSellMinutes,
            maxSlippage: botConfig.trading.maxSlippage,
            gasLimit: botConfig.trading.gasLimit,
          };

          await this.sellEngine.addPosition(
            buyResult,
            tokenInfo.tokenAddress,
            tokenInfo.symbol || 'Unknown',
            sellConfig
          );
        }
      } else {
        // Skip safety check and snipe directly (dangerous!)
        logger.warning('⚠️ Safety scanner disabled - sniping without checks');

        const sniperConfig: SniperConfig = {
          buyAmount: botConfig.trading.buyAmount,
          maxSlippage: botConfig.trading.maxSlippage,
          gasLimit: botConfig.trading.gasLimit,
          maxPriorityFeePerGas: botConfig.trading.maxPriorityFeePerGas,
          autoApprove: botConfig.trading.autoApprove,
          retryFailedTx: botConfig.monitoring.retryFailedTx,
          maxRetries: botConfig.monitoring.maxRetries,
        };

        await this.sniperEngine.snipe(
          tokenInfo,
          {
            tokenAddress: tokenInfo.tokenAddress,
            safetyScore: 0,
            isHoneypot: false,
            buyTax: 0,
            sellTax: 0,
            hasOwner: false,
            ownerAddress: null,
            isRenounced: false,
            hasBlacklist: false,
            liquidityBNB: 0,
            liquidityLocked: false,
            maxTxAmount: null,
            canBuy: true,
            canSell: true,
            warnings: [],
            timestamp: Date.now(),
          },
          sniperConfig
        );
      }
    } catch (error) {
      logger.error('Error handling new token', error);
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warning('Bot is not running');
      return;
    }

    logger.info('🛑 Stopping bot...');

    // Stop listening for new tokens
    this.factoryListener.stopListening();

    // Stop monitoring positions
    this.sellEngine.stopMonitoring();

    // Disconnect provider
    await this.provider.disconnect();

    this.isRunning = false;
    logger.success('Bot stopped');
  }

  /**
   * Get bot status
   */
  getStatus(): {
    isRunning: boolean;
    positions: number;
    walletsConnected: number;
  } {
    return {
      isRunning: this.isRunning,
      positions: this.sellEngine.getPositions().length,
      walletsConnected: this.walletManager.getAllWallets().length,
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  const bot = new FourMemeSniperBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n🛑 Received shutdown signal...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\n🛑 Received shutdown signal...');
    await bot.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });

  // Start bot
  try {
    await bot.start();
  } catch (error) {
    logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export default FourMemeSniperBot;
