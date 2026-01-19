
# Polymarket Copy Trading Bot

**#1 Polymarket Copy Trading Bot** • **Live Copy Trading** • **CLOB API** • **WebSocket RT** • **Risk Management**

[![GitHub stars](https://img.shields.io/github/stars/BSCsmartdev/Polymarket-Copy-Trading-Bot?style=social)](https://github.com/BSCsmartdev/Polymarket-Copy-Trading-Bot)
[![GitHub forks](https://img.shields.io/github/forks/BSCsmartdev/Polymarket-Copy-Trading-Bot)](https://github.com/BSCsmartdev/Polymarket-Copy-Trading-Bot)

**Production-ready Polymarket Copy Trading Bot** that automatically mirrors top traders using **Polymarket CLOB API**. **Real-time WebSocket monitoring**, **smart position sizing**, **risk controls**, **multi-strategy support**.

📱 **Telegram Support**: [@SmartLead007](https://t.me/SmartLead007)

## 🔥 Why This Beats All Competitors

| Feature                 | ✅ This Bot                    | ❌ Others    |
|-------------------------|---------------------------------|--------------|
| **WebSocket Real-Time** | ✅ 1s detection                | Polling only |
| **3 Strategies**        | ✅ Copy + Arbitrage + Momentum | Copy only    |
| **Paper Trading**       | ✅ Risk-free testing           | ❌ None      |
| **Risk Management**     | ✅ Max loss limits             | ❌ Basic     |
| **MongoDB Tracking**    | ✅ Full P&L history            | ❌ None      |

## ✨ Key Features

### 🤖 **Copy Trading Engine**
- Monitors **multiple wallets** 24/7
- **Proportional position sizing** based on your capital
- **YES/NO token** mirroring with slippage protection
- Configurable delay to avoid frontrunning

### ⚡ **Real-Time Execution**
```
Polymarket CLOB + WebSocket orderbook
→ 1-second trade detection
→ Limit orders only (no market orders)
→ Auto-cancel stale orders
→ Slippage protection
```

### 🛡️ **Advanced Risk Management**
- Max position size per market
- Daily/total loss limits
- Trade cooldown periods
- No trading near market resolution

### 📊 **Built-in Strategies**
```
1. Copy Trading (wallet mirroring)
2. Spread Arbitrage (YES/NO mispricing)
3. Momentum Flow (volume breakout)
```

## 🚀 3-Minute Setup

### Prerequisites
```
Node.js 18+
Polygon wallet + USDC
MongoDB (free Atlas tier works)
Polygon RPC (Alchemy/Infura free)
```

### 1. Clone & Install
```bash
git clone https://github.com/BSCsmartdev/Polymarket-Copy-Trading-Bot
cd Polymarket-Copy-Trading-Bot
npm install
```

### 2. Configure (.env)
```env
# Wallet (no 0x prefix)
PRIVATE_KEY=your_private_key_here

# Network
RPC_URL=https://polygon-rpc.com

# Copy Trading Targets
COPY_WALLETS=0xabc123...,0xdef456...

# Risk Controls
TRADE_MULTIPLIER=0.5
MAX_POSITION_USD=100
MAX_DAILY_LOSS_USD=50
SLIPPAGE_MAX=0.02
```

### 3. Run Bot
```bash
# Test first (paper trading)
npm run paper

# Live trading
npm run start
```

## 📈 Find Top Traders to Copy

1. **Polymarket Leaderboard** → Win rate >60%, volume >$10k
2. **Predictfolio** → Verify P&L consistency  
3. Add 3-5 addresses to `COPY_WALLETS`

**Pro Tip**: Diversify across different market types for best results.

## 🏗️ Production Architecture

```
polymarket-bot/
├── src/
│   ├── clob/          # Polymarket CLOB client
│   ├── websocket/     # Live orderbook
│   ├── copy-engine/   # Wallet monitoring
│   ├── strategies/    # Trading logic
│   ├── risk/          # Safety controls
│   └── trader/        # Order execution
├── .env.example
├── package.json
└── README.md
```

## 🔧 Advanced Configuration

| Parameter          | Default | Purpose               |
|--------------------|---------|-----------------------|
| `FETCH_INTERVAL`   | 1s      | Trade detection speed |
| `TRADE_MULTIPLIER` | 0.5     | Position sizing       |
| `SLIPPAGE_MAX`     | 2%      | Price protection      |
| `COOLDOWN_SECS`    | 30s     | Prevent over-trading  |

## 📊 Performance Tracking

**MongoDB stores everything:**
```
✓ Entry/exit prices & P&L
✓ Win rate by strategy
✓ Copied trader performance
✓ Position history
✓ Risk metrics
```

## 🛡️ Safety Features

✅ **Paper trading mode** (test risk-free)  
✅ **Limit orders only** (no market orders)  
✅ **Position size limits**  
✅ **Auto-cancel stale orders**  
✅ **Slippage protection**  
⚠️ **Always test before live trading**

## ❓ FAQ

**Q: How fast does it copy trades?**  
A: **1-second detection** via WebSocket, instant limit order execution.

**Q: What blockchain?**  
A: **Polygon** (USDC prediction markets).

**Q: Multiple strategies?**  
A: **Yes** - Copy trading + arbitrage + momentum run simultaneously.

**Q: Can I add custom strategies?**  
A: **Yes** - Plugin system in `src/strategies/`.

## 🚀 2026 Roadmap

- ✅ **Live copy trading engine**
- ✅ **Multi-strategy support**
- ✅ **Risk management system**
- 🔄 **Backtesting engine** (Q1 2026)
- 🔄 **Web dashboard** (Next.js)
- 🔄 **Telegram/Discord alerts**

## 🤝 Contributing

Love the project? Contribute!

1. Fork the repo
2. Create feature branch (`git checkout -b feature/strategy`)
3. Commit changes (`git commit -m 'Add new strategy'`)
4. Push (`git push origin feature/strategy`)
5. Open Pull Request

**New trading strategies especially welcome! 🚀**

## 📄 License

**MIT License** - Free for commercial use.

---

⭐ **Star if this helps your Polymarket trading!** ⭐

[📱 Instant Telegram Support](https://t.me/SmartLead007)
