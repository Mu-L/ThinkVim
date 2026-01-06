import { EventEmitter } from 'events';
import { Decimal } from 'decimal.js';
import { TradeSignal } from '../strategy/baseStrategy';
import PolymarketAPI, { Order } from '../api/polymarket';
import RiskManager from './riskManager';
import config from '../config/env';
import logger from '../utils/logger';

export interface ManagedOrder {
  id: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: Decimal;
  price: Decimal;
  type: 'LIMIT' | 'MARKET';
  status: 'PENDING' | 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  filledSize: Decimal;
  remainingSize: Decimal;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  slippageProtection: boolean;
  maxSlippage: Decimal;
}

export interface OrderResult {
  success: boolean;
  order?: ManagedOrder;
  error?: string;
  warnings?: string[];
}

export class OrderManager extends EventEmitter {
  private api: PolymarketAPI;
  private riskManager: RiskManager;
  private orders = new Map<string, ManagedOrder>();
  private orderTimeouts = new Map<string, NodeJS.Timeout>();
  private fillCheckInterval: NodeJS.Timeout | null = null;

  constructor(api: PolymarketAPI, riskManager: RiskManager) {
    super();
    this.api = api;
    this.riskManager = riskManager;

    // Start periodic fill checking
    this.startFillChecking();
  }

  /**
   * Execute a trade signal by placing an order
   */
  async executeSignal(signal: TradeSignal): Promise<OrderResult> {
    try {
      // Risk check
      const riskCheck = this.riskManager.checkTradeSignal(signal);
      if (!riskCheck.approved) {
        return {
          success: false,
          error: riskCheck.reason,
          warnings: riskCheck.warnings,
        };
      }

      // Adjust size if needed
      const finalSize = riskCheck.adjustedSize || signal.size;

      // In paper trading mode, simulate the order
      if (config.enablePaperTrading) {
        return this.simulateOrder(signal, finalSize);
      }

      // Place real order
      const order = await this.api.placeOrder(
        signal.marketId,
        signal.tokenId,
        signal.side,
        finalSize,
        signal.price
      );

      // Create managed order
      const managedOrder = this.createManagedOrder(order, signal);
      this.orders.set(order.id, managedOrder);

      // Set expiration timer
      this.setOrderTimeout(managedOrder);

      logger.info(`Placed order: ${order.id} for ${signal.marketId}:${signal.tokenId} ${signal.side} ${finalSize.toFixed(2)} @ ${signal.price.toFixed(4)}`);

      return {
        success: true,
        order: managedOrder,
        warnings: riskCheck.warnings,
      };

    } catch (error) {
      logger.error('Failed to execute trade signal:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) {
      logger.warn(`Attempted to cancel unknown order: ${orderId}`);
      return false;
    }

    if (order.status !== 'OPEN' && order.status !== 'PARTIAL') {
      logger.warn(`Cannot cancel order ${orderId} with status: ${order.status}`);
      return false;
    }

    try {
      if (!config.enablePaperTrading) {
        const success = await this.api.cancelOrder(orderId);
        if (!success) {
          logger.warn(`API failed to cancel order: ${orderId}`);
          return false;
        }
      }

      order.status = 'CANCELLED';
      order.updatedAt = Date.now();

      // Clear timeout
      const timeout = this.orderTimeouts.get(orderId);
      if (timeout) {
        clearTimeout(timeout);
        this.orderTimeouts.delete(orderId);
      }

      logger.info(`Cancelled order: ${orderId}`);
      this.emit('orderCancelled', order);

      return true;
    } catch (error) {
      logger.error(`Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<number> {
    const openOrders = Array.from(this.orders.values())
      .filter(order => order.status === 'OPEN' || order.status === 'PARTIAL');

    let cancelledCount = 0;
    for (const order of openOrders) {
      if (await this.cancelOrder(order.id)) {
        cancelledCount++;
      }
    }

    logger.info(`Cancelled ${cancelledCount} out of ${openOrders.length} open orders`);
    return cancelledCount;
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): ManagedOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Get all orders
   */
  getAllOrders(): ManagedOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get open orders
   */
  getOpenOrders(): ManagedOrder[] {
    return Array.from(this.orders.values())
      .filter(order => order.status === 'OPEN' || order.status === 'PARTIAL');
  }

  /**
   * Handle partial fill
   */
  handlePartialFill(orderId: string, filledSize: Decimal, fillPrice: Decimal): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    order.filledSize = order.filledSize.plus(filledSize);
    order.remainingSize = order.size.minus(order.filledSize);
    order.updatedAt = Date.now();

    if (order.remainingSize.lessThanOrEqualTo(0)) {
      order.status = 'FILLED';
      this.clearOrderTimeout(orderId);
    } else {
      order.status = 'PARTIAL';
    }

    // Record fill with risk manager
    this.riskManager.recordPosition(order.marketId, order.tokenId, filledSize, fillPrice);

    logger.info(`Partial fill: ${orderId}, filled ${filledSize.toFixed(2)} @ ${fillPrice.toFixed(4)}, remaining ${order.remainingSize.toFixed(2)}`);

    this.emit('orderFill', {
      order,
      filledSize,
      fillPrice,
      remainingSize: order.remainingSize,
    });
  }

  /**
   * Handle complete fill
   */
  handleCompleteFill(orderId: string, fillPrice: Decimal): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    const filledSize = order.remainingSize;
    order.filledSize = order.size;
    order.remainingSize = new Decimal(0);
    order.status = 'FILLED';
    order.updatedAt = Date.now();

    this.clearOrderTimeout(orderId);

    // Record fill with risk manager
    this.riskManager.recordPosition(order.marketId, order.tokenId, filledSize, fillPrice);

    logger.info(`Complete fill: ${orderId}, filled ${filledSize.toFixed(2)} @ ${fillPrice.toFixed(4)}`);

    this.emit('orderFill', {
      order,
      filledSize,
      fillPrice,
      remainingSize: new Decimal(0),
    });
  }

  /**
   * Simulate order execution for paper trading
   */
  private simulateOrder(signal: TradeSignal, size: Decimal): OrderResult {
    const orderId = `paper_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const managedOrder: ManagedOrder = {
      id: orderId,
      marketId: signal.marketId,
      tokenId: signal.tokenId,
      side: signal.side,
      size,
      price: signal.price,
      type: 'LIMIT',
      status: 'OPEN',
      filledSize: new Decimal(0),
      remainingSize: size,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + config.orderTimeoutSeconds * 1000,
      slippageProtection: true,
      maxSlippage: new Decimal(0.01), // 1% max slippage
    };

    this.orders.set(orderId, managedOrder);
    this.setOrderTimeout(managedOrder);

    logger.info(`Simulated order: ${orderId} for ${signal.marketId}:${signal.tokenId} ${signal.side} ${size.toFixed(2)} @ ${signal.price.toFixed(4)}`);

    return {
      success: true,
      order: managedOrder,
    };
  }

  /**
   * Create managed order from API order
   */
  private createManagedOrder(apiOrder: Order, signal: TradeSignal): ManagedOrder {
    return {
      id: apiOrder.id,
      marketId: apiOrder.market,
      tokenId: signal.tokenId, // API might not return this
      side: apiOrder.side,
      size: new Decimal(apiOrder.size),
      price: new Decimal(apiOrder.price),
      type: apiOrder.type,
      status: 'OPEN',
      filledSize: new Decimal(0),
      remainingSize: new Decimal(apiOrder.size),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + config.orderTimeoutSeconds * 1000,
      slippageProtection: true,
      maxSlippage: new Decimal(0.01), // 1% max slippage
    };
  }

  /**
   * Set order expiration timeout
   */
  private setOrderTimeout(order: ManagedOrder): void {
    if (order.expiresAt) {
      const timeoutMs = order.expiresAt - Date.now();
      if (timeoutMs > 0) {
        const timeout = setTimeout(() => {
          this.expireOrder(order.id);
        }, timeoutMs);

        this.orderTimeouts.set(order.id, timeout);
      }
    }
  }

  /**
   * Clear order timeout
   */
  private clearOrderTimeout(orderId: string): void {
    const timeout = this.orderTimeouts.get(orderId);
    if (timeout) {
      clearTimeout(timeout);
      this.orderTimeouts.delete(orderId);
    }
  }

  /**
   * Expire an order
   */
  private async expireOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || (order.status !== 'OPEN' && order.status !== 'PARTIAL')) {
      return;
    }

    order.status = 'EXPIRED';
    order.updatedAt = Date.now();

    logger.info(`Order expired: ${orderId}`);

    // Try to cancel if still open
    if (!config.enablePaperTrading) {
      await this.cancelOrder(orderId);
    }

    this.emit('orderExpired', order);
  }

  /**
   * Start periodic fill checking
   */
  private startFillChecking(): void {
    this.fillCheckInterval = setInterval(async () => {
      await this.checkOrderFills();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Check for order fills
   */
  private async checkOrderFills(): Promise<void> {
    if (config.enablePaperTrading) {
      // In paper trading, simulate fills
      this.simulateFills();
      return;
    }

    try {
      const apiOrders = await this.api.getOrders('OPEN');
      const openOrderIds = new Set(apiOrders.map(o => o.id));

      // Check our managed orders
      for (const [orderId, order] of this.orders.entries()) {
        if ((order.status === 'OPEN' || order.status === 'PARTIAL') && !openOrderIds.has(orderId)) {
          // Order might be filled or cancelled
          const updatedOrder = apiOrders.find(o => o.id === orderId);
          if (updatedOrder) {
            // Update status based on API
            order.status = updatedOrder.status as any;
            order.updatedAt = Date.now();
          }
        }
      }
    } catch (error) {
      logger.error('Failed to check order fills:', error);
    }
  }

  /**
   * Simulate fills for paper trading
   */
  private simulateFills(): void {
    const openOrders = Array.from(this.orders.values())
      .filter(order => order.status === 'OPEN' || order.status === 'PARTIAL');

    for (const order of openOrders) {
      // Random fill simulation (10% chance every check)
      if (Math.random() < 0.1) {
        const fillSize = order.remainingSize.mul(Math.random() * 0.5 + 0.1); // Fill 10-60% of remaining
        const fillPrice = order.price.mul(1 + (Math.random() - 0.5) * 0.002); // Small price variation

        if (fillSize.greaterThanOrEqualTo(order.remainingSize)) {
          this.handleCompleteFill(order.id, fillPrice);
        } else {
          this.handlePartialFill(order.id, fillSize, fillPrice);
        }
      }
    }
  }

  /**
   * Get order statistics
   */
  getOrderStats(): {
    total: number;
    open: number;
    filled: number;
    cancelled: number;
    expired: number;
  } {
    const orders = Array.from(this.orders.values());
    return {
      total: orders.length,
      open: orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIAL').length,
      filled: orders.filter(o => o.status === 'FILLED').length,
      cancelled: orders.filter(o => o.status === 'CANCELLED').length,
      expired: orders.filter(o => o.status === 'EXPIRED').length,
    };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.fillCheckInterval) {
      clearInterval(this.fillCheckInterval);
      this.fillCheckInterval = null;
    }

    // Clear all timeouts
    for (const timeout of this.orderTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.orderTimeouts.clear();

    this.removeAllListeners();
  }
}

export default OrderManager;
