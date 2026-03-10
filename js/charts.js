/**
 * charts.js — Chart.js rendering helpers
 * Requires Chart.js 4.x loaded via CDN (global `Chart`)
 */

'use strict';

import { formatPrice, formatDate } from './utils.js';

/* ------------------------------------------------------------------ */
/* Theme constants matching CSS variables                               */
/* ------------------------------------------------------------------ */
const CYAN   = '#00f5ff';
const PURPLE = '#a855f7';
const GREEN  = '#22c55e';
const RED    = '#ef4444';
const YELLOW = '#eab308';
const BG     = '#111827';
const GRID   = 'rgba(255,255,255,0.06)';
const TEXT   = '#94a3b8';

/** Shared Chart.js defaults for the dark theme */
function _darkDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e293b',
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(0,245,255,0.2)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: ctx => ` ${formatPrice(ctx.parsed.y)}`
        }
      }
    },
    scales: {
      x: {
        grid:   { color: GRID },
        ticks:  { color: TEXT, maxRotation: 0, maxTicksLimit: 8 }
      },
      y: {
        grid:   { color: GRID },
        ticks:  { color: TEXT, callback: v => formatPrice(v) }
      }
    }
  };
}

/** Map to store chart instances keyed by canvasId */
const _charts = {};

function _destroy(canvasId) {
  if (_charts[canvasId]) {
    _charts[canvasId].destroy();
    delete _charts[canvasId];
  }
}

function _store(canvasId, chart) {
  _charts[canvasId] = chart;
  return chart;
}

/* ------------------------------------------------------------------ */
/* 1. Price + Prediction Overlay Chart                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {string}   canvasId
 * @param {{ labels: string[], prices: number[] }} historicalData
 * @param {number[]} predictedData  Array of future prices
 */
export function renderPriceChart(canvasId, historicalData, predictedData = []) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const { labels, prices } = historicalData;
  const N = prices.length;

  // Build future labels: Day+1, Day+2, … Day+7 (up to predictedData.length)
  const futureLabels = predictedData.map((_, i) => `Day+${i + 1}`);

  const allLabels = [...labels, ...futureLabels];

  // Historical dataset: N prices + nulls for future slots
  const histData = [...prices, ...Array(futureLabels.length).fill(null)];

  // Prediction dataset: (N-1) nulls, then last historical price as connection point, then predictions
  const predData = [
    ...Array(N - 1).fill(null),
    prices[N - 1], // connect at last historical point
    ...predictedData
  ];

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Historical',
          data:  histData,
          borderColor:     CYAN,
          borderWidth:     2,
          pointRadius:     0,
          pointHoverRadius:4,
          tension:         0.3,
          fill: true,
          backgroundColor: (context) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, context.chart.height);
            gradient.addColorStop(0, 'rgba(0,245,255,0.15)');
            gradient.addColorStop(1, 'rgba(0,245,255,0.0)');
            return gradient;
          }
        },
        {
          label: 'Predicted',
          data:  predData,
          borderColor:  PURPLE,
          borderWidth:  2,
          borderDash:   [6, 4],
          pointRadius:  0,
          pointHoverRadius: 4,
          tension:      0.3,
          fill: false
        }
      ]
    },
    options: {
      ..._darkDefaults(),
      plugins: {
        ..._darkDefaults().plugins,
        tooltip: {
          ..._darkDefaults().plugins.tooltip,
          callbacks: {
            title: items => items[0].label,
            label: ctx  => {
              if (ctx.parsed.y === null) return null;
              return ` ${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}`;
            }
          }
        }
      }
    }
  });

  return _store(canvasId, chart);
}

/* ------------------------------------------------------------------ */
/* 2. Volume Bar Chart                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {string}   canvasId
 * @param {{ labels: string[], volumes: number[], prices: number[] }} volumeData
 */
export function renderVolumeChart(canvasId, volumeData) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const { labels, volumes, prices } = volumeData;

  // Green bar if price went up on that day, red otherwise
  const barColors = prices.map((p, i) => {
    const prev = i > 0 ? prices[i - 1] : p;
    return p >= prev ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';
  });

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Volume',
        data:  volumes,
        backgroundColor: barColors,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v >= 1e9) return ` $${(v/1e9).toFixed(2)}B`;
              if (v >= 1e6) return ` $${(v/1e6).toFixed(2)}M`;
              return ` $${v.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: TEXT, maxRotation: 0, maxTicksLimit: 8 } },
        y: {
          grid: { color: GRID },
          ticks: {
            color: TEXT,
            callback: v => {
              if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
              if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
              return `$${v}`;
            }
          }
        }
      }
    }
  });

  return _store(canvasId, chart);
}

/* ------------------------------------------------------------------ */
/* 3. RSI Chart                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {string}   canvasId
 * @param {{ labels: string[], rsi: number[] }} rsiData
 */
export function renderRSIChart(canvasId, rsiData) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const { labels, rsi } = rsiData;

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'RSI',
          data:  rsi,
          borderColor:  CYAN,
          borderWidth:  2,
          pointRadius:  0,
          tension:      0.3,
          fill: false
        },
        {
          label: 'Overbought (70)',
          data:  Array(labels.length).fill(70),
          borderColor: 'rgba(239,68,68,0.5)',
          borderWidth: 1,
          borderDash:  [4, 4],
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Oversold (30)',
          data:  Array(labels.length).fill(30),
          borderColor: 'rgba(34,197,94,0.5)',
          borderWidth: 1,
          borderDash:  [4, 4],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8' } },
      scales: {
        x: { grid: { display: false }, ticks: { color: TEXT, maxRotation: 0, maxTicksLimit: 8 } },
        y: {
          min: 0, max: 100,
          grid: { color: GRID },
          ticks: { color: TEXT }
        }
      }
    }
  });

  return _store(canvasId, chart);
}

/* ------------------------------------------------------------------ */
/* 4. Moving Average Overlay Chart                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {number[]} prices  Raw closing prices
 * @param {number[]} ma7
 * @param {number[]} ma25
 * @param {number[]} ma99
 */
export function renderMAChart(canvasId, labels, prices, ma7, ma25, ma99) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Align arrays to same length as prices
  const n = prices.length;
  function pad(arr) {
    const padded = Array(n).fill(null);
    const offset = n - arr.length;
    arr.forEach((v, i) => { if (i + offset >= 0) padded[i + offset] = v; });
    return padded;
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Price', data: prices,    borderColor: CYAN,   borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
        { label: 'MA7',   data: pad(ma7),  borderColor: GREEN,  borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, borderDash: [] },
        { label: 'MA25',  data: pad(ma25), borderColor: YELLOW, borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, borderDash: [3,3] },
        { label: 'MA99',  data: pad(ma99), borderColor: PURPLE, borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, borderDash: [6,3] }
      ]
    },
    options: {
      ..._darkDefaults(),
      plugins: {
        ..._darkDefaults().plugins,
        legend: {
          display: true,
          labels: { color: TEXT, boxWidth: 12, padding: 12 }
        }
      }
    }
  });

  return _store(canvasId, chart);
}

/* ------------------------------------------------------------------ */
/* Destroy a specific chart instance                                    */
/* ------------------------------------------------------------------ */
export function destroyChart(canvasId) {
  _destroy(canvasId);
}

/* ------------------------------------------------------------------ */
/* 5. Append a live price point to an existing chart                   */
/* ------------------------------------------------------------------ */

/**
 * Append a single price point to a live chart without full re-render.
 * @param {string} canvasId
 * @param {number} price
 * @param {string} label
 */
export function appendLivePricePoint(canvasId, price, label) {
  const chart = _charts[canvasId];
  if (!chart) return;
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(price);
  // Keep max 120 points for live chart
  if (chart.data.labels.length > 120) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none'); // no animation for speed
}

/* ------------------------------------------------------------------ */
/* 6. Live real-time price stream chart                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a lightweight real-time chart for the Binance WebSocket stream.
 * @param {string} canvasId
 */
export function renderLiveChart(canvasId) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  _destroy(canvasId);
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Live Price',
        data: [],
        borderColor: '#00f5ff',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
  _charts[canvasId] = chart;
}
