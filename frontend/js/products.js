// products.js: product list, add/edit form, deactivate, and the product detail page.
import { getBootstrap, write, call } from './api.js';
import { t } from './i18n.js';
import {
  esc, money, num, fmtDate, toast, withLoading, errorBox, openDialog, closeDialog,
  confirmDialog, summaryMap, optionsHtml
} from './utils.js';

export const CATEGORIES = ['Sunscreen', 'Sunscreen Stick', 'Tinted Sunscreen', 'Lip Balm', 'Makeup', 'Skincare', 'Kit', 'Accessory'];
const UNITS = ['unit', 'ml', 'g'];

// Filters survive moving to another page and back.
const filters = { search: '', category: '', showInactive: false };

export async function render(container, params) {
  if (params.sku) return renderDetail(container, params.sku);
  const boot = await getBootstrap();
  container.innerHTML = `
    <div class="page-head">
      <h1>${esc(t('prod.title'))}</h1>
      <button type="button" id="add-product">${esc(t('prod.add'))}</button>
    </div>
    <div class="filters">
      <div class="field"><label for="p-search">${esc(t('common.search'))}</label>
        <input id="p-search" type="search" value="${esc(filters.search)}" placeholder="LB-CORAL, Opticks…"></div>
      <div class="field"><label for="p-cat">${esc(t('col.category'))}</label>
        <select id="p-cat">${optionsHtml(CATEGORIES.map((c) => [c, c]), filters.category, t('common.all'))}</select></div>
      <label class="check"><input type="checkbox" id="p-inactive" ${filters.showInactive ? 'checked' : ''}> ${esc(t('prod.showInactive'))}</label>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap" id="p-table"></div></div>`;

  const draw = () => drawTable(container.querySelector('#p-table'), boot);
  container.querySelector('#p-search').addEventListener('input', (e) => { filters.search = e.target.value; draw(); });
  container.querySelector('#p-cat').addEventListener('change', (e) => { filters.category = e.target.value; draw(); });
  container.querySelector('#p-inactive').addEventListener('change', (e) => { filters.showInactive = e.target.checked; draw(); });
  container.querySelector('#add-product').addEventListener('click', () => openProductForm(null, boot, () => render(container, params)));
  draw();
}

function drawTable(el, boot) {
  const summary = summaryMap(boot);
  const suppliers = Object.fromEntries(boot.suppliers.map((s) => [s.supplier_id, s.name]));
  const q = filters.search.trim().toLowerCase();
  const rows = boot.products.filter((p) =>
    (filters.showInactive || p.active) &&
    (!filters.category || p.category === filters.category) &&
    (!q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  ).sort((a, b) => a.name.localeCompare(b.name));

  if (!rows.length) { el.innerHTML = `<div class="empty">${esc(t('common.none'))}</div>`; return; }
  el.innerHTML = `<table>
    <thead><tr>
      <th>${esc(t('col.product'))}</th><th>${esc(t('col.category'))}</th>
      <th class="num">${esc(t('col.onHand'))}</th><th class="num">${esc(t('col.price'))}</th>
      <th class="num">${esc(t('col.cost'))}</th><th class="num">${esc(t('col.leadTime'))}</th>
      <th>${esc(t('col.supplier'))}</th><th></th>
    </tr></thead>
    <tbody>${rows.map((p) => `
      <tr class="${p.active ? '' : 'inactive'}">
        <td><a href="#/products/${encodeURIComponent(p.sku)}">${esc(p.name)}</a>
          <div class="muted small">${esc(p.sku)}${p.active ? '' : ` · <span class="badge neutral">${esc(t('prod.inactive'))}</span>`}</div></td>
        <td>${esc(p.category)}</td>
        <td class="num">${num(summary[p.sku]?.on_hand)}</td>
        <td class="num">${money(p.retail_price)}</td>
        <td class="num">${money(p.unit_cost)}</td>
        <td class="num">${num(p.lead_time_days)} d</td>
        <td>${esc(suppliers[p.supplier_id] || '')}</td>
        <td class="actions"><button type="button" class="secondary small" data-edit="${esc(p.sku)}">${esc(t('common.edit'))}</button></td>
      </tr>`).join('')}</tbody>
  </table>
  <p class="muted small" style="padding:0 .75rem">${esc(t('prod.count', { n: rows.length }))}</p>`;

  el.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const product = boot.products.find((p) => p.sku === btn.dataset.edit);
    openProductForm(product, boot, () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  }));
}

/** Add/edit dialog. product = null for a new product. onSaved runs after a successful save. */
export function openProductForm(product, boot, onSaved) {
  const isNew = !product;
  const p = product || { unit: 'unit', lead_time_days: 21, min_order_qty: 1, target_cover_days: 60, supplier_id: 'SUP-INHOUSE' };
  const field = (id, label, input, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  const numInput = (id, value, step = 'any') => `<input id="${id}" name="${id}" type="number" inputmode="decimal" min="0" step="${step}" value="${esc(value ?? '')}">`;

  const body = `<form id="product-form" novalidate>
    <div class="form-grid">
      ${field('sku', t('prod.sku'), `<input id="sku" name="sku" value="${esc(p.sku || '')}" ${isNew ? '' : 'readonly'} autocapitalize="characters" required>`, isNew ? t('prod.skuHint') : '')}
      ${field('name', t('prod.name'), `<input id="name" name="name" value="${esc(p.name || '')}" required>`)}
      ${field('category', t('prod.category'), `<select id="category" name="category" required>${optionsHtml(CATEGORIES.map((c) => [c, c]), p.category, '—')}</select>`)}
      ${field('unit', t('prod.unit'), `<select id="unit" name="unit">${optionsHtml(UNITS.map((u) => [u, u]), p.unit)}</select>`)}
      ${field('unit_cost', t('prod.unitCost'), numInput('unit_cost', p.unit_cost))}
      ${field('retail_price', t('prod.retail'), numInput('retail_price', p.retail_price))}
      ${field('wholesale_price', t('prod.wholesale'), numInput('wholesale_price', p.wholesale_price), t('prod.wholesaleHint'))}
      ${field('supplier_id', t('prod.supplier'), `<select id="supplier_id" name="supplier_id">${optionsHtml(boot.suppliers.map((s) => [s.supplier_id, s.name]), p.supplier_id, '—')}</select>`)}
      ${field('lead_time_days', t('prod.leadTime'), numInput('lead_time_days', p.lead_time_days, 1), t('prod.leadTimeHint'))}
      ${field('min_order_qty', t('prod.moq'), numInput('min_order_qty', p.min_order_qty, 1))}
      ${field('target_cover_days', t('prod.targetCover'), numInput('target_cover_days', p.target_cover_days, 1), t('prod.targetCoverHint'))}
      ${field('safety_stock_override', t('prod.safetyOverride'), numInput('safety_stock_override', p.safety_stock_override), t('prod.overrideHint'))}
      ${field('reorder_point_override', t('prod.reorderOverride'), numInput('reorder_point_override', p.reorder_point_override), t('prod.overrideHint'))}
    </div>
    <div id="product-error"></div>
  </form>`;

  const footer = `
    ${isNew ? '' : `<button type="button" class="danger" id="toggle-active">${esc(t(p.active ? 'prod.deactivate' : 'prod.activate'))}</button>`}
    <span style="flex:1"></span>
    <button type="button" class="secondary" data-close>${esc(t('common.cancel'))}</button>
    <button type="submit" form="product-form" id="save-product">${esc(t('common.save'))}</button>`;
  const dlg = openDialog(isNew ? t('prod.newTitle') : t('prod.editTitle', { sku: p.sku }), body, footer);
  const form = dlg.querySelector('#product-form');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.sku = (data.sku || p.sku || '').toUpperCase();
    // Quick checks before the round trip; the server checks everything again.
    const errors = [];
    if (!data.sku) errors.push(t('prod.sku') + ': required');
    if (!data.name.trim()) errors.push(t('prod.name') + ': required');
    if (!data.category) errors.push(t('prod.category') + ': required');
    if (!(Number(data.lead_time_days) > 0)) errors.push(t('prod.leadTime') + ' > 0');
    if (errors.length) { dlg.querySelector('#product-error').innerHTML = errorBox({ message: errors.join(' · ') }); return; }

    withLoading(dlg.querySelector('#save-product'), async () => {
      try {
        await write('upsertProduct', { is_new: isNew, product: data });
        closeDialog();
        toast(t('common.saved'));
        onSaved?.();
      } catch (err) {
        dlg.querySelector('#product-error').innerHTML = errorBox(err);
      }
    });
  });

  dlg.querySelector('#toggle-active')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (p.active) {
      const ok = await confirmDialog(t('prod.deactivate'), `<p>${esc(t('prod.deactivateConfirm', { name: p.name }))}</p>`, t('prod.deactivate'));
      if (!ok) return;
    }
    await withLoading(button, async () => {
      try {
        await write('setProductActive', { sku: p.sku, active: !p.active });
        closeDialog();
        toast(t('common.saved'));
        onSaved?.();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

// ------------------------------------------------------------ detail page

async function renderDetail(container, sku) {
  const [boot, detail] = await Promise.all([getBootstrap(), call('getProductDetail', { sku })]);
  const p = detail.product;
  const s = summaryMap(boot)[p.sku] || {};
  const supplier = boot.suppliers.find((x) => x.supplier_id === p.supplier_id);
  const recent = detail.movements.slice(-25).reverse();

  container.innerHTML = `
    <p><a href="#/products">${esc(t('prod.back'))}</a></p>
    <div class="page-head">
      <div><h1>${esc(p.name)}</h1>
        <div class="muted">${esc(p.sku)} · ${esc(p.category)}${p.active ? '' : ` · <span class="badge neutral">${esc(t('prod.inactive'))}</span>`}</div></div>
      <div class="actions-row">
        <a class="btn secondary" href="#/history?sku=${encodeURIComponent(p.sku)}">${esc(t('nav.history'))}</a>
        <button type="button" id="edit-product">${esc(t('common.edit'))}</button>
      </div>
    </div>
    <div class="card">
      <dl class="stats">
        <div><dt>${esc(t('prod.currentStock'))}</dt><dd>${num(s.on_hand)} ${s.on_hand <= 0 ? '<span class="badge out">OUT</span>' : ''}</dd></div>
        <div><dt>${esc(t('prod.stockValue'))}</dt><dd>${money(s.value)}</dd></div>
        <div><dt>${esc(t('col.price'))}</dt><dd>${money(p.retail_price)}</dd></div>
        <div><dt>${esc(t('col.cost'))}</dt><dd>${money(p.unit_cost)}</dd></div>
        <div><dt>${esc(t('col.leadTime'))}</dt><dd>${num(p.lead_time_days)} d</dd></div>
        <div><dt>${esc(t('prod.moq'))}</dt><dd>${num(p.min_order_qty)}</dd></div>
        <div><dt>${esc(t('col.supplier'))}</dt><dd>${esc(supplier?.name || '–')}</dd></div>
      </dl>
    </div>
    <div id="detail-extra"></div>
    <div class="card">
      <h2 style="margin-top:0">${esc(t('prod.recentMovements'))}</h2>
      ${recent.length ? `<div class="table-wrap"><table>
        <thead><tr><th>${esc(t('col.date'))}</th><th>${esc(t('col.type'))}</th><th class="num">${esc(t('col.qty'))}</th>
          <th>${esc(t('col.channel'))}</th><th>${esc(t('col.customer'))}</th><th>${esc(t('col.note'))}</th></tr></thead>
        <tbody>${recent.map((m) => `<tr>
          <td class="nowrap">${fmtDate(m.date)}</td><td>${esc(t('type.' + m.type))}</td>
          <td class="num">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
          <td>${esc(m.channel)}</td><td>${esc(m.customer)}</td><td class="small">${esc(m.note)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${esc(t('common.none'))}</div>`}
    </div>`;

  container.querySelector('#edit-product').addEventListener('click', () =>
    openProductForm(p, boot, () => window.dispatchEvent(new HashChangeEvent('hashchange'))));
  return { boot, detail, product: p };
}
