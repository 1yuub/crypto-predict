/**
 * prediction.js — Client-Side AI Prediction Engine
 * LSTM-inspired: weighted linear regression + MA extrapolation
 */

'use strict';

import { clamp } from './utils.js';

/* ------------------------------------------------------------------ */
/* Core prediction                                                      */
/* ------------------------------------------------------------------ */

/**
 * Predict future prices using weighted linear regression
 * @param {number[]} historicalPrices  Flat array of closing prices (oldest → newest)
 * @param {number}   steps             How many steps forward to predict
 * @returns {{ prices: number[], confidence: number }}
 */
export function predictPrices(historicalPrices, steps = 7) {
  if (!historicalPrices || historicalPrices.length < 5) {
    return { prices: [], confidence: 0 };
  }

  const prices = historicalPrices.slice(-90); // cap at 90 data points
  const n      = prices.length;

  // Normalize prices to [0, 1]
  const minP  = Math.min(...prices);
  const maxP  = Math.max(...prices);
  const range = maxP - minP || 1;
  const norm  = prices.map(p => (p - minP) / range);

  // Weighted linear regression (exponential weights — recent data matters more)
  const lambda = 0.05;
  let wx = 0, wy = 0, wxy = 0, wxx = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(lambda * i); // recent = higher weight
    wx  += w * i;
    wy  += w * norm[i];
    wxy += w * i * norm[i];
    wxx += w * i * i;
    sw  += w;
  }
  const slope    = (sw * wxy - wx * wy) / (sw * wxx - wx * wx);
  const intercept = (wy - slope * wx) / sw;

  // Calculate R² for confidence
  const yMean = wy / sw;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const w    = Math.exp(lambda * i);
    const yHat = intercept + slope * i;
    ssTot += w * (norm[i] - yMean) ** 2;
    ssRes += w * (norm[i] - yHat) ** 2;
  }
  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;

  // Trend velocity & acceleration (last 7 vs last 14)
  const recent  = prices.slice(-7);
  const older   = prices.slice(-14, -7);
  const vRecent = recent.length > 1  ? (recent[recent.length - 1]  - recent[0])  / recent.length  : 0;
  const vOlder  = older.length  > 1  ? (older[older.length - 1]   - older[0])   / older.length   : 0;
  const accel   = (vRecent - vOlder) / 7;

  // Project future prices
  const lastNorm  = norm[n - 1];
  const lastPrice = prices[n - 1];
  const predicted = [];
  let   decayConf = 1;

  for (let s = 1; s <= steps; s++) {
    // Regression component
    const regNorm  = intercept + slope * (n - 1 + s);
    // Trend momentum component (decays)
    const momentum = (vRecent / (maxP - minP || 1)) * s * Math.exp(-0.15 * s);
    // Blended normalized prediction
    const blended  = lastNorm + (regNorm - lastNorm) * 0.7 + momentum * 0.3;
    // De-normalize
    const p        = blended * range + minP;
    // Soft decay towards last known price for distant predictions
    decayConf     *= (0.97 - 0.01 * s);
    const final    = lastPrice + (p - lastPrice) * clamp(decayConf, 0.1, 1);
    predicted.push(Math.max(0, final));
  }

  // Compute overall confidence score
  const conf = confidenceScore(prices, [], r2);

  return { prices: predicted, confidence: conf };
}

/* ------------------------------------------------------------------ */
/* Technical Indicators                                                 */
/* ------------------------------------------------------------------ */

/**
 * Relative Strength Index
 * @param {number[]} prices
 * @param {number}   period
 * @returns {number[]}
 */
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return [];
  const rsi = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else          avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs0));

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

/**
 * MACD (12, 26, 9)
 * @param {number[]} prices
 * @returns {{ macd: number[], signal: number[], histogram: number[] }}
 */
export function calculateMACD(prices) {
  const ema12   = _ema(prices, 12);
  const ema26   = _ema(prices, 26);
  const minLen  = Math.min(ema12.length, ema26.length);
  const offset12 = ema12.length - minLen;
  const offset26 = ema26.length - minLen;

  const macd    = [];
  for (let i = 0; i < minLen; i++) {
    macd.push(ema12[i + offset12] - ema26[i + offset26]);
  }

  const signal    = _ema(macd, 9);
  const sigOffset = macd.length - signal.length;
  const histogram = signal.map((s, i) => macd[i + sigOffset] - s);

  return { macd, signal, histogram };
}

/**
 * Simple Moving Average
 * @param {number[]} prices
 * @param {number}   period
 * @returns {number[]}
 */
export function calculateMovingAverage(prices, period) {
  if (prices.length < period) return [];
  const ma = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    ma.push(sum / period);
  }
  return ma;
}

/**
 * Historical volatility (standard deviation of log returns)
 * @param {number[]} prices
 * @returns {number}  0–1
 */
export function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  const logReturns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }
  if (!logReturns.length) return 0;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance);
}

/* ------------------------------------------------------------------ */
/* Signal Generation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Generate BUY / HOLD / SELL signal based on technical indicators
 * @param {number} rsi
 * @param {{ histogram: number[] }} macd
 * @param {number} price
 * @param {number} ma7
 * @param {number} ma25
 * @returns {'BUY'|'HOLD'|'SELL'}
 */
export function generateSignal(rsi, macd, price, ma7, ma25) {
  let score = 0; // positive = bullish, negative = bearish

  // RSI signals
  if (rsi < 30)      score += 2;  // oversold — bullish
  else if (rsi < 45) score += 1;
  else if (rsi > 70) score -= 2;  // overbought — bearish
  else if (rsi > 60) score -= 1;

  // MACD histogram direction
  const hist = macd?.histogram ?? [];
  if (hist.length >= 2) {
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    if (last > 0 && last > prev) score += 1;  // expanding bullish
    if (last < 0 && last < prev) score -= 1;  // expanding bearish
    if (last > 0 && prev < 0)    score += 2;  // crossover up
    if (last < 0 && prev > 0)    score -= 2;  // crossover down
  }

  // Price vs MAs
  if (price > ma7  && ma7  > 0) score += 1;
  if (price > ma25 && ma25 > 0) score += 1;
  if (price < ma7  && ma7  > 0) score -= 1;
  if (price < ma25 && ma25 > 0) score -= 1;
  if (ma7 > ma25   && ma25 > 0) score += 1;  // golden cross
  if (ma7 < ma25   && ma25 > 0) score -= 1;  // death cross

  if (score >=  3) return 'BUY';
  if (score <= -3) return 'SELL';
  return 'HOLD';
}

/* ------------------------------------------------------------------ */
/* Confidence Scoring                                                   */
/* ------------------------------------------------------------------ */

/**
 * Overall confidence score 0–100
 * @param {number[]} prices
 * @param {number[]} volumes  (optional)
 * @param {number}   r2       R² from regression (optional)
 * @returns {number}
 */
export function confidenceScore(prices, volumes = [], r2 = null) {
  if (!prices || prices.length < 5) return 0;

  let score = 50; // baseline

  // R² component (if provided)
  if (r2 !== null) score += (r2 * 25) - 12.5; // ±12.5 points

  // Volatility penalty: high volatility = lower confidence
  const vol = calculateVolatility(prices);
  score -= clamp(vol * 300, 0, 20);

  // Trend consistency: how many of the last 10 moves align with trend
  const recent = prices.slice(-10);
  if (recent.length >= 3) {
    const direction = recent[recent.length - 1] > recent[0] ? 1 : -1;
    let aligned = 0;
    for (let i = 1; i < recent.length; i++) {
      if ((recent[i] - recent[i - 1]) * direction > 0) aligned++;
    }
    score += ((aligned / (recent.length - 1)) - 0.5) * 20;
  }

  // RSI extremes can boost confidence in reversal
  const rsiArr = calculateRSI(prices);
  if (rsiArr.length) {
    const lastRSI = rsiArr[rsiArr.length - 1];
    if (lastRSI < 25 || lastRSI > 75) score += 5; // extreme signals are clear
  }

  // Volume trend (if provided)
  if (volumes && volumes.length >= 5) {
    const volRecent = volumes.slice(-5);
    const volOlder  = volumes.slice(-10, -5);
    if (volOlder.length) {
      const avgRecent = volRecent.reduce((a, b) => a + b, 0) / volRecent.length;
      const avgOlder  = volOlder.reduce((a, b)  => a + b, 0) / volOlder.length;
      if (avgRecent > avgOlder * 1.2) score += 5; // rising volume
    }
  }

  return Math.round(clamp(score, 10, 95));
}

/* ------------------------------------------------------------------ */
/* Internal Helpers                                                     */
/* ------------------------------------------------------------------ */

function _ema(data, period) {
  if (data.length < period) return [];
  const k   = 2 / (period + 1);
  const ema = [data.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}
