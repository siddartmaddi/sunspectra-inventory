// counts.js: physical stock count sheet and count history.
import { getBootstrap, write, call } from './api.js';
import { t } from './i18n.js';
import { esc, num, fmtDate, toast, withLoading, errorBox, productMap, summaryMap, confirmDialog, downloadCSV, todayISO } from './utils.js';

// Typed quantities survive switching pages, so a half-done count isn't lost.
const counted = {};
let countDate = null;
let search = '';

export async function render(container) {
  const boot = await getBootstrap();
  if (!countDate) countDate = boot.today;
  const summary = summaryMap(boot);
  const products = boot.products.filter((p) => p.active).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  container.innerHTML = `
    <div class="page-head"><div><h1>${esc(t('cnt.title'))}</h1><div class="muted">${esc(t('cnt.subtitle'))}</div></div></div>
    <form class="card" id="count-form" novalidate>
      <div class="filters">
        <div class="field"><label for="c-date">${esc(t('cnt.date'))}</label><input type="date" id="c-date" value="${esc(countDate)}" max="${esc(boot.today)}"></div>
        <div class="field"><label for="c-search">${esc(t('common.search'))}</label><input type="search" id="c-search" value="${esc(search)}"></div>
      </div>
      <p class="muted small" id="c-date-hint"></p>
      <div class="table-wrap"><table>
        <thead><tr><th>${esc(t('col.product'))}</th><th>${esc(t('col.category'))}</th><th class="num">${esc(t('cnt.system'))}</th>
          <th class="num">${esc(t('cnt.counted'))}</th><th class="num">${esc(t('cnt.variance'))}</th></tr></thead>
        <tbody>${products.map((p) => `<tr data-sku="${esc(p.sku)}">
          <td>${esc(p.name)}<div class="muted small">${esc(p.sku)}</div></td>
          <td class="small">${esc(p.category)}</td>
          <td class="num">${num(summary[p.sku]?.on_hand)}</td>
          <td class="num"><input type="number" min="0" step="1" inputmode="numeric" data-sku="${esc(p.sku)}" value="${esc(counted[p.sku] ?? '')}"
            aria-label="${esc(t('cnt.counted'))}: ${esc(p.name)}" style="width:100px;text-align:right;min-height:44px;font-size:16px"></td>
          <td class="num" data-variance="${esc(p.sku)}"></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div id="count-error"></div>
      <div class="sticky-save actions-row">
        <button type="submit" id="count-save"></button>
        <button type="button" class="secondary" id="count-clear">${esc(t('common.clear'))}</button>
      </div>
    </form>
    <div id="count-history"></div>`;

  const $ = (sel) => container.querySelector(sel);
  const refresh = () => {
    let n = 0;
    products.forEach((p) => {
      const cell = container.querySelector(`[data-variance="${CSS.escape(p.sku)}"]`);
      const value = counted[p.sku];
      if (value === undefined || value === '') { cell.textContent = ''; cell.style.color = ''; return; }
      n++;
      const diff = Number(value) - (summary[p.sku]?.on_hand || 0);
      cell.textContent = (diff > 0 ? '+' : '') + num(diff);
      cell.style.color = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--orange)' : 'var(--ok)';
    });
    $('#count-save').textContent = n ? t('cnt.save', { n }) : t('common.save');
    $('#c-date-hint').textContent = countDate !== boot.today ? t('cnt.pastDateHint') : '';
  };
  const filter = () => {
    const q = search.trim().toLowerCase();
    container.querySelectorAll('tbody tr[data-sku]').forEach((tr) => {
      const p = products.find((x) => x.sku === tr.dataset.sku);
      tr.classList.toggle('hidden', !!q && !(p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)));
    });
  };

  container.querySelectorAll('input[data-sku]').forEach((input) => input.addEventListener('input', () => {
    counted[input.dataset.sku] = input.value;
    refresh();
  }));
  $('#c-date').addEventListener('change', (e) => { countDate = e.target.value; refresh(); });
  $('#c-search').addEventListener('input', (e) => { search = e.target.value; filter(); });
  $('#count-clear').addEventListener('click', () => {
    Object.keys(counted).forEach((k) => delete counted[k]);
    render(container);
  });
  $('#count-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = Object.entries(counted).filter(([, v]) => v !== '' && v !== undefined)
      .map(([sku, v]) => ({ sku, counted_qty: Number(v) }));
    const errorEl = $('#count-error');
    if (!lines.length) { errorEl.innerHTML = errorBox(t('cnt.needOne')); return; }
    const bad = lines.filter((l) => !(l.counted_qty >= 0) || !Number.isInteger(l.counted_qty));
    if (bad.length) { errorEl.innerHTML = errorBox(t('cnt.badQty', { skus: bad.map((l) => l.sku).join(', ') })); return; }
    const ok = await confirmDialog(t('cnt.confirmTitle'), `<p>${esc(t('cnt.confirmBody', { n: lines.length, date: fmtDate(countDate) }))}</p>`, t('cnt.saveShort'));
    if (!ok) return;
    await withLoading($('#count-save'), async () => {
      try {
        const result = await write('saveCount', { date: countDate, lines });
        toast(t('cnt.saved', { n: result.saved, adjusted: result.adjusted }));
        Object.keys(counted).forEach((k) => delete counted[k]);
        await render(container);
      } catch (err) {
        errorEl.innerHTML = errorBox(err);
      }
    });
  });

  refresh();
  filter();
  loadHistory($('#count-history'), productMap(boot));
}

async function loadHistory(el, products) {
  el.innerHTML = `<div class="loading-page">${esc(t('common.loading'))}</div>`;
  let data;
  try {
    data = await call('listCounts');
  } catch (err) {
    el.innerHTML = errorBox(err);
    return;
  }
  const counts = data.counts;
  if (!counts.length) { el.innerHTML = ''; return; }

  // One row per count date.
  const byDate = new Map();
  counts.forEach((c) => {
    const row = byDate.get(c.date) || { date: c.date, products: 0, differences: 0, net: 0, by: new Set() };
    row.products++;
    if (c.variance) row.differences++;
    row.net += c.variance;
    row.by.add(c.entered_by);
    byDate.set(c.date, row);
  });
  // One row per product: repeated differences point to shrinkage or data entry problems.
  const byProduct = new Map();
  counts.forEach((c) => {
    const row = byProduct.get(c.sku) || { sku: c.sku, counts: 0, differences: 0, net: 0, abs: 0 };
    row.counts++;
    if (c.variance) row.differences++;
    row.net += c.variance;
    row.abs += Math.abs(c.variance);
    byProduct.set(c.sku, row);
  });
  const productRows = [...byProduct.values()].filter((r) => r.differences).sort((a, b) => b.abs - a.abs);

  el.innerHTML = `
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card"><h2 style="margin-top:0">${esc(t('cnt.history'))}</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('col.date'))}</th><th class="num">${esc(t('cnt.productsCounted'))}</th>
            <th class="num">${esc(t('cnt.withDifference'))}</th><th class="num">${esc(t('cnt.netVariance'))}</th><th>${esc(t('col.enteredBy'))}</th></tr></thead>
          <tbody>${[...byDate.values()].map((r) => `<tr><td class="nowrap">${fmtDate(r.date)}</td><td class="num">${r.products}</td>
            <td class="num">${r.differences}</td><td class="num">${r.net > 0 ? '+' : ''}${num(r.net)}</td><td class="small">${esc([...r.by].join(', '))}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card"><div class="page-head" style="margin:0 0 .5rem"><h2 style="margin:0">${esc(t('cnt.byProduct'))}</h2>
          <button type="button" class="secondary small" id="cnt-export">${esc(t('common.exportCsv'))}</button></div>
        <p class="muted small">${esc(t('cnt.byProductHint'))}</p>
        ${productRows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>${esc(t('col.product'))}</th><th class="num">${esc(t('cnt.counts'))}</th><th class="num">${esc(t('cnt.withDifference'))}</th>
            <th class="num">${esc(t('cnt.netVariance'))}</th></tr></thead>
          <tbody>${productRows.map((r) => `<tr><td><a href="#/products/${encodeURIComponent(r.sku)}">${esc(products[r.sku]?.name || r.sku)}</a></td>
            <td class="num">${r.counts}</td><td class="num">${r.differences}</td><td class="num">${r.net > 0 ? '+' : ''}${num(r.net)}</td></tr>`).join('')}</tbody>
        </table></div>` : `<p class="msg info">${esc(t('cnt.noDifferences'))}</p>`}
      </div>
    </div>`;
  el.querySelector('#cnt-export').addEventListener('click', () => downloadCSV(`counts-${todayISO()}.csv`, counts, [
    ['date', 'date'], ['sku', 'sku'], [(c) => products[c.sku]?.name || '', 'product'], ['system_qty', 'system_qty'],
    ['counted_qty', 'counted_qty'], ['variance', 'variance'], ['entered_by', 'entered_by']
  ]));
}
