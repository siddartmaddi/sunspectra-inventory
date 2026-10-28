// reports.js: sales by month and channel, top sellers, slow movers, stock value by category,
// count variances. Each table can be exported to CSV.
import { call, getBootstrap } from './api.js';
import { t } from './i18n.js';
import { esc, money, num, fmtDate, downloadCSV, todayISO, optionsHtml, productMap } from './utils.js';

let topDays = 90;

export async function render(container) {
  const [boot, report] = await Promise.all([getBootstrap(), call('getReport', { top_days: topDays })]);
  const products = productMap(boot);

  // Each section: [id, title, hint, rows, columns: [key or fn, header, format]]
  const sections = [
    ['sales', t('rep.salesByMonth'), t('rep.revenueHint'), report.sales_by_month, [
      ['month', t('rep.month'), (v) => fmtDate(v + '-15').replace(/^\d+\s/, '')], ['channel', t('col.channel')],
      ['units', t('dash.units'), num], ['revenue', t('rep.revenue'), money]]],
    ['top', t('rep.topSellers', { n: report.top_days }), '', report.top_sellers, [
      ['name', t('col.product')], ['sku', t('col.sku')], ['units', t('dash.units'), num], ['revenue', t('rep.revenue'), money]]],
    ['slow', t('rep.slowMovers'), t('rep.slowHint'), report.slow_movers, [
      ['name', t('col.product')], ['sku', t('col.sku')], ['on_hand', t('col.onHand'), num],
      ['last_sale', t('rep.lastSale'), (v) => (v ? fmtDate(v) : t('rep.never'))], ['value', t('rep.valueTiedUp'), money]]],
    ['category', t('rep.valueByCategory'), '', report.value_by_category, [
      ['category', t('col.category')], ['products', t('nav.products'), num], ['units', t('dash.units'), num],
      ['value_cost', t('rep.atCost'), money], ['value_retail', t('rep.atRetail'), money]]],
    ['variance', t('rep.countVariance'), t('rep.varianceHint'), report.count_variance, [
      ['name', t('col.product')], ['counts', t('cnt.counts'), num], ['counts_with_difference', t('cnt.withDifference'), num],
      ['total_variance', t('cnt.netVariance'), num], ['value', t('rep.varianceValue'), money], ['last_count', t('rep.lastCount'), fmtDate]]]
  ];

  container.innerHTML = `
    <div class="page-head"><div><h1>${esc(t('rep.title'))}</h1><div class="muted small">${esc(t('dash.asOf', { date: fmtDate(report.today) }))}</div></div>
      <div class="field" style="margin:0"><label for="rep-days">${esc(t('rep.period'))}</label>
        <select id="rep-days">${optionsHtml([[30, t('fc.days', { n: 30 })], [90, t('fc.days', { n: 90 })], [365, t('fc.days', { n: 365 })]], topDays)}</select></div>
    </div>
    ${sections.map(([id, title, hint, rows, cols]) => `
      <div class="card">
        <div class="page-head" style="margin:0 0 .5rem"><h2 style="margin:0">${esc(title)}</h2>
          <button type="button" class="secondary small" data-export="${id}" ${rows.length ? '' : 'disabled'}>${esc(t('common.exportCsv'))}</button></div>
        ${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr>${cols.map(([, h, f]) => `<th class="${f === num || f === money ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${cols.map(([k, , f]) => {
            const v = r[k];
            const text = f ? f(v) : v;
            const cls = f === num || f === money ? 'num' : '';
            return k === 'name' ? `<td><a href="#/products/${encodeURIComponent(r.sku)}">${esc(products[r.sku]?.name || v)}</a></td>`
              : `<td class="${cls}">${esc(text)}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>` : `<p class="muted">${esc(t('common.none'))}</p>`}
      </div>`).join('')}`;

  container.querySelector('#rep-days').addEventListener('change', (e) => { topDays = Number(e.target.value); render(container); });
  container.querySelectorAll('[data-export]').forEach((btn) => btn.addEventListener('click', () => {
    const [id, , , rows] = sections.find((s) => s[0] === btn.dataset.export);
    // CSV keeps raw values (no currency symbols) so the numbers stay usable in a spreadsheet.
    downloadCSV(`report-${id}-${todayISO()}.csv`, rows, Object.keys(rows[0]).map((k) => [k, k]));
  }));
}
