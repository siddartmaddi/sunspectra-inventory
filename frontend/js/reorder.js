// reorder.js: what to order now, how much, by when, and from whom. Exports to CSV for suppliers.
import { getBootstrap } from './api.js';
import { t } from './i18n.js';
import { esc, money, num, fmtDate, todayISO, productMap, statusBadge, downloadCSV, withLoading } from './utils.js';

const STATUS_RANK = { 'OUT': 0, 'REORDER NOW': 1, 'LOW': 2, 'OK': 3, 'INACTIVE': 4 };
let includeLow = false;
const edited = {}; // sku -> quantity typed by the person (kept while the app is open)

export async function render(container) {
  const boot = await getBootstrap();
  const products = productMap(boot);
  const suppliers = Object.fromEntries(boot.suppliers.map((s) => [s.supplier_id, s]));

  container.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(t('ro.title'))}</h1><div class="muted">${esc(t('ro.subtitle'))}</div></div>
      <button type="button" class="secondary" id="ro-export">${esc(t('common.exportCsv'))}</button>
    </div>
    <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="ro-low" ${includeLow ? 'checked' : ''}> ${esc(t('ro.includeLow'))}</label>
    <div id="ro-table"></div>`;

  const rowsNow = () => boot.summary
    .filter((r) => products[r.sku]?.active && (r.status === 'OUT' || r.status === 'REORDER NOW' || (includeLow && r.status === 'LOW')))
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || String(a.reorder_by_date).localeCompare(String(b.reorder_by_date)))
    .map((r) => {
      const p = products[r.sku];
      const qty = edited[r.sku] ?? r.suggested_qty;
      return { ...r, name: p.name, unit_cost: p.unit_cost || 0, qty, cost: qty * (p.unit_cost || 0),
        supplier: suppliers[p.supplier_id]?.name || t('ro.noSupplier'), supplier_email: suppliers[p.supplier_id]?.email || '' };
    });

  const draw = () => {
    const rows = rowsNow();
    const el = container.querySelector('#ro-table');
    if (!rows.length) { el.innerHTML = `<div class="card msg info">${esc(t('ro.nothing'))}</div>`; return; }
    const total = rows.reduce((sum, r) => sum + r.cost, 0);
    el.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr>
        <th>${esc(t('col.product'))}</th><th>${esc(t('col.status'))}</th><th class="num">${esc(t('col.onHand'))}</th>
        <th>${esc(t('fc.reorderBy'))}</th><th>${esc(t('col.supplier'))}</th><th class="num">${esc(t('ro.qty'))}</th>
        <th class="num">${esc(t('ro.unitCost'))}</th><th class="num">${esc(t('ro.estCost'))}</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><a href="#/products/${encodeURIComponent(r.sku)}">${esc(r.name)}</a><div class="muted small">${esc(r.sku)}</div></td>
        <td>${statusBadge(r.status)}</td>
        <td class="num">${num(r.on_hand)}</td>
        <td class="nowrap">${fmtDate(r.reorder_by_date)}${r.reorder_by_date && r.reorder_by_date < boot.today ? ` <span class="small" style="color:var(--danger)">(${esc(t('fc.overdue'))})</span>` : ''}</td>
        <td class="small">${esc(r.supplier)}</td>
        <td class="num"><input type="number" min="0" step="1" inputmode="numeric" value="${r.qty}" data-sku="${esc(r.sku)}"
          aria-label="${esc(t('ro.qty'))} ${esc(r.sku)}" style="width:90px;text-align:right"></td>
        <td class="num">${money(r.unit_cost)}</td>
        <td class="num" data-cost="${esc(r.sku)}">${money(r.cost)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="7">${esc(t('ro.total'))}</th><th class="num" id="ro-total">${money(total)}</th></tr></tfoot>
    </table></div></div>`;

    el.querySelectorAll('input[data-sku]').forEach((input) => input.addEventListener('input', () => {
      const qty = Math.max(0, Math.round(Number(input.value) || 0));
      edited[input.dataset.sku] = qty;
      const fresh = rowsNow();
      el.querySelector(`[data-cost="${CSS.escape(input.dataset.sku)}"]`).textContent = money(fresh.find((r) => r.sku === input.dataset.sku).cost);
      el.querySelector('#ro-total').textContent = money(fresh.reduce((sum, r) => sum + r.cost, 0));
    }));
  };

  container.querySelector('#ro-low').addEventListener('change', (e) => { includeLow = e.target.checked; draw(); });
  container.querySelector('#ro-export').addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    const rows = rowsNow().filter((r) => r.qty > 0);
    downloadCSV(`reorder-plan-${todayISO()}.csv`, rows, [
      ['supplier', 'supplier'], ['supplier_email', 'supplier_email'], ['sku', 'sku'], ['name', 'product'],
      ['status', 'status'], ['on_hand', 'on_hand'], ['reorder_by_date', 'reorder_by'], ['qty', 'order_qty'],
      ['unit_cost', 'unit_cost'], [(r) => r.cost.toFixed(2), 'estimated_cost']
    ]);
  }));
  draw();
}
