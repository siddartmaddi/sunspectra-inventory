// dashboard.js: the home page. Three tabs:
//   Stock                  today's numbers (from getBootstrap, so it opens instantly), trends fill in after
//   Sales                  units, revenue, margin, mix, customers, B2B orders (from getKpis)
//   Production & quality   production vs sales, damage, samples, count accuracy and shrinkage (from getKpis)
// Every section only appears when the data for it exists, and almost every number has a trend by month.
import { getBootstrap, getKpis, storageGet, storageSet } from './api.js';
import { t } from './i18n.js';
import {
  esc, money, money0, num, pct, fmtDate, productMap, statusBadge, coverText, drawChart, errorBox, loadingHtml,
  tile, sparkSlot, sparkline, addSparklines, deltaBadge
} from './utils.js';

const TABS = ['stock', 'sales', 'ops'];
const PERIODS = [30, 90, 365];
const COLORS = ['#0f766e', '#e8734a', '#6366f1', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#0ea5e9', '#a855f7', '#94a3b8'];
const CHANNEL_COLORS = { B2C: '#0f766e', B2B2C: '#e8734a', B2B: '#6366f1', INTERNAL: '#94a3b8' };
const CHANNELS = ['B2C', 'B2B2C', 'B2B', 'INTERNAL'];
const STATUS_RANK = { 'OUT': 0, 'REORDER NOW': 1, 'LOW': 2, 'OK': 3, 'INACTIVE': 4 };

// What the person last looked at is remembered between visits (and stays when they leave the page).
let tab = TABS.includes(storageGet('sunspectra.dashTab')) ? storageGet('sunspectra.dashTab') : 'stock';
let period = PERIODS.includes(Number(storageGet('sunspectra.dashPeriod'))) ? Number(storageGet('sunspectra.dashPeriod')) : 90;
let unitsBy = 'channel';
let showAll = false;

export async function render(container) {
  const boot = await getBootstrap();
  container.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(t('dash.title'))}</h1><div class="muted small">${esc(t('dash.asOf', { date: fmtDate(boot.today) }))}</div></div>
      <div class="field" id="period-box" style="margin:0"><label for="dash-period">${esc(t('dash.period'))}</label>
        <select id="dash-period">${PERIODS.map((n) => `<option value="${n}"${n === period ? ' selected' : ''}>${esc(t('kpi.lastDays', { n }))}</option>`).join('')}</select></div>
    </div>
    <div class="tabs" role="tablist">${TABS.map((name) => `<button type="button" class="tab" role="tab" data-tab="${name}">${esc(t('dash.tab' + name[0].toUpperCase() + name.slice(1)))}</button>`).join('')}</div>
    <div id="dash-body"></div>`;

  const body = container.querySelector('#dash-body');
  let latest = 0; // ignore a slow answer if the person already switched tab or period

  const show = async () => {
    const mine = ++latest;
    container.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    container.querySelector('#period-box').classList.toggle('hidden', tab === 'stock');
    if (tab === 'stock') { renderStock(body, boot); return; }

    body.innerHTML = loadingHtml();
    try {
      const k = await getKpis(period);
      if (mine !== latest) return;
      if (tab === 'sales') renderSales(body, boot, k); else renderOps(body, boot, k);
    } catch (err) {
      if (mine === latest) body.innerHTML = errorBox(err);
    }
  };

  container.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    storageSet('sunspectra.dashTab', tab);
    show();
  }));
  container.querySelector('#dash-period').addEventListener('change', (e) => {
    period = Number(e.target.value);
    storageSet('sunspectra.dashPeriod', String(period));
    show();
  });
  await show();
}

// ================================================================ shared bits

const monthLabel = (month) => fmtDate(month + '-15').replace(/^\d+\s/, '');
/** Month names for a chart axis; a * marks a month that is still in progress or only partly recorded. */
const monthLabels = (months) => months.map((x) => monthLabel(x.month) + (x.partial ? '*' : ''));
const partialNote = (months) => (months.some((x) => x.partial) ? ` ${t('kpi.partialNote')}` : '');

/** A white card with a title and optional small hint. */
function card(title, inner, hint = '') {
  return `<div class="card"><h2 style="margin-top:0">${esc(title)}</h2>${hint ? `<p class="muted small" style="margin-top:-.4rem">${esc(hint)}</p>` : ''}${inner}</div>`;
}

/** A table. head: [[label, isNumber]]; rows: arrays of ready-made cell HTML. */
function table(head, rows, cls = 'compact') {
  return `<div class="table-wrap"><table class="${cls}"><thead><tr>${head.map(([label, isNum]) =>
    `<th class="${isNum ? 'num' : ''}">${esc(label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((cell, i) => `<td class="${head[i][1] ? 'num' : ''}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const link = (products, sku) => `<a href="#/products/${encodeURIComponent(sku)}">${esc(products[sku]?.name || sku)}</a><div class="muted small">${esc(sku)}</div>`;

/** "How these numbers are calculated": a closed box at the bottom of each tab. */
function howBox(keys) {
  return `<details class="card how"><summary>${esc(t('kpi.how'))}</summary><ul>${keys.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul></details>`;
}

/** Draws charts after the page is on screen (Chart.js needs the canvas size). */
function later(fn) { requestAnimationFrame(fn); }

const canvasBox = (id, short = false) => `<div class="chart-box${short ? ' short' : ''}"><canvas id="${id}"></canvas></div>`;

const lineSet = (label, data, color, extra = {}) => ({
  type: 'line', label, data, borderColor: color, backgroundColor: color, tension: 0.25, pointRadius: 3, spanGaps: true, ...extra
});

function baseOptions(extra = {}) {
  return { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, ...extra };
}

const percentTicks = { callback: (v) => v + '%' };

// ================================================================ Stock tab

function renderStock(body, boot) {
  const sk = boot.stock_kpis;
  const products = productMap(boot);
  const rows = boot.summary.filter((r) => products[r.sku]?.active);

  const tiles = [
    tile({ label: t('kpi.stockOnHand'), value: num(sk.units), sub: [t('kpi.inStockSub', { n: sk.in_stock, total: sk.active_products })], spark: sparkSlot('units') }),
    sk.days_of_cover !== null && tile({
      label: t('kpi.daysCover'), value: t('fc.days', { n: num(sk.days_of_cover) }),
      sub: [sk.median_cover !== null && t('kpi.medianCover', { n: num(sk.median_cover) })], spark: sparkSlot('cover')
    }),
    tile({
      label: t('kpi.stockoutRisk'), value: num(sk.risk.at_risk), cls: sk.risk.at_risk ? 'bad' : '',
      sub: [t('kpi.riskSplit', sk.risk),
        sk.risk.stockout_soon > 0 && t('kpi.runOutSoon', { n: sk.risk.stockout_soon, days: sk.risk.warn_days }),
        sk.risk.lost_per_day > 0 && t('kpi.lostPerDay', { amount: money0(sk.risk.lost_per_day) })],
      spark: sparkSlot('out')
    }),
    tile({
      label: t('kpi.ropTitle'), value: num(sk.reorder_point.below), cls: sk.reorder_point.below ? 'warn' : '',
      sub: [t('kpi.belowRop'), sk.reorder_point.safety_total > 0 && t('kpi.safetySub', {
        held: num(sk.reorder_point.safety_held), total: num(sk.reorder_point.safety_total), pct: pct(sk.reorder_point.safety_coverage)
      })]
    }),
    tile({
      label: t('kpi.overstock'), value: num(sk.overstock.count), cls: sk.overstock.count ? 'warn' : '',
      sub: [sk.overstock.count > 0 && t('kpi.excessSub', { amount: money0(sk.overstock.excess_value) })]
    }),
    tile({
      label: t('kpi.slowMovers'), value: num(sk.slow_movers.count), cls: sk.slow_movers.count ? 'warn' : '',
      sub: [sk.slow_movers.count > 0 && t('kpi.tiedUp', { amount: money0(sk.slow_movers.value), days: sk.slow_movers.days })],
      spark: sparkSlot('slow')
    }),
    tile({ label: t('kpi.inventoryValue'), value: money0(sk.value.cost), sub: [t('kpi.atRetail', { amount: money0(sk.value.retail) })], spark: sparkSlot('value') })
  ].filter(Boolean).join('');

  const categoryTable = table(
    [[t('col.category')], [t('kpi.col.products'), true], [t('kpi.col.units'), true], [t('kpi.col.cover'), true], [t('kpi.col.valueCost'), true], [t('kpi.col.valueRetail'), true]],
    sk.by_category.map((c) => [esc(c.category), num(c.products), num(c.units), c.days_of_cover === null ? '–' : num(c.days_of_cover), money0(c.value_cost), money0(c.value_retail)]));

  const overstockCard = card(t('kpi.overstockList'), sk.overstock.items.length ? table(
    [[t('col.product')], [t('col.onHand'), true], [t('kpi.col.cover'), true], [t('kpi.col.excessUnits'), true], [t('kpi.col.excessValue'), true]],
    sk.overstock.items.map((o) => [link(products, o.sku), num(o.on_hand), num(o.days_of_cover), num(o.excess_units), money0(o.excess_value)]))
    : `<p class="muted">${esc(t('kpi.noneNow'))}</p>`, t('kpi.overstockHint', { n: sk.overstock.factor }));

  const slowCard = card(t('kpi.slowList'), sk.slow_movers.items.length ? table(
    [[t('col.product')], [t('col.onHand'), true], [t('kpi.col.lastSale')], [t('kpi.col.daysSince'), true], [t('kpi.col.valueCost'), true]],
    sk.slow_movers.items.map((s) => [link(products, s.sku), num(s.on_hand), s.last_sale ? fmtDate(s.last_sale) : esc(t('kpi.never')),
      s.days_since_sale === null ? '–' : num(s.days_since_sale), money0(s.value)]))
    : `<p class="muted">${esc(t('kpi.noneNow'))}</p>`, t('kpi.slowHint', { n: sk.slow_movers.days }));

  body.innerHTML = `
    <div class="kpis wide">${tiles}</div>
    <div id="stock-trends"></div>
    <div class="card" id="attention-card">
      <div class="page-head" style="margin-bottom:.5rem">
        <h2 style="margin:0">${esc(t('dash.needsAttention'))}</h2>
        <label class="check small"><input type="checkbox" id="show-all" ${showAll ? 'checked' : ''}> ${esc(t('dash.showAll'))}</label>
      </div>
      <div id="attention"></div>
    </div>
    ${card(t('kpi.byCategory'), categoryTable)}
    <div class="dash-grid">${overstockCard}${slowCard}</div>
    ${howBox(['kpi.how.stock1', 'kpi.how.stock2', 'kpi.how.stock3', 'kpi.how.stock4'])}`;

  const drawTable = () => drawAttention(body.querySelector('#attention'), rows, products, boot.today);
  body.querySelector('#show-all').addEventListener('change', (e) => { showAll = e.target.checked; drawTable(); });
  drawTable();

  // The month-by-month trends come from a second request. If it fails the page just stays as it is.
  getKpis(period).then((k) => addStockTrends(body, k)).catch(() => {});
}

function drawAttention(el, rows, products, today) {
  const list = rows
    .filter((r) => showAll || r.status !== 'OK')
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || ((a.days_of_cover ?? Infinity) - (b.days_of_cover ?? Infinity)));
  if (!list.length) { el.innerHTML = `<div class="msg info">${esc(t('dash.allGood'))}</div>`; return; }

  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>${esc(t('col.product'))}</th><th class="num">${esc(t('col.onHand'))}</th>
      <th class="num">${esc(t('fc.avgDaily'))}</th><th class="num">${esc(t('fc.cover'))}</th>
      <th>${esc(t('fc.stockout'))}</th><th>${esc(t('fc.reorderBy'))}</th>
      <th class="num">${esc(t('kpi.col.reorderPoint'))}</th><th class="num">${esc(t('kpi.col.safety'))}</th><th>${esc(t('col.status'))}</th>
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
        <td class="num">${num(r.reorder_point)}</td>
        <td class="num">${num(r.safety_stock)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/** Sparklines inside the tiles plus three month-by-month charts. Needs at least 2 months of history. */
function addStockTrends(body, k) {
  const slot = body.querySelector('#stock-trends');
  if (!slot || k.months.length < 2) return;
  const m = k.months;
  addSparklines(body, {
    units: m.map((x) => x.stock.units), value: m.map((x) => x.stock.value), out: m.map((x) => x.stock.out),
    cover: m.map((x) => x.stock.cover), slow: m.map((x) => x.stock.slow_count)
  });

  const hasCover = m.some((x) => x.stock.cover !== null);
  const hasSlow = m.some((x) => x.stock.slow_count > 0);
  slot.innerHTML = `
    <div class="dash-grid trio">
      ${card(t('kpi.stockTrend'), canvasBox('chart-stock-trend', true), t('kpi.trendNote'))}
      ${hasCover ? card(t('kpi.coverTrend'), canvasBox('chart-cover-trend', true)) : ''}
      ${hasSlow ? card(t('kpi.slowTrend'), canvasBox('chart-slow-trend', true)) : ''}
    </div>`;
  const labels = monthLabels(m);

  later(() => {
    drawChart(document.getElementById('chart-stock-trend'), {
      data: { labels, datasets: [
        lineSet(t('kpi.series.units'), m.map((x) => x.stock.units), '#0f766e', { yAxisID: 'y' }),
        lineSet(t('kpi.series.value'), m.map((x) => x.stock.value), '#e8734a', { yAxisID: 'y1' })
      ] },
      options: baseOptions({ scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } })
    });
    if (hasCover) {
      drawChart(document.getElementById('chart-cover-trend'), {
        data: { labels, datasets: [
          { type: 'bar', label: t('kpi.series.out'), data: m.map((x) => x.stock.out), backgroundColor: '#fca5a5', yAxisID: 'y1' },
          lineSet(t('kpi.series.cover'), m.map((x) => x.stock.cover), '#0f766e', { yAxisID: 'y' })
        ] },
        options: baseOptions({ scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } } } })
      });
    }
    if (hasSlow) {
      drawChart(document.getElementById('chart-slow-trend'), {
        type: 'bar',
        data: { labels, datasets: [{ label: t('kpi.series.slowValue'), data: m.map((x) => x.stock.slow_value), backgroundColor: '#f59e0b' }] },
        options: baseOptions({ scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } })
      });
    }
  });
}

// ================================================================ Sales tab

function renderSales(body, boot, k) {
  if (!k.units) { body.innerHTML = `<div class="msg info">${esc(t('kpi.noSales'))}</div>`; return; }
  const products = productMap(boot);
  const m = k.months;
  const p = k.prev;
  const hasTrend = m.length >= 2;
  const spark = (fn) => (hasTrend ? sparkline(m.map(fn)) : '');
  const share = (a, b) => (b > 0 ? a / b : null);
  const kitShareSeries = m.map((x) => share(x.kit_revenue, x.revenue));
  const top3Series = m.map((x) => x.top3_share);
  const orderUnitsSeries = m.map((x) => share(x.biz_units, x.biz_orders));
  const orderRevenueSeries = m.map((x) => share(x.biz_revenue, x.biz_orders));
  const hasKits = k.kit.units > 0;
  const hasCustomers = k.customers.top1_share !== null;
  const hasOrders = k.biz.orders > 0;

  const tiles = [
    tile({ label: t('kpi.unitsSold'), value: num(k.units), delta: deltaBadge(k.units, p.units), spark: spark((x) => x.units) }),
    tile({ label: t('kpi.estRevenue'), value: money0(k.revenue), delta: deltaBadge(k.revenue, p.revenue), spark: spark((x) => x.revenue) }),
    tile({
      label: t('kpi.estMargin'), value: money0(k.margin), sub: [k.margin_pct !== null && t('kpi.ofRevenue', { pct: pct(k.margin_pct) })],
      delta: deltaBadge(k.margin, p.margin), spark: spark((x) => x.margin)
    }),
    hasKits && tile({
      label: t('kpi.kitShare'), value: pct(k.kit.revenue_share), sub: [t('kpi.ofUnits', { pct: pct(k.kit.units_share) })],
      delta: deltaBadge(k.kit.revenue_share, p.kit_revenue_share, { good: null, mode: 'pts' }), spark: hasTrend ? sparkline(kitShareSeries) : ''
    }),
    hasCustomers && tile({
      label: t('kpi.top3'), value: pct(k.customers.top3_share),
      sub: [t('kpi.top3Sub', { name: k.customers.top[0].customer, pct: pct(k.customers.top1_share) })],
      delta: deltaBadge(k.customers.top3_share, p.top3_share, { good: 'down', mode: 'pts' }), spark: hasTrend ? sparkline(top3Series) : ''
    }),
    hasOrders && tile({
      label: t('kpi.avgOrder'), value: money0(k.biz.avg_revenue), sub: [t('kpi.avgOrderSub', { n: num(k.biz.avg_units, 1), orders: num(k.biz.orders) })],
      delta: deltaBadge(k.biz.avg_revenue, p.biz_avg_revenue), spark: hasTrend ? sparkline(orderRevenueSeries) : ''
    })
  ].filter(Boolean).join('');

  // Channel table + doughnut, and the month-by-month share chart.
  const channelTable = table(
    [[t('col.channel')], [t('kpi.col.units'), true], [t('kpi.estRevenue'), true], [t('kpi.col.share'), true], [t('kpi.col.margin'), true]],
    k.by_channel.map((c) => [`<span class="legend-dot" style="background:${CHANNEL_COLORS[c.channel] || '#94a3b8'}"></span>${esc(t('channel.' + c.channel))}`,
      num(c.units), money0(c.revenue), pct(c.revenue_share), money0(c.margin)]));

  // The "vs before" column only appears when there are sales from the previous period to compare with.
  const compare = [...k.top, ...k.bottom].some((r) => r.prev_units > 0);
  const sellerRow = (r) => [link(products, r.sku), num(r.units), money0(r.revenue), ...(compare ? [deltaBadge(r.units, r.prev_units) || '<span class="muted">–</span>'] : [])];
  const sellerHead = [[t('col.product')], [t('kpi.col.units'), true], [t('kpi.estRevenue'), true], ...(compare ? [[t('kpi.col.vsBefore'), true]] : [])];

  const kitCard = hasKits && card(t('kpi.kitMix'), `
      <div class="muted small">${esc(t('kpi.estRevenue'))}</div>
      <div class="mixbar" aria-hidden="true"><span style="width:${(k.kit.revenue_share * 100).toFixed(1)}%;background:#e8734a"></span><span style="flex:1;background:#0f766e"></span></div>
      ${table([[''], [t('kpi.col.units'), true], [t('kpi.col.share'), true], [t('kpi.estRevenue'), true], [t('kpi.col.share'), true]], [
        [`<span class="legend-dot" style="background:#e8734a"></span>${esc(t('kpi.kits'))}`, num(k.kit.units), pct(k.kit.units_share), money0(k.kit.revenue), pct(k.kit.revenue_share)],
        [`<span class="legend-dot" style="background:#0f766e"></span>${esc(t('kpi.singles'))}`, num(k.units - k.kit.units), pct(1 - k.kit.units_share), money0(k.revenue - k.kit.revenue), pct(1 - k.kit.revenue_share)]
      ])}
      ${hasTrend ? `<h3>${esc(t('kpi.kitTrend'))}</h3>${canvasBox('chart-kit', true)}` : ''}`);

  const customerCard = hasCustomers && card(t('kpi.customers'), `
      ${k.customers.no_customer_share > 0 ? `<div class="msg warn">${esc(t('kpi.noCustomerWarn', { pct: pct(k.customers.no_customer_share) }))}</div>` : ''}
      ${table([[t('kpi.col.customer')], [t('kpi.col.orders'), true], [t('kpi.col.units'), true], [t('kpi.estRevenue'), true], [t('kpi.col.share'), true]],
        k.customers.top.map((c) => [esc(c.customer), num(c.orders), num(c.units), money0(c.revenue), pct(c.share, 1)]))}
      <p class="small muted">Top 1: ${pct(k.customers.top1_share)} · Top 3: ${pct(k.customers.top3_share)} · Top 5: ${pct(k.customers.top5_share)}</p>
      ${top3Series.filter((v) => v !== null).length >= 2 ? `<h3>${esc(t('kpi.top3Trend'))}</h3>${canvasBox('chart-top3', true)}` : ''}`,
    t('kpi.customersHint'));

  const ordersCard = hasOrders && card(t('kpi.b2bOrders'), `
      ${table([[t('col.channel')], [t('kpi.col.orders'), true], [t('kpi.col.avgUnits'), true], [t('kpi.col.avgRevenue'), true]], [
        ...k.biz.by_channel.map((c) => [esc(t('channel.' + c.channel)), num(c.orders), num(c.avg_units, 1), money(c.avg_revenue)]),
        [`<strong>${esc(t('kpi.allBusiness'))}</strong>`, num(k.biz.orders), num(k.biz.avg_units, 1), money(k.biz.avg_revenue)]
      ])}
      ${orderUnitsSeries.filter((v) => v !== null).length >= 2 ? `<h3>${esc(t('kpi.orderTrend'))}</h3>${canvasBox('chart-orders', true)}` : ''}`,
    t('kpi.b2bHint'));

  body.innerHTML = `
    <p class="muted small">${esc(t('kpi.compareNote', { n: k.days }) + partialNote(m))}</p>
    <div class="kpis wide">${tiles}</div>
    <div class="card">
      <h2 style="margin-top:0">${esc(t('kpi.unitsChart'))}</h2>
      <div class="toggle-group" role="group">${['channel', 'category', 'product'].map((by) =>
        `<button type="button" data-by="${by}" aria-pressed="${by === unitsBy}">${esc(t('kpi.by.' + by))}</button>`).join('')}</div>
      ${canvasBox('chart-units')}
    </div>
    <div class="dash-grid">
      ${card(t('kpi.revMargin'), canvasBox('chart-revenue', true))}
      ${card(t('kpi.channelShare'), `${canvasBox('chart-channel', true)}${channelTable}${hasTrend ? `<h3>${esc(t('kpi.shareTrend'))}</h3>${canvasBox('chart-share', true)}` : ''}`)}
      ${card(t('kpi.topSellers'), table(sellerHead, k.top.map(sellerRow)))}
      ${card(t('kpi.bottomSellers'), table(sellerHead, k.bottom.map(sellerRow)), t('kpi.bottomHint'))}
      ${kitCard || ''}${customerCard || ''}${ordersCard || ''}
    </div>
    ${howBox(['kpi.how.sales1', 'kpi.how.sales2'])}`;

  const labels = monthLabels(m);
  const drawUnits = () => drawUnitsChart(document.getElementById('chart-units'), k, products, labels);
  body.querySelectorAll('[data-by]').forEach((b) => b.addEventListener('click', () => {
    unitsBy = b.dataset.by;
    body.querySelectorAll('[data-by]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.by === unitsBy));
    drawUnits();
  }));

  later(() => {
    drawUnits();
    drawChart(document.getElementById('chart-revenue'), {
      data: { labels, datasets: [
        { type: 'bar', label: t('kpi.series.revenue'), data: m.map((x) => x.revenue), backgroundColor: '#e8734a', yAxisID: 'y' },
        lineSet(t('kpi.series.marginPct'), m.map((x) => (x.revenue > 0 ? Math.round((x.margin / x.revenue) * 1000) / 10 : null)), '#0f766e', { yAxisID: 'y1' })
      ] },
      options: baseOptions({ scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, ticks: percentTicks } } })
    });
    drawChart(document.getElementById('chart-channel'), {
      type: 'doughnut',
      data: { labels: k.by_channel.map((c) => t('channel.' + c.channel)), datasets: [{ data: k.by_channel.map((c) => c.revenue), backgroundColor: k.by_channel.map((c) => CHANNEL_COLORS[c.channel] || '#94a3b8') }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
    if (hasTrend) {
      const used = CHANNELS.filter((c) => m.some((x) => x.revenue_by_channel[c]));
      drawChart(document.getElementById('chart-share'), {
        type: 'bar',
        data: { labels, datasets: used.map((c) => ({
          label: t('channel.' + c), backgroundColor: CHANNEL_COLORS[c],
          data: m.map((x) => (x.revenue > 0 ? Math.round(((x.revenue_by_channel[c] || 0) / x.revenue) * 1000) / 10 : 0))
        })) },
        options: baseOptions({ scales: { x: { stacked: true }, y: { stacked: true, max: 100, ticks: percentTicks } } })
      });
      if (hasKits) {
        drawChart(document.getElementById('chart-kit'), {
          data: { labels, datasets: [lineSet(t('kpi.kitShare'), kitShareSeries.map((v) => (v === null ? null : Math.round(v * 1000) / 10)), '#e8734a')] },
          options: baseOptions({ scales: { y: { beginAtZero: true, ticks: percentTicks } }, plugins: { legend: { display: false } } })
        });
      }
      if (top3Series.filter((v) => v !== null).length >= 2) {
        drawChart(document.getElementById('chart-top3'), {
          data: { labels, datasets: [lineSet(t('kpi.top3'), top3Series.map((v) => (v === null ? null : Math.round(v * 1000) / 10)), '#6366f1')] },
          options: baseOptions({ scales: { y: { beginAtZero: true, max: 100, ticks: percentTicks } }, plugins: { legend: { display: false } } })
        });
      }
      if (orderUnitsSeries.filter((v) => v !== null).length >= 2) {
        drawChart(document.getElementById('chart-orders'), {
          data: { labels, datasets: [lineSet(t('kpi.col.avgUnits'), orderUnitsSeries.map((v) => (v === null ? null : Math.round(v * 10) / 10)), '#0f766e')] },
          options: baseOptions({ scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } })
        });
      }
    }
  });
}

/** Units sold by month, stacked by channel, category or product (the 8 biggest + "other"). */
function drawUnitsChart(canvas, k, products, labels) {
  const m = k.months;
  let datasets;
  if (unitsBy === 'channel') {
    datasets = CHANNELS.filter((c) => m.some((x) => x.by_channel[c])).map((c) => ({
      label: t('channel.' + c), backgroundColor: CHANNEL_COLORS[c], data: m.map((x) => x.by_channel[c] || 0)
    }));
  } else {
    const field = unitsBy === 'category' ? 'by_category' : 'by_sku';
    const keys = [...new Set(m.flatMap((x) => Object.keys(x[field])))];
    const total = (key) => m.reduce((sum, x) => sum + (x[field][key] || 0), 0);
    keys.sort((a, b) => (a === '_other') - (b === '_other') || total(b) - total(a));
    datasets = keys.map((key, i) => ({
      label: key === '_other' ? t('kpi.other') : unitsBy === 'category' ? key : (products[key]?.name || key),
      backgroundColor: COLORS[i % COLORS.length], data: m.map((x) => x[field][key] || 0)
    }));
  }
  drawChart(canvas, {
    type: 'bar', data: { labels, datasets },
    options: baseOptions({ scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: t('dash.units') } } } })
  });
}

// ================================================================ Production & quality tab

function renderOps(body, boot, k) {
  const m = k.months;
  const p = k.prev;
  const f = k.flows;
  const c = k.counts;
  const hasTrend = m.length >= 2;
  const spark = (fn) => (hasTrend ? sparkline(m.map(fn)) : '');
  const rate = (a, b) => (b > 0 ? a / b : null);

  const hasProduction = f.produced + f.received > 0 || m.some((x) => x.produced + x.received > 0);
  const hasDamage = f.damaged > 0 || m.some((x) => x.damaged > 0);
  const hasSamples = f.samples > 0 || m.some((x) => x.samples > 0);
  const hasExpired = f.expired > 0 || m.some((x) => x.expired > 0);
  const hasCounts = c.lines > 0;
  const hasCountHistory = m.some((x) => x.counts.lines > 0);

  if (!hasProduction && !hasDamage && !hasSamples && !hasExpired && !hasCounts && !hasCountHistory) {
    body.innerHTML = `<div class="msg info">${esc(t('kpi.opsEmpty'))}</div>`;
    return;
  }

  const accuracyOf = (x) => (x.counts.system > 0 ? Math.max(0, 1 - x.counts.abs / x.counts.system) : null);
  const tiles = [
    hasProduction && f.produced > 0 && tile({
      label: t('kpi.produced'), value: num(f.produced), sub: [f.received > 0 && t('kpi.receivedSub', { n: num(f.received) })],
      delta: deltaBadge(f.produced, p.produced, { good: null }), spark: spark((x) => x.produced)
    }),
    hasProduction && f.production_vs_sales !== null && tile({
      label: t('kpi.prodVsSales'), value: f.production_vs_sales.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '×',
      sub: [t('kpi.producedVsSold', { p: num(f.produced), s: num(k.units) })], spark: spark((x) => rate(x.produced, x.units))
    }),
    hasDamage && f.damage_rate !== null && tile({
      label: t('kpi.damageRate'), value: pct(f.damage_rate, 1), sub: [t('kpi.damagedSub', { n: num(f.damaged), amount: money0(f.damaged_cost) })],
      delta: deltaBadge(f.damage_rate, p.damage_rate, { good: 'down', mode: 'pts' }), spark: spark((x) => rate(x.damaged, x.units))
    }),
    hasSamples && f.sample_rate !== null && tile({
      label: t('kpi.sampleRate'), value: pct(f.sample_rate, 1), sub: [t('kpi.sampleSub', { n: num(f.samples), amount: money0(f.sample_cost) })],
      delta: deltaBadge(f.sample_rate, p.sample_rate, { good: null, mode: 'pts' }), spark: spark((x) => rate(x.samples, x.units))
    }),
    hasCounts && c.unit_accuracy !== null && tile({
      label: t('kpi.countAccuracy'), value: pct(c.unit_accuracy, 1), sub: [t('kpi.countAccuracySub', { exact: c.exact, lines: c.lines })],
      delta: deltaBadge(c.unit_accuracy, p.count_accuracy, { good: 'up', mode: 'pts' }), spark: spark(accuracyOf)
    }),
    hasCounts && tile({
      label: t('kpi.shrinkage'), value: money0(c.short_value), cls: c.short_value > 0 ? 'warn' : '',
      sub: [t('kpi.shrinkSub', { units: num(c.short_units), over: num(c.over_units) })], spark: spark((x) => x.counts.short_value)
    })
  ].filter(Boolean).join('');

  const lossRows = [['DAMAGED', f.damaged, f.damage_rate, f.damaged_cost], ['EXPIRED', f.expired, f.expired_rate, f.expired_cost], ['SAMPLE', f.samples, f.sample_rate, f.sample_cost]]
    .filter(([, units]) => units > 0)
    .map(([type, units, share, cost]) => [esc(t('type.' + type)), num(units), pct(share, 1), money0(cost)]);
  const lossCard = (hasDamage || hasSamples || hasExpired) && card(t('kpi.losses'), `
      ${lossRows.length ? table([[t('col.type')], [t('kpi.col.units'), true], [t('kpi.col.pctSold'), true], [t('kpi.col.valueCost'), true]], lossRows) : ''}
      ${hasTrend ? `<h3>${esc(t('kpi.lossChart'))}</h3>${canvasBox('chart-loss', true)}` : ''}`);

  const products = productMap(boot);
  const countCard = (hasCounts || hasCountHistory) && card(t('kpi.countDetail'), `
      ${hasCounts ? `<p>${esc(t('kpi.sessions'))}: <strong>${num(c.sessions)}</strong> · ${esc(t('kpi.lineAccuracy'))}: <strong>${pct(c.line_accuracy, 1)}</strong>
        · ${esc(t('kpi.unitAccuracy'))}: <strong>${pct(c.unit_accuracy, 1)}</strong></p>` : ''}
      ${hasCounts && c.worst.length ? `<h3>${esc(t('kpi.biggestDiffs'))}</h3>${table(
        [[t('col.product')], [t('kpi.col.net'), true], [t('kpi.col.valueCost'), true]],
        c.worst.map((w) => [link(products, w.sku), (w.net > 0 ? '+' : '') + num(w.net), money(w.value)]))}` : ''}
      ${hasCountHistory && hasTrend ? `<h3>${esc(t('kpi.countTrend'))}</h3>${canvasBox('chart-counts', true)}` : ''}`);

  body.innerHTML = `
    <p class="muted small">${esc(t('kpi.compareNote', { n: k.days }) + partialNote(m))}</p>
    <div class="kpis wide">${tiles}</div>
    <div class="dash-grid" style="margin-top:0">
      ${hasProduction ? card(t('kpi.prodChart'), canvasBox('chart-production', true)) : ''}
      ${lossCard || ''}${countCard || ''}
    </div>
    ${howBox(['kpi.how.ops1', 'kpi.how.ops2'])}`;

  const labels = monthLabels(m);
  later(() => {
    if (hasProduction) {
      const sets = [
        { label: t('kpi.series.produced'), data: m.map((x) => x.produced), backgroundColor: '#0f766e' },
        m.some((x) => x.received > 0) && { label: t('kpi.series.received'), data: m.map((x) => x.received), backgroundColor: '#6366f1' },
        { label: t('kpi.series.sold'), data: m.map((x) => x.units), backgroundColor: '#e8734a' }
      ].filter(Boolean);
      drawChart(document.getElementById('chart-production'), {
        type: 'bar', data: { labels, datasets: sets },
        options: baseOptions({ scales: { y: { beginAtZero: true, title: { display: true, text: t('dash.units') } } } })
      });
    }
    if (lossCard && hasTrend) {
      const sets = [
        hasDamage && lineSet(t('kpi.series.damageRate'), m.map((x) => (x.units > 0 ? Math.round((x.damaged / x.units) * 1000) / 10 : null)), '#b42318'),
        hasSamples && lineSet(t('kpi.series.sampleRate'), m.map((x) => (x.units > 0 ? Math.round((x.samples / x.units) * 1000) / 10 : null)), '#6366f1')
      ].filter(Boolean);
      if (sets.length) {
        drawChart(document.getElementById('chart-loss'), {
          data: { labels, datasets: sets }, options: baseOptions({ scales: { y: { beginAtZero: true, ticks: percentTicks } } })
        });
      }
    }
    if (countCard && hasCountHistory && hasTrend) {
      drawChart(document.getElementById('chart-counts'), {
        data: { labels, datasets: [
          { type: 'bar', label: t('kpi.series.shrink'), data: m.map((x) => (x.counts.lines ? x.counts.short_value : null)), backgroundColor: '#fca5a5', yAxisID: 'y1' },
          lineSet(t('kpi.series.accuracy'), m.map((x) => { const a = accuracyOf(x); return a === null ? null : Math.round(a * 1000) / 10; }), '#0f766e', { yAxisID: 'y' })
        ] },
        options: baseOptions({ scales: { y: { min: 0, max: 100, position: 'left', ticks: percentTicks }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } })
      });
    }
  });
}
