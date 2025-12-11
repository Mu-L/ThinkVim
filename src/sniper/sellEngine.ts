import { ethers } from 'ethers';
import { BlockchainProvider } from '../core/provider';
import { WalletManager } from '../core/walletManager';
import { logger } from '../utils/logger';
import { BuyResult } from './sniperEngine';
import {
  ERC20_ABI,
  PANCAKE_ROUTER_V2_ABI,
} from '../utils/abis';
import {
  formatBNB,
  formatTokenAmount,
  getDeadline,
  calculateMinAmountOut,
  calculatePnL,
  gweiToWei,
} from '../utils/helpers';

/**
 * Auto-sell configuration
 */
export interface SellConfig {
  autoSell: boolean;
  takeProfit: number; // Percentage gain to sell
  stopLoss: number; // Percentage loss to sell
  trailingStop: boolean;
  trailingStopPercent: number;
  timedSell: boolean;
  timedSellMinutes: number;
  maxSlippage: number;
  gasLimit: number;
}

/**
 * Position tracking
 */
export interface Position {
  tokenAddress: string;
  tokenSymbol: string;
  walletAddress: string;
  buyTxHash: string;
  buyPrice: number; // BNB per token
  buyAmount: bigint; // Tokens bought
  bnbSpent: bigint;
  buyTimestamp: number;
  highestPrice: number; // For trailing stop
  targetSellPrice?: number;
  stopLossPrice?: number;
}

/**
 * Sell result
 */
export interface SellResult {
  success: boolean;
  txHash?: string;
  bnbReceived?: bigint;
  tokensSold?: bigint;
  profitLoss: number; // Percentage
  profitLossBNB: number; // BNB amount
  reason: string;
  timestamp: number;
}

/**
 * Auto-sell engine with take-profit, stop-loss, and trailing stop
 */
export class SellEngine {
  private provider: BlockchainProvider;
  private walletManager: WalletManager;
  private routerAddress: string;
  private router: ethers.Contract;
  private WBNB: string = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  
  private positions: Map<string, Position> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private checkInterval: number = 1000; // Check every 1 second

  constructor(
    provider: BlockchainProvider,
    walletManager: WalletManager,
    routerAddress: string,
    checkInterval: number = 1000
  ) {
    this.provider = provider;
    this.walletManager = walletManager;
    this.routerAddress = routerAddress;
    this.checkInterval = checkInterval;

    // Initialize router contract
    this.router = new ethers.Contract(
      routerAddress,
      PANCAKE_ROUTER_V2_ABI,
      provider.getHttpProvider()
    );
  }

  /**
   * Add position for monitoring
   */
  async addPosition(
    buyResult: BuyResult,
    tokenAddress: string,
    tokenSymbol: string,
    config: SellConfig
  ): Promise<void> {
    if (!buyResult.success || !buyResult.tokenAmount) {
      logger.warning('Cannot add position - buy was not successful');
      return;
    }

    // Calculate buy price
    const bnbSpent = buyResult.bnbSpent || BigInt(0);
    const tokensReceived = buyResult.tokenAmount;
    const buyPrice = Number(bnbSpent) / Number(tokensReceived);

    // Calculate target prices
    const targetSellPrice = buyPrice * (1 + config.takeProfit / 100);
    const stopLossPrice = buyPrice * (1 - config.stopLoss / 100);

    const position: Position = {
      tokenAddress,
      tokenSymbol,
      walletAddress: buyResult.walletAddress,
      buyTxHash: buyResult.txHash!,
      buyPrice,
      buyAmount: tokensReceived,
      bnbSpent,
      buyTimestamp: buyResult.timestamp,
      highestPrice: buyPrice,
      targetSellPrice,
      stopLossPrice,
    };

    // Generate unique position ID
    const positionId = `${tokenAddress}-${buyResult.walletAddress}`;
    this.positions.set(positionId, position);

    logger.success(
      `📊 Position added: ${tokenSymbol} | TP: ${config.takeProfit}% | SL: ${config.stopLoss}%`
    );

    // Start monitoring if not already running
    if (!this.monitoringInterval && config.autoSell) {
      this.startMonitoring(config);
    }

    // Set timed sell if configured
    if (config.timedSell) {
      this.scheduleTimedSell(positionId, config.timedSellMinutes, config);
    }
  }

  /**
   * Start monitoring positions
   */
  private startMonitoring(config: SellConfig): void {
    if (this.monitoringInterval) return;

    logger.info('🔄 Starting position monitoring...');

    this.monitoringInterval = setInterval(async () => {
      await this.checkPositions(config);
    }, this.checkInterval);
  }

  /**
   * Check all positions for sell conditions
   */
  private async checkPositions(config: SellConfig): Promise<void> {
    if (this.positions.size === 0) {
      return;
    }

    for (const [positionId, position] of this.positions) {
      try {
        // Get current price
        const currentPrice = await this.getTokenPrice(position.tokenAddress);

        if (currentPrice === 0) {
          logger.debug(`Cannot get price for ${position.tokenSymbol}`);
          continue;
        }

        // Update highest price for trailing stop
        if (currentPrice > position.highestPrice) {
          position.highestPrice = currentPrice;
        }

        // Calculate profit/loss
        const pnlPercent = calculatePnL(position.buyPrice, currentPrice);

        // Check take-profit
        if (config.takeProfit > 0 && pnlPercent >= config.takeProfit) {
          logger.info(
            `🎯 Take-profit triggered for ${position.tokenSymbol}: ${pnlPercent.toFixed(2)}%`
          );
          await this.executeSell(positionId, position, config, 'Take-Profit');
          continue;
        }

        // Check stop-loss
        if (config.stopLoss > 0 && pnlPercent <= -config.stopLoss) {
          logger.warning(
            `🛑 Stop-loss triggered for ${position.tokenSymbol}: ${pnlPercent.toFixed(2)}%`
          );
          await this.executeSell(positionId, position, config, 'Stop-Loss');
          continue;
        }

        // Check trailing stop
        if (config.trailingStop) {
          const dropFromHigh = calculatePnL(position.highestPrice, currentPrice);
          if (dropFromHigh <= -config.trailingStopPercent) {
            logger.info(
              `📉 Trailing stop triggered for ${position.tokenSymbol}: ${dropFromHigh.toFixed(2)}% from high`
            );
            await this.executeSell(positionId, position, config, 'Trailing-Stop');
            continue;
          }
        }

        // Log current status
        logger.debug(
          `${position.tokenSymbol}: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`
        );
      } catch (error) {
        logger.error(`Error checking position ${position.tokenSymbol}`, error);
      }
    }
  }

  /**
   * Execute sell transaction
   */
  private async executeSell(
    positionId: string,
    position: Position,
    config: SellConfig,
    reason: string
  ): Promise<SellResult> {
    try {
      logger.info(`💰 Executing sell: ${position.tokenSymbol} - ${reason}`);

      // Get wallet
      const walletInfo = this.walletManager.getWallet(position.walletAddress);
      if (!walletInfo) {
        throw new Error('Wallet not found');
      }

      // Get token balance
      const tokenContract = new ethers.Contract(
        position.tokenAddress,
        ERC20_ABI,
        walletInfo.wallet
      );

      const balance = await tokenContract.balanceOf(position.walletAddress);

      if (balance === BigInt(0)) {
        throw new Error('No tokens to sell');
      }

      // Approve router if needed
      await this.ensureApproval(position.tokenAddress, balance, walletInfo.wallet);

      // Prepare swap path
      const path = [position.tokenAddress, this.WBNB];

      // Get expected output
      const amountsOut = await this.router.getAmountsOut(balance, path);
      const expectedBNB = amountsOut[1];
      const minBNB = calculateMinAmountOut(expectedBNB, config.maxSlippage);

      logger.info(
        `Selling ${formatTokenAmount(balance, 18)} tokens for ~${formatBNB(expectedBNB)} BNB`
      );

      // Get nonce
      const nonce = this.walletManager.getAndIncrementNonce(position.walletAddress);

      // Build transaction
      const deadline = getDeadline(10);
      const gasPrice = (await this.provider.getGasPrice()) + gweiToWei('2');

      const tx = await this.router.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
        balance,
        minBNB,
        path,
        position.walletAddress,
        deadline
      );

      tx.gasLimit = BigInt(config.gasLimit);
      tx.gasPrice = gasPrice;
      tx.nonce = nonce;
      tx.chainId = await this.provider.getChainId();

      // Sign and send
      const signedTx = await walletInfo.wallet.signTransaction(tx);
      const sentTx = await this.provider.getHttpProvider().broadcastTransaction(signedTx);

      logger.info(`Sell transaction sent: ${sentTx.hash}`);

      // Wait for confirmation
      const receipt = await this.provider.waitForTransaction(sentTx.hash, 1);

      if (!receipt || receipt.status === 0) {
        throw new Error('Sell transaction failed');
      }

      // Mark transaction as confirmed
      this.walletManager.confirmTransaction(position.walletAddress);

      // Get actual BNB received
      const currentBalance = await this.provider.getHttpProvider().getBalance(position.walletAddress);
      const bnbReceived = expectedBNB; // Approximation

      // Calculate P&L
      const profitLossBNB = Number(formatBNB(bnbReceived)) - Number(formatBNB(position.bnbSpent));
      const profitLossPercent = (profitLossBNB / Number(formatBNB(position.bnbSpent))) * 100;

      logger.trade(
        'SELL',
        position.tokenSymbol,
        formatTokenAmount(balance, 18),
        sentTx.hash,
        {
          bnbReceived: formatBNB(bnbReceived),
          profitLoss: `${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%`,
          reason,
        }
      );

      // Remove position
      this.positions.delete(positionId);

      return {
        success: true,
        txHash: sentTx.hash,
        bnbReceived,
        tokensSold: balance,
        profitLoss: profitLossPercent,
        profitLossBNB,
        reason,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.error(`Failed to sell ${position.tokenSymbol}`, error);

      // Reset nonce
      await this.walletManager.resetNonce(position.walletAddress);

      return {
        success: false,
        profitLoss: 0,
        profitLossBNB: 0,
        reason: `Failed: ${error.message}`,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Ensure token approval for selling
   */
  private async ensureApproval(
    tokenAddress: string,
    amount: bigint,
    wallet: ethers.Wallet
  ): Promise<void> {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      const allowance = await tokenContract.allowance(wallet.address, this.routerAddress);

      if (allowance >= amount) {
        return;
      }

      logger.info('Approving token for selling...');
      const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256, {
        gasLimit: 100000,
      });

      await approveTx.wait();
      logger.success('Token approved');
    } catch (error) {
      logger.error('Failed to approve token', error);
      throw error;
    }
  }

  /**
   * Get current token price in BNB
   */
  private async getTokenPrice(tokenAddress: string): Promise<number> {
    try {
      const path = [tokenAddress, this.WBNB];
      const oneToken = ethers.parseUnits('1', 18);
      const amountsOut = await this.router.getAmountsOut(oneToken, path);
      return Number(formatBNB(amountsOut[1]));
    } catch {
      return 0;
    }
  }

  /**
   * Schedule timed sell
   */
  private scheduleTimedSell(
    positionId: string,
    minutes: number,
    config: SellConfig
  ): void {
    setTimeout(async () => {
      const position = this.positions.get(positionId);
      if (position) {
        logger.info(`⏰ Timed sell triggered for ${position.tokenSymbol}`);
        await this.executeSell(positionId, position, config, 'Timed-Sell');
      }
    }, minutes * 60 * 1000);
  }

  /**
   * Manual sell
   */
  async manualSell(positionId: string, config: SellConfig): Promise<SellResult | null> {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warning('Position not found');
      return null;
    }

    return await this.executeSell(positionId, position, config, 'Manual');
  }

  /**
   * Get all positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Position monitoring stopped');
    }
  }
}
