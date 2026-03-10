/**
 * api.js — Multi-API Data Layer
 * CoinGecko, Binance, Alternative.me — all free, no key required
 * Includes retry + exponential backoff, CORS proxy fallback,
 * stale-while-revalidate, and Binance WebSocket live feed.
 */

'use strict';

import { showToast } from './utils.js';

/* ------------------------------------------------------------------ */
/* Cache                                                                */
/* ------------------------------------------------------------------ */
const CACHE_TTL_PRICE   = 5_000;    // 5 seconds (prices — WS is primary)
const CACHE_TTL_DEFAULT = 30_000;   // 30 seconds
const CACHE_TTL_LIST    = 300_000;  // 5 minutes  (coin list)
const _cache = new Map();

function cacheGet(key, maxAge = CACHE_TTL_DEFAULT) {
  if (!_cache.has(key)) return null;
  const entry = _cache.get(key);
  if (Date.now() - entry.ts > maxAge) return null; // expired but keep for stale
  return entry.data;
}

/** Returns stale data even if expired (for stale-while-revalidate) */
function cacheGetStale(key) {
  if (!_cache.has(key)) return null;
  return _cache.get(key).data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Retry with exponential backoff                                       */
/* ------------------------------------------------------------------ */
async function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch with up to `retries` attempts, doubling delay each time.
 * @param {string}   url
 * @param {number}   retries
 * @param {number}   baseDelay  ms
 */
async function _fetchWithRetry(url, retries = 3, baseDelay = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await _sleep(baseDelay * (2 ** attempt));
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* CORS proxy fallback chain                                            */
/* ------------------------------------------------------------------ */
const PROXIES = [
  '',                              // direct (no proxy)
  'https://api.allorigins.win/get?url=',
  'https://corsproxy.io/?'
];

/**
 * Try a URL directly, then via each proxy in order.
 * Proxies that wrap the body in JSON need unwrapping (allorigins).
 */
async function _fetchWithProxyFallback(url) {
  for (const proxy of PROXIES) {
    try {
      if (proxy === '') {
        return await _fetchWithRetry(url);
      }
      const proxyUrl = proxy + encodeURIComponent(url);
      const raw = await _fetchWithRetry(proxyUrl, 2, 500);
      // allorigins wraps the response in { contents: "..." }
      if (proxy.includes('allorigins') && typeof raw.contents === 'string') {
        return JSON.parse(raw.contents);
      }
      return raw;
    } catch (_) {
      // try next proxy
    }
  }
  throw new Error(`All proxy attempts failed for ${url}`);
}

/* ------------------------------------------------------------------ */
/* Generic fetch wrapper (cache → fetch → stale fallback)             */
/* ------------------------------------------------------------------ */
async function apiFetch(url, cacheKey = null, ttl = CACHE_TTL_DEFAULT) {
  if (cacheKey) {
    const fresh = cacheGet(cacheKey, ttl);
    if (fresh !== null) return fresh;
  }

  try {
    const data = await _fetchWithProxyFallback(url);
    if (cacheKey) cacheSet(cacheKey, data);
    return data;
  } catch (err) {
    // Stale-while-revalidate: return expired cache with _stale flag
    if (cacheKey) {
      const stale = cacheGetStale(cacheKey);
      if (stale !== null) {
        return { ...stale, _stale: true };
      }
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* CoinGecko Endpoints                                                  */
/* ------------------------------------------------------------------ */

const CG_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Fetch full coin list (id, symbol, name) — cached 5 min
 */
export async function fetchCoinList() {
  const key = 'coin_list';
  const c = _cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL_LIST) return c.data;

  try {
    const data = await _fetchWithProxyFallback(`${CG_BASE}/coins/list`);
    _cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    const stale = cacheGetStale(key);
    if (stale) return stale;
    return [];
  }
}

/**
 * Full market + metadata for a coin — with stale fallback
 */
export async function fetchMarketData(coinId) {
  const key = `market_${coinId}`;
  try {
    const data = await apiFetch(
      `${CG_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      key
    );
    if (data && data._stale) {
      showToast(`⚠️ Showing cached data for ${coinId}`, 'info');
    }
    return data;
  } catch (err) {
    showToast(`Market data unavailable for ${coinId}`, 'error');
    return null;
  }
}

/**
 * Lightweight simple price endpoint — less rate-limited than /coins/{id}
 * @param {string[]} coinIds  e.g. ['bitcoin','ethereum','solana']
 * @returns {Object}  { bitcoin: { usd: 50000, usd_24h_change: 1.2 }, ... }
 */
export async function fetchCoinGeckoSimplePrice(coinIds) {
  const ids = coinIds.join(',');
  const key = `simple_price_${ids}`;
  try {
    return await apiFetch(
      `${CG_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      key,
      CACHE_TTL_PRICE
    );
  } catch (err) {
    const stale = cacheGetStale(key);
    if (stale) return { ...stale, _stale: true };
    return null;
  }
}

/**
 * Historical OHLCV prices from CoinGecko — with proxy fallback + stale
 */
export async function fetchHistoricalPrices(coinId, days = 30) {
  const key = `history_${coinId}_${days}`;
  try {
    return await apiFetch(
      `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      key
    );
  } catch (err) {
    const stale = cacheGetStale(key);
    if (stale) {
      showToast('⚠️ Showing cached chart data', 'info');
      return { ...stale, _stale: true };
    }
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
    const stale = cacheGetStale('trending');
    if (stale) return stale;
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
    const stale = cacheGetStale(key);
    if (stale) return stale;
    return null; // signal failure so caller can try simplePrice fallback
  }
}

/**
 * Fear & Greed index from Alternative.me
 */
export async function fetchFearGreed() {
  try {
    return await apiFetch('https://api.alternative.me/fng/', 'fear_greed');
  } catch (err) {
    const stale = cacheGetStale('fear_greed');
    if (stale) return stale;
    return { data: [{ value: '50', value_classification: 'Neutral' }] };
  }
}

/* ------------------------------------------------------------------ */
/* Binance REST Endpoints                                               */
/* ------------------------------------------------------------------ */

const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * Live price from Binance REST (very generous rate limits)
 * @param {string} symbol  e.g. "BTC"
 */
export async function fetchBinancePrice(symbol) {
  const key = `binance_price_${symbol}`;
  try {
    const data = await apiFetch(
      `${BINANCE_BASE}/ticker/price?symbol=${symbol.toUpperCase()}USDT`,
      key,
      CACHE_TTL_PRICE
    );
    return data;
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
/* Binance WebSocket Live Feed                                          */
/* ------------------------------------------------------------------ */

let _ws = null;

/**
 * Open a Binance WebSocket stream for real-time ticker updates.
 * Calls onUpdate({ price, change24h, volume24h, high24h, low24h, timestamp })
 * on every message. Passes null on error.
 * @param {string}   symbol    e.g. "BTC"
 * @param {Function} onUpdate  callback
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
    _ws.onerror = () => onUpdate(null);
    _ws.onclose = () => { _ws = null; };
  } catch (err) {
    onUpdate(null);
  }
}

/**
 * Close the Binance WebSocket connection.
 */
export function stopBinanceWS() {
  if (_ws) {
    _ws.close();
    _ws = null;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attempt to get the most accurate current price for a coin.
 * Priority: Binance REST → CoinGecko simple → CoinGecko market data
 * @param {string} coinId  CoinGecko id
 * @param {string} symbol  Ticker symbol e.g. "BTC"
 * @returns {Promise<number>}
 */
export async function fetchCurrentPrice(coinId, symbol) {
  // 1. Try Binance REST
  try {
    const b = await fetchBinancePrice(symbol);
    if (b && b.price) return parseFloat(b.price);
  } catch (_) { /* fall through */ }

  // 2. Try CoinGecko simple/price (lighter endpoint)
  try {
    const sp = await fetchCoinGeckoSimplePrice([coinId]);
    if (sp && sp[coinId]?.usd) return sp[coinId].usd;
  } catch (_) { /* fall through */ }

  // 3. Fallback to full CoinGecko market data
  const market = await fetchMarketData(coinId);
  return market?.market_data?.current_price?.usd ?? 0;
}

/**
 * Clear all cached entries (useful for manual refresh)
 */
export function clearCache() {
  _cache.clear();
}
