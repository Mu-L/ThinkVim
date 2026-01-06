import axios, { AxiosInstance } from 'axios';
import { Decimal } from 'decimal.js';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import config from '../config/env';

// Types for Polymarket API responses
export interface Market {
  id: string;
  question: string;
  description: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  volume: string;
  volume24hr: string;
  liquidity: string;
  createdAt: string;
  updatedAt: string;
  marketMakerAddress: string;
  tokens: Token[];
}

export interface Token {
  tokenId: string;
  outcome: string;
  price: string;
  winner: boolean;
}

export interface Orderbook {
  market: string;
  asset_id: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
}

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface Order {
  id: string;
  market: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  type: 'LIMIT' | 'MARKET';
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  createdAt: string;
}

export interface Position {
  market: string;
  outcome: string;
  size: string;
  avgPrice: string;
  unrealizedPnl: string;
}

export class PolymarketAPI extends EventEmitter {
  private client: AxiosInstance;
  private baseURL = 'https://api.polymarket.com';
  private wsBaseURL = 'wss://ws.polymarket.com';

  constructor() {
    super();

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.polymarketApiKey,
        'X-API-Secret': config.polymarketApiSecret,
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Polymarket API Error:', {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
        });
        throw error;
      }
    );
  }

  /**
   * Get active markets with optional filters
   */
  async getActiveMarkets(limit: number = 100, offset: number = 0): Promise<Market[]> {
    try {
      const response = await this.client.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit,
          offset,
        },
      });

      return response.data.map((market: any) => ({
        ...market,
        volume: new Decimal(market.volume || '0'),
        volume24hr: new Decimal(market.volume24hr || '0'),
        liquidity: new Decimal(market.liquidity || '0'),
        tokens: market.tokens?.map((token: any) => ({
          ...token,
          price: new Decimal(token.price || '0'),
        })) || [],
      }));
    } catch (error) {
      logger.error('Failed to fetch active markets:', error);
      throw error;
    }
  }

  /**
   * Get specific market by ID
   */
  async getMarket(marketId: string): Promise<Market | null> {
    try {
      const response = await this.client.get(`/markets/${marketId}`);

      const market = response.data;
      return {
        ...market,
        volume: new Decimal(market.volume || '0'),
        volume24hr: new Decimal(market.volume24hr || '0'),
        liquidity: new Decimal(market.liquidity || '0'),
        tokens: market.tokens?.map((token: any) => ({
          ...token,
          price: new Decimal(token.price || '0'),
        })) || [],
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      logger.error(`Failed to fetch market ${marketId}:`, error);
      throw error;
    }
  }

  /**
   * Get orderbook for a market
   */
  async getOrderbook(marketId: string, tokenId: string): Promise<Orderbook | null> {
    try {
      const response = await this.client.get(`/markets/${marketId}/orderbook/${tokenId}`);

      const data = response.data;
      return {
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
    } catch (error) {
      logger.error(`Failed to fetch orderbook for market ${marketId}, token ${tokenId}:`, error);
      throw error;
    }
  }

  /**
   * Place a limit order
   */
  async placeOrder(
    marketId: string,
    tokenId: string,
    side: 'BUY' | 'SELL',
    size: Decimal,
    price: Decimal
  ): Promise<Order> {
    try {
      const payload = {
        market: marketId,
        asset_id: tokenId,
        side,
        size: size.toString(),
        price: price.toString(),
        type: 'LIMIT',
      };

      const response = await this.client.post('/orders', payload);
      return response.data;
    } catch (error) {
      logger.error('Failed to place order:', error);
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.delete(`/orders/${orderId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Get user positions
   */
  async getPositions(): Promise<Position[]> {
    try {
      const response = await this.client.get('/positions');

      return response.data.map((position: any) => ({
        ...position,
        size: new Decimal(position.size || '0'),
        avgPrice: new Decimal(position.avgPrice || '0'),
        unrealizedPnl: new Decimal(position.unrealizedPnl || '0'),
      }));
    } catch (error) {
      logger.error('Failed to fetch positions:', error);
      throw error;
    }
  }

  /**
   * Get user orders
   */
  async getOrders(status?: 'OPEN' | 'FILLED' | 'CANCELLED'): Promise<Order[]> {
    try {
      const params: any = {};
      if (status) params.status = status;

      const response = await this.client.get('/orders', { params });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch orders:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time orderbook updates
   * This will emit 'orderbook' events with updated data
   */
  subscribeToOrderbook(marketId: string, tokenId: string): void {
    // Implementation will be in websocket.ts
    this.emit('subscribe', { marketId, tokenId });
  }

  /**
   * Unsubscribe from orderbook updates
   */
  unsubscribeFromOrderbook(marketId: string, tokenId: string): void {
    this.emit('unsubscribe', { marketId, tokenId });
  }
}

export default PolymarketAPI;
