# Polymarket Trading Bot

A production-ready automated trading bot for Polymarket prediction markets, built with TypeScript and featuring modular architecture, real-time orderbook analysis, and multiple trading strategies.

## 🚀 Features

- **Market Discovery**: Automatically scans and filters active Polymarket prediction markets
- **Real-time Orderbook**: WebSocket-based orderbook subscriptions with live analysis
- **Trading Strategies**:
  - Spread Arbitrage: Exploit price inefficiencies between YES/NO tokens
  - Momentum Trading: Capitalize on price momentum and volume spikes
- **Risk Management**: Comprehensive risk controls with position limits, loss protection, and circuit breakers
- **Order Management**: Smart order execution with slippage protection and automatic cancellation
- **Position Tracking**: Real-time P&L monitoring and portfolio management
- **Paper Trading**: Safe testing mode with simulated trades

## 🏗️ Architecture

```
polymarket-bot/
├── src/
│   ├── config/          # Environment configuration
│   ├── api/            # Polymarket API clients (REST + WebSocket)
│   ├── market/         # Market scanning and orderbook engine
│   ├── strategy/       # Trading strategies (base + implementations)
│   ├── trader/         # Order, position, and risk management
│   └── utils/          # Mathematical utilities and logging
├── .env.example        # Environment variables template
├── package.json        # Dependencies and scripts
└── README.md          # This file
```

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- Polymarket API credentials
- Private key for wallet access

## 🔧 Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd polymarket-bot
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Polymarket API Configuration
POLYMARKET_API_KEY=your_polymarket_api_key_here
POLYMARKET_API_SECRET=your_polymarket_api_secret_here

# Wallet Configuration
PRIVATE_KEY=your_private_key_here

# Risk Management
MAX_POSITION_USD=100
MAX_DAILY_LOSS_USD=50
MIN_SPREAD=0.03

# Trading Configuration
ENABLE_PAPER_TRADING=true
MAX_ORDERS_PER_MARKET=5
ORDER_TIMEOUT_SECONDS=300

# Market Filters
MIN_VOLUME_USD=1000
MIN_LIQUIDITY_USD=500
MAX_TIME_TO_RESOLUTION_HOURS=168

# Strategy Configuration
SPREAD_ARB_ENABLED=true
MOMENTUM_ENABLED=true
TRAILING_STOP_PERCENT=0.05
```

### Risk Management Settings

- **MAX_POSITION_USD**: Maximum position size per market
- **MAX_DAILY_LOSS_USD**: Daily loss limit before circuit breaker
- **MIN_SPREAD**: Minimum spread threshold for arbitrage
- **ENABLE_PAPER_TRADING**: Set to `true` for safe testing

## 🚀 Usage

### Starting the Bot

```bash
# Development mode (with TypeScript compilation)
npm run dev

# Production mode
npm run build
npm start
```

### Stopping the Bot

Press `Ctrl+C` for graceful shutdown. The bot will:
- Cancel all open orders
- Close positions (if emergency stop)
- Save final state
- Disconnect from WebSocket

## 📊 Trading Strategies

### Spread Arbitrage Strategy

**How it works:**
- Monitors YES and NO token prices
- Identifies when `bestAsk_YES < (1 - bestBid_NO) - fee`
- Buys YES token and simultaneously sells NO token (or waits for convergence)
- Exits when spread collapses

**Parameters:**
- Minimum spread threshold
- Maximum position size
- Fee calculation
- Exit conditions

### Momentum Strategy

**How it works:**
- Tracks price movement over time
- Detects breakouts above recent highs/lows
- Monitors volume spikes as confirmation
- Uses trailing stops for exit

**Parameters:**
- Lookback period for momentum calculation
- Momentum threshold
- Volume spike multiplier
- Trailing stop percentage

## 🛡️ Risk Management

### Safety Features

- **Circuit Breaker**: Automatic shutdown on excessive losses
- **Position Limits**: Per-market and total portfolio limits
- **Cooldown Periods**: Temporary trading suspension after losses
- **Slippage Protection**: Maximum slippage limits on orders
- **Order Timeout**: Automatic cancellation of stale orders

### Monitoring

The bot provides real-time monitoring of:
- Portfolio P&L
- Active positions
- Open orders
- Risk metrics
- Win rate statistics

## 🔍 Market Filtering

Markets are automatically filtered by:
- **Volume**: Minimum 24h volume
- **Liquidity**: Minimum liquidity depth
- **Time to Resolution**: Maximum hours until market resolves
- **Activity**: Recent trading activity

## 📈 Performance Monitoring

### Key Metrics

- Total P&L (realized + unrealized)
- Win rate percentage
- Sharpe ratio
- Maximum drawdown
- Average position size

### Logging

All trades and decisions are logged with:
- Entry/exit reasons
- Confidence levels
- Risk metrics
- Error conditions

## 🧪 Testing

### Paper Trading Mode

Enable `ENABLE_PAPER_TRADING=true` for safe testing:
- Simulated order execution
- Mock fills with realistic slippage
- Full risk management without real money

### Strategy Backtesting

```typescript
// Example backtesting setup
import { SpreadArbitrageStrategy } from './strategy/spreadArb';

// Load historical data
// Run strategy against historical orderbook data
// Analyze performance metrics
```

## 🔒 Security

### Best Practices

- Never commit private keys to version control
- Use environment variables for sensitive data
- Enable paper trading for strategy testing
- Monitor positions regularly
- Set appropriate risk limits

### Wallet Security

- Use dedicated wallet for trading
- Implement withdrawal limits
- Regular security audits
- Cold storage for large amounts

## 🛠️ Development

### Adding New Strategies

1. Extend `BaseStrategy` class:
   ```typescript
   import BaseStrategy, { TradeSignal, StrategyConfig } from './baseStrategy';

   export class MyStrategy extends BaseStrategy {
     async evaluate(market: ScannedMarket, orderbook: OrderbookSnapshot): Promise<TradeSignal[]> {
       // Implement your strategy logic
       return [];
     }

     canTrade(market: ScannedMarket): boolean {
       // Define market suitability criteria
       return true;
     }
   }
   ```

2. Register in main bot:
   ```typescript
   // In index.ts
   this.strategies.push(new MyStrategy(config));
   ```

### Custom Market Filters

```typescript
// Override market filtering
getMarketFilter(): Partial<MarketFilter> {
  return {
    minVolume: new Decimal(5000),
    minLiquidity: new Decimal(2000),
    maxTimeToResolution: 72, // 3 days
  };
}
```

## 📚 API Reference

### Core Classes

- `PolymarketTradingBot`: Main bot orchestrator
- `MarketScanner`: Market discovery and filtering
- `OrderbookEngine`: Real-time orderbook management
- `RiskManager`: Risk control and limits
- `OrderManager`: Order execution and management
- `PositionManager`: Portfolio and P&L tracking

### Events

```typescript
bot.on('started', () => console.log('Bot started'));
bot.on('stopped', () => console.log('Bot stopped'));
bot.on('orderFill', (fill) => console.log('Order filled:', fill));
bot.on('emergencyStop', () => console.log('Emergency stop triggered'));
```

## 🚨 Risk Disclaimer

**This software is for educational and research purposes only. Trading cryptocurrencies and prediction markets involves substantial risk of loss and is not suitable for every investor.**

- Past performance does not guarantee future results
- Markets can be highly volatile and unpredictable
- Smart contract risks and platform risks exist
- Always trade with money you can afford to lose
- Consult with financial advisors before trading

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
- Check the logs in `logs/` directory
- Review configuration settings
- Test in paper trading mode first
- Ensure API credentials are correct

## 🔄 Future Enhancements

- [ ] Backtesting framework
- [ ] Telegram notifications
- [ ] Web dashboard
- [ ] Additional strategies (mean reversion, sentiment analysis)
- [ ] Machine learning integration
- [ ] Multi-exchange support
