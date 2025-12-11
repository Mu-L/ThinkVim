import { ethers } from 'ethers';
import { BlockchainProvider } from '../core/provider';
import { logger } from '../utils/logger';
import { FOUR_MEME_FACTORY_ABI, PANCAKE_FACTORY_ABI, PANCAKE_PAIR_ABI } from '../utils/abis';
import { sleep } from '../utils/helpers';

/**
 * New token information detected from Four.Meme
 */
export interface NewTokenInfo {
  tokenAddress: string;
  pairAddress: string;
  creator: string;
  name?: string;
  symbol?: string;
  totalSupply?: bigint;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
  liquidityToken?: string; // WBNB, USDT, etc.
}

/**
 * Four.Meme factory listener for detecting new token launches
 */
export class FactoryListener {
  private provider: BlockchainProvider;
  private factoryAddress: string;
  private pancakeFactoryAddress: string;
  private factoryContract: ethers.Contract | null = null;
  private pancakeFactoryContract: ethers.Contract | null = null;
  private isListening: boolean = false;
  private listeners: Array<(token: NewTokenInfo) => void> = [];

  constructor(
    provider: BlockchainProvider,
    factoryAddress: string,
    pancakeFactoryAddress: string
  ) {
    this.provider = provider;
    this.factoryAddress = factoryAddress;
    this.pancakeFactoryAddress = pancakeFactoryAddress;
  }

  /**
   * Initialize contracts
   */
  async initialize(): Promise<void> {
    try {
      const wssProvider = this.provider.getWssProvider();
      const httpProvider = this.provider.getHttpProvider();

      // Use WSS for events, HTTP for fallback
      const eventProvider = wssProvider || httpProvider;

      // Initialize Four.Meme factory contract
      this.factoryContract = new ethers.Contract(
        this.factoryAddress,
        FOUR_MEME_FACTORY_ABI,
        eventProvider
      );

      // Initialize PancakeSwap factory for pair detection
      this.pancakeFactoryContract = new ethers.Contract(
        this.pancakeFactoryAddress,
        PANCAKE_FACTORY_ABI,
        eventProvider
      );

      logger.success('Factory listener initialized');
    } catch (error) {
      logger.error('Failed to initialize factory listener', error);
      throw error;
    }
  }

  /**
   * Start listening for new tokens
   */
  async startListening(): Promise<void> {
    if (this.isListening) {
      logger.warning('Factory listener already running');
      return;
    }

    if (!this.factoryContract) {
      throw new Error('Factory contract not initialized');
    }

    logger.info('Starting factory listener...');
    this.isListening = true;

    // Listen to Four.Meme TokenCreated events
    this.factoryContract.on('TokenCreated', async (...args) => {
      try {
        await this.handleTokenCreated(args);
      } catch (error) {
        logger.error('Error handling TokenCreated event', error);
      }
    });

    // Listen to PancakeSwap PairCreated events as fallback
    if (this.pancakeFactoryContract) {
      this.pancakeFactoryContract.on('PairCreated', async (...args) => {
        try {
          await this.handlePairCreated(args);
        } catch (error) {
          logger.error('Error handling PairCreated event', error);
        }
      });
    }

    // Also monitor pending transactions in mempool for early detection
    this.startMempoolMonitoring();

    logger.success('Factory listener started');
  }

  /**
   * Handle TokenCreated event from Four.Meme factory
   */
  private async handleTokenCreated(args: any[]): Promise<void> {
    try {
      // Parse event based on expected ABI structure
      // event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 totalSupply, uint256 timestamp)
      
      const event = args[args.length - 1]; // Last arg is usually the event object
      const tokenAddress = args[0];
      const creator = args[1];
      const name = args[2];
      const symbol = args[3];
      const totalSupply = args[4];

      logger.info(`🆕 New token detected: ${symbol} (${tokenAddress})`);

      // Find the pair address
      const pairAddress = await this.findPairAddress(tokenAddress);

      const tokenInfo: NewTokenInfo = {
        tokenAddress,
        pairAddress: pairAddress || ethers.ZeroAddress,
        creator,
        name,
        symbol,
        totalSupply,
        timestamp: Math.floor(Date.now() / 1000),
        blockNumber: event.blockNumber || 0,
        transactionHash: event.transactionHash || '',
      };

      // Notify all listeners
      this.notifyListeners(tokenInfo);
    } catch (error) {
      logger.error('Failed to handle TokenCreated event', error);
    }
  }

  /**
   * Handle PairCreated event from PancakeSwap (fallback detection)
   */
  private async handlePairCreated(args: any[]): Promise<void> {
    try {
      // event PairCreated(address indexed token0, address indexed token1, address pair, uint)
      const token0 = args[0];
      const token1 = args[1];
      const pairAddress = args[2];
      const event = args[args.length - 1];

      // Determine which is the new token (not WBNB/USDT/BUSD)
      const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      let tokenAddress = token0.toLowerCase() === WBNB.toLowerCase() ? token1 : token0;
      let liquidityToken = token0.toLowerCase() === WBNB.toLowerCase() ? token0 : token1;

      logger.info(`🔔 New pair detected: ${pairAddress}`);

      // Try to get token info
      const tokenInfo = await this.getTokenInfo(tokenAddress, pairAddress, event);
      tokenInfo.liquidityToken = liquidityToken;

      // Notify listeners
      this.notifyListeners(tokenInfo);
    } catch (error) {
      logger.error('Failed to handle PairCreated event', error);
    }
  }

  /**
   * Monitor mempool for pending token creation transactions
   */
  private startMempoolMonitoring(): void {
    const wssProvider = this.provider.getWssProvider();
    if (!wssProvider) {
      logger.warning('WSS not available, skipping mempool monitoring');
      return;
    }

    logger.info('Starting mempool monitoring...');

    // Listen to pending transactions
    wssProvider.on('pending', async (txHash) => {
      try {
        await this.checkPendingTransaction(txHash);
      } catch (error) {
        // Silently ignore mempool errors (high volume)
      }
    });
  }

  /**
   * Check if pending transaction is a token creation
   */
  private async checkPendingTransaction(txHash: string): Promise<void> {
    try {
      const provider = this.provider.getHttpProvider();
      const tx = await provider.getTransaction(txHash);

      if (!tx || !tx.to) return;

      // Check if transaction is to Four.Meme factory
      if (tx.to.toLowerCase() === this.factoryAddress.toLowerCase()) {
        logger.debug(`Detected pending token creation: ${txHash}`);
        // Could pre-process here, but events will catch it
      }
    } catch (error) {
      // Ignore - mempool transactions can disappear quickly
    }
  }

  /**
   * Find pair address for a token
   */
  private async findPairAddress(tokenAddress: string): Promise<string | null> {
    try {
      if (!this.pancakeFactoryContract) return null;

      const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      const pairAddress = await this.pancakeFactoryContract.getPair(tokenAddress, WBNB);

      if (pairAddress === ethers.ZeroAddress) {
        return null;
      }

      return pairAddress;
    } catch (error) {
      logger.error('Failed to find pair address', error);
      return null;
    }
  }

  /**
   * Get detailed token information
   */
  private async getTokenInfo(
    tokenAddress: string,
    pairAddress: string,
    event: any
  ): Promise<NewTokenInfo> {
    const provider = this.provider.getHttpProvider();

    // Try to get token details
    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function totalSupply() view returns (uint256)',
      ],
      provider
    );

    let name: string | undefined;
    let symbol: string | undefined;
    let totalSupply: bigint | undefined;

    try {
      [name, symbol, totalSupply] = await Promise.all([
        tokenContract.name().catch(() => undefined),
        tokenContract.symbol().catch(() => undefined),
        tokenContract.totalSupply().catch(() => undefined),
      ]);
    } catch (error) {
      // Some tokens may not have these functions
    }

    // Try to get creator from transaction
    let creator = ethers.ZeroAddress;
    try {
      if (event.transactionHash) {
        const tx = await provider.getTransaction(event.transactionHash);
        creator = tx?.from || ethers.ZeroAddress;
      }
    } catch (error) {
      // Ignore
    }

    return {
      tokenAddress,
      pairAddress,
      creator,
      name,
      symbol,
      totalSupply,
      timestamp: Math.floor(Date.now() / 1000),
      blockNumber: event.blockNumber || 0,
      transactionHash: event.transactionHash || '',
    };
  }

  /**
   * Register a callback for new tokens
   */
  onNewToken(callback: (token: NewTokenInfo) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Notify all listeners of new token
   */
  private notifyListeners(token: NewTokenInfo): void {
    for (const listener of this.listeners) {
      try {
        listener(token);
      } catch (error) {
        logger.error('Error in token listener callback', error);
      }
    }
  }

  /**
   * Stop listening
   */
  stopListening(): void {
    if (!this.isListening) return;

    logger.info('Stopping factory listener...');

    if (this.factoryContract) {
      this.factoryContract.removeAllListeners();
    }

    if (this.pancakeFactoryContract) {
      this.pancakeFactoryContract.removeAllListeners();
    }

    const wssProvider = this.provider.getWssProvider();
    if (wssProvider) {
      wssProvider.removeAllListeners('pending');
    }

    this.isListening = false;
    logger.info('Factory listener stopped');
  }

  /**
   * Get listening status
   */
  isActive(): boolean {
    return this.isListening;
  }
}
