// utils.js: small helpers used by every page.
import { t, getLang } from './i18n.js';

/** Escapes text before putting it into HTML, so names like "<b>" can't break the page. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(value) {
  const n = Number(value) || 0;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Money without cents, for big dashboard numbers. */
export function money0(value) {
  const n = Number(value) || 0;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** 0.1234 -> "12%" (or "12.3%" with decimals = 1). null -> "–". */
export function pct(value, decimals = 0) {
  if (value === null || value === undefined || isNaN(value)) return '–';
  return (value * 100).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
}

export function num(value, decimals = 0) {
  if (value === null || value === undefined || value === '' || isNaN(value)) return '–';
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "2026-10-28" -> "28 Oct 2026" (or "28 oct 2026" in Spanish). */
export function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(getLang() === 'es' ? 'es-CR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Today's date as YYYY-MM-DD on this device. */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Query string after the hash, e.g. #/history?sku=LB-CORAL */
export function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

/** Shows a short message at the bottom of the screen. */
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}

/**
 * Shows a spinner on a button while `task` runs and stops double clicks.
 * Returns whatever the task returns.
 */
export async function withLoading(button, task) {
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('loading');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
}

/** Builds an error box (shows the server's list of problems when there is one). */
export function errorBox(err) {
  const lines = err?.details?.lines || err?.details?.fields || err?.details?.errors;
  if (lines && lines.length > 1) {
    return `<div class="msg error" role="alert">${esc(t('common.fixThese'))}<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  }
  return `<div class="msg error" role="alert">${esc(err?.message || err)}</div>`;
}

export function loadingHtml() {
  return `<div class="loading-page">${esc(t('common.loading'))}</div>`;
}

// ---- CSV export ----
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** rows = array of objects; columns = [[key, header], ...]. Downloads a .csv file. */
export function downloadCSV(filename, rows, columns) {
  const lines = [columns.map((c) => csvCell(c[1])).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => csvCell(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(',')));
  // The BOM (﻿) makes Excel open accents like "Carmesí" correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Dialog (one shared <dialog> element) ----
/**
 * Opens a dialog. `body` is HTML. Returns the dialog element; call closeDialog() to close.
 * The footer buttons are given as HTML so each page can wire its own handlers.
 */
export function openDialog(title, body, footer = '') {
  const dlg = document.getElementById('dialog');
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${esc(title)}</h2>
      <button type="button" class="link" data-close aria-label="${esc(t('common.close'))}">✕</button></div>
    <div class="dialog-body">${body}</div>
    <div class="dialog-foot">${footer}</div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDialog));
  if (!dlg.open) dlg.showModal();
  return dlg;
}

export function closeDialog() {
  const dlg = document.getElementById('dialog');
  if (dlg.open) dlg.close();
}

/** Yes/no question in a dialog. Resolves true when the person confirms. */
export function confirmDialog(title, bodyHtml, confirmLabel) {
  return new Promise((resolve) => {
    const dlg = openDialog(title, bodyHtml,
      `<button type="button" class="secondary" data-close>${esc(t('common.cancel'))}</button>
       <button type="button" data-ok>${esc(confirmLabel || t('common.confirm'))}</button>`);
    let answered = false;
    dlg.querySelector('[data-ok]').addEventListener('click', () => { answered = true; closeDialog(); resolve(true); });
    dlg.addEventListener('close', () => { if (!answered) resolve(false); }, { once: true });
  });
}

// Status -> CSS class and translation key. Every badge shows text, never color alone.
const STATUS_STYLE = {
  'OUT': ['out', 'status.out'],
  'REORDER NOW': ['reorder', 'status.reorder'],
  'LOW': ['low', 'status.low'],
  'OK': ['ok', 'status.ok'],
  'INACTIVE': ['neutral', 'status.inactive']
};
export function statusBadge(status) {
  const [cls, key] = STATUS_STYLE[status] || ['neutral', status];
  return `<span class="badge ${cls}">${esc(t(key))}</span>`;
}

/** "12.5 days", "no recent sales" when there is no demand. */
export function coverText(row) {
  if (row.days_of_cover === null || row.days_of_cover === undefined) return t('fc.noRecentSales');
  return t('fc.days', { n: num(row.days_of_cover, row.days_of_cover < 10 ? 1 : 0) });
}

// ---- Dashboard tiles ----

/**
 * One KPI tile. `value` and `sub` lines are plain text (escaped here); `delta` and `spark` are
 * ready-made HTML from deltaBadge() / sparkSlot() / sparkline().
 */
export function tile({ label, value, sub = [], cls = '', delta = '', spark = '' }) {
  return `<div class="kpi ${cls}"><div class="label">${esc(label)}</div>
    <div class="value">${esc(value)}</div>${delta ? `<div class="delta-row">${delta}</div>` : ''}
    ${sub.filter(Boolean).map((line) => `<div class="sub">${esc(line)}</div>`).join('')}${spark && !spark.includes('spark-slot') ? `<div class="spark-slot">${spark}</div>` : spark}</div>`;
}

/** An empty spot in a tile that addSparklines() fills in once the monthly numbers arrive. */
export function sparkSlot(name) {
  return `<div class="spark-slot" data-spark="${esc(name)}"></div>`;
}

/** Tiny line chart (inline SVG) of a list of numbers; nulls are skipped. Empty if under 2 points. */
export function sparkline(values) {
  const points = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined && !isNaN(v));
  if (points.length < 2) return '';
  const w = 96, h = 28, pad = 3;
  const ys = points.map(([, v]) => v);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const path = points.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const [lastI, lastV] = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(lastI).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="2.2" fill="currentColor"/></svg>`;
}

/** Fills every [data-spark="name"] slot inside `root` from {name: [numbers]}. */
export function addSparklines(root, seriesByName) {
  root.querySelectorAll('[data-spark]').forEach((slot) => {
    const values = seriesByName[slot.dataset.spark];
    if (values) slot.innerHTML = sparkline(values);
  });
}

/**
 * "▲ 12%" or "▼ 0.4 pts" compared with before. good = 'up' | 'down' | null decides the color
 * (null = neutral gray). mode 'pts' is for rates that are already percentages.
 */
export function deltaBadge(current, previous, { good = 'up', mode = 'pct' } = {}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return '';
  let change;
  let label;
  if (mode === 'pts') {
    change = (current - previous) * 100;
    label = Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' pts';
    if (Math.abs(change) < 0.05) return `<span class="delta flat">${esc(t('kpi.same'))}</span>`;
  } else {
    if (!previous) return '';
    change = ((current - previous) / Math.abs(previous)) * 100;
    label = Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '%';
    if (Math.abs(change) < 0.5) return `<span class="delta flat">${esc(t('kpi.same'))}</span>`;
  }
  const up = change > 0;
  const cls = good === null ? 'flat' : up === (good === 'up') ? 'good' : 'bad';
  return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${label}</span>`;
}

/** Lookup helpers for bootstrap data. */
export function productMap(boot) {
  return Object.fromEntries(boot.products.map((p) => [p.sku, p]));
}
export function summaryMap(boot) {
  return Object.fromEntries(boot.summary.map((s) => [s.sku, s]));
}

/** <option> list. options = [[value, label], ...] */
export function optionsHtml(options, selected, placeholder) {
  let html = placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '';
  for (const [value, label] of options) {
    html += `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
  }
  return html;
}

/** Keeps a chart reference per canvas so re-rendering a page doesn't stack charts. */
const charts = new Map();
export function drawChart(canvas, config) {
  // The page may have changed (another tab opened) between asking for a chart and drawing it.
  if (!canvas || !canvas.isConnected) return null;
  if (!window.Chart) {
    canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: t('common.noCharts') }));
    return null;
  }
  charts.get(canvas.id)?.destroy();
  const chart = new window.Chart(canvas, config);
  charts.set(canvas.id, chart);
  return chart;
}
