import dotenv from 'dotenv';
import { Decimal } from 'decimal.js';

// Load environment variables
dotenv.config();

export interface EnvConfig {
  // Polymarket API
  polymarketApiKey: string;
  polymarketApiSecret: string;

  // Wallet
  privateKey: string;

  // Risk Management
  maxPositionUsd: Decimal;
  maxDailyLossUsd: Decimal;
  minSpread: Decimal;

  // Trading Configuration
  enablePaperTrading: boolean;
  maxOrdersPerMarket: number;
  orderTimeoutSeconds: number;

  // Market Filters
  minVolumeUsd: Decimal;
  minLiquidityUsd: Decimal;
  maxTimeToResolutionHours: number;

  // Strategy Configuration
  spreadArbEnabled: boolean;
  momentumEnabled: boolean;
  trailingStopPercent: Decimal;

  // WebSocket Configuration
  wsReconnectInterval: number;
  wsHeartbeatInterval: number;

  // Logging Configuration
  logLevel: string;
  enableFileLogging: boolean;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value || defaultValue!;
}

function getEnvDecimal(key: string, defaultValue: string): Decimal {
  const value = getEnvVar(key, defaultValue);
  return new Decimal(value);
}

function getEnvBoolean(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = getEnvVar(key, defaultValue.toString());
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

/**
 * Validate configuration values
 */
function validateConfig(config: Partial<EnvConfig>): void {
  if (config.maxPositionUsd && config.maxPositionUsd.lessThanOrEqualTo(0)) {
    throw new Error('MAX_POSITION_USD must be greater than 0');
  }

  if (config.maxDailyLossUsd && config.maxDailyLossUsd.greaterThanOrEqualTo(0)) {
    throw new Error('MAX_DAILY_LOSS_USD must be negative (a loss limit)');
  }

  if (config.minSpread && (config.minSpread.lessThan(0) || config.minSpread.greaterThan(1))) {
    throw new Error('MIN_SPREAD must be between 0 and 1');
  }

  if (config.trailingStopPercent && (config.trailingStopPercent.lessThan(0) || config.trailingStopPercent.greaterThan(1))) {
    throw new Error('TRAILING_STOP_PERCENT must be between 0 and 1');
  }

  if (config.wsReconnectInterval && config.wsReconnectInterval < 1000) {
    throw new Error('WS_RECONNECT_INTERVAL must be at least 1000ms');
  }

  if (config.wsHeartbeatInterval && config.wsHeartbeatInterval < 5000) {
    throw new Error('WS_HEARTBEAT_INTERVAL must be at least 5000ms');
  }

  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (config.logLevel && !validLogLevels.includes(config.logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }
}

export const config: EnvConfig = {
  // Polymarket API
  polymarketApiKey: getEnvVar('POLYMARKET_API_KEY'),
  polymarketApiSecret: getEnvVar('POLYMARKET_API_SECRET'),

  // Wallet
  privateKey: getEnvVar('PRIVATE_KEY'),

  // Risk Management
  maxPositionUsd: getEnvDecimal('MAX_POSITION_USD', '100'),
  maxDailyLossUsd: getEnvDecimal('MAX_DAILY_LOSS_USD', '50'),
  minSpread: getEnvDecimal('MIN_SPREAD', '0.03'),

  // Trading Configuration
  enablePaperTrading: getEnvBoolean('ENABLE_PAPER_TRADING', true),
  maxOrdersPerMarket: getEnvNumber('MAX_ORDERS_PER_MARKET', 5),
  orderTimeoutSeconds: getEnvNumber('ORDER_TIMEOUT_SECONDS', 300),

  // Market Filters
  minVolumeUsd: getEnvDecimal('MIN_VOLUME_USD', '1000'),
  minLiquidityUsd: getEnvDecimal('MIN_LIQUIDITY_USD', '500'),
  maxTimeToResolutionHours: getEnvNumber('MAX_TIME_TO_RESOLUTION_HOURS', 168),

  // Strategy Configuration
  spreadArbEnabled: getEnvBoolean('SPREAD_ARB_ENABLED', true),
  momentumEnabled: getEnvBoolean('MOMENTUM_ENABLED', true),
  trailingStopPercent: getEnvDecimal('TRAILING_STOP_PERCENT', '0.05'),

  // WebSocket Configuration
  wsReconnectInterval: getEnvNumber('WS_RECONNECT_INTERVAL', 5000),
  wsHeartbeatInterval: getEnvNumber('WS_HEARTBEAT_INTERVAL', 30000),

  // Logging Configuration
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  enableFileLogging: getEnvBoolean('ENABLE_FILE_LOGGING', false),
};

// Validate configuration
validateConfig(config);

export default config;
