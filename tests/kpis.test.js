// Tests for the dashboard numbers in backend/Kpis.gs, run in Node against a small hand-made dataset.
// The expected values below are worked out by hand in the comments, so a failure means a real change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, callApi } = require('../dev/fake-apps-script');

const TODAY = '2026-11-27';
const SETTINGS = { service_level: 0.95, forecast_window_days: 90, stockout_warning_days: 14, include_samples_in_demand: 'FALSE' };
const b = loadBackend({ now: TODAY + 'T15:00:00Z' });

const product = (sku, category, retail, wholesale, cost, extra = {}) => ({
  sku, name: sku + ' name', category, unit: 'unit', unit_cost: cost, retail_price: retail, wholesale_price: wholesale,
  lead_time_days: 10, min_order_qty: 10, target_cover_days: 60, active: true, ...extra
});
const PRODUCTS = [
  product('LB-A', 'Lip Balm', 10, 7, 2),
  product('KIT-K', 'Kit', 30, 21, 10),
  product('SLOW-S', 'Skincare', 20, 14, 5),
  product('OUT-1', 'Makeup', 12, 8, 3),
  product('DISC-1', 'Makeup', 12, 8, 3, { active: false })
];

let n = 0;
const mv = (date, sku, type, qty, channel = 'INTERNAL', extra = {}) =>
  ({ movement_id: 'M' + (++n), date, sku, type, qty, channel, customer: '', reference: '', note: '', reverses_id: '', created_at: date, ...extra });

const sale4 = mv('2026-11-10', 'LB-A', 'SALE', -4, 'B2C');
const MOVEMENTS = [
  mv('2026-08-01', 'LB-A', 'OPENING', 100), mv('2026-08-01', 'KIT-K', 'OPENING', 50),
  mv('2026-08-01', 'SLOW-S', 'OPENING', 20), mv('2026-08-01', 'OUT-1', 'OPENING', 5), mv('2026-08-01', 'DISC-1', 'OPENING', 4),
  mv('2026-08-10', 'SLOW-S', 'SALE', -2, 'B2C'),
  mv('2026-09-10', 'OUT-1', 'SALE', -5, 'B2C'),
  mv('2026-10-15', 'LB-A', 'SALE', -6, 'B2C'),                       // before the 30-day period
  mv('2026-11-20', 'LB-A', 'SALE', -5, 'B2C'),
  mv('2026-11-21', 'LB-A', 'SALE', -10, 'B2B', { customer: 'Distribuidora', reference: 'INV1' }),
  mv('2026-11-21', 'KIT-K', 'SALE', -2, 'B2B', { customer: 'Distribuidora', reference: 'INV1' }),   // same order
  mv('2026-11-22', 'KIT-K', 'SALE', -3, 'B2B2C', { customer: 'Surf Shop', reference: 'INV2' }),
  mv('2026-11-23', 'LB-A', 'SALE', -5, 'B2B', { customer: 'Distribuidora', reference: 'INV3' }),
  sale4,                                                             // reversed below: must be ignored
  mv('2026-11-11', 'LB-A', 'SALE', 4, 'B2C', { reverses_id: sale4.movement_id }),
  mv('2026-11-05', 'LB-A', 'PRODUCTION', 40),
  mv('2026-11-06', 'KIT-K', 'RESTOCK', 10),
  mv('2026-11-12', 'LB-A', 'DAMAGED', -2),
  mv('2026-11-12', 'SLOW-S', 'EXPIRED', -1),
  mv('2026-11-13', 'LB-A', 'SAMPLE', -3)
];
const COUNTS = [
  { count_id: 'C1', date: '2026-11-15', sku: 'LB-A', counted_qty: 90, system_qty: 92, variance: -2 },
  { count_id: 'C2', date: '2026-11-15', sku: 'KIT-K', counted_qty: 50, system_qty: 50, variance: 0 }
];

// The backend runs in its own sandbox, so its objects have different prototypes than the test's.
// Converting through JSON gives plain objects that deepEqual can compare.
const plain = (value) => JSON.parse(JSON.stringify(value));
const kpis = (days = 30) => plain(b.computeKpis(PRODUCTS, MOVEMENTS, COUNTS, TODAY, days));

test('sales totals use list prices (retail for B2C, wholesale for B2B) and ignore reversed sales', () => {
  const k = kpis();
  // 5 B2C (50) + 10 B2B (70) + 2 kits B2B (42) + 3 kits B2B2C (63) + 5 B2B (35) = 25 units, 260 revenue
  assert.equal(k.units, 25);
  assert.equal(k.revenue, 260);
  assert.equal(k.cogs, 90);               // 5x2 + 10x2 + 2x10 + 3x10 + 5x2
  assert.equal(k.margin, 170);
  assert.equal(k.margin_pct, 0.6538);
});

test('revenue share by channel, kit mix and category/product breakdowns', () => {
  const k = kpis();
  const byChannel = Object.fromEntries(k.by_channel.map((c) => [c.channel, c]));
  assert.equal(byChannel.B2B.revenue, 147);
  assert.equal(byChannel.B2B2C.revenue, 63);
  assert.equal(byChannel.B2C.revenue, 50);
  assert.equal(byChannel.B2B.revenue_share, 0.5654);
  assert.equal(k.by_channel[0].channel, 'B2B', 'sorted by revenue');
  assert.deepEqual(k.kit, { units: 5, revenue: 105, units_share: 0.2, revenue_share: 0.4038 });
  assert.equal(k.by_category.find((c) => c.category === 'Lip Balm').units, 20);
  assert.equal(k.by_sku[0].sku, 'LB-A');
});

test('top sellers have a previous-period comparison; bottom sellers skip products with no stock', () => {
  const k = kpis();
  assert.equal(k.top[0].sku, 'LB-A');
  assert.equal(k.top[0].units, 20);
  assert.equal(k.top[0].prev_units, 6);       // 6 sold on 15 Oct, in the 30 days before
  assert.deepEqual(k.bottom.map((r) => r.sku), ['SLOW-S', 'KIT-K', 'LB-A']);
  assert.ok(!k.bottom.some((r) => r.sku === 'OUT-1' || r.sku === 'DISC-1'));
});

test('B2B and store orders: one order = same channel, date, customer and reference', () => {
  const k = kpis();
  assert.equal(k.biz.orders, 3);              // INV1 (2 lines), INV3, INV2
  assert.equal(k.biz.avg_units, 6.7);         // (12 + 5 + 3) / 3
  assert.equal(k.biz.avg_revenue, 70);        // (112 + 35 + 63) / 3
  const b2b = k.biz.by_channel.find((c) => c.channel === 'B2B');
  assert.deepEqual([b2b.orders, b2b.avg_units, b2b.avg_revenue], [2, 8.5, 73.5]);
});

test('customer concentration covers business customers only', () => {
  const k = kpis();
  assert.equal(k.customers.named, 2);
  assert.equal(k.customers.top[0].customer, 'Distribuidora');
  assert.equal(k.customers.top[0].orders, 2);
  assert.equal(k.customers.top1_share, 0.7);  // 147 of 210
  assert.equal(k.customers.top3_share, 1);
  assert.equal(k.customers.no_customer_share, 0);
});

test('production, damage, expiry and sample rates', () => {
  const f = kpis().flows;
  assert.equal(f.produced, 40);
  assert.equal(f.received, 10);
  assert.equal(f.production_vs_sales, 1.6);   // 40 produced / 25 sold
  assert.equal(f.damaged, 2);
  assert.equal(f.damage_rate, 0.08);
  assert.equal(f.expired, 1);
  assert.equal(f.writeoff_rate, 0.12);
  assert.equal(f.samples, 3);
  assert.equal(f.sample_rate, 0.12);
  assert.equal(f.damaged_cost, 4);
  assert.equal(f.sample_cost, 6);
});

test('count accuracy and shrinkage', () => {
  const c = kpis().counts;
  assert.equal(c.sessions, 1);
  assert.equal(c.lines, 2);
  assert.equal(c.line_accuracy, 0.5);
  assert.equal(c.unit_accuracy, 0.9859);      // 1 - 2 / 142
  assert.equal(c.short_units, 2);
  assert.equal(c.short_value, 4);             // 2 units x $2
  assert.deepEqual(c.worst.map((w) => [w.sku, w.net]), [['LB-A', -2]]);
});

test('previous period uses the same length just before', () => {
  const p = kpis().prev;
  assert.equal(p.units, 6);
  assert.equal(p.revenue, 60);
  assert.equal(kpis(90).prev.units, 2, 'only the 2 units sold on 10 Aug fall in the 90 days before 29 Aug');
});

test('a longer period includes older sales and flows', () => {
  const k = kpis(90);                          // after 29 Aug: also the 15 Oct sale and the 10 Sep sale
  assert.equal(k.units, 25 + 6 + 5);
  assert.equal(k.by_sku.find((r) => r.sku === 'OUT-1').units, 5);
});

test('monthly trend: sales, flows, counts and month-end stock', () => {
  const months = kpis().months;
  assert.deepEqual(months.map((m) => m.month), ['2026-08', '2026-09', '2026-10', '2026-11'], 'starts at the first movement');
  const [aug, sep, oct, nov] = months;
  assert.equal(aug.units, 2);
  assert.deepEqual(months.map((m) => m.partial), [false, false, false, true], 'only the month in progress is partial');
  assert.equal(plain(b.computeKpis(PRODUCTS, [mv('2026-11-20', 'LB-A', 'OPENING', 5)], [], TODAY, 30)).months[0].partial, true);
  assert.equal(sep.units, 5);
  assert.equal(oct.units, 6);
  assert.equal(nov.units, 25);
  assert.equal(nov.revenue, 260);
  assert.equal(nov.kit_revenue, 105);
  assert.equal(nov.biz_orders, 3);
  assert.equal(nov.top3_share, 1);
  assert.equal(nov.produced, 40);
  assert.equal(nov.damaged, 2);
  assert.equal(nov.counts.lines, 2);
  assert.deepEqual(nov.by_channel, { B2C: 5, B2B: 17, B2B2C: 3 });

  // Stock today: LB-A 109, KIT-K 55, SLOW-S 17, OUT-1 0 (DISC-1 is inactive and not counted).
  assert.deepEqual([nov.stock.units, nov.stock.value, nov.stock.out], [181, 853, 1]);
  assert.deepEqual([nov.stock.slow_count, nov.stock.slow_value], [1, 85]);
  // End of October: LB-A 94 (the 6 sold on 15 Oct), KIT-K 50, SLOW-S 18, OUT-1 0.
  assert.deepEqual([oct.stock.date, oct.stock.units, oct.stock.value, oct.stock.out], ['2026-10-31', 162, 778, 1]);
  // End of August: OUT-1 still had its 5 units.
  assert.equal(aug.stock.out, 0);
  assert.equal(aug.stock.date, '2026-08-31');
});

test('days of cover by month needs at least 14 days of history', () => {
  const few = [mv('2026-11-20', 'LB-A', 'OPENING', 50), mv('2026-11-22', 'LB-A', 'SALE', -2, 'B2C')];
  const months = plain(b.computeKpis(PRODUCTS, few, [], TODAY, 90)).months;
  assert.equal(months[0].stock.cover, null, 'only 8 days of history');
  // Full dataset, end of September: 61 days of history. Sales so far: 2 (SLOW-S, 10 Aug) and 5 (OUT-1, 10 Sep),
  // so demand = 7 / 61 a day. Only products that sold count: SLOW-S holds 18, OUT-1 holds 0.
  // Cover = 18 / (7 / 61) = 156.9 days.
  const sep = kpis().months[1].stock;
  assert.equal(sep.cover, 156.9);
});

test('the monthly units chart keeps the biggest products and groups the rest', () => {
  const nov = kpis().months[3];
  assert.equal(nov.by_sku['LB-A'], 20);
  assert.equal(nov.by_sku['KIT-K'], 5);
  assert.equal(Object.values(nov.by_sku).reduce((s, v) => s + v, 0), 25);
});

test('stock KPIs: units, value, cover, risk, slow movers and categories (inactive products left out)', () => {
  const summary = b.buildSummary_(PRODUCTS, MOVEMENTS, TODAY, SETTINGS);
  const s = plain(b.computeStockKpis(PRODUCTS, summary, TODAY, SETTINGS));
  assert.equal(s.active_products, 4);
  assert.equal(s.units, 181);
  assert.equal(s.in_stock, 3);
  assert.deepEqual(s.value, { cost: 853, retail: 3080 });   // 109x10 + 55x30 + 17x20 at retail
  assert.equal(s.risk.out, 1);
  assert.ok(s.risk.at_risk >= 1);
  assert.ok(s.risk.lost_per_day > 0, 'an out-of-stock product that used to sell loses sales every day');
  assert.equal(s.slow_movers.count, 1);
  assert.deepEqual(s.slow_movers.items.map((i) => [i.sku, i.value, i.days_since_sale]), [['SLOW-S', 85, 109]]);
  assert.ok(s.days_of_cover > 0);
  assert.equal(s.by_category.reduce((sum, c) => sum + c.units, 0), 181);
  assert.ok(s.by_category.every((c) => c.category !== undefined));
  assert.ok(s.reorder_point.safety_total >= s.reorder_point.safety_held);
});

test('a product younger than 60 days is not a slow mover yet', () => {
  const young = [mv('2026-11-07', 'LB-A', 'OPENING', 50)];                 // 21 days old, never sold
  const old = [mv('2026-08-01', 'SLOW-S', 'OPENING', 20)];                 // 118 days old, never sold
  const run = (movements) => plain(b.computeStockKpis(PRODUCTS, b.buildSummary_(PRODUCTS, movements, TODAY, SETTINGS), TODAY, SETTINGS));
  assert.equal(run(young).slow_movers.count, 0);
  assert.equal(run(old).slow_movers.count, 1);
  const months = plain(b.computeKpis(PRODUCTS, old, [], TODAY, 90)).months;
  assert.equal(months[0].stock.slow_count, 0, 'end of August: only 31 days old');
  assert.equal(months[months.length - 1].stock.slow_count, 1);
});

test('empty data gives zeros and nulls, not errors', () => {
  const k = plain(b.computeKpis(PRODUCTS, [], [], TODAY, 90));
  assert.equal(k.units, 0);
  assert.equal(k.margin_pct, null);
  assert.equal(k.flows.damage_rate, null);
  assert.equal(k.counts.lines, 0);
  assert.deepEqual(k.months, []);
  const s = plain(b.computeStockKpis(PRODUCTS, b.buildSummary_(PRODUCTS, [], TODAY, SETTINGS), TODAY, SETTINGS));
  assert.equal(s.units, 0);
  assert.equal(s.days_of_cover, null);
});

test('getKpis API: validates the period, is included in sample data, and refreshes after a write', () => {
  const backend = loadBackend();
  backend.loadSampleData();
  const api = (action, payload) => callApi(backend, { key: 'dev-key', user: 'T', action, payload });

  assert.equal(api('getKpis', { days: 45 }).ok, false);
  const boot = api('getBootstrap').data;
  assert.ok(boot.stock_kpis.units > 0);
  assert.ok(boot.sales && boot.sales.by_month, 'old websites that still read boot.sales keep working');
  assert.ok(boot.summary.every((r) => 'last_sale' in r && 'value_retail' in r));

  const before = api('getKpis', { days: 90 }).data;
  assert.ok(before.units > 0 && before.revenue > 0);
  assert.ok(before.months.length >= 3);
  assert.ok(JSON.stringify(before).length < 60000, 'small enough to cache');

  const today = boot.today;
  const sku = boot.summary.find((r) => r.on_hand > 20).sku;
  assert.equal(api('addMovements', { date: today, type: 'SALE', channel: 'B2C', lines: [{ sku, qty: 3 }] }).ok, true);
  const after = api('getKpis', { days: 90 }).data;
  assert.equal(after.units, before.units + 3, 'cache is cleared by a write');
});
