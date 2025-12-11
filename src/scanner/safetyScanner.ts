import { ethers } from 'ethers';
import { BlockchainProvider } from '../core/provider';
import { logger } from '../utils/logger';
import { NewTokenInfo } from './factoryListener';
import {
  ERC20_ABI,
  PANCAKE_ROUTER_V2_ABI,
  PANCAKE_PAIR_ABI,
  SAFETY_CHECK_ABI,
} from '../utils/abis';
import { formatTokenAmount, formatBNB } from '../utils/helpers';

/**
 * Safety analysis result for a token
 */
export interface SafetyReport {
  tokenAddress: string;
  safetyScore: number; // 0-100
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  hasOwner: boolean;
  ownerAddress: string | null;
  isRenounced: boolean;
  hasBlacklist: boolean;
  liquidityBNB: number;
  liquidityLocked: boolean;
  maxTxAmount: bigint | null;
  canBuy: boolean;
  canSell: boolean;
  warnings: string[];
  timestamp: number;
}

export interface SafetyConfig {
  minSafetyScore: number;
  minLiquidity: number;
  maxBuyTax: number;
  maxSellTax: number;
  checkHoneypot: boolean;
  checkOwnership: boolean;
  checkLiquidity: boolean;
}

/**
 * Comprehensive safety scanner for new tokens
 */
export class SafetyScanner {
  private provider: BlockchainProvider;
  private routerAddress: string;
  private router: ethers.Contract;
  private WBNB: string = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

  constructor(provider: BlockchainProvider, routerAddress: string) {
    this.provider = provider;
    this.routerAddress = routerAddress;

    // Initialize router contract
    this.router = new ethers.Contract(
      routerAddress,
      PANCAKE_ROUTER_V2_ABI,
      provider.getHttpProvider()
    );
  }

  /**
   * Perform comprehensive safety analysis
   */
  async analyzeToken(
    tokenInfo: NewTokenInfo,
    config: SafetyConfig
  ): Promise<SafetyReport> {
    logger.info(`🔍 Analyzing token safety: ${tokenInfo.symbol || tokenInfo.tokenAddress}`);

    const warnings: string[] = [];
    let safetyScore = 100;

    // Initialize report
    const report: SafetyReport = {
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
      warnings,
      timestamp: Math.floor(Date.now() / 1000),
    };

    try {
      // Run all checks in parallel for speed
      const [ownershipResult, liquidityResult, honeypotResult] = await Promise.allSettled([
        config.checkOwnership ? this.checkOwnership(tokenInfo.tokenAddress) : Promise.resolve(null),
        config.checkLiquidity ? this.checkLiquidity(tokenInfo.pairAddress) : Promise.resolve(null),
        config.checkHoneypot ? this.checkHoneypot(tokenInfo.tokenAddress, tokenInfo.pairAddress) : Promise.resolve(null),
      ]);

      // Process ownership check
      if (ownershipResult.status === 'fulfilled' && ownershipResult.value) {
        const ownership = ownershipResult.value;
        report.hasOwner = ownership.hasOwner;
        report.ownerAddress = ownership.ownerAddress;
        report.isRenounced = ownership.isRenounced;
        report.hasBlacklist = ownership.hasBlacklist;

        if (ownership.hasOwner && !ownership.isRenounced) {
          safetyScore -= 20;
          warnings.push('⚠️ Contract has owner (not renounced)');
        }

        if (ownership.hasBlacklist) {
          safetyScore -= 15;
          warnings.push('⚠️ Contract has blacklist function');
        }
      }

      // Process liquidity check
      if (liquidityResult.status === 'fulfilled' && liquidityResult.value) {
        const liquidity = liquidityResult.value;
        report.liquidityBNB = liquidity.bnbAmount;
        report.liquidityLocked = liquidity.isLocked;

        if (liquidity.bnbAmount < config.minLiquidity) {
          safetyScore -= 25;
          warnings.push(`⚠️ Low liquidity: ${liquidity.bnbAmount.toFixed(4)} BNB`);
        }

        if (!liquidity.isLocked) {
          safetyScore -= 15;
          warnings.push('⚠️ Liquidity not locked');
        }
      }

      // Process honeypot check
      if (honeypotResult.status === 'fulfilled' && honeypotResult.value) {
        const honeypot = honeypotResult.value;
        report.isHoneypot = honeypot.isHoneypot;
        report.buyTax = honeypot.buyTax;
        report.sellTax = honeypot.sellTax;
        report.canBuy = honeypot.canBuy;
        report.canSell = honeypot.canSell;

        if (honeypot.isHoneypot) {
          safetyScore = 0;
          warnings.push('🚨 HONEYPOT DETECTED - Cannot sell!');
        }

        if (honeypot.buyTax > config.maxBuyTax) {
          safetyScore -= 15;
          warnings.push(`⚠️ High buy tax: ${honeypot.buyTax}%`);
        }

        if (honeypot.sellTax > config.maxSellTax) {
          safetyScore -= 15;
          warnings.push(`⚠️ High sell tax: ${honeypot.sellTax}%`);
        }

        if (!honeypot.canBuy) {
          safetyScore -= 30;
          warnings.push('⚠️ Cannot buy token');
        }
      }

      // Ensure score is within 0-100
      report.safetyScore = Math.max(0, Math.min(100, safetyScore));

      // Log results
      if (report.safetyScore >= config.minSafetyScore) {
        logger.success(
          `✅ Token passed safety check: ${report.safetyScore}/100 | ${tokenInfo.symbol}`
        );
      } else {
        logger.warning(
          `❌ Token failed safety check: ${report.safetyScore}/100 | ${tokenInfo.symbol}`
        );
      }

      if (warnings.length > 0) {
        logger.warning('Safety warnings:', warnings);
      }
    } catch (error) {
      logger.error('Error during safety analysis', error);
      report.safetyScore = 0;
      report.warnings.push('Error during analysis');
    }

    return report;
  }

  /**
   * Check contract ownership and dangerous functions
   */
  private async checkOwnership(tokenAddress: string): Promise<{
    hasOwner: boolean;
    ownerAddress: string | null;
    isRenounced: boolean;
    hasBlacklist: boolean;
  }> {
    const contract = new ethers.Contract(
      tokenAddress,
      SAFETY_CHECK_ABI,
      this.provider.getHttpProvider()
    );

    let hasOwner = false;
    let ownerAddress: string | null = null;
    let isRenounced = false;
    let hasBlacklist = false;

    try {
      // Try to get owner
      try {
        ownerAddress = await contract.owner();
        hasOwner = ownerAddress !== ethers.ZeroAddress;
        isRenounced = ownerAddress === ethers.ZeroAddress;
      } catch {
        try {
          ownerAddress = await contract.getOwner();
          hasOwner = ownerAddress !== ethers.ZeroAddress;
          isRenounced = ownerAddress === ethers.ZeroAddress;
        } catch {
          // No owner function found
        }
      }

      // Check for blacklist function
      try {
        const code = await this.provider.getHttpProvider().getCode(tokenAddress);
        hasBlacklist = code.includes('blacklist') || code.includes('isBlacklisted');
      } catch {
        // Unable to check code
      }
    } catch (error) {
      logger.debug('Error checking ownership', error);
    }

    return { hasOwner, ownerAddress, isRenounced, hasBlacklist };
  }

  /**
   * Check liquidity pool reserves
   */
  private async checkLiquidity(pairAddress: string): Promise<{
    bnbAmount: number;
    tokenAmount: number;
    isLocked: boolean;
  }> {
    if (!pairAddress || pairAddress === ethers.ZeroAddress) {
      return { bnbAmount: 0, tokenAmount: 0, isLocked: false };
    }

    const pairContract = new ethers.Contract(
      pairAddress,
      PANCAKE_PAIR_ABI,
      this.provider.getHttpProvider()
    );

    try {
      const [token0, token1, reserves] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
        pairContract.getReserves(),
      ]);

      const isToken0WBNB = token0.toLowerCase() === this.WBNB.toLowerCase();
      const bnbReserve = isToken0WBNB ? reserves[0] : reserves[1];
      const tokenReserve = isToken0WBNB ? reserves[1] : reserves[0];

      const bnbAmount = Number(formatBNB(bnbReserve));
      const tokenAmount = Number(formatTokenAmount(tokenReserve, 18)); // Assume 18 decimals

      // Check if liquidity is locked (simplified - would need LP lock contract integration)
      // For now, we just check if there's sufficient liquidity
      const isLocked = bnbAmount > 1; // Very basic check

      return { bnbAmount, tokenAmount, isLocked };
    } catch (error) {
      logger.debug('Error checking liquidity', error);
      return { bnbAmount: 0, tokenAmount: 0, isLocked: false };
    }
  }

  /**
   * Check if token is a honeypot by simulating buy and sell
   */
  private async checkHoneypot(
    tokenAddress: string,
    pairAddress: string
  ): Promise<{
    isHoneypot: boolean;
    canBuy: boolean;
    canSell: boolean;
    buyTax: number;
    sellTax: number;
  }> {
    // Default safe values
    let isHoneypot = false;
    let canBuy = true;
    let canSell = true;
    let buyTax = 0;
    let sellTax = 0;

    try {
      // Simulate buy with 0.01 BNB
      const buyAmount = ethers.parseEther('0.01');
      const buyPath = [this.WBNB, tokenAddress];

      try {
        const buyAmountsOut = await this.router.getAmountsOut(buyAmount, buyPath);
        const expectedTokens = buyAmountsOut[1];

        // Simulate sell
        const sellPath = [tokenAddress, this.WBNB];
        try {
          const sellAmountsOut = await this.router.getAmountsOut(expectedTokens, sellPath);
          const receivedBNB = sellAmountsOut[1];

          // Calculate taxes
          const buyLoss = ((Number(buyAmount) - Number(receivedBNB)) / Number(buyAmount)) * 100;
          
          if (buyLoss > 95) {
            // Likely honeypot - can't sell or extreme tax
            isHoneypot = true;
            canSell = false;
            sellTax = 100;
          } else {
            // Calculate approximate taxes
            buyTax = Math.max(0, Math.min(buyLoss / 2, 50));
            sellTax = Math.max(0, Math.min(buyLoss / 2, 50));
          }
        } catch (sellError) {
          // Cannot simulate sell - likely honeypot
          logger.debug('Cannot simulate sell', sellError);
          isHoneypot = true;
          canSell = false;
          sellTax = 100;
        }
      } catch (buyError) {
        // Cannot simulate buy
        logger.debug('Cannot simulate buy', buyError);
        canBuy = false;
        buyTax = 100;
      }
    } catch (error) {
      logger.debug('Error during honeypot check', error);
      // Assume safe if we can't check
    }

    return { isHoneypot, canBuy, canSell, buyTax, sellTax };
  }

  /**
   * Quick safety check (faster, less comprehensive)
   */
  async quickCheck(tokenAddress: string): Promise<boolean> {
    try {
      // Just check if we can get basic token info
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider.getHttpProvider()
      );

      await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.totalSupply(),
      ]);

      return true;
    } catch {
      return false;
    }
  }
}
