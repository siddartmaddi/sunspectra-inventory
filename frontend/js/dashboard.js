// dashboard.js: home page with KPI tiles, the "Needs attention" table and sales charts.
import { getBootstrap } from './api.js';
import { t } from './i18n.js';
import { esc, money, num, fmtDate, addDays, summaryMap, productMap, statusBadge, coverText, drawChart } from './utils.js';

const CHANNEL_COLORS = { B2C: '#0f766e', B2B2C: '#e8734a', B2B: '#6366f1', INTERNAL: '#94a3b8' };
const STATUS_RANK = { 'OUT': 0, 'REORDER NOW': 1, 'LOW': 2, 'OK': 3, 'INACTIVE': 4 };

let showAll = false; // "Show all products" toggle, remembered while the app is open

export async function render(container) {
  const boot = await getBootstrap();
  const products = productMap(boot);
  const rows = boot.summary.filter((s) => products[s.sku]?.active);
  const warnDays = Number(boot.settings.stockout_warning_days) || 14;
  const soonLimit = addDays(boot.today, warnDays);

  const out = rows.filter((r) => r.on_hand <= 0).length;
  const belowReorder = rows.filter((r) => r.on_hand > 0 && r.on_hand <= r.reorder_point).length;
  const stockoutsSoon = rows.filter((r) => r.on_hand > 0 && r.stockout_date && r.stockout_date <= soonLimit).length;
  const value = rows.reduce((sum, r) => sum + (r.value || 0), 0);

  container.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(t('dash.title'))}</h1><div class="muted small">${esc(t('dash.asOf', { date: fmtDate(boot.today) }))}</div></div>
    </div>
    <div class="kpis">
      ${kpi(t('dash.activeProducts'), rows.length)}
      ${kpi(t('dash.outOfStock'), out, out ? 'bad' : '')}
      ${kpi(t('dash.belowReorder'), belowReorder, belowReorder ? 'warn' : '')}
      ${kpi(t('dash.stockoutsSoon', { n: warnDays }), stockoutsSoon, stockoutsSoon ? 'warn' : '')}
      ${kpi(t('dash.inventoryValue'), money(value))}
    </div>
    <div class="card">
      <div class="page-head" style="margin-bottom:.5rem">
        <h2 style="margin:0">${esc(t('dash.needsAttention'))}</h2>
        <label class="check small"><input type="checkbox" id="show-all" ${showAll ? 'checked' : ''}> ${esc(t('dash.showAll'))}</label>
      </div>
      <div id="attention"></div>
    </div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card"><h2 style="margin-top:0">${esc(t('dash.salesByMonth'))}</h2><div class="chart-box"><canvas id="chart-months"></canvas></div></div>
      <div class="card"><h2 style="margin-top:0">${esc(t('dash.topSellers'))}</h2><div class="chart-box"><canvas id="chart-top"></canvas></div></div>
    </div>`;

  const drawTable = () => drawAttention(container.querySelector('#attention'), rows, products, boot.today);
  container.querySelector('#show-all').addEventListener('change', (e) => { showAll = e.target.checked; drawTable(); });
  drawTable();

  // Charts are drawn after the page is on screen (Chart.js needs the canvas size).
  requestAnimationFrame(() => {
    drawMonthChart(container.querySelector('#chart-months'), boot.sales.by_month);
    drawTopChart(container.querySelector('#chart-top'), boot.sales.top_30_days, products);
  });
}

function kpi(label, value, cls = '') {
  return `<div class="kpi ${cls}"><div class="label">${esc(label)}</div><div class="value">${typeof value === 'number' ? num(value) : esc(value)}</div></div>`;
}

function drawAttention(el, rows, products, today) {
  const list = rows
    .filter((r) => showAll || r.status !== 'OK')
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) ||
      ((a.days_of_cover ?? Infinity) - (b.days_of_cover ?? Infinity)));
  if (!list.length) { el.innerHTML = `<div class="msg info">${esc(t('dash.allGood'))}</div>`; return; }

  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>${esc(t('col.product'))}</th><th class="num">${esc(t('col.onHand'))}</th>
      <th class="num">${esc(t('fc.avgDaily'))}</th><th class="num">${esc(t('fc.cover'))}</th>
      <th>${esc(t('fc.stockout'))}</th><th>${esc(t('fc.reorderBy'))}</th><th>${esc(t('col.status'))}</th>
    </tr></thead>
    <tbody>${list.map((r) => {
      const overdue = r.reorder_by_date && r.reorder_by_date < today;
      return `<tr>
        <td><a href="#/products/${encodeURIComponent(r.sku)}">${esc(products[r.sku].name)}</a>
          <div class="muted small">${esc(r.sku)}${r.low_data ? ` · ${esc(t('fc.lowData'))}` : ''}</div></td>
        <td class="num">${num(r.on_hand)}</td>
        <td class="num">${num(r.avg_daily, 1)}</td>
        <td class="num">${esc(coverText(r))}</td>
        <td class="nowrap">${r.on_hand > 0 ? fmtDate(r.stockout_date) : '–'}</td>
        <td class="nowrap">${fmtDate(r.reorder_by_date)}${overdue ? ` <span class="small" style="color:var(--danger)">(${esc(t('fc.overdue'))})</span>` : ''}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function drawMonthChart(canvas, byMonth) {
  const months = Object.keys(byMonth).sort();
  const channels = ['B2C', 'B2B2C', 'B2B', 'INTERNAL'].filter((c) => months.some((m) => byMonth[m][c]));
  drawChart(canvas, {
    type: 'bar',
    data: {
      labels: months.map((m) => fmtDate(m + '-15').replace(/^\d+\s/, '')),
      datasets: channels.map((c) => ({
        label: t('channel.' + c), data: months.map((m) => byMonth[m][c] || 0), backgroundColor: CHANNEL_COLORS[c]
      }))
    },
    options: {
      maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: t('dash.units') } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function drawTopChart(canvas, top, products) {
  drawChart(canvas, {
    type: 'bar',
    data: {
      labels: top.map((r) => products[r.sku]?.name || r.sku),
      datasets: [{ label: t('dash.units'), data: top.map((r) => r.units), backgroundColor: '#0f766e' }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false, font: { size: 11 } } } },
      plugins: { legend: { display: false } }
    }
  });
}
