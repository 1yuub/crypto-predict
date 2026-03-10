/**
 * sentiment.js — Sentiment & Social Data Helpers
 * Uses Fear & Greed index and simulated social metrics
 * (Free APIs only — LunarCrush/Santiment require keys, so we simulate)
 */

'use strict';

import { fetchFearGreed } from './api.js';

/**
 * Fetch and return a structured fear & greed object
 * @returns {Promise<{ value: number, label: string, color: string }>}
 */
export async function getFearGreedIndex() {
  const data = await fetchFearGreed();
  const entry = (data?.data ?? [{ value: '50', value_classification: 'Neutral' }])[0];
  const value = parseInt(entry.value, 10);

  let color;
  if (value <= 25)      color = '#ef4444'; // Extreme Fear
  else if (value <= 45) color = '#f97316'; // Fear
  else if (value <= 55) color = '#eab308'; // Neutral
  else if (value <= 75) color = '#84cc16'; // Greed
  else                  color = '#22c55e'; // Extreme Greed

  return {
    value,
    label: entry.value_classification,
    color
  };
}

/**
 * Render the Fear & Greed widget into a container element
 * @param {string} containerId
 */
export async function renderFearGreedWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="skeleton skeleton-box" style="height:100px"></div>';

  const fg = await getFearGreedIndex();

  container.innerHTML = `
    <div class="fear-greed-widget">
      <div class="fear-greed-value" style="color:${fg.color}">${fg.value}</div>
      <div class="fear-greed-label" style="color:${fg.color}">${fg.label}</div>
      <div class="fear-greed-bar">
        <div class="fear-greed-indicator" style="left:${fg.value}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-muted);margin-top:0.25rem">
        <span>Fear</span><span>Neutral</span><span>Greed</span>
      </div>
    </div>
  `;
}

/**
 * Generate a simulated sentiment score based on RSI and price trend
 * @param {number} rsi
 * @param {number} priceChange24h  Percent
 * @returns {{ score: number, label: string, sentiment: 'bullish'|'bearish'|'neutral' }}
 */
export function computeSentiment(rsi, priceChange24h) {
  // Weighted blend
  let score = 50;
  if (rsi < 30)       score += 20;
  else if (rsi < 40)  score += 10;
  else if (rsi > 70)  score -= 20;
  else if (rsi > 60)  score -= 10;

  if (priceChange24h > 5)       score += 15;
  else if (priceChange24h > 2)  score += 7;
  else if (priceChange24h < -5) score -= 15;
  else if (priceChange24h < -2) score -= 7;

  score = Math.max(0, Math.min(100, score));

  let sentiment;
  let label;
  if (score >= 65)      { sentiment = 'bullish'; label = '🟢 Bullish'; }
  else if (score <= 35) { sentiment = 'bearish'; label = '🔴 Bearish'; }
  else                  { sentiment = 'neutral'; label = '🟡 Neutral'; }

  return { score, label, sentiment };
}
