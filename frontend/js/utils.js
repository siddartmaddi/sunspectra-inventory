// utils.js: small helpers used by every page.
import { t, getLang } from './i18n.js';

/** Escapes text before putting it into HTML, so names like "<b>" can't break the page. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(value) {
  const n = Number(value) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (!window.Chart) {
    canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: t('common.noCharts') }));
    return null;
  }
  charts.get(canvas.id)?.destroy();
  const chart = new window.Chart(canvas, config);
  charts.set(canvas.id, chart);
  return chart;
}
