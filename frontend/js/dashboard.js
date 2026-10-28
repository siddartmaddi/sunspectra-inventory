// dashboard.js: home page with KPI tiles and current stock.
import { getBootstrap } from './api.js';
import { t } from './i18n.js';
import { esc, money, num, fmtDate, summaryMap } from './utils.js';

export async function render(container) {
  const boot = await getBootstrap();
  const summary = summaryMap(boot);
  const active = boot.products.filter((p) => p.active);
  const outOfStock = active.filter((p) => (summary[p.sku]?.on_hand || 0) <= 0);
  const value = active.reduce((sum, p) => sum + (summary[p.sku]?.value || 0), 0);

  // Lowest stock first, so the problems are at the top.
  const rows = active.slice().sort((a, b) => (summary[a.sku]?.on_hand || 0) - (summary[b.sku]?.on_hand || 0));

  container.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(t('dash.title'))}</h1><div class="muted small">${esc(t('dash.asOf', { date: fmtDate(boot.today) }))}</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">${esc(t('dash.activeProducts'))}</div><div class="value">${active.length}</div></div>
      <div class="kpi ${outOfStock.length ? 'bad' : ''}"><div class="label">${esc(t('dash.outOfStock'))}</div><div class="value">${outOfStock.length}</div></div>
      <div class="kpi"><div class="label">${esc(t('dash.inventoryValue'))}</div><div class="value">${money(value)}</div></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">${esc(t('dash.currentStock'))}</h2>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>${esc(t('col.product'))}</th><th>${esc(t('col.category'))}</th>
          <th class="num">${esc(t('col.onHand'))}</th><th class="num">${esc(t('col.value'))}</th>
        </tr></thead>
        <tbody>${rows.map((p) => {
          const s = summary[p.sku] || {};
          const badge = s.on_hand <= 0 ? ` <span class="badge out">OUT</span>` : '';
          return `<tr>
            <td><a href="#/products/${encodeURIComponent(p.sku)}">${esc(p.name)}</a><div class="muted small">${esc(p.sku)}</div></td>
            <td>${esc(p.category)}</td>
            <td class="num">${num(s.on_hand)}${badge}</td>
            <td class="num">${money(s.value)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}
