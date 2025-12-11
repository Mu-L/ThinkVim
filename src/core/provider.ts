import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { sleep } from '../utils/helpers';

/**
 * Enhanced blockchain provider with WebSocket support and auto-reconnect
 */
export class BlockchainProvider {
  private wssProvider: ethers.WebSocketProvider | null = null;
  private httpProvider: ethers.JsonRpcProvider;
  private wssUrl: string;
  private httpUrl: string;
  private reconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;
  private isConnected: boolean = false;

  constructor(wssUrl: string, httpUrl: string) {
    this.wssUrl = wssUrl;
    this.httpUrl = httpUrl;
    
    // Initialize HTTP provider (always available as fallback)
    this.httpProvider = new ethers.JsonRpcProvider(httpUrl);
    logger.info('HTTP provider initialized');
  }

  /**
   * Connect to WebSocket provider
   */
  async connect(): Promise<void> {
    try {
      logger.info('Connecting to BSC WebSocket...');
      
      this.wssProvider = new ethers.WebSocketProvider(this.wssUrl);
      
      // Setup connection listeners
      this.setupListeners();
      
      // Wait for connection to be established
      await this.wssProvider.getNetwork();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.success('WebSocket connection established');
      
    } catch (error) {
      logger.error('Failed to connect to WebSocket', error);
      await this.handleReconnect();
    }
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupListeners(): void {
    if (!this.wssProvider) return;

    this.wssProvider.on('error', (error) => {
      logger.error('WebSocket error', error);
      this.isConnected = false;
    });

    this.wssProvider.on('close', () => {
      logger.warning('WebSocket connection closed');
      this.isConnected = false;
      this.handleReconnect();
    });

    // Heartbeat to detect stale connections
    this.startHeartbeat();
  }

  /**
   * Heartbeat to detect connection issues
   */
  private startHeartbeat(): void {
    setInterval(async () => {
      if (!this.wssProvider || !this.isConnected) return;
      
      try {
        await this.wssProvider.getBlockNumber();
      } catch (error) {
        logger.warning('Heartbeat failed, connection may be stale');
        this.isConnected = false;
        await this.handleReconnect();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Handle reconnection logic
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnecting) return;
    
    this.reconnecting = true;
    
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      try {
        // Destroy old connection
        if (this.wssProvider) {
          await this.wssProvider.destroy();
        }
        
        // Wait before reconnecting
        await sleep(this.reconnectDelay);
        
        // Create new connection
        await this.connect();
        
        this.reconnecting = false;
        return;
        
      } catch (error) {
        logger.error(`Reconnection attempt ${this.reconnectAttempts} failed`, error);
      }
    }
    
    logger.error('Max reconnection attempts reached. Falling back to HTTP provider only.');
    this.reconnecting = false;
  }

  /**
   * Get WebSocket provider (prefer this for real-time events)
   */
  getWssProvider(): ethers.WebSocketProvider | null {
    return this.wssProvider;
  }

  /**
   * Get HTTP provider (use for queries and transactions)
   */
  getHttpProvider(): ethers.JsonRpcProvider {
    return this.httpProvider;
  }

  /**
   * Get best available provider
   */
  getProvider(): ethers.Provider {
    return this.wssProvider && this.isConnected ? this.wssProvider : this.httpProvider;
  }

  /**
   * Check if WebSocket is connected
   */
  isWssConnected(): boolean {
    return this.isConnected && this.wssProvider !== null;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    try {
      return await this.getProvider().getBlockNumber();
    } catch (error) {
      logger.error('Failed to get block number', error);
      throw error;
    }
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.getProvider().getFeeData();
      return feeData.gasPrice || BigInt(0);
    } catch (error) {
      logger.error('Failed to get gas price', error);
      throw error;
    }
  }

  /**
   * Get network chain ID
   */
  async getChainId(): Promise<bigint> {
    try {
      const network = await this.getProvider().getNetwork();
      return network.chainId;
    } catch (error) {
      logger.error('Failed to get chain ID', error);
      throw error;
    }
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(transaction: ethers.TransactionRequest): Promise<bigint> {
    try {
      return await this.getProvider().estimateGas(transaction);
    } catch (error) {
      logger.error('Failed to estimate gas', error);
      throw error;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    try {
      return await this.getProvider().getTransactionReceipt(txHash);
    } catch (error) {
      logger.error('Failed to get transaction receipt', error);
      return null;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(txHash: string, confirmations: number = 1): Promise<ethers.TransactionReceipt | null> {
    try {
      logger.info(`Waiting for transaction ${txHash} (${confirmations} confirmations)`);
      return await this.getProvider().waitForTransaction(txHash, confirmations);
    } catch (error) {
      logger.error('Failed to wait for transaction', error);
      return null;
    }
  }

  /**
   * Graceful shutdown
   */
  async disconnect(): Promise<void> {
    logger.info('Disconnecting providers...');
    
    if (this.wssProvider) {
      await this.wssProvider.destroy();
    }
    
    this.isConnected = false;
    logger.info('Providers disconnected');
  }
}
