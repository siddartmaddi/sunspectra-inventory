// import.js: load products, opening stock or movement history from CSV files.
// Steps: pick a file -> map unknown product names to SKUs -> preview with errors -> import in batches.
import { getBootstrap, call, write, invalidateBootstrap } from './api.js';
import { t } from './i18n.js';
import { esc, num, toast, withLoading, errorBox, optionsHtml } from './utils.js';

const KINDS = {
  products: { template: 'templates/products.csv', columns: ['sku', 'name', 'category', 'unit', 'unit_cost', 'retail_price', 'wholesale_price', 'supplier_id', 'lead_time_days', 'min_order_qty', 'safety_stock_override', 'reorder_point_override', 'target_cover_days'] },
  opening: { template: 'templates/opening_stock.csv', columns: ['date', 'sku', 'product_name', 'qty'] },
  movements: { template: 'templates/movements.csv', columns: ['date', 'sku', 'product_name', 'type', 'qty', 'channel', 'customer', 'reference', 'note'] }
};
const BATCH = 300; // rows per request, so Apps Script never hits its time limit

// The current import, kept while moving between pages.
let state = { kind: 'movements', fileName: '', rows: [], errors: [], unknown: [], mappings: {}, checked: false };

export async function render(container) {
  const boot = await getBootstrap();
  container.innerHTML = `
    <div class="page-head"><div><h1>${esc(t('imp.title'))}</h1><div class="muted">${esc(t('imp.subtitle'))}</div></div></div>
    <div class="card">
      <h2 style="margin-top:0">1. ${esc(t('imp.step1'))}</h2>
      <div class="filters">
        <div class="field"><label for="i-kind">${esc(t('imp.kind'))}</label>
          <select id="i-kind">${optionsHtml(Object.keys(KINDS).map((k) => [k, t('imp.kind.' + k)]), state.kind)}</select></div>
        <div class="field"><label for="i-file">${esc(t('imp.file'))}</label><input type="file" id="i-file" accept=".csv,text/csv"></div>
        <div class="field"><a class="btn secondary" id="i-template" href="${KINDS[state.kind].template}" download>${esc(t('imp.template'))}</a></div>
      </div>
      <p class="muted small">${esc(t('imp.hint.' + state.kind))} ${esc(t('imp.dateHint'))}</p>
    </div>
    <div id="i-steps"></div>`;

  const $ = (sel) => container.querySelector(sel);
  $('#i-kind').addEventListener('change', (e) => {
    state = { ...state, kind: e.target.value, fileName: '', rows: [], errors: [], unknown: [], checked: false };
    render(container);
  });
  $('#i-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const steps = $('#i-steps');
    try {
      const rows = parseCSV(await file.text());
      state = { ...state, fileName: file.name, rows: rows.map(normalizeRow), errors: [], unknown: [], checked: false };
      if (!state.rows.length) throw new Error(t('imp.empty'));
      const missing = requiredColumns(state.kind).filter((c) => !(c in rows[0]) && !(c === 'sku' && 'product_name' in rows[0]));
      if (missing.length) throw new Error(t('imp.missingColumns', { cols: missing.join(', ') }));
      await check(steps, boot);
    } catch (err) {
      steps.innerHTML = errorBox(err);
    }
  });
  if (state.rows.length) drawSteps($('#i-steps'), boot);
}

function requiredColumns(kind) {
  if (kind === 'products') return ['sku', 'name', 'category', 'lead_time_days'];
  if (kind === 'opening') return ['date', 'sku', 'qty'];
  return ['date', 'sku', 'type', 'qty'];
}

/** Sends every row to the server with dry_run (nothing saved) to collect errors and unknown names. */
async function check(el, boot) {
  el.innerHTML = `<div class="loading-page">${esc(t('imp.checking'))}</div>`;
  const errors = [];
  const unknown = new Set();
  for (let i = 0; i < state.rows.length; i += 500) {
    const res = await call('importRows', { kind: state.kind, rows: state.rows.slice(i, i + 500), row_offset: i, dry_run: true, new_mappings: mappingList() });
    errors.push(...res.errors);
    res.unknown_names.forEach((n) => unknown.add(n));
  }
  state.errors = errors;
  state.unknown = [...unknown];
  state.checked = true;
  drawSteps(el, boot);
}

function mappingList() {
  return Object.entries(state.mappings).filter(([, sku]) => sku).map(([source_name, sku]) => ({ source_name, sku }));
}

function drawSteps(el, boot) {
  const products = boot.products.slice().sort((a, b) => a.name.localeCompare(b.name));
  const productOptions = products.map((p) => [p.sku, `${p.sku} — ${p.name}`]);
  const errorsByRow = new Map(state.errors.map((e) => [e.row, e.messages]));
  const needsMapping = state.unknown.length > 0;
  const columns = KINDS[state.kind].columns.filter((c) => state.rows.some((r) => r[c] !== undefined && r[c] !== ''));
  // Show rows with problems first, then the rest (up to 100 rows on screen).
  const order = state.rows.map((r, i) => i).sort((a, b) => (errorsByRow.has(b + 2) ? 1 : 0) - (errorsByRow.has(a + 2) ? 1 : 0)).slice(0, 100);

  el.innerHTML = `
    ${needsMapping ? `<div class="card">
      <h2 style="margin-top:0">2. ${esc(t('imp.step2'))}</h2>
      <p class="muted">${esc(t('imp.mapHint'))}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>${esc(t('imp.nameInFile'))}</th><th>${esc(t('imp.mapsTo'))}</th></tr></thead>
        <tbody>${state.unknown.map((name, i) => `<tr><td>${esc(name)}</td>
          <td><select data-map="${i}" aria-label="${esc(t('imp.mapsTo'))}: ${esc(name)}">${optionsHtml(productOptions, state.mappings[name], '—')}</select></td></tr>`).join('')}</tbody>
      </table></div>
      <p><button type="button" id="i-apply-map">${esc(t('imp.applyMap'))}</button></p>
    </div>` : ''}
    <div class="card">
      <h2 style="margin-top:0">${needsMapping ? 3 : 2}. ${esc(t('imp.step3'))}</h2>
      <p>${esc(t('imp.summary', { file: state.fileName, rows: num(state.rows.length) }))}
        ${state.errors.length ? `<strong style="color:var(--danger)">${esc(t('imp.errorCount', { n: state.errors.length }))}</strong>`
          : `<strong style="color:var(--ok)">${esc(t('imp.noErrors'))}</strong>`}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>${esc(t('imp.row'))}</th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}<th>${esc(t('imp.problems'))}</th></tr></thead>
        <tbody>${order.map((i) => {
          const r = state.rows[i];
          const msgs = errorsByRow.get(i + 2);
          return `<tr${msgs ? ' style="background:var(--danger-soft)"' : ''}><td class="num">${i + 2}</td>
            ${columns.map((c) => `<td class="small">${esc(r[c])}</td>`).join('')}
            <td class="small" style="color:var(--danger)">${msgs ? msgs.map(esc).join('<br>') : '✓'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${state.rows.length > 100 ? `<p class="muted small">${esc(t('imp.previewLimit', { n: num(state.rows.length) }))}</p>` : ''}
      <div id="i-result"></div>
      <p class="actions-row"><button type="button" id="i-import" ${state.errors.length ? 'disabled' : ''}>${esc(t('imp.import', { n: num(state.rows.length) }))}</button>
        ${state.errors.length ? `<span class="muted small">${esc(t('imp.fixFirst'))}</span>` : ''}</p>
    </div>`;

  el.querySelectorAll('[data-map]').forEach((sel) => sel.addEventListener('change', () => {
    state.mappings[state.unknown[Number(sel.dataset.map)]] = sel.value;
  }));
  el.querySelector('#i-apply-map')?.addEventListener('click', (e) => withLoading(e.currentTarget, () => check(el, boot).catch((err) => toast(err.message, 'error'))));
  el.querySelector('#i-import').addEventListener('click', async (e) => {
    const ok = await withLoading(e.currentTarget, () => runImport(el.querySelector('#i-result')));
    // After a successful import, only the result stays on screen so nothing can be imported twice.
    if (ok) el.innerHTML = `<div class="card">${el.querySelector('#i-result').innerHTML}</div>`;
  });
}

/** Imports in batches. If a batch fails, tells exactly which rows were already saved. */
async function runImport(resultEl) {
  let done = 0;
  try {
    for (let i = 0; i < state.rows.length; i += BATCH) {
      resultEl.innerHTML = `<p class="msg info">${esc(t('imp.progress', { done: num(done), total: num(state.rows.length) }))}</p>`;
      const res = await write('importRows', { kind: state.kind, rows: state.rows.slice(i, i + BATCH), row_offset: i, new_mappings: mappingList() });
      if (res.errors.length) throw new Error(res.errors.map((er) => `${t('imp.row')} ${er.row}: ${er.messages.join(' ')}`).join(' '));
      done += Math.min(BATCH, state.rows.length - i);
    }
    invalidateBootstrap();
    resultEl.innerHTML = `<p class="msg info">${esc(t('imp.done', { n: num(done) }))}</p>`;
    toast(t('imp.done', { n: num(done) }));
    state = { ...state, rows: [], errors: [], unknown: [], checked: false };
    return true;
  } catch (err) {
    resultEl.innerHTML = errorBox({ message: t('imp.partial', { done: num(done), lastRow: done + 2 }) + ' ' + err.message });
    return false;
  }
}

// ---------------------------------------------------------------- CSV reading

/**
 * Reads CSV text into an array of objects keyed by the header row.
 * Handles quoted values ("a, b"), "" inside quotes, Windows line endings, and
 * semicolon-separated files (what Excel saves in Spanish).
 */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }

  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Turns "28/10/2026", "28-10-2026" or "2026/10/28" into "2026-10-28". Day comes first (Costa Rica). */
export function normalizeDate(value) {
  const v = String(value || '').trim().slice(0, 10);
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return v;
}

function normalizeRow(row) {
  const out = { ...row };
  if ('date' in out) out.date = normalizeDate(out.date);
  if ('type' in out) out.type = out.type.toUpperCase();
  if ('channel' in out) out.channel = out.channel.toUpperCase();
  if ('sku' in out) out.sku = out.sku.toUpperCase();
  return out;
}
