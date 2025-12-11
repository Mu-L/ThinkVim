
# 🎯 Four.Meme BSC Token Sniper Bot

A fully modular, high-performance **new-token sniper bot** designed specifically for the **Four.Meme ecosystem on Binance Smart Chain (BSC)**.
This bot monitors newly created tokens in real time, performs advanced safety analysis, and executes automated buy/sell strategies with precise controls.

---

## 📬 Contact & Development Support

For professional development, bot customization, or private consulting:

**Telegram:** @BSCsmartdev
**WhatsApp:** +1 (838) 273-9959
**Email:** [dev9999989@gmail.com](mailto:dev9999989@gmail.com)

---

## 🚀 Key Features

### 🔍 Real-Time Detection

* Live monitoring of **Four.Meme new token events** via WSS
* Mempool scanning for ultra-low latency execution
* Auto-fetch of token metadata, deployer address, liquidity, and supply

### 🛡️ Advanced Safety Scanner

* Honeypot simulation (pre-trade check)
* Buy/Sell tax detection
* Contract ownership & renounce status
* Blacklist / hidden privileged function scanning
* Liquidity verification (added, size, lock detection)
* Risk scoring (0–100)

### 💸 Smart Sniping Engine

* Ultra-fast transaction construction using:

  * Nonce queues
  * Gas optimization
  * Pre-built router calls
* Configurable:

  * Buy amount
  * Max slippage
  * Gas price / priority fee

### 🤖 Automated Sell Engine

* Take-profit (TP)
* Stop-loss (SL)
* Trailing stop
* Auto-sell on defined conditions
* Manual override support

### 🧩 Modular Architecture

* Multi-wallet support
* Isolated modules for scanning, trading, safety, utils
* Scalable for custom strategies or dashboards

### 📊 Logging & Monitoring

* Structured JSON logs
* Transaction tracking (buy, sell, failed, profit/loss)
* Error-tolerant reconnect logic

---

## 📦 Installation

```bash
npm install
```

---

## ⚙️ Configuration

### 1. Environment Variables

Copy `.env.example` to `.env`:

```
cp .env.example .env
```

Fill in:

* `RPC_WSS_URL`
* `RPC_HTTPS_URL`
* `PRIVATE_KEYS` (comma-separated for multi-wallet mode)

### 2. Bot Configuration

Edit `config/bot.config.json`:

Example:

```json
{
  "buyAmount": "0.05",
  "maxSlippage": 8,
  "minLiquidity": 0.5,
  "enableSafetyScanner": true,
  "takeProfit": 50,
  "stopLoss": 15,
  "autoSell": true,
  "wallets": ["PK1", "PK2"]
}
```

---

## 🏃 Running the Bot

### Development with Hot Reload

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

### Run Production

```bash
npm start
```

---

## 📁 Project Structure

```
src/
├── core/              # Provider, RPC management, websocket handlers
├── scanner/           # Honeypot tests, tax checks, contract analysis
├── sniper/            # Buy/sell engines, gas logic, nonce management
├── utils/             # ABIs, logger, helpers, math utilities
├── config/            # Config parsing, validation, types
└── index.ts           # Main entry point
```
---

## 📄 License

This project is released under the **MIT License**.
You may modify, distribute, or use it within the terms of the license.

---



