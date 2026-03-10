/**
 * app.js — Main App Bootstrap & Routing
 * Crypto Predict Platform
 */

'use strict';

import {
  fetchCoinList, fetchMarketData, fetchHistoricalPrices,
  fetchTrending, fetchTopCoins, fetchCoinGeckoSimplePrice,
  startBinanceWS, stopBinanceWS, clearCache
} from './api.js';
import {
  predictPrices, predictNextTick, calculateRSI, calculateMACD,
  calculateMovingAverage, calculateVolatility, generateSignal, confidenceScore
} from './prediction.js';
import {
  renderPriceChart, renderVolumeChart, renderRSIChart, renderMAChart,
  renderLiveChart, appendLivePricePoint
} from './charts.js';
import { renderFearGreedWidget, computeSentiment } from './sentiment.js';
import { detectWhaleActivity, getGainersLosers } from './whale.js';
import {
  formatPrice, formatLargeNumber, formatPercent,
  copyToClipboard, showToast, debounce, abbreviateNumber, formatDate
} from './utils.js';

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */
let coinList        = [];
let selectedCoin    = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' };
let currentDays     = 30;
let refreshTimer    = null;
let refreshCountdown = 30;
const WALLET_ADDRESS = 'FYpgseqgGkE2eHsTxz3M7u4JeqhFCoo5Y7EvYLpRZqoT';

// Live feed state
let livePriceTicks   = [];
let lastLivePrice    = 0;
let wsConnected      = false;
let fullRefreshTimer = null;
let fullRefreshCountdown = 60;

// Dashboard refresh interval in seconds
const FULL_REFRESH_INTERVAL = 60;

// Fallback coin IDs for quick-stats when top coins endpoint fails
const FALLBACK_COIN_IDS  = ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'binancecoin'];
const FALLBACK_COIN_SYMBOLS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', dogecoin: 'DOGE', binancecoin: 'BNB' };

/* ------------------------------------------------------------------ */
/* Page Detection                                                       */
/* ------------------------------------------------------------------ */
function getPage() {
  const path = window.location.pathname;
  if (path.includes('dashboard')) return 'dashboard';
  if (path.includes('donate'))    return 'donate';
  return 'index';
}

/* ------------------------------------------------------------------ */
/* Initialise                                                           */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  const page = getPage();

  // Wire up navbar search on every page
  initNavbarSearch();
  // Wire up copy-wallet buttons on every page
  initCopyWalletButtons();

  if (page === 'index')     await initIndexPage();
  if (page === 'dashboard') await initDashboardPage();
  if (page === 'donate')    await initDonatePage();
});

/* ------------------------------------------------------------------ */
/* Navbar Search (shared)                                               */
/* ------------------------------------------------------------------ */
function initNavbarSearch() {
  const input = document.getElementById('navbar-search');
  if (!input) return;

  // Load coin list lazily
  input.addEventListener('focus', async () => {
    if (!coinList.length) coinList = await fetchCoinList();
  });

  const debouncedSearch = debounce(e => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) { closeNavDropdown(); return; }
    showNavDropdown(filterCoins(q, 8), (coin) => {
      selectedCoin = coin;
      input.value  = coin.name;
      closeNavDropdown();
      if (getPage() !== 'dashboard') {
        window.location.href = `dashboard.html?coin=${coin.id}`;
      } else {
        loadDashboardData(coin.id, coin.symbol);
      }
    });
  }, 250);

  input.addEventListener('input', debouncedSearch);
  document.addEventListener('click', e => {
    if (!e.target.closest('.navbar-search')) closeNavDropdown();
  });
}

function filterCoins(q, limit) {
  return coinList
    .filter(c => c.symbol.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    .slice(0, limit);
}

function showNavDropdown(coins, onSelect) {
  closeNavDropdown();
  if (!coins.length) return;
  const wrap = document.querySelector('.navbar-search');
  if (!wrap) return;

  const dd = document.createElement('div');
  dd.id = 'nav-dropdown';
  dd.className = 'autocomplete-dropdown';
  coins.forEach(coin => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.innerHTML = `<span class="coin-symbol">${coin.symbol}</span><span>${coin.name}</span>`;
    item.addEventListener('click', () => onSelect(coin));
    dd.appendChild(item);
  });
  wrap.appendChild(dd);
}

function closeNavDropdown() {
  document.getElementById('nav-dropdown')?.remove();
}

/* ------------------------------------------------------------------ */
/* Copy Wallet Buttons                                                  */
/* ------------------------------------------------------------------ */
function initCopyWalletButtons() {
  document.querySelectorAll('[data-copy-wallet]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await copyToClipboard(WALLET_ADDRESS);
      if (ok) {
        btn.textContent = '✅ Copied!';
        showToast('Wallet address copied!', 'success');
        setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2500);
      } else {
        showToast('Could not copy — please copy manually', 'error');
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Index Page                                                           */
/* ------------------------------------------------------------------ */
async function initIndexPage() {
  // Load quick stats (top 5)
  renderQuickStats();

  // Wire up hero BTC live ticker via Binance WebSocket
  const heroBtcEl = document.getElementById('hero-btc-price');
  const wsIndexEl = document.getElementById('ws-status-index');
  if (heroBtcEl) {
    startBinanceWS('BTC', (tick) => {
      if (!tick) {
        if (wsIndexEl) { wsIndexEl.className = 'ws-dot ws-delayed'; wsIndexEl.title = 'Delayed data'; }
        return;
      }
      if (wsIndexEl) { wsIndexEl.className = 'ws-dot ws-live'; wsIndexEl.title = 'Live data'; }
      heroBtcEl.textContent = formatPrice(tick.price);
    });
  }

  // Hero search autocomplete
  const heroInput = document.getElementById('hero-search');
  const heroDrop  = document.getElementById('hero-dropdown');
  if (heroInput && heroDrop) {
    heroInput.addEventListener('focus', async () => {
      if (!coinList.length) coinList = await fetchCoinList();
    });

    const debouncedHero = debounce(async (e) => {
      const q = e.target.value.trim().toLowerCase();
      heroDrop.innerHTML = '';
      if (q.length < 2) { heroDrop.classList.add('hidden'); return; }
      if (!coinList.length) coinList = await fetchCoinList();
      const results = filterCoins(q, 8);
      if (!results.length) { heroDrop.classList.add('hidden'); return; }
      heroDrop.classList.remove('hidden');
      results.forEach(coin => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `<span class="coin-symbol">${coin.symbol}</span><span>${coin.name}</span>`;
        item.addEventListener('click', () => {
          window.location.href = `dashboard.html?coin=${coin.id}`;
        });
        heroDrop.appendChild(item);
      });
    }, 250);

    heroInput.addEventListener('input', debouncedHero);
    document.addEventListener('click', e => {
      if (!e.target.closest('.hero-search')) {
        heroDrop.classList.add('hidden');
      }
    });
  }
}

async function renderQuickStats() {
  const container = document.getElementById('quick-stats');
  if (!container) return;

  // Show skeletons while loading
  container.innerHTML = Array(5).fill('<div class="quick-stat-item skeleton-stat"><div class="skeleton" style="width:60px;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:80px;height:18px"></div></div>').join('');

  let coins = await fetchTopCoins(5);

  // Fallback to simple price if top coins fails
  if (!coins || !coins.length) {
    try {
      const simple = await fetchCoinGeckoSimplePrice(FALLBACK_COIN_IDS);
      coins = Object.entries(simple).map(([id, data]) => ({
        symbol: FALLBACK_COIN_SYMBOLS[id] || id,
        name: id,
        current_price: data.usd,
        price_change_percentage_24h: data.usd_24h_change
      }));
    } catch { /* ignore */ }
  }

  if (!coins || !coins.length) {
    container.innerHTML = '<div class="quick-stat-offline">⚠️ Live data temporarily unavailable</div>';
    return;
  }

  container.innerHTML = coins.map(coin => {
    const chg = formatPercent(coin.price_change_percentage_24h);
    return `
      <div class="quick-stat-item">
        <span class="quick-stat-name">${coin.symbol.toUpperCase()}</span>
        <span class="quick-stat-price">${formatPrice(coin.current_price)}</span>
        <span class="quick-stat-change ${chg.cls}">${chg.text}</span>
      </div>
    `;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* Dashboard Page                                                       */
/* ------------------------------------------------------------------ */
async function initDashboardPage() {
  // Check URL param
  const params = new URLSearchParams(window.location.search);
  const coinParam = params.get('coin');
  if (coinParam) {
    selectedCoin.id = coinParam;
    // Try to match symbol from list
    if (!coinList.length) coinList = await fetchCoinList();
    const found = coinList.find(c => c.id === coinParam);
    if (found) selectedCoin = found;
  }

  // Dashboard search
  const dashInput = document.getElementById('dash-search');
  if (dashInput) {
    dashInput.addEventListener('focus', async () => {
      if (!coinList.length) coinList = await fetchCoinList();
    });

    const debouncedDash = debounce(async (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (q.length < 2) { closeDashDropdown(); return; }
      if (!coinList.length) coinList = await fetchCoinList();
      showDashDropdown(filterCoins(q, 8));
    }, 250);

    dashInput.addEventListener('input', debouncedDash);
    document.addEventListener('click', e => {
      if (!e.target.closest('.coin-selector-input')) closeDashDropdown();
    });
  }

  // Timeframe buttons
  document.querySelectorAll('.timeframe-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDays = parseInt(btn.dataset.days, 10);
      loadDashboardData(selectedCoin.id, selectedCoin.symbol);
    });
  });

  // Initial load
  await loadDashboardData(selectedCoin.id, selectedCoin.symbol);

  // Auto-refresh
  startAutoRefresh();
}

function showDashDropdown(coins) {
  closeDashDropdown();
  const wrap = document.querySelector('.coin-selector-input');
  if (!wrap || !coins.length) return;

  const dd = document.createElement('div');
  dd.id = 'dash-dropdown';
  dd.className = 'autocomplete-dropdown';
  coins.forEach(coin => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.innerHTML = `<span class="coin-symbol">${coin.symbol}</span><span>${coin.name}</span>`;
    item.addEventListener('click', () => {
      selectedCoin = coin;
      const dashInput = document.getElementById('dash-search');
      if (dashInput) dashInput.value = coin.name;
      closeDashDropdown();
      loadDashboardData(coin.id, coin.symbol);
    });
    dd.appendChild(item);
  });
  wrap.appendChild(dd);
}

function closeDashDropdown() {
  document.getElementById('dash-dropdown')?.remove();
}

async function loadDashboardData(coinId, symbol = '') {
  // Show skeletons
  setSkeletons();

  try {
    // Fetch all data in parallel
    const [marketData, histData, trending] = await Promise.all([
      fetchMarketData(coinId),
      fetchHistoricalPrices(coinId, currentDays),
      fetchTrending()
    ]);

    if (!marketData) { showToast(`No data for ${coinId}`, 'error'); return; }

    const md      = marketData.market_data;
    const prices  = histData.prices.map(p => p[1]);
    const vols    = histData.total_volumes.map(v => v[1]);
    const labels  = histData.prices.map(p => formatDate(p[0]));

    // ------ Left Panel ------
    renderMarketDataPanel(marketData, md);
    renderFearGreedWidget('fear-greed-container');
    renderTrendingCoins(trending?.coins ?? []);

    // ------ Center Panel – Charts ------
    const prediction = predictPrices(prices, 7);
    renderPriceChart('price-chart', { labels, prices }, prediction.prices);
    renderVolumeChart('volume-chart', { labels, volumes: vols, prices });

    const rsiArr = calculateRSI(prices);
    const rsiLabels = labels.slice(labels.length - rsiArr.length);
    renderRSIChart('rsi-chart', { labels: rsiLabels, rsi: rsiArr });

    const ma7  = calculateMovingAverage(prices, 7);
    const ma25 = calculateMovingAverage(prices, 25);
    const ma99 = calculateMovingAverage(prices, 99);
    renderMAChart('ma-chart', labels, prices, ma7, ma25, ma99);

    // ------ Right Panel – Predictions ------
    const macd  = calculateMACD(prices);
    const rsi   = rsiArr.length ? rsiArr[rsiArr.length - 1] : 50;
    const curPr = md.current_price?.usd ?? prices[prices.length - 1];
    const ma7v  = ma7.length  ? ma7[ma7.length - 1]   : 0;
    const ma25v = ma25.length ? ma25[ma25.length - 1]  : 0;
    const conf  = confidenceScore(prices, vols);

    renderPredictionCards(curPr, prices, prediction, rsi, macd, ma7v, ma25v, conf);
    renderMACDSignal(macd, prices);
    renderMovingAverages(curPr, ma7v, ma25v, ma99.length ? ma99[ma99.length - 1] : 0);

    // ------ Bottom Panel ------
    const { gainers, losers } = await getGainersLosers(5);
    renderGainersLosers(gainers, losers);
    renderTrendingPanel(trending?.coins ?? []);
    const whaleAlerts = await detectWhaleActivity(symbol || marketData.symbol?.toUpperCase() || 'BTC');
    renderWhaleAlerts(whaleAlerts);

    // Start live WebSocket feed
    const liveSymbol = (symbol || marketData.symbol || 'BTC').toUpperCase();
    startLiveFeed(liveSymbol);

  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Failed to load dashboard data', 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Skeleton Loaders                                                     */
/* ------------------------------------------------------------------ */
function setSkeletons() {
  const ids = ['price-display', 'metrics-grid', 'prediction-cards', 'macd-display', 'ma-display'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="skeleton skeleton-text" style="width:80%"></div><div class="skeleton skeleton-text" style="width:60%"></div>';
  });
}

/* ------------------------------------------------------------------ */
/* Left Panel Renderers                                                 */
/* ------------------------------------------------------------------ */
function renderMarketDataPanel(marketData, md) {
  const priceEl = document.getElementById('price-display');
  if (priceEl) {
    const chg24h = md?.price_change_percentage_24h ?? 0;
    const chg    = formatPercent(chg24h);
    priceEl.innerHTML = `
      <div class="price-main">${formatPrice(md?.current_price?.usd)}</div>
      <div>
        <span class="price-change-badge ${chg24h >= 0 ? 'text-green' : 'text-red'}"
              style="background:${chg24h >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}">
          ${chg.text}
        </span>
        <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.4rem">24h</span>
      </div>
    `;
  }

  const metricsEl = document.getElementById('metrics-grid');
  if (metricsEl) {
    const items = [
      { label: '24h Volume',   value: formatLargeNumber(md?.total_volume?.usd) },
      { label: 'Market Cap',   value: formatLargeNumber(md?.market_cap?.usd) },
      { label: 'ATH',          value: formatPrice(md?.ath?.usd) },
      { label: 'Circulating',  value: abbreviateNumber(md?.circulating_supply) + ' ' + (marketData.symbol?.toUpperCase() ?? '') },
      { label: '7d Change',    value: formatPercent(md?.price_change_percentage_7d).text },
      { label: '30d Change',   value: formatPercent(md?.price_change_percentage_30d).text }
    ];
    metricsEl.innerHTML = `<div class="metric-grid">${items.map(i => `
      <div class="metric-item">
        <div class="metric-label">${i.label}</div>
        <div class="metric-value">${i.value}</div>
      </div>`).join('')}</div>`;
  }

  // Update coin title
  const nameEl = document.getElementById('coin-name');
  if (nameEl) nameEl.textContent = `${marketData.name} (${(marketData.symbol ?? '').toUpperCase()})`;
}

function renderTrendingCoins(coins) {
  const el = document.getElementById('trending-list');
  if (!el || !coins.length) return;

  el.innerHTML = coins.slice(0, 7).map((c, i) => `
    <div class="trending-item" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('selectCoin',{detail:{id:'${c.item.id}',symbol:'${c.item.symbol}',name:'${c.item.name}'}}))">
      <span class="trending-rank">#${i + 1}</span>
      <span class="trending-name">${c.item.name}</span>
      <span class="trending-symbol">${c.item.symbol}</span>
    </div>
  `).join('');

  window.addEventListener('selectCoin', e => {
    selectedCoin = e.detail;
    loadDashboardData(e.detail.id, e.detail.symbol);
  }, { once: false });
}

/* ------------------------------------------------------------------ */
/* Right Panel Renderers                                                */
/* ------------------------------------------------------------------ */
function renderPredictionCards(currentPrice, prices, prediction, rsi, macd, ma7, ma25, conf) {
  const container = document.getElementById('prediction-cards');
  if (!container) return;

  const pred1h = currentPrice * (1 + _hourlyDrift(prices) * 1);
  const pred24h = prediction.prices[0] ?? currentPrice;
  // Fix: clamp index to valid range to avoid undefined
  const pred7d  = prediction.prices.length > 0
    ? prediction.prices[Math.min(6, prediction.prices.length - 1)]
    : currentPrice;

  const timeframes = [
    { id: '1h',  label: '1 Hour',  price: pred1h,  conf: Math.round(conf * 0.9) },
    { id: '24h', label: '24 Hours',price: pred24h, conf: conf },
    { id: '7d',  label: '7 Days',  price: pred7d,  conf: Math.round(conf * 0.75) }
  ];

  container.innerHTML = timeframes.map(tf => {
    const chg    = ((tf.price - currentPrice) / currentPrice) * 100;
    const chgFmt = formatPercent(chg);
    const signal = generateSignal(rsi, macd, currentPrice, ma7, ma25);
    const sigCls = signal === 'BUY' ? 'signal-buy' : signal === 'SELL' ? 'signal-sell' : 'signal-hold';
    const sigEmoji = signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '🟡';
    return `
      <div class="prediction-card animate-fade-in" data-timeframe="${tf.id}">
        <div class="prediction-timeframe">Next ${tf.label}</div>
        <div class="prediction-price">${formatPrice(tf.price)}</div>
        <div class="prediction-change ${chgFmt.cls}">${chgFmt.text}</div>
        <div class="confidence-bar-wrap">
          <div class="confidence-label"><span>Confidence</span><span>${tf.conf}%</span></div>
          <div class="confidence-bar"><div class="confidence-fill" style="width:${tf.conf}%"></div></div>
        </div>
        <span class="signal-badge ${sigCls}">${sigEmoji} ${signal}</span>
      </div>
    `;
  }).join('');
}

function renderMACDSignal(macd, prices) {
  const el = document.getElementById('macd-display');
  if (!el) return;

  const hist = macd.histogram;
  if (!hist.length) { el.innerHTML = '<p class="text-muted">Insufficient data</p>'; return; }

  const lastHist   = hist[hist.length - 1];
  const lastMacd   = macd.macd[macd.macd.length - 1];
  const lastSignal = macd.signal[macd.signal.length - 1];
  const bullish    = lastHist > 0;

  el.innerHTML = `
    <div class="indicator-row">
      <span class="indicator-label">MACD Line</span>
      <span class="indicator-value ${bullish ? 'text-green' : 'text-red'}">${lastMacd?.toFixed(4) ?? 'N/A'}</span>
    </div>
    <div class="indicator-row">
      <span class="indicator-label">Signal Line</span>
      <span class="indicator-value">${lastSignal?.toFixed(4) ?? 'N/A'}</span>
    </div>
    <div class="indicator-row">
      <span class="indicator-label">Histogram</span>
      <span class="indicator-value ${bullish ? 'text-green' : 'text-red'}">${lastHist.toFixed(4)}</span>
    </div>
    <div class="indicator-row">
      <span class="indicator-label">Signal</span>
      <span class="indicator-value ${bullish ? 'text-green' : 'text-red'}">${bullish ? '📈 Bullish' : '📉 Bearish'}</span>
    </div>
  `;
}

function renderMovingAverages(price, ma7, ma25, ma99) {
  const el = document.getElementById('ma-display');
  if (!el) return;

  function maStatus(ma) {
    if (!ma) return { cls: 'text-muted', txt: 'N/A' };
    return price > ma
      ? { cls: 'text-green', txt: '↑ Above' }
      : { cls: 'text-red',   txt: '↓ Below' };
  }

  const s7  = maStatus(ma7);
  const s25 = maStatus(ma25);
  const s99 = maStatus(ma99);

  el.innerHTML = `
    <div class="indicator-row">
      <span class="indicator-label">MA7</span>
      <span class="indicator-value">${formatPrice(ma7)} <small class="${s7.cls}">${s7.txt}</small></span>
    </div>
    <div class="indicator-row">
      <span class="indicator-label">MA25</span>
      <span class="indicator-value">${formatPrice(ma25)} <small class="${s25.cls}">${s25.txt}</small></span>
    </div>
    <div class="indicator-row">
      <span class="indicator-label">MA99</span>
      <span class="indicator-value">${formatPrice(ma99)} <small class="${s99.cls}">${s99.txt}</small></span>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Bottom Panel Renderers                                               */
/* ------------------------------------------------------------------ */
function renderGainersLosers(gainers, losers) {
  const renderList = (coins, containerId) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = coins.map(c => {
      const chg = formatPercent(c.price_change_percentage_24h);
      return `
        <div class="coin-list-item">
          <span class="coin-list-name">${c.symbol.toUpperCase()} <span style="font-size:0.75rem;color:var(--text-muted)">${c.name}</span></span>
          <span>
            <span class="coin-list-price">${formatPrice(c.current_price)}</span>
            <span class="${chg.cls}" style="font-size:0.8rem;margin-left:0.4rem">${chg.text}</span>
          </span>
        </div>`;
    }).join('');
  };
  renderList(gainers, 'gainers-list');
  renderList(losers,  'losers-list');
}

function renderTrendingPanel(coins) {
  const el = document.getElementById('trending-panel');
  if (!el || !coins.length) return;
  el.innerHTML = coins.slice(0, 7).map((c, i) => `
    <div class="coin-list-item">
      <span class="trending-rank">#${c.item.market_cap_rank ?? (i + 1)}</span>
      <span class="coin-list-name" style="flex:1;margin-left:0.4rem">${c.item.name}</span>
      <span class="coin-list-price text-cyan" style="font-size:0.8rem">${c.item.symbol.toUpperCase()}</span>
    </div>`).join('');
}

function renderWhaleAlerts(alerts) {
  const el = document.getElementById('whale-alerts');
  if (!el || !alerts.length) return;
  el.innerHTML = alerts.map(a => `
    <div class="coin-list-item">
      <span>${a.type}</span>
      <span>
        <span style="color:var(--text-primary);font-weight:600">${a.size}</span>
        <span class="${a.direction.includes('Buy') ? 'text-green' : 'text-red'}" style="margin-left:0.4rem">${a.direction}</span>
        <span class="text-muted" style="font-size:0.75rem;margin-left:0.4rem">${a.timeAgo}</span>
      </span>
    </div>`).join('');
}

/* ------------------------------------------------------------------ */
/* Auto Refresh                                                         */
/* ------------------------------------------------------------------ */
function startAutoRefresh() {
  if (fullRefreshTimer) clearInterval(fullRefreshTimer);
  fullRefreshCountdown = FULL_REFRESH_INTERVAL;
  // Keep legacy refreshCountdown in sync for countdown display
  refreshCountdown = FULL_REFRESH_INTERVAL;

  fullRefreshTimer = setInterval(async () => {
    fullRefreshCountdown--;
    refreshCountdown = fullRefreshCountdown;
    const el = document.getElementById('refresh-countdown');
    if (el) el.textContent = fullRefreshCountdown + 's';

    if (fullRefreshCountdown <= 0) {
      fullRefreshCountdown = FULL_REFRESH_INTERVAL;
      refreshCountdown = FULL_REFRESH_INTERVAL;
      clearCache();
      await loadDashboardData(selectedCoin.id, selectedCoin.symbol);
    }
  }, 1000);
}

/* ------------------------------------------------------------------ */
/* Live Feed (Binance WebSocket)                                        */
/* ------------------------------------------------------------------ */
function startLiveFeed(symbol) {
  stopLiveFeed();
  // Initialize live chart
  renderLiveChart('live-chart');

  const wsStatusEl = document.getElementById('ws-status');

  startBinanceWS(symbol, (tick) => {
    if (!tick) {
      wsConnected = false;
      if (wsStatusEl) { wsStatusEl.className = 'ws-dot ws-delayed'; wsStatusEl.title = 'Delayed data'; }
      return;
    }

    wsConnected = true;
    if (wsStatusEl) { wsStatusEl.className = 'ws-dot ws-live'; wsStatusEl.title = 'Live data'; }

    const prevPrice = lastLivePrice;
    lastLivePrice = tick.price;
    livePriceTicks.push(tick.price);
    if (livePriceTicks.length > 200) livePriceTicks.shift();

    // Update price display with flash animation
    const priceEl = document.getElementById('live-price-display');
    if (priceEl) {
      priceEl.textContent = formatPrice(tick.price);
      const flashClass = tick.price >= prevPrice ? 'price-flash-up' : 'price-flash-down';
      priceEl.classList.remove('price-flash-up', 'price-flash-down');
      void priceEl.offsetWidth; // force reflow to restart animation
      priceEl.classList.add(flashClass);
      setTimeout(() => priceEl.classList.remove(flashClass), 400);
    }

    // Update 24h change display
    const changeEl = document.getElementById('live-change-display');
    if (changeEl) {
      const chg = formatPercent(tick.change24h);
      changeEl.textContent = chg.text;
      changeEl.className = `price-change-live ${chg.cls}`;
    }

    // Show LIVE badge
    const badgeEl = document.getElementById('live-price-badge');
    if (badgeEl) badgeEl.style.display = 'inline-flex';

    // Append to live chart
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    appendLivePricePoint('live-chart', tick.price, now);

    // Update 1h prediction card with live price
    update1hPrediction(tick.price);
  });
}

function stopLiveFeed() {
  stopBinanceWS();
  wsConnected = false;
  livePriceTicks = [];
}

function update1hPrediction(livePrice) {
  const card1h = document.querySelector('[data-timeframe="1h"]');
  if (!card1h) return;
  const prices = livePriceTicks.length >= 5 ? livePriceTicks : [livePrice];
  // Use micro-prediction for next tick, blended with hourly drift estimate
  const { nextPrice } = predictNextTick(prices);
  const pred1h = prices.length >= 5
    ? livePrice * (1 + _hourlyDrift(prices))
    : nextPrice;
  const chg = ((pred1h - livePrice) / livePrice) * 100;
  const chgFmt = formatPercent(chg);
  const priceEl = card1h.querySelector('.prediction-price');
  const changeEl = card1h.querySelector('.prediction-change');
  if (priceEl) priceEl.textContent = formatPrice(pred1h);
  if (changeEl) { changeEl.textContent = chgFmt.text; changeEl.className = `prediction-change ${chgFmt.cls}`; }
}

/* ------------------------------------------------------------------ */
/* Donate Page                                                          */
/* ------------------------------------------------------------------ */
async function initDonatePage() {
  // QR code
  const { generateQRCode } = await import('./utils.js');
  generateQRCode('qr-code', WALLET_ADDRESS);

  // Tier card click → copy wallet
  document.querySelectorAll('.tier-card').forEach(card => {
    card.addEventListener('click', async () => {
      const ok = await copyToClipboard(WALLET_ADDRESS);
      if (ok) {
        showToast(`Ready to send ${card.dataset.amount ?? 'USDT'}! Wallet copied 🙏`, 'success');
        const ty = document.getElementById('thankyou-card');
        if (ty) ty.classList.add('visible');
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Estimate 1-hour drift from recent price deltas */
function _hourlyDrift(prices) {
  if (prices.length < 2) return 0;
  const recent = prices.slice(-24); // last 24 bars
  const changes = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] !== 0) changes.push((recent[i] - recent[i - 1]) / recent[i - 1]);
  }
  if (!changes.length) return 0;
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  return avg * 0.5; // dampened for realism
}
