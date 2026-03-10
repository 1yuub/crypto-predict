/**
 * utils.js — Shared utility functions
 * Crypto Predict Platform
 */

'use strict';

/**
 * Format a price value with appropriate precision and $ prefix
 * @param {number} value
 * @returns {string}
 */
export function formatPrice(value) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  if (value === 0) return '$0.00';
  if (value >= 1000) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (value >= 0.01) {
    return '$' + value.toFixed(4);
  }
  if (value >= 0.000001) {
    return '$' + value.toFixed(6);
  }
  return '$' + value.toExponential(4);
}

/**
 * Format large numbers as K / M / B
 * @param {number} value
 * @returns {string}
 */
export function formatLargeNumber(value) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  if (value >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9)  return '$' + (value / 1e9 ).toFixed(2) + 'B';
  if (value >= 1e6)  return '$' + (value / 1e6 ).toFixed(2) + 'M';
  if (value >= 1e3)  return '$' + (value / 1e3 ).toFixed(2) + 'K';
  return '$' + value.toFixed(2);
}

/**
 * Format percent change with color class
 * @param {number} value
 * @returns {{ text: string, cls: string }}
 */
export function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return { text: 'N/A', cls: '' };
  const abs = Math.abs(value).toFixed(2);
  const sign = value >= 0 ? '+' : '-';
  return {
    text: `${sign}${abs}%`,
    cls:  value >= 0 ? 'text-green' : 'text-red'
  };
}

/**
 * Copy text to clipboard (async API with execCommand fallback)
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* fall through */ }
  }
  // Fallback
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

/**
 * Show animated toast notification
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration ms
 */
export function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

/**
 * Standard debounce
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Return human-readable time ago string
 * @param {number|string|Date} timestamp
 * @returns {string}
 */
export function timeAgo(timestamp) {
  const now = Date.now();
  const ts  = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = Math.floor((now - ts) / 1000);

  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Generate a QR code into a DOM element using qrcode.js CDN global
 * @param {string} elementId  Target element id (canvas or div)
 * @param {string} text       Data to encode
 */
export function generateQRCode(elementId, text) {
  const el = document.getElementById(elementId);
  if (!el) return;

  // Clear previous content
  el.innerHTML = '';

  if (typeof QRCode !== 'undefined') {
    new QRCode(el, {
      text,
      width:         200,
      height:        200,
      colorDark:     '#00f5ff',
      colorLight:    '#0a0a0f',
      correctLevel:  QRCode.CorrectLevel.H
    });
  } else {
    // Fallback: show text if QRCode lib not loaded
    el.textContent = text;
    el.style.fontFamily = 'monospace';
    el.style.fontSize   = '0.7rem';
    el.style.wordBreak  = 'break-all';
    el.style.color      = '#22c55e';
  }
}

/**
 * Abbreviate large numbers without $ prefix
 * @param {number} value
 * @returns {string}
 */
export function abbreviateNumber(value) {
  if (!value && value !== 0) return 'N/A';
  if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9)  return (value / 1e9 ).toFixed(2) + 'B';
  if (value >= 1e6)  return (value / 1e6 ).toFixed(2) + 'M';
  if (value >= 1e3)  return (value / 1e3 ).toFixed(2) + 'K';
  return value.toLocaleString();
}

/**
 * Clamp a number between min and max
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Safely parse a float, returning 0 on failure
 */
export function safeFloat(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Format a date to locale short string
 * @param {number} timestamp  Unix ms
 * @returns {string}
 */
export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
