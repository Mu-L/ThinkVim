import WebSocket from 'ws';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { Orderbook, OrderbookLevel } from './polymarket';
import { Decimal } from 'decimal.js';

interface Subscription {
  marketId: string;
  tokenId: string;
}

interface WSMessage {
  type: string;
  data: any;
}

export class PolymarketWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private subscriptions = new Map<string, Subscription>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(private apiClient: EventEmitter) {
    super();

    // Listen for subscription requests from API client
    apiClient.on('subscribe', (sub: Subscription) => this.subscribe(sub.marketId, sub.tokenId));
    apiClient.on('unsubscribe', (sub: Subscription) => this.unsubscribe(sub.marketId, sub.tokenId));
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket('wss://ws.polymarket.com');

      this.ws.on('open', () => {
        logger.info('WebSocket connected to Polymarket');
        this.reconnectAttempts = 0;
        this.startPingInterval();

        // Resubscribe to all existing subscriptions
        for (const sub of this.subscriptions.values()) {
          this.sendSubscriptionMessage(sub.marketId, sub.tokenId, true);
        }
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });

      this.ws.on('close', () => {
        logger.warn('WebSocket connection closed');
        this.stopPingInterval();
        this.handleReconnect();
      });

    } catch (error) {
      logger.error('Failed to connect WebSocket:', error);
      this.handleReconnect();
    }
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private sendSubscriptionMessage(marketId: string, tokenId: string, subscribe: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: subscribe ? 'subscribe' : 'unsubscribe',
      channel: 'orderbook',
      market: marketId,
      asset: tokenId,
    };

    this.ws.send(JSON.stringify(message));
  }

  subscribe(marketId: string, tokenId: string): void {
    const key = `${marketId}:${tokenId}`;

    if (this.subscriptions.has(key)) {
      return; // Already subscribed
    }

    this.subscriptions.set(key, { marketId, tokenId });
    this.sendSubscriptionMessage(marketId, tokenId, true);

    logger.info(`Subscribed to orderbook: ${marketId}/${tokenId}`);
  }

  unsubscribe(marketId: string, tokenId: string): void {
    const key = `${marketId}:${tokenId}`;

    if (!this.subscriptions.has(key)) {
      return; // Not subscribed
    }

    this.subscriptions.delete(key);
    this.sendSubscriptionMessage(marketId, tokenId, false);

    logger.info(`Unsubscribed from orderbook: ${marketId}/${tokenId}`);
  }

  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'orderbook':
        this.handleOrderbookUpdate(message.data);
        break;
      case 'error':
        logger.error('WebSocket error message:', message.data);
        break;
      default:
        logger.debug('Unknown message type:', message.type);
    }
  }

  private handleOrderbookUpdate(data: any): void {
    try {
      const orderbook: Orderbook = {
        market: data.market,
        asset_id: data.asset_id,
        bids: data.bids?.map((bid: any) => ({
          price: new Decimal(bid.price || '0'),
          size: new Decimal(bid.size || '0'),
        })) || [],
        asks: data.asks?.map((ask: any) => ({
          price: new Decimal(ask.price || '0'),
          size: new Decimal(ask.size || '0'),
        })) || [],
        timestamp: data.timestamp || Date.now(),
      };

      // Emit the orderbook update
      this.emit('orderbook', orderbook);

    } catch (error) {
      logger.error('Failed to process orderbook update:', error);
    }
  }

  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }
}

export default PolymarketWebSocket;
