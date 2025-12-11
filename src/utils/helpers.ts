import { ethers } from 'ethers';

/**
 * Utility functions for the sniper bot
 */

/**
 * Sleep for specified milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Format BNB amount to readable string
 */
export const formatBNB = (wei: bigint | string): string => {
  return ethers.formatEther(wei.toString());
};

/**
 * Parse BNB amount from string to wei
 */
export const parseBNB = (bnb: string): bigint => {
  return ethers.parseEther(bnb);
};

/**
 * Format token amount based on decimals
 */
export const formatTokenAmount = (amount: bigint | string, decimals: number): string => {
  return ethers.formatUnits(amount.toString(), decimals);
};

/**
 * Parse token amount to smallest unit
 */
export const parseTokenAmount = (amount: string, decimals: number): bigint => {
  return ethers.parseUnits(amount, decimals);
};

/**
 * Calculate percentage
 */
export const calculatePercentage = (value: number, percentage: number): number => {
  return (value * percentage) / 100;
};

/**
 * Calculate price impact
 */
export const calculatePriceImpact = (
  inputAmount: bigint,
  outputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): number => {
  const spotPrice = Number(inputReserve) / Number(outputReserve);
  const executionPrice = Number(inputAmount) / Number(outputAmount);
  const priceImpact = ((executionPrice - spotPrice) / spotPrice) * 100;
  return Math.abs(priceImpact);
};

/**
 * Get deadline timestamp (current time + minutes)
 */
export const getDeadline = (minutesFromNow: number = 10): number => {
  return Math.floor(Date.now() / 1000) + (minutesFromNow * 60);
};

/**
 * Validate Ethereum address
 */
export const isValidAddress = (address: string): boolean => {
  return ethers.isAddress(address);
};

/**
 * Checksum address
 */
export const checksumAddress = (address: string): string => {
  return ethers.getAddress(address);
};

/**
 * Calculate minimum amount out with slippage
 */
export const calculateMinAmountOut = (expectedAmount: bigint, slippagePercent: number): bigint => {
  const slippage = BigInt(Math.floor(slippagePercent * 100));
  return (expectedAmount * (BigInt(10000) - slippage)) / BigInt(10000);
};

/**
 * Generate random delay for anti-detection
 */
export const randomDelay = (minMs: number, maxMs: number): Promise<void> => {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(delay);
};

/**
 * Truncate address for display
 */
export const truncateAddress = (address: string, chars: number = 4): string => {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
};

/**
 * Format timestamp to readable date
 */
export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp * 1000).toISOString();
};

/**
 * Calculate profit/loss percentage
 */
export const calculatePnL = (buyPrice: number, sellPrice: number): number => {
  return ((sellPrice - buyPrice) / buyPrice) * 100;
};

/**
 * Retry async function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, i);
      await sleep(delay);
    }
  }
  throw new Error('Max retries reached');
};

/**
 * Check if error is a revert error
 */
export const isRevertError = (error: any): boolean => {
  const errorStr = error.toString().toLowerCase();
  return errorStr.includes('revert') || 
         errorStr.includes('execution reverted') ||
         errorStr.includes('transaction failed');
};

/**
 * Extract revert reason from error
 */
export const extractRevertReason = (error: any): string => {
  try {
    if (error.reason) return error.reason;
    if (error.data?.message) return error.data.message;
    const errorStr = error.toString();
    const match = errorStr.match(/reason="([^"]+)"/);
    if (match) return match[1];
    return 'Unknown revert reason';
  } catch {
    return 'Unknown revert reason';
  }
};

/**
 * Convert gas price from gwei to wei
 */
export const gweiToWei = (gwei: string): bigint => {
  return ethers.parseUnits(gwei, 'gwei');
};

/**
 * Convert wei to gwei
 */
export const weiToGwei = (wei: bigint): string => {
  return ethers.formatUnits(wei, 'gwei');
};

/**
 * Safe BigInt division with precision
 */
export const safeDivide = (numerator: bigint, denominator: bigint, precision: number = 18): number => {
  if (denominator === BigInt(0)) return 0;
  const scaled = (numerator * BigInt(10 ** precision)) / denominator;
  return Number(scaled) / (10 ** precision);
};

/**
 * Generate random wallet from available wallets
 */
export const selectRandomWallet = <T>(wallets: T[]): T => {
  return wallets[Math.floor(Math.random() * wallets.length)];
};
