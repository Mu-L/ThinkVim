# 🎯 Four.Meme BSC Token Sniper Bot

**⚠️ DISCLAIMER**: This bot is for **educational and research purposes only**. Cryptocurrency trading involves substantial risk. The developers are not responsible for any financial losses. Always conduct your own research and trade responsibly.

## 🚀 Features

- ✅ Real-time Four.Meme new token detection via WSS
- ✅ Advanced safety scanner (honeypot, tax, contract analysis)
- ✅ Multi-wallet support for parallel sniping
- ✅ Configurable buy parameters (amount, slippage, gas)
- ✅ Auto-sell engine (take-profit, stop-loss, trailing stop)
- ✅ Mempool monitoring for instant execution
- ✅ Detailed logging and transaction tracking
- ✅ Nonce management and gas optimization

## 📦 Installation

```bash
npm install
```

## ⚙️ Configuration

1. Copy `.env.example` to `.env`
2. Fill in your RPC URLs and private keys
3. Edit `config/bot.config.json` for trading parameters

## 🏃 Running

```bash
# Development mode with hot reload
npm run dev

# Build production
npm run build

# Start production
npm start
```

## 📁 Project Structure

```
src/
├── core/           # Blockchain connection and provider
├── scanner/        # Safety checks and token analysis
├── sniper/         # Buy/sell execution engines
├── utils/          # Helpers, ABIs, logging
├── config/         # Configuration management
└── index.ts        # Main entry point
```

## ⚠️ Risk Warning

Token sniping is high-risk:
- Tokens may be scams/rugs
- High gas costs on failed transactions
- Slippage and MEV risks
- Potential for total loss

**Use at your own risk. Start with small amounts.**

## 📄 License

MIT
