/**
 * api.js — Multi-API Data Layer
 * CoinGecko, Binance, Alternative.me — all free, no key required
 * Includes in-memory caching (30 s TTL) and fallback handling
 */

'use strict';

import { showToast } from './utils.js';

/* ------------------------------------------------------------------ */
/* Cache                                                                */
/* ------------------------------------------------------------------ */
const CACHE_TTL = 30_000; // 30 seconds
const _cache = new Map();

function cacheGet(key) {
  if (!_cache.has(key)) return null;
  const { data, ts } = _cache.get(key);
  if (Date.now() - ts > CACHE_TTL) { _cache.delete(key); return null; }
  return data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Generic fetch wrapper                                                */
/* ------------------------------------------------------------------ */
async function apiFetch(url, cacheKey = null) {
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached !== null) return cached;
  }

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${url}`);
  const data = await res.json();

  if (cacheKey) cacheSet(cacheKey, data);
  return data;
}

/* ------------------------------------------------------------------ */
/* CoinGecko Endpoints                                                  */
/* ------------------------------------------------------------------ */

const CG_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Fetch full coin list (id, symbol, name)
 * Heavy – cached longer (5 min)
 */
export async function fetchCoinList() {
  const key = 'coin_list';
  const c = _cache.get(key);
  if (c && Date.now() - c.ts < 300_000) return c.data; // 5 min cache

  try {
    const data = await apiFetch(`${CG_BASE}/coins/list`, null);
    _cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    showToast('Could not load coin list', 'error');
    return [];
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
      key
    );
  } catch (err) {
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
      key
    );
  } catch (err) {
    showToast(`Historical data unavailable for ${coinId}`, 'error');
    return { prices: [], market_caps: [], total_volumes: [] };
  }
}

/**
 * Trending coins
 */
export async function fetchTrending() {
  try {
    return await apiFetch(`${CG_BASE}/search/trending`, 'trending');
  } catch (err) {
    showToast('Trending data unavailable', 'error');
    return { coins: [] };
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
      key
    );
  } catch (err) {
    showToast('Top coins data unavailable', 'error');
    return [];
  }
}

/**
 * Fear & Greed index from Alternative.me
 */
export async function fetchFearGreed() {
  try {
    return await apiFetch('https://api.alternative.me/fng/', 'fear_greed');
  } catch (err) {
    // Silent fail – not critical
    return { data: [{ value: '50', value_classification: 'Neutral' }] };
  }
}

/* ------------------------------------------------------------------ */
/* Binance Endpoints                                                    */
/* ------------------------------------------------------------------ */

const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * Live price from Binance
 * @param {string} symbol  e.g. "BTC"
 */
export async function fetchBinancePrice(symbol) {
  const key = `binance_price_${symbol}`;
  try {
    return await apiFetch(
      `${BINANCE_BASE}/ticker/price?symbol=${symbol.toUpperCase()}USDT`,
      key
    );
  } catch (err) {
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
      key
    );
  } catch (err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attempt to get the most accurate current price for a coin
 * Tries Binance first (more real-time), falls back to CoinGecko market data
 * @param {string} coinId     CoinGecko id (e.g. "bitcoin")
 * @param {string} symbol     Ticker symbol (e.g. "BTC")
 * @returns {Promise<number>}
 */
export async function fetchCurrentPrice(coinId, symbol) {
  // Try Binance first
  try {
    const b = await fetchBinancePrice(symbol);
    if (b && b.price) return parseFloat(b.price);
  } catch (_) { /* fall through */ }

  // Fallback to CoinGecko
  const market = await fetchMarketData(coinId);
  return market?.market_data?.current_price?.usd ?? 0;
}

/**
 * Clear all cached entries (useful for manual refresh)
 */
export function clearCache() {
  _cache.clear();
}
