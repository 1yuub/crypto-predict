/**
 * api.js — Multi-API Data Layer
 * CoinGecko, Binance, Alternative.me — all free, no key required
 * Includes retry with exponential backoff, CORS proxy fallback chain,
 * stale-while-revalidate caching, and Binance WebSocket live feed.
 */

'use strict';

import { showToast } from './utils.js';

/* ------------------------------------------------------------------ */
/* Cache                                                                */
/* ------------------------------------------------------------------ */
const CACHE_TTL = 5_000;       // 5 seconds for price data (WS provides live feed)
const COIN_LIST_TTL = 300_000; // 5 minutes for coin list
const _cache = new Map();
let _ws = null;

function cacheGet(key, allowStale = false) {
  if (!_cache.has(key)) return null;
  const { data, ts } = _cache.get(key);
  const ttl = key === 'coin_list' ? COIN_LIST_TTL : CACHE_TTL;
  if (Date.now() - ts <= ttl) return data;
  if (allowStale) return data; // stale but usable as fallback
  _cache.delete(key);
  return null;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Retry & Proxy helpers                                                */
/* ------------------------------------------------------------------ */

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) await sleep(1000 * Math.pow(2, i - 1));
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (res.status === 429) throw new Error('rate_limited');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const PROXIES = [
  url => url,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

async function apiFetch(url, cacheKey = null, allowStale = true) {
  if (cacheKey) {
    const fresh = cacheGet(cacheKey, false);
    if (fresh !== null) return fresh;
  }
  for (let pi = 0; pi < PROXIES.length; pi++) {
    try {
      const proxyUrl = PROXIES[pi](url);
      let data = await fetchWithRetry(proxyUrl, pi === 0 ? 2 : 1);
      // allorigins wraps response in { contents: "..." }
      if (pi === 1 && data && data.contents) {
        data = JSON.parse(data.contents);
      }
      if (cacheKey) cacheSet(cacheKey, data);
      return data;
    } catch (e) {
      if (pi === PROXIES.length - 1) {
        // All proxies failed — return stale cache if available
        if (cacheKey && allowStale) {
          const stale = cacheGet(cacheKey, true);
          if (stale !== null) return stale;
        }
        throw e;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* CoinGecko Endpoints                                                  */
/* ------------------------------------------------------------------ */

const CG_BASE = 'https://api.coingecko.com/api/v3';
const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * Fetch full coin list (id, symbol, name)
 * Heavy – cached longer (5 min)
 */
export async function fetchCoinList() {
  const key = 'coin_list';
  const cached = cacheGet(key, false);
  if (cached) return cached;
  try {
    const data = await apiFetch(`${CG_BASE}/coins/list`, key, true);
    return data || [];
  } catch {
    const stale = cacheGet(key, true);
    return stale || [];
  }
}

/**
 * Full market + metadata for a coin
 */
export async function fetchMarketData(coinId) {
  const key = `market_${coinId}`;
  try {
    return await apiFetch(
      `${CG_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      key, true
    );
  } catch {
    const stale = cacheGet(key, true);
    if (stale) return stale;
    showToast(`Market data unavailable for ${coinId}`, 'error');
    return null;
  }
}

/**
 * Historical OHLCV prices from CoinGecko
 * @param {string} coinId
 * @param {number} days
 * @returns {{ prices: [ts,price][], market_caps: [], total_volumes: [] }}
 */
export async function fetchHistoricalPrices(coinId, days = 30) {
  const key = `history_${coinId}_${days}`;
  try {
    return await apiFetch(
      `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      key, true
    );
  } catch {
    const stale = cacheGet(key, true);
    if (stale) return stale;
    return { prices: [], market_caps: [], total_volumes: [] };
  }
}

/**
 * Trending coins
 */
export async function fetchTrending() {
  try {
    return await apiFetch(`${CG_BASE}/search/trending`, 'trending', true);
  } catch {
    const stale = cacheGet('trending', true);
    return stale || { coins: [] };
  }
}

/**
 * Top coins by market cap
 * @param {number} limit
 */
export async function fetchTopCoins(limit = 10) {
  const key = `top_${limit}`;
  try {
    return await apiFetch(
      `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      key, true
    );
  } catch {
    const stale = cacheGet(key, true);
    return stale || [];
  }
}

/**
 * Fear & Greed index from Alternative.me
 */
export async function fetchFearGreed() {
  try {
    return await apiFetch('https://api.alternative.me/fng/?limit=1', 'fear_greed', true);
  } catch {
    const stale = cacheGet('fear_greed', true);
    return stale || { data: [{ value: '50', value_classification: 'Neutral' }] };
  }
}

/* ------------------------------------------------------------------ */
/* Binance Endpoints                                                    */
/* ------------------------------------------------------------------ */

/**
 * Live price from Binance
 * @param {string} symbol  e.g. "BTC"
 */
export async function fetchBinancePrice(symbol) {
  const key = `binance_price_${symbol}`;
  try {
    return await apiFetch(
      `${BINANCE_BASE}/ticker/price?symbol=${symbol.toUpperCase()}USDT`,
      key, true
    );
  } catch {
    return null;
  }
}

/**
 * Kline/Candlestick data from Binance
 * @param {string} symbol    e.g. "BTC"
 * @param {string} interval  e.g. "1h", "4h", "1d"
 * @param {number} limit
 */
export async function fetchBinanceKlines(symbol, interval = '1d', limit = 30) {
  const key = `binance_klines_${symbol}_${interval}_${limit}`;
  try {
    return await apiFetch(
      `${BINANCE_BASE}/klines?symbol=${symbol.toUpperCase()}USDT&interval=${interval}&limit=${limit}`,
      key, true
    );
  } catch {
    const stale = cacheGet(key, true);
    return stale || [];
  }
}

/**
 * Lightweight simple price endpoint from CoinGecko
 * @param {string|string[]} coinIds
 */
export async function fetchCoinGeckoSimplePrice(coinIds) {
  const ids = Array.isArray(coinIds) ? coinIds.join(',') : coinIds;
  const key = `simple_price_${ids}`;
  try {
    return await apiFetch(
      `${CG_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
      key, true
    );
  } catch {
    const stale = cacheGet(key, true);
    return stale || {};
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attempt to get the most accurate current price for a coin.
 * Tries Binance first (more real-time), then CoinGecko simple price,
 * then falls back to full CoinGecko market data.
 * @param {string} coinId     CoinGecko id (e.g. "bitcoin")
 * @param {string} symbol     Ticker symbol (e.g. "BTC")
 * @returns {Promise<number>}
 */
export async function fetchCurrentPrice(coinId, symbol) {
  try {
    const b = await fetchBinancePrice(symbol);
    if (b && b.price) return parseFloat(b.price);
  } catch (_) { /* fall through */ }
  try {
    const simple = await fetchCoinGeckoSimplePrice([coinId]);
    if (simple && simple[coinId]) return simple[coinId].usd;
  } catch (_) { /* fall through */ }
  const market = await fetchMarketData(coinId);
  return market?.market_data?.current_price?.usd ?? 0;
}

/* ------------------------------------------------------------------ */
/* Binance WebSocket Live Feed                                          */
/* ------------------------------------------------------------------ */

/**
 * Open a Binance WebSocket ticker stream and call onUpdate on each tick.
 * @param {string} symbol  Ticker symbol (e.g. "BTC")
 * @param {function} onUpdate  Called with { price, change24h, volume24h, high24h, low24h, timestamp } or null on error
 */
export function startBinanceWS(symbol, onUpdate) {
  stopBinanceWS();
  const stream = `${symbol.toLowerCase()}usdt@ticker`;
  try {
    _ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
    _ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        onUpdate({
          price:     parseFloat(d.c),
          change24h: parseFloat(d.P),
          volume24h: parseFloat(d.v),
          high24h:   parseFloat(d.h),
          low24h:    parseFloat(d.l),
          timestamp: Date.now()
        });
      } catch (_) { /* ignore parse errors */ }
    };
    _ws.onerror = () => { onUpdate(null); };
    _ws.onclose = () => { _ws = null; };
  } catch {
    onUpdate(null);
  }
}

/**
 * Close the active Binance WebSocket connection, if any.
 */
export function stopBinanceWS() {
  if (_ws) {
    try { _ws.close(); } catch (_) { /* ignore */ }
    _ws = null;
  }
}

/**
 * Clear all cached entries (useful for manual refresh)
 */
export function clearCache() {
  _cache.clear();
}
