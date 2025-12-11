import { ethers } from 'ethers';
import { BlockchainProvider } from '../core/provider';
import { WalletManager } from '../core/walletManager';
import { logger } from '../utils/logger';
import { NewTokenInfo } from '../scanner/factoryListener';
import { SafetyReport } from '../scanner/safetyScanner';
import {
  ERC20_ABI,
  PANCAKE_ROUTER_V2_ABI,
  WBNB_ABI,
} from '../utils/abis';
import {
  parseBNB,
  formatBNB,
  getDeadline,
  calculateMinAmountOut,
  gweiToWei,
  retryWithBackoff,
} from '../utils/helpers';

/**
 * Sniper configuration
 */
export interface SniperConfig {
  buyAmount: string; // In BNB
  maxSlippage: number; // Percentage
  gasLimit: number;
  maxPriorityFeePerGas: string; // In gwei
  autoApprove: boolean;
  retryFailedTx: boolean;
  maxRetries: number;
}

/**
 * Buy transaction result
 */
export interface BuyResult {
  success: boolean;
  txHash?: string;
  tokenAmount?: bigint;
  bnbSpent?: bigint;
  gasUsed?: bigint;
  error?: string;
  walletAddress: string;
  timestamp: number;
}

/**
 * Token sniper engine - executes buy transactions
 */
export class SniperEngine {
  private provider: BlockchainProvider;
  private walletManager: WalletManager;
  private routerAddress: string;
  private router: ethers.Contract;
  private WBNB: string = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  private pendingBuys: Map<string, boolean> = new Map();

  constructor(
    provider: BlockchainProvider,
    walletManager: WalletManager,
    routerAddress: string
  ) {
    this.provider = provider;
    this.walletManager = walletManager;
    this.routerAddress = routerAddress;

    // Initialize router contract
    this.router = new ethers.Contract(
      routerAddress,
      PANCAKE_ROUTER_V2_ABI,
      provider.getHttpProvider()
    );
  }

  /**
   * Execute snipe buy for a token
   */
  async snipe(
    tokenInfo: NewTokenInfo,
    safetyReport: SafetyReport,
    config: SniperConfig
  ): Promise<BuyResult> {
    const tokenAddress = tokenInfo.tokenAddress;

    // Check if already buying this token
    if (this.pendingBuys.has(tokenAddress)) {
      logger.warning(`Already sniping ${tokenInfo.symbol}, skipping duplicate`);
      return {
        success: false,
        error: 'Duplicate snipe attempt',
        walletAddress: '',
        timestamp: Date.now(),
      };
    }

    this.pendingBuys.set(tokenAddress, true);

    try {
      logger.info(`🎯 Starting snipe: ${tokenInfo.symbol} (${tokenAddress})`);

      // Get wallet to use
      const walletInfo = this.walletManager.getNextWallet();
      logger.info(`Using wallet: ${walletInfo.address}`);

      // Check wallet balance
      const balance = await this.provider.getHttpProvider().getBalance(walletInfo.address);
      const buyAmount = parseBNB(config.buyAmount);

      if (balance < buyAmount) {
        throw new Error(
          `Insufficient balance: ${formatBNB(balance)} BNB < ${config.buyAmount} BNB`
        );
      }

      // Approve token spending if needed
      if (config.autoApprove) {
        await this.ensureApproval(tokenAddress, walletInfo.wallet);
      }

      // Execute buy
      const result = await this.executeBuy(
        tokenAddress,
        walletInfo,
        config
      );

      if (result.success) {
        logger.trade(
          'BUY',
          tokenInfo.symbol || tokenAddress,
          config.buyAmount + ' BNB',
          result.txHash!,
          {
            tokenAmount: result.tokenAmount?.toString(),
            gasUsed: result.gasUsed?.toString(),
            safetyScore: safetyReport.safetyScore,
          }
        );
      }

      return result;
    } catch (error: any) {
      logger.error(`Failed to snipe ${tokenInfo.symbol}`, error);
      return {
        success: false,
        error: error.message,
        walletAddress: '',
        timestamp: Date.now(),
      };
    } finally {
      this.pendingBuys.delete(tokenAddress);
    }
  }

  /**
   * Execute buy transaction
   */
  private async executeBuy(
    tokenAddress: string,
    walletInfo: any,
    config: SniperConfig
  ): Promise<BuyResult> {
    const startTime = Date.now();

    try {
      // Get current gas price
      const feeData = await this.provider.getProvider().getFeeData();
      const gasPrice = feeData.gasPrice || gweiToWei('5');
      const priorityFee = gweiToWei(config.maxPriorityFeePerGas);

      // Prepare swap path
      const path = [this.WBNB, tokenAddress];
      const buyAmount = parseBNB(config.buyAmount);

      // Get expected output amount
      const amountsOut = await this.router.getAmountsOut(buyAmount, path);
      const expectedTokens = amountsOut[1];
      const minTokens = calculateMinAmountOut(expectedTokens, config.maxSlippage);

      logger.info(
        `Expected tokens: ${expectedTokens.toString()}, Min: ${minTokens.toString()}`
      );

      // Get nonce
      const nonce = this.walletManager.getAndIncrementNonce(walletInfo.address);

      // Build transaction
      const deadline = getDeadline(10); // 10 minutes

      const tx = await this.router.swapExactETHForTokens.populateTransaction(
        minTokens,
        path,
        walletInfo.address,
        deadline,
        { value: buyAmount }
      );

      // Add gas configuration
      tx.gasLimit = BigInt(config.gasLimit);
      tx.gasPrice = gasPrice + priorityFee;
      tx.nonce = nonce;
      tx.chainId = await this.provider.getChainId();

      // Sign and send transaction
      const signedTx = await walletInfo.wallet.signTransaction(tx);
      const sentTx = await this.provider.getHttpProvider().broadcastTransaction(signedTx);

      logger.info(`Transaction sent: ${sentTx.hash}`);

      // Wait for confirmation
      const receipt = await this.provider.waitForTransaction(sentTx.hash, 1);

      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      // Mark transaction as confirmed
      this.walletManager.confirmTransaction(walletInfo.address);

      if (receipt.status === 0) {
        throw new Error('Transaction failed');
      }

      // Calculate actual tokens received
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider.getHttpProvider()
      );
      const tokenBalance = await tokenContract.balanceOf(walletInfo.address);

      const executionTime = Date.now() - startTime;
      logger.success(`Buy executed in ${executionTime}ms`);

      return {
        success: true,
        txHash: sentTx.hash,
        tokenAmount: tokenBalance,
        bnbSpent: buyAmount,
        gasUsed: receipt.gasUsed,
        walletAddress: walletInfo.address,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.error('Buy execution failed', error);

      // Reset nonce on failure
      await this.walletManager.resetNonce(walletInfo.address);

      // Retry if configured
      if (config.retryFailedTx && config.maxRetries > 0) {
        logger.info('Retrying buy...');
        config.maxRetries--;
        return this.executeBuy(tokenAddress, walletInfo, config);
      }

      return {
        success: false,
        error: error.message,
        walletAddress: walletInfo.address,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Ensure token spending approval (for selling later)
   */
  private async ensureApproval(
    tokenAddress: string,
    wallet: ethers.Wallet
  ): Promise<void> {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      // Check current allowance
      const allowance = await tokenContract.allowance(wallet.address, this.routerAddress);

      // If allowance is sufficient, skip
      if (allowance > BigInt(0)) {
        logger.debug('Token already approved');
        return;
      }

      // Approve max amount
      logger.info('Approving token spending...');
      const maxApproval = ethers.MaxUint256;

      const approveTx = await tokenContract.approve(this.routerAddress, maxApproval, {
        gasLimit: 100000,
      });

      await approveTx.wait();
      logger.success('Token approved for trading');
    } catch (error) {
      logger.warning('Failed to pre-approve token', error);
      // Don't throw - approval can happen during sell
    }
  }

  /**
   * Get estimated output for buy
   */
  async getEstimatedOutput(
    tokenAddress: string,
    bnbAmount: string
  ): Promise<bigint> {
    try {
      const path = [this.WBNB, tokenAddress];
      const buyAmount = parseBNB(bnbAmount);
      const amountsOut = await this.router.getAmountsOut(buyAmount, path);
      return amountsOut[1];
    } catch (error) {
      logger.error('Failed to get estimated output', error);
      return BigInt(0);
    }
  }

  /**
   * Calculate current token price in BNB
   */
  async getTokenPrice(tokenAddress: string): Promise<number> {
    try {
      const path = [tokenAddress, this.WBNB];
      const oneToken = ethers.parseUnits('1', 18); // Assume 18 decimals
      const amountsOut = await this.router.getAmountsOut(oneToken, path);
      const bnbOut = amountsOut[1];
      return Number(formatBNB(bnbOut));
    } catch (error) {
      logger.debug('Failed to get token price', error);
      return 0;
    }
  }

  /**
   * Check if snipe is in progress for token
   */
  isSnipping(tokenAddress: string): boolean {
    return this.pendingBuys.has(tokenAddress);
  }
}
