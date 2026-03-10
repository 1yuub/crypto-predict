# ₿ CryptoPredict AI

> **AI-powered cryptocurrency prediction platform** — live charts, LSTM-inspired price forecasts, technical indicators, whale alerts, and buy/hold/sell signals. 100% static, hosted on GitHub Pages.

🌐 **Live Demo:** [https://1yuub.github.io/crypto-predict](https://1yuub.github.io/crypto-predict)

---

## 📸 Screenshots

> _Dashboard and landing page screenshots — coming soon._

---

## ✨ Features

| Feature | Details |
|---|---|
| 🤖 **AI Predictions** | LSTM-inspired weighted linear regression for 1h, 24h & 7-day price forecasts |
| 📊 **Interactive Charts** | Chart.js price history, volume, RSI (14), and moving average overlay |
| 📡 **Multi-API Data** | CoinGecko free tier + Binance public endpoints + Alternative.me Fear & Greed |
| 🐋 **Whale Alerts** | Volume spike detection to surface unusual on-chain activity |
| 📉 **Technical Analysis** | RSI, MACD, MA7/MA25/MA99, volatility scoring, BUY/HOLD/SELL signals |
| ⚡ **Auto-Refresh** | Dashboard refreshes every 30 s with API response caching |
| 🔍 **Coin Search** | Autocomplete search across 10,000+ coins from CoinGecko `/coins/list` |
| 😨 **Fear & Greed Index** | Live index from Alternative.me with animated indicator |
| 💚 **Crypto Donation** | SOL / USDT (Solana) with QR code and copy-to-clipboard |
| 🌙 **Dark Mode** | Glassmorphism cards, neon accents (cyan / purple / green), smooth animations |
| 📱 **Responsive** | Mobile-first CSS Grid + Flexbox layout |

---

## 🗂️ Project Structure

```
crypto-predict/
├── index.html           ← Landing / main dashboard
├── dashboard.html       ← Full prediction dashboard
├── donate.html          ← Dedicated donation page
├── css/
│   └── style.css        ← All styles (dark mode, glassmorphism, neon)
├── js/
│   ├── app.js           ← Main app bootstrap & routing
│   ├── api.js           ← API fetch helpers (CoinGecko, Binance, Alternative.me)
│   ├── prediction.js    ← Client-side AI prediction engine
│   ├── charts.js        ← Chart.js chart rendering helpers
│   ├── sentiment.js     ← Sentiment & Fear/Greed helpers
│   ├── whale.js         ← Whale / on-chain data helpers
│   └── utils.js         ← Shared utilities
└── README.md
```

---

## 🔌 API Sources

| API | Endpoint | Requires Key? |
|---|---|---|
| **CoinGecko** | `/coins/list`, `/coins/{id}`, `/coins/{id}/market_chart`, `/search/trending`, `/coins/markets` | ❌ Free |
| **Binance** | `/api/v3/ticker/price`, `/api/v3/klines` | ❌ Free |
| **Alternative.me** | `https://api.alternative.me/fng/` | ❌ Free |

All API calls use **in-memory caching** (30-second TTL) to respect rate limits.

---

## 🚀 Deployment (GitHub Pages)

This site is served as pure static HTML/CSS/JS from the `main` branch root `/`.

**Automatic deployment:**
1. Push to `main` branch
2. GitHub Pages serves the updated site at `https://1yuub.github.io/crypto-predict`

**To enable GitHub Pages:**
- Go to repository **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main`, Folder: `/ (root)`
- Save — the site will be live within a minute.

No build step, no Node.js, no CI required.

---

## 🧠 AI Prediction Engine

The prediction engine (`js/prediction.js`) implements a **weighted linear regression with momentum extrapolation**:

1. **Normalize** historical prices to [0, 1]
2. **Weighted regression** — exponential weights so recent prices have more influence
3. **R² scoring** — measures how well the regression fits
4. **Trend velocity & acceleration** — computed from last 7 vs last 14 bars
5. **Future projection** — blends regression trend with momentum, applying exponential confidence decay
6. **Confidence scoring** — R², RSI extremes, trend consistency, volume trend

Technical indicators: **RSI (14)**, **MACD (12, 26, 9)**, **MA7/MA25/MA99**, **Volatility (log-return std dev)**

---

## ❤️ Donation

If this project helps you, please consider supporting it!

**Supported networks:** SOL and USDT on the Solana network

**Wallet address:**
```
FYpgseqgGkE2eHsTxz3M7u4JeqhFCoo5Y7EvYLpRZqoT
```

Donation tiers: ☕ Coffee (1 USDT) · 🍕 Pizza (5 USDT) · 🚀 Rocket Fuel (10 USDT) · 💎 Diamond Hands (25 USDT) · 🌙 To The Moon (50 USDT) · 🐋 Whale (100 USDT)

---

## 📜 License

MIT © 2025 [1yuub](https://github.com/1yuub)

> **Disclaimer:** CryptoPredict AI is for educational and informational purposes only. Nothing on this platform constitutes financial advice. Always do your own research (DYOR) before making any investment decisions.