// movements.js: the "Record" form (most used screen) and the movement history page.
import { getBootstrap, write, call } from './api.js';
import { t } from './i18n.js';
import {
  esc, num, fmtDate, todayISO, toast, withLoading, errorBox, openDialog, closeDialog,
  confirmDialog, productMap, summaryMap, optionsHtml, downloadCSV, hashParams
} from './utils.js';

export const TYPES = ['SALE', 'RESTOCK', 'PRODUCTION', 'RETURN', 'DAMAGED', 'EXPIRED', 'SAMPLE', 'ADJUSTMENT', 'OPENING'];
const NEGATIVE_TYPES = ['SALE', 'DAMAGED', 'EXPIRED', 'SAMPLE'];
export const CHANNELS = ['B2C', 'B2B2C', 'B2B', 'INTERNAL'];

export async function render(container, params) {
  if (params.view === 'history') return renderHistory(container);
  return renderRecord(container);
}

// ================================================================ Record form

// The form's state lives here so a half-filled form survives switching pages.
const form = {
  date: todayISO(),
  type: 'SALE',
  channel: 'B2C',
  customer: '',
  reference: '',
  note: '',
  lines: [newLine()],
  allowNegative: false,
  negativeNote: ''
};

function newLine() {
  return { sku: '', text: '', qty: '', sign: 1 };
}

const QUICK = [
  ['SALE', 'rec.quickSale', ['SALE']],
  ['PRODUCTION', 'rec.quickRestock', ['RESTOCK', 'PRODUCTION']],
  ['DAMAGED', 'rec.quickDamaged', ['DAMAGED']],
  ['SAMPLE', 'rec.quickSample', ['SAMPLE']]
];

/** Which channel makes sense by default for each type. */
function defaultChannel(type) {
  return ['SALE', 'RETURN'].includes(type) ? 'B2C' : 'INTERNAL';
}

async function renderRecord(container) {
  const boot = await getBootstrap();
  const products = boot.products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));

  container.innerHTML = `
    <div class="page-head"><div><h1>${esc(t('rec.title'))}</h1><div class="muted">${esc(t('rec.subtitle'))}</div></div></div>
    <form id="rec-form" class="card" novalidate>
      <div class="type-buttons" role="group" aria-label="${esc(t('rec.type'))}">
        ${QUICK.map(([type, label]) => `<button type="button" data-quick="${type}">${esc(t(label))}</button>`).join('')}
      </div>
      <div class="form-grid">
        <div class="field"><label for="r-type">${esc(t('rec.type'))}</label>
          <select id="r-type">${optionsHtml(TYPES.map((x) => [x, t('type.' + x)]), form.type)}</select></div>
        <div class="field"><label for="r-date">${esc(t('rec.date'))}</label>
          <input id="r-date" type="date" value="${esc(form.date)}" max="${esc(boot.today)}" required></div>
        <div class="field"><label for="r-channel">${esc(t('rec.channel'))}</label>
          <select id="r-channel">${optionsHtml(CHANNELS.map((c) => [c, t('channel.' + c)]), form.channel)}</select></div>
        <div class="field"><label for="r-customer">${esc(t('rec.customer'))}</label>
          <input id="r-customer" list="customer-list" value="${esc(form.customer)}" autocomplete="off">
          <datalist id="customer-list">${boot.customers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="field"><label for="r-reference">${esc(t('rec.reference'))}</label>
          <input id="r-reference" value="${esc(form.reference)}"></div>
        <div class="field"><label for="r-note">${esc(t('rec.note'))}</label>
          <input id="r-note" value="${esc(form.note)}"></div>
      </div>

      <h2>${esc(t('rec.products'))}</h2>
      <datalist id="product-list">${products.map((p) => `<option value="${esc(p.sku + ' — ' + p.name)}">`).join('')}</datalist>
      <div class="lines" id="lines"></div>
      <p><button type="button" class="secondary" id="add-line">${esc(t('rec.addLine'))}</button></p>

      <div id="negative-box" class="msg warn hidden">
        <label class="check"><input type="checkbox" id="r-allow-negative" ${form.allowNegative ? 'checked' : ''}> ${esc(t('rec.allowNegative'))}</label>
        <div class="field" style="margin:.5rem 0 0"><label for="r-negative-note">${esc(t('rec.negativeNote'))}</label>
          <input id="r-negative-note" value="${esc(form.negativeNote)}"></div>
      </div>
      <div id="rec-error"></div>
      <div class="sticky-save"><button type="submit" id="rec-save"></button></div>
    </form>`;

  const $ = (sel) => container.querySelector(sel);
  const ctx = { boot, products: productMap(boot), summary: summaryMap(boot), container };

  const syncQuick = () => {
    container.querySelectorAll('[data-quick]').forEach((b) => {
      const types = QUICK.find((q) => q[0] === b.dataset.quick)[2];
      b.setAttribute('aria-pressed', types.includes(form.type));
    });
  };
  const setType = (type) => {
    form.type = type;
    form.channel = defaultChannel(type);
    $('#r-type').value = type;
    $('#r-channel').value = form.channel;
    syncQuick();
    drawLines(ctx); // ADJUSTMENT shows +/- buttons, and the sign changes the "after" numbers
  };

  container.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => setType(b.dataset.quick)));
  $('#r-type').addEventListener('change', (e) => setType(e.target.value));
  $('#r-date').addEventListener('change', (e) => { form.date = e.target.value; });
  $('#r-channel').addEventListener('change', (e) => { form.channel = e.target.value; });
  $('#r-customer').addEventListener('input', (e) => { form.customer = e.target.value; });
  $('#r-reference').addEventListener('input', (e) => { form.reference = e.target.value; });
  $('#r-note').addEventListener('input', (e) => { form.note = e.target.value; });
  $('#r-allow-negative').addEventListener('change', (e) => { form.allowNegative = e.target.checked; });
  $('#r-negative-note').addEventListener('input', (e) => { form.negativeNote = e.target.value; });
  $('#add-line').addEventListener('click', () => {
    form.lines.push(newLine());
    drawLines(ctx);
    container.querySelectorAll('.line input[data-field=product]')[form.lines.length - 1]?.focus();
  });
  $('#rec-form').addEventListener('submit', (e) => { e.preventDefault(); save(ctx); });

  syncQuick();
  drawLines(ctx);
}

function drawLines(ctx) {
  const el = ctx.container.querySelector('#lines');
  const adjustment = form.type === 'ADJUSTMENT';
  el.innerHTML = form.lines.map((line, i) => `
    <div class="line" data-index="${i}">
      <div><label for="l-prod-${i}">${esc(t('col.product'))}</label>
        <input id="l-prod-${i}" data-field="product" list="product-list" value="${esc(line.text)}"
          placeholder="${esc(t('rec.productPlaceholder'))}" autocomplete="off"></div>
      <div><label for="l-qty-${i}">${esc(t('rec.qty'))}</label>
        <input id="l-qty-${i}" data-field="qty" type="number" inputmode="numeric" min="1" step="1" value="${esc(line.qty)}"></div>
      <div>${adjustment ? `<label>${esc(t('rec.adjDirection'))}</label><div class="sign-toggle">
          <button type="button" class="small ${line.sign > 0 ? '' : 'secondary'}" data-sign="1" aria-pressed="${line.sign > 0}">${esc(t('rec.adjAdd'))}</button>
          <button type="button" class="small ${line.sign < 0 ? '' : 'secondary'}" data-sign="-1" aria-pressed="${line.sign < 0}">${esc(t('rec.adjRemove'))}</button></div>`
        : `<label>&nbsp;</label>`}
        ${form.lines.length > 1 ? `<button type="button" class="danger remove" data-remove>${esc(t('rec.remove'))}</button>` : ''}</div>
      <div class="line-info" aria-live="polite"></div>
    </div>`).join('');

  el.querySelectorAll('.line').forEach((row) => {
    const i = Number(row.dataset.index);
    const line = form.lines[i];
    row.querySelector('[data-field=product]').addEventListener('input', (e) => {
      line.text = e.target.value;
      line.sku = findSku(e.target.value, ctx.products);
      updateInfo(ctx);
    });
    row.querySelector('[data-field=qty]').addEventListener('input', (e) => {
      line.qty = e.target.value;
      updateInfo(ctx);
    });
    row.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => {
      line.sign = Number(b.dataset.sign);
      drawLines(ctx);
    }));
    row.querySelector('[data-remove]')?.addEventListener('click', () => {
      form.lines.splice(i, 1);
      drawLines(ctx);
    });
  });
  updateInfo(ctx);
}

/** Accepts "LB-CORAL — Lip Balm Coral", "lb-coral" or an exact product name. */
function findSku(text, products) {
  const value = text.trim();
  if (!value) return '';
  const code = value.split(' — ')[0].trim().toUpperCase();
  if (products[code]?.active) return code;
  const byName = Object.values(products).find((p) => p.active && p.name.toLowerCase() === value.toLowerCase());
  return byName ? byName.sku : '';
}

function signedQty(line) {
  const qty = Number(line.qty);
  if (NEGATIVE_TYPES.includes(form.type)) return -qty;
  if (form.type === 'ADJUSTMENT') return line.sign < 0 ? -qty : qty;
  return qty;
}

/**
 * Checks every line and shows the result under it. Returns a summary used by save().
 * Lines with no product and no quantity are ignored (an empty last line is normal).
 */
function checkLines(ctx) {
  const mult = Number(ctx.boot.settings.spike_multiplier) || 3;
  const running = {}; // stock after earlier lines of the same product in this form
  const result = { lines: [], invalid: 0, negative: [], spikes: [] };

  form.lines.forEach((line, i) => {
    const info = { index: i, text: '', level: '' };
    result.lines.push(info);
    if (!line.text.trim() && !line.qty) return;
    if (!line.sku) { info.text = t('rec.unknownProduct'); info.level = 'bad'; result.invalid++; return; }
    const qty = Number(line.qty);
    const onHand = running[line.sku] ?? (ctx.summary[line.sku]?.on_hand || 0);
    if (!(qty > 0) || !Number.isInteger(qty)) {
      info.text = t('rec.lineInfo', { onHand: num(onHand), after: '?' }) + ' · ' + t('rec.badQty');
      info.level = 'bad'; result.invalid++; return;
    }
    const after = onHand + signedQty(line);
    running[line.sku] = after;
    info.text = t('rec.lineInfo', { onHand: num(onHand), after: num(after) });
    info.valid = true;

    const sizes = ctx.summary[line.sku]?.typical_qty || {};
    const typical = (signedQty(line) < 0 ? sizes.out : sizes.in) || 0;
    if (typical > 0 && qty > mult * typical) {
      info.text += ' · ' + t('rec.spike', { qty: num(qty), mult, typical: num(typical) });
      info.level = 'warn';
      result.spikes.push(`${line.sku}: ${t('rec.spike', { qty: num(qty), mult, typical: num(typical) })}`);
    }
    if (after < 0) {
      info.text += ' · ' + t('rec.wouldBeNegative', { after: num(after) });
      info.level = 'bad';
      result.negative.push(line.sku);
    }
  });
  result.valid = result.lines.filter((l) => l.valid).length;
  return result;
}

function updateInfo(ctx) {
  const check = checkLines(ctx);
  ctx.container.querySelectorAll('.line').forEach((row, i) => {
    const el = row.querySelector('.line-info');
    el.textContent = check.lines[i].text;
    el.className = 'line-info ' + check.lines[i].level;
  });
  ctx.container.querySelector('#negative-box').classList.toggle('hidden', !check.negative.length);
  ctx.container.querySelector('#rec-save').textContent = check.valid ? t('rec.save', { n: check.valid }) : t('common.save');
  return check;
}

async function save(ctx) {
  const errorEl = ctx.container.querySelector('#rec-error');
  errorEl.innerHTML = '';
  const check = updateInfo(ctx);
  if (!check.valid) { errorEl.innerHTML = errorBox(t('rec.needLines')); return; }
  if (check.invalid) { errorEl.innerHTML = errorBox(t('rec.fixLines')); return; }
  if (check.negative.length && !form.allowNegative) { errorEl.innerHTML = errorBox(t('rec.negativeBlocked')); return; }
  if (check.negative.length && !form.negativeNote.trim()) { errorEl.innerHTML = errorBox(t('rec.needNegativeNote')); return; }
  if (check.spikes.length) {
    const ok = await confirmDialog(t('rec.spikeTitle'),
      `<p>${esc(t('rec.spikeBody'))}</p><ul>${check.spikes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
      t('rec.spikeConfirm'));
    if (!ok) return;
  }

  const lines = form.lines.filter((l) => l.sku && l.qty).map((l) => ({ sku: l.sku, qty: Number(l.qty), sign: l.sign }));
  await withLoading(ctx.container.querySelector('#rec-save'), async () => {
    try {
      const result = await write('addMovements', {
        date: form.date, type: form.type, channel: form.channel, customer: form.customer,
        reference: form.reference, note: form.note, lines,
        allow_negative: !!check.negative.length && form.allowNegative, negative_note: form.negativeNote
      });
      toast(t('rec.saved', { n: result.saved }));
      // Keep date/type/channel (often several orders in a row), clear the rest.
      Object.assign(form, { customer: '', reference: '', note: '', lines: [newLine()], allowNegative: false, negativeNote: '' });
      await renderRecord(ctx.container);
    } catch (err) {
      errorEl.innerHTML = errorBox(err);
    }
  });
}

// ================================================================ History

const histFilters = { from: '', to: '', sku: '', type: '', channel: '', customer: '' };

async function renderHistory(container) {
  const boot = await getBootstrap();
  const fromUrl = hashParams().get('sku');
  if (fromUrl) histFilters.sku = fromUrl.toUpperCase();

  const productOptions = boot.products.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.sku, `${p.sku} — ${p.name}`]);
  container.innerHTML = `
    <div class="page-head">
      <h1>${esc(t('hist.title'))}</h1>
      <button type="button" class="secondary" id="h-export">${esc(t('common.exportCsv'))}</button>
    </div>
    <form class="filters card" id="h-filters">
      <div class="field"><label for="h-from">${esc(t('hist.from'))}</label><input type="date" id="h-from" value="${esc(histFilters.from)}"></div>
      <div class="field"><label for="h-to">${esc(t('hist.to'))}</label><input type="date" id="h-to" value="${esc(histFilters.to)}"></div>
      <div class="field"><label for="h-sku">${esc(t('hist.product'))}</label><select id="h-sku">${optionsHtml(productOptions, histFilters.sku, t('common.all'))}</select></div>
      <div class="field"><label for="h-type">${esc(t('col.type'))}</label><select id="h-type">${optionsHtml(TYPES.map((x) => [x, t('type.' + x)]), histFilters.type, t('common.all'))}</select></div>
      <div class="field"><label for="h-channel">${esc(t('col.channel'))}</label><select id="h-channel">${optionsHtml(CHANNELS.map((c) => [c, c]), histFilters.channel, t('common.all'))}</select></div>
      <div class="field"><label for="h-customer">${esc(t('col.customer'))}</label><input id="h-customer" list="h-customers" value="${esc(histFilters.customer)}">
        <datalist id="h-customers">${boot.customers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="actions-row"><button type="submit" id="h-apply">${esc(t('common.apply'))}</button>
        <button type="button" class="secondary" id="h-clear">${esc(t('common.clear'))}</button></div>
    </form>
    <div id="h-results"></div>`;

  const $ = (sel) => container.querySelector(sel);
  const readFilters = () => {
    histFilters.from = $('#h-from').value; histFilters.to = $('#h-to').value; histFilters.sku = $('#h-sku').value;
    histFilters.type = $('#h-type').value; histFilters.channel = $('#h-channel').value; histFilters.customer = $('#h-customer').value.trim();
  };
  const products = productMap(boot);

  const load = async () => {
    const results = $('#h-results');
    results.innerHTML = `<div class="loading-page">${esc(t('common.loading'))}</div>`;
    try {
      const data = await call('listMovements', { ...histFilters, limit: 500 });
      drawHistory(results, data, products, load);
    } catch (err) {
      results.innerHTML = errorBox(err);
    }
  };

  $('#h-filters').addEventListener('submit', (e) => {
    e.preventDefault();
    readFilters();
    if (location.hash.includes('?')) window.history.replaceState(null, '', '#/history');
    withLoading($('#h-apply'), load);
  });
  $('#h-clear').addEventListener('click', () => {
    Object.keys(histFilters).forEach((k) => { histFilters[k] = ''; });
    location.hash = '#/history';
    renderHistory(container);
  });
  $('#h-export').addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    readFilters();
    try {
      const data = await call('listMovements', { ...histFilters, limit: 1000000 });
      downloadCSV(`movements-${todayISO()}.csv`, data.movements, [
        ['movement_id', 'movement_id'], ['date', 'date'], ['sku', 'sku'], [(m) => products[m.sku]?.name || '', 'product'],
        ['type', 'type'], ['qty', 'qty'], ['channel', 'channel'], ['customer', 'customer'], ['reference', 'reference'],
        ['note', 'note'], ['entered_by', 'entered_by'], ['created_at', 'created_at'], ['reverses_id', 'reverses_id']
      ]);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  await load();
}

function drawHistory(el, data, products, reload) {
  if (!data.movements.length) { el.innerHTML = `<div class="card empty">${esc(t('common.none'))}</div>`; return; }
  el.innerHTML = `
    <p class="muted small">${esc(t('hist.showing', { shown: data.movements.length, total: data.total }))}</p>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>${esc(t('col.date'))}</th><th>${esc(t('col.product'))}</th><th>${esc(t('col.type'))}</th>
        <th class="num">${esc(t('col.qty'))}</th><th>${esc(t('col.channel'))}</th><th>${esc(t('col.customer'))}</th>
        <th>${esc(t('col.reference'))}</th><th>${esc(t('col.note'))}</th><th>${esc(t('col.enteredBy'))}</th><th></th></tr></thead>
      <tbody>${data.movements.map((m) => `<tr>
        <td class="nowrap">${fmtDate(m.date)}</td>
        <td><a href="#/products/${encodeURIComponent(m.sku)}">${esc(products[m.sku]?.name || m.sku)}</a><div class="muted small">${esc(m.sku)}</div></td>
        <td>${esc(t('type.' + m.type))}${m.reverses_id ? ` <span class="badge neutral">${esc(t('hist.reversal'))}</span>` : ''}</td>
        <td class="num">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
        <td>${esc(m.channel)}</td><td>${esc(m.customer)}</td><td>${esc(m.reference)}</td>
        <td class="small">${esc(m.note)}</td><td class="small">${esc(m.entered_by)}</td>
        <td class="actions">${m.is_reversed ? `<span class="badge neutral">${esc(t('hist.reversed'))}</span>`
          : m.reverses_id ? '' : `<button type="button" class="secondary small" data-reverse="${esc(m.movement_id)}">${esc(t('hist.reverse'))}</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

  el.querySelectorAll('[data-reverse]').forEach((btn) => btn.addEventListener('click', async () => {
    const m = data.movements.find((x) => x.movement_id === btn.dataset.reverse);
    const ok = await confirmDialog(t('hist.reverseTitle'),
      `<p>${esc(t('hist.reverseBody', { qty: (m.qty > 0 ? '' : '+') + num(-m.qty), sku: m.sku }))}</p>`, t('hist.reverseConfirm'));
    if (!ok) return;
    await withLoading(btn, async () => {
      try {
        await write('reverseMovement', { movement_id: m.movement_id });
      } catch (err) {
        if (!err.details?.negative) { toast(err.message, 'error'); return; }
        const note = await askNegativeNote(m.sku);
        if (!note) return;
        try {
          await write('reverseMovement', { movement_id: m.movement_id, allow_negative: true, negative_note: note });
        } catch (err2) { toast(err2.message, 'error'); return; }
      }
      toast(t('hist.reverseDone'));
      reload();
    });
  }));
}

/** Asks why negative stock is acceptable. Resolves with the note, or '' if cancelled. */
function askNegativeNote(sku) {
  return new Promise((resolve) => {
    const dlg = openDialog(t('hist.reverseTitle'),
      `<p>${esc(t('hist.negativeReverse', { sku }))}</p><div class="field"><textarea id="neg-note" rows="3"></textarea></div>`,
      `<button type="button" class="secondary" data-close>${esc(t('common.cancel'))}</button><button type="button" id="neg-ok">${esc(t('hist.reverseConfirm'))}</button>`);
    let done = false;
    dlg.querySelector('#neg-ok').addEventListener('click', () => {
      const note = dlg.querySelector('#neg-note').value.trim();
      if (!note) return dlg.querySelector('#neg-note').focus();
      done = true; closeDialog(); resolve(note);
    });
    dlg.addEventListener('close', () => { if (!done) resolve(''); }, { once: true });
  });
}
