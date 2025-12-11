import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

/**
 * Main bot configuration
 */
export interface BotConfig {
  trading: {
    buyAmount: string;
    maxSlippage: number;
    gasLimit: number;
    maxPriorityFeePerGas: string;
    autoApprove: boolean;
  };
  safety: {
    enableSafetyScanner: boolean;
    minSafetyScore: number;
    minLiquidity: number;
    maxBuyTax: number;
    maxSellTax: number;
    checkHoneypot: boolean;
    checkOwnership: boolean;
    checkLiquidity: boolean;
  };
  selling: {
    autoSell: boolean;
    takeProfit: number;
    stopLoss: number;
    trailingStop: boolean;
    trailingStopPercent: number;
    timedSell: boolean;
    timedSellMinutes: number;
  };
  monitoring: {
    checkInterval: number;
    maxPendingTx: number;
    retryFailedTx: boolean;
    maxRetries: number;
  };
  wallets: {
    rotateWallets: boolean;
    maxWalletUsage: number;
  };
  logging: {
    level: string;
    colorized: boolean;
    saveToFile: boolean;
    saveToDatabase: boolean;
  };
}

/**
 * Environment configuration
 */
export interface EnvConfig {
  RPC_WSS_URL: string;
  RPC_HTTPS_URL: string;
  PRIVATE_KEYS: string[];
  FOUR_MEME_FACTORY: string;
  PANCAKE_ROUTER_V2: string;
  PANCAKE_ROUTER_V3: string;
  DATABASE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/**
 * Load and validate configuration
 */
export class ConfigLoader {
  private botConfig: BotConfig;
  private envConfig: EnvConfig;

  constructor() {
    // Load environment variables
    dotenv.config();

    // Load bot configuration
    this.botConfig = this.loadBotConfig();
    this.envConfig = this.loadEnvConfig();

    // Validate configuration
    this.validate();
  }

  /**
   * Load bot configuration from JSON file
   */
  private loadBotConfig(): BotConfig {
    try {
      const configPath = path.join(process.cwd(), 'config', 'bot.config.json');
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData) as BotConfig;

      logger.success('Bot configuration loaded');
      return config;
    } catch (error) {
      logger.error('Failed to load bot configuration', error);
      throw new Error('Configuration file not found or invalid');
    }
  }

  /**
   * Load environment configuration
   */
  private loadEnvConfig(): EnvConfig {
    const privateKeysStr = process.env.PRIVATE_KEYS || '';
    const privateKeys = privateKeysStr
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (privateKeys.length === 0) {
      throw new Error('No private keys configured in .env');
    }

    return {
      RPC_WSS_URL: process.env.RPC_WSS_URL || '',
      RPC_HTTPS_URL: process.env.RPC_HTTPS_URL || '',
      PRIVATE_KEYS: privateKeys,
      FOUR_MEME_FACTORY: process.env.FOUR_MEME_FACTORY || '',
      PANCAKE_ROUTER_V2: process.env.PANCAKE_ROUTER_V2 || '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      PANCAKE_ROUTER_V3: process.env.PANCAKE_ROUTER_V3 || '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      DATABASE_URL: process.env.DATABASE_URL,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    };
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    const errors: string[] = [];

    // Validate RPC URLs
    if (!this.envConfig.RPC_WSS_URL) {
      errors.push('RPC_WSS_URL is required');
    }

    if (!this.envConfig.RPC_HTTPS_URL) {
      errors.push('RPC_HTTPS_URL is required');
    }

    // Validate private keys
    if (this.envConfig.PRIVATE_KEYS.length === 0) {
      errors.push('At least one private key is required');
    }

    // Validate factory address
    if (!this.envConfig.FOUR_MEME_FACTORY) {
      errors.push('FOUR_MEME_FACTORY address is required');
    }

    // Validate trading config
    if (Number(this.botConfig.trading.buyAmount) <= 0) {
      errors.push('Buy amount must be greater than 0');
    }

    if (this.botConfig.trading.maxSlippage < 0 || this.botConfig.trading.maxSlippage > 100) {
      errors.push('Max slippage must be between 0 and 100');
    }

    // Validate safety config
    if (
      this.botConfig.safety.minSafetyScore < 0 ||
      this.botConfig.safety.minSafetyScore > 100
    ) {
      errors.push('Min safety score must be between 0 and 100');
    }

    // Validate sell config
    if (this.botConfig.selling.takeProfit < 0) {
      errors.push('Take profit must be >= 0');
    }

    if (this.botConfig.selling.stopLoss < 0) {
      errors.push('Stop loss must be >= 0');
    }

    if (errors.length > 0) {
      logger.error('Configuration validation failed:');
      errors.forEach((err) => logger.error(`  - ${err}`));
      throw new Error('Invalid configuration');
    }

    logger.success('Configuration validated');
  }

  /**
   * Get bot configuration
   */
  getBotConfig(): BotConfig {
    return this.botConfig;
  }

  /**
   * Get environment configuration
   */
  getEnvConfig(): EnvConfig {
    return this.envConfig;
  }

  /**
   * Display configuration summary
   */
  displaySummary(): void {
    logger.info('═══════════════════════════════════════════════════');
    logger.info('📋 Configuration Summary');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`Buy Amount: ${this.botConfig.trading.buyAmount} BNB`);
    logger.info(`Max Slippage: ${this.botConfig.trading.maxSlippage}%`);
    logger.info(`Gas Limit: ${this.botConfig.trading.gasLimit}`);
    logger.info(`Priority Fee: ${this.botConfig.trading.maxPriorityFeePerGas} gwei`);
    logger.info('───────────────────────────────────────────────────');
    logger.info(`Safety Scanner: ${this.botConfig.safety.enableSafetyScanner ? 'ON' : 'OFF'}`);
    logger.info(`Min Safety Score: ${this.botConfig.safety.minSafetyScore}/100`);
    logger.info(`Min Liquidity: ${this.botConfig.safety.minLiquidity} BNB`);
    logger.info(`Max Buy Tax: ${this.botConfig.safety.maxBuyTax}%`);
    logger.info(`Max Sell Tax: ${this.botConfig.safety.maxSellTax}%`);
    logger.info('───────────────────────────────────────────────────');
    logger.info(`Auto Sell: ${this.botConfig.selling.autoSell ? 'ON' : 'OFF'}`);
    logger.info(`Take Profit: ${this.botConfig.selling.takeProfit}%`);
    logger.info(`Stop Loss: ${this.botConfig.selling.stopLoss}%`);
    logger.info(`Trailing Stop: ${this.botConfig.selling.trailingStop ? 'ON' : 'OFF'}`);
    logger.info('───────────────────────────────────────────────────');
    logger.info(`Wallets: ${this.envConfig.PRIVATE_KEYS.length}`);
    logger.info(`WSS RPC: ${this.envConfig.RPC_WSS_URL.substring(0, 30)}...`);
    logger.info('═══════════════════════════════════════════════════');
  }
}
