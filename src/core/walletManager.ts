import { ethers } from 'ethers';
import { BlockchainProvider } from './provider';
import { logger } from '../utils/logger';

/**
 * Wallet manager for multi-wallet support
 */
export interface WalletInfo {
  address: string;
  wallet: ethers.Wallet;
  nonce: number;
  pendingTxCount: number;
  lastUsed: number;
}

export class WalletManager {
  private wallets: Map<string, WalletInfo> = new Map();
  private provider: BlockchainProvider;
  private currentWalletIndex: number = 0;
  private maxPendingTx: number;

  constructor(provider: BlockchainProvider, privateKeys: string[], maxPendingTx: number = 3) {
    this.provider = provider;
    this.maxPendingTx = maxPendingTx;
    this.initializeWallets(privateKeys);
  }

  /**
   * Initialize wallets from private keys
   */
  private initializeWallets(privateKeys: string[]): void {
    logger.info(`Initializing ${privateKeys.length} wallet(s)...`);

    for (const pk of privateKeys) {
      try {
        const wallet = new ethers.Wallet(pk.trim(), this.provider.getHttpProvider());
        
        const info: WalletInfo = {
          address: wallet.address,
          wallet: wallet,
          nonce: 0,
          pendingTxCount: 0,
          lastUsed: 0
        };

        this.wallets.set(wallet.address, info);
        logger.success(`Wallet initialized: ${wallet.address}`);
      } catch (error) {
        logger.error('Failed to initialize wallet', error);
      }
    }

    if (this.wallets.size === 0) {
      throw new Error('No valid wallets initialized');
    }
  }

  /**
   * Sync nonces for all wallets
   */
  async syncNonces(): Promise<void> {
    logger.info('Syncing wallet nonces...');

    for (const [address, info] of this.wallets) {
      try {
        const nonce = await this.provider.getHttpProvider().getTransactionCount(address, 'latest');
        info.nonce = nonce;
        logger.debug(`Nonce for ${address}: ${nonce}`);
      } catch (error) {
        logger.error(`Failed to sync nonce for ${address}`, error);
      }
    }
  }

  /**
   * Get next available wallet (round-robin or least pending)
   */
  getNextWallet(): WalletInfo {
    const walletsArray = Array.from(this.wallets.values());

    // Find wallet with least pending transactions
    const availableWallets = walletsArray.filter(w => w.pendingTxCount < this.maxPendingTx);

    if (availableWallets.length === 0) {
      logger.warning('All wallets at max pending tx, using round-robin');
      const wallet = walletsArray[this.currentWalletIndex % walletsArray.length];
      this.currentWalletIndex++;
      return wallet;
    }

    // Sort by pending count, then by last used time
    availableWallets.sort((a, b) => {
      if (a.pendingTxCount !== b.pendingTxCount) {
        return a.pendingTxCount - b.pendingTxCount;
      }
      return a.lastUsed - b.lastUsed;
    });

    const selectedWallet = availableWallets[0];
    selectedWallet.lastUsed = Date.now();
    
    return selectedWallet;
  }

  /**
   * Get wallet by address
   */
  getWallet(address: string): WalletInfo | undefined {
    return this.wallets.get(address);
  }

  /**
   * Get all wallets
   */
  getAllWallets(): WalletInfo[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Get and increment nonce for wallet
   */
  getAndIncrementNonce(address: string): number {
    const wallet = this.wallets.get(address);
    if (!wallet) {
      throw new Error(`Wallet not found: ${address}`);
    }

    const nonce = wallet.nonce;
    wallet.nonce++;
    wallet.pendingTxCount++;

    return nonce;
  }

  /**
   * Mark transaction as confirmed (decrement pending count)
   */
  confirmTransaction(address: string): void {
    const wallet = this.wallets.get(address);
    if (wallet && wallet.pendingTxCount > 0) {
      wallet.pendingTxCount--;
    }
  }

  /**
   * Reset nonce for wallet (use after failed tx)
   */
  async resetNonce(address: string): Promise<void> {
    const wallet = this.wallets.get(address);
    if (!wallet) return;

    try {
      const nonce = await this.provider.getHttpProvider().getTransactionCount(address, 'latest');
      wallet.nonce = nonce;
      wallet.pendingTxCount = 0;
      logger.info(`Reset nonce for ${address} to ${nonce}`);
    } catch (error) {
      logger.error(`Failed to reset nonce for ${address}`, error);
    }
  }

  /**
   * Get wallet balances
   */
  async getBalances(): Promise<Map<string, bigint>> {
    const balances = new Map<string, bigint>();

    for (const [address, info] of this.wallets) {
      try {
        const balance = await this.provider.getHttpProvider().getBalance(address);
        balances.set(address, balance);
      } catch (error) {
        logger.error(`Failed to get balance for ${address}`, error);
        balances.set(address, BigInt(0));
      }
    }

    return balances;
  }

  /**
   * Check if wallets have sufficient balance
   */
  async checkBalances(minBalance: bigint): Promise<boolean> {
    const balances = await this.getBalances();
    let allSufficient = true;

    for (const [address, balance] of balances) {
      const sufficient = balance >= minBalance;
      logger.info(
        `Wallet ${address}: ${ethers.formatEther(balance)} BNB ${sufficient ? '✓' : '✗'}`
      );
      if (!sufficient) allSufficient = false;
    }

    return allSufficient;
  }
}
