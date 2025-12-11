# Four.Meme BSC Token Sniper Bot - Complete Setup Guide

## 📋 Prerequisites

Before running the bot, ensure you have:

- **Node.js** v18+ and npm v9+
- **BSC RPC endpoints** (WebSocket and HTTPS)
- **Private keys** for wallets with BNB balance
- **Four.Meme factory contract address**

## 🔧 Installation Steps

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `ethers` (v6) - Blockchain interaction
- `chalk` - Colored terminal output
- `dotenv` - Environment variable management
- TypeScript and development tools

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# BSC RPC Configuration
RPC_WSS_URL=wss://bsc-mainnet.core.chainstack.com/YOUR_KEY
RPC_HTTPS_URL=https://bsc-dataseed1.binance.org/

# Wallet Configuration (comma-separated for multi-wallet)
PRIVATE_KEYS=your_private_key_1,your_private_key_2

# Four.Meme Factory Contract
FOUR_MEME_FACTORY=0x0000000000000000000000000000000000000000

# PancakeSwap Router (BSC)
PANCAKE_ROUTER_V2=0x10ED43C718714eb63d5aA57B78B54704E256024E
```

**⚠️ SECURITY WARNING:**
- Never commit `.env` to version control
- Keep private keys secure
- Use dedicated wallets with limited funds

### 3. Configure Bot Settings

Edit `config/bot.config.json`:

```json
{
  "trading": {
    "buyAmount": "0.05",        // BNB per snipe
    "maxSlippage": 8,           // Percentage
    "gasLimit": 500000,
    "maxPriorityFeePerGas": "2" // Gwei
  },
  "safety": {
    "enableSafetyScanner": true,
    "minSafetyScore": 70,       // 0-100
    "minLiquidity": 0.5,        // BNB
    "maxBuyTax": 10,            // Percentage
    "maxSellTax": 10
  },
  "selling": {
    "autoSell": true,
    "takeProfit": 50,           // Sell at 50% gain
    "stopLoss": 15,             // Sell at 15% loss
    "trailingStop": true,
    "trailingStopPercent": 10
  }
}
```

## 🚀 Running the Bot

### Development Mode (with hot reload)

```bash
npm run dev
```

### Production Mode

```bash
# Build TypeScript
npm run build

# Run compiled code
npm start

# Or combined
npm run start:prod
```

## 📊 Bot Workflow

1. **Initialization**
   - Connects to BSC via WebSocket
   - Syncs wallet nonces
   - Checks balances

2. **Token Detection**
   - Monitors Four.Meme factory for new tokens
   - Watches mempool for early detection
   - Extracts token metadata

3. **Safety Analysis**
   - Honeypot simulation (buy/sell test)
   - Contract ownership check
   - Liquidity verification
   - Tax detection

4. **Execution**
   - Builds optimized transaction
   - Signs with selected wallet
   - Broadcasts with priority gas
   - Waits for confirmation

5. **Position Management**
   - Monitors price every second
   - Executes take-profit/stop-loss
   - Trailing stop adjustments
   - Auto-approval for selling

## 📁 Project Structure

```
four-meme-sniper-bot/
├── src/
│   ├── core/               # Blockchain & wallet management
│   │   ├── provider.ts     # WSS/HTTP provider with reconnect
│   │   └── walletManager.ts # Multi-wallet nonce management
│   ├── scanner/            # Token detection & safety
│   │   ├── factoryListener.ts # Four.Meme event listener
│   │   └── safetyScanner.ts   # Honeypot/tax/ownership checks
│   ├── sniper/             # Trading engines
│   │   ├── sniperEngine.ts # Buy execution
│   │   └── sellEngine.ts   # Auto-sell with TP/SL
│   ├── config/             # Configuration management
│   │   └── configLoader.ts
│   ├── utils/              # Helpers & utilities
│   │   ├── abis.ts         # Contract ABIs
│   │   ├── helpers.ts      # Utility functions
│   │   └── logger.ts       # Colored logging
│   └── index.ts            # Main orchestrator
├── config/
│   └── bot.config.json     # Bot settings
├── .env.example            # Environment template
├── tsconfig.json           # TypeScript config
└── package.json            # Dependencies
```

## ⚙️ Advanced Configuration

### Multi-Wallet Strategy

Add multiple private keys in `.env`:

```env
PRIVATE_KEYS=key1,key2,key3
```

The bot will:
- Rotate between wallets
- Use least-busy wallet
- Manage nonces independently

### Gas Optimization

Adjust in `bot.config.json`:

```json
{
  "trading": {
    "gasLimit": 500000,           // Increase if transactions fail
    "maxPriorityFeePerGas": "5"   // Higher = faster execution
  }
}
```

### Safety Thresholds

```json
{
  "safety": {
    "minSafetyScore": 80,    // Stricter = fewer trades
    "minLiquidity": 1.0,     // Higher = safer tokens
    "maxBuyTax": 5,          // Lower = avoid high-tax tokens
    "checkHoneypot": true    // Always recommended!
  }
}
```

## 🔍 Monitoring

### Log Files

Logs are saved to `logs/bot-YYYY-MM-DD.log`:

```json
{"timestamp":"2024-01-01T12:00:00.000Z","level":"INFO","message":"New token detected","data":{...}}
```

### Console Output

The bot provides real-time colored output:
- 🆕 New token detected
- 🔍 Safety analysis
- 🎯 Buy execution
- 💰 Sell execution
- ✅ Success / ❌ Failures

## ⚠️ Risk Management

### Best Practices

1. **Start Small**
   - Begin with `buyAmount: "0.01"` for testing
   - Increase gradually after success

2. **Use Test Wallets**
   - Dedicated wallets for bot only
   - Never use your main wallet

3. **Set Limits**
   - Enable stop-loss always
   - Use conservative take-profit (20-30%)
   - Monitor first few snipes manually

4. **Safety First**
   - Always enable safety scanner
   - Set minimum liquidity requirements
   - Check for honeypots

### Common Pitfalls

❌ **Avoid:**
- Disabling safety checks
- Using production wallets
- Chasing every token
- Setting slippage too low
- Ignoring gas costs

✅ **Do:**
- Test with small amounts first
- Monitor bot actively
- Review logs regularly
- Keep BNB for gas
- Use multiple wallets

## 🐛 Troubleshooting

### "Insufficient balance" error
- Ensure wallets have enough BNB
- Account for gas costs (add 10% buffer)

### "Transaction failed" repeatedly
- Increase `gasLimit` in config
- Check `maxSlippage` setting
- Verify RPC connection quality

### "Cannot connect to WebSocket"
- Check `RPC_WSS_URL` in `.env`
- Verify endpoint is working
- Bot will fallback to HTTP automatically

### "Honeypot detected" for safe tokens
- Simulation may have false positives
- Reduce `minSafetyScore` slightly
- Check liquidity is sufficient

## 📞 Support & Updates

For issues or improvements:
- Check logs in `logs/` directory
- Review config in `bot.config.json`
- Verify `.env` settings

## ⚖️ Legal Disclaimer

This software is provided "as is" for educational purposes only. Cryptocurrency trading involves substantial risk of loss. The developers:

- Are NOT responsible for any financial losses
- Do NOT guarantee profits or successful trades
- Make NO warranties about the software
- Are NOT liable for any damages

**USE AT YOUR OWN RISK**

Always:
- Conduct your own research
- Understand the risks
- Trade responsibly
- Comply with local laws

## 📝 License

MIT License - See LICENSE file for details
