// Unit tests for the forecast math in backend/forecast.js.  Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../backend/forecast.js');

const TODAY = '2026-10-28';
const SETTINGS = { service_level: 0.95, forecast_window_days: 90, stockout_warning_days: 14, include_samples_in_demand: 'FALSE' };
const PRODUCT = { sku: 'LB-CORAL', lead_time_days: 10, min_order_qty: 60, target_cover_days: 60, active: true };

let seq = 0;
function mv(daysAgo, type, qty, extra = {}) {
  return { movement_id: 'M' + (++seq), sku: 'LB-CORAL', date: F.addDays(TODAY, -daysAgo), type, qty, ...extra };
}

/** Opening stock 90 days ago, then `perDay` units sold every day from then up to yesterday. */
function steadySales(perDay, opening = 1000, days = 90) {
  const list = [mv(days, 'OPENING', opening)];
  for (let d = days; d >= 1; d--) list.push(mv(d, 'SALE', -perDay));
  return list;
}

function forecast(movements, product = PRODUCT, settings = SETTINGS) {
  const onHand = F.stockBySku(movements)[product.sku] || 0;
  return F.forecastProduct(product, movements, onHand, TODAY, settings);
}

test('Forecast.gs is an exact copy of forecast.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../backend/forecast.js'), 'utf8');
  const copy = fs.readFileSync(path.join(__dirname, '../backend/Forecast.gs'), 'utf8');
  assert.equal(copy, src, 'Copy backend/forecast.js over backend/Forecast.gs');
});

test('no sales: no demand, no stockout date, status OK, nothing to order', () => {
  const f = forecast([mv(60, 'OPENING', 50)]);
  assert.equal(f.avg_daily, 0);
  assert.equal(f.days_of_cover, null);
  assert.equal(f.stockout_date, null);
  assert.equal(f.status, 'OK');
  assert.equal(f.suggested_qty, 0);
});

test('no movements at all: out of stock, suggests one minimum batch', () => {
  const f = forecast([]);
  assert.equal(f.on_hand, 0);
  assert.equal(f.status, 'OUT');
  assert.equal(f.suggested_qty, 60);
  assert.equal(f.history_days, 0);
  assert.equal(f.low_data, true);
});

test('steady sales: average, cover, dates and the weighted method', () => {
  const f = forecast(steadySales(2, 1000));
  assert.equal(f.method, 'weighted');
  assert.equal(f.history_days, 90);
  assert.equal(f.avg_daily, 2);
  assert.equal(f.std_daily, 0);
  assert.equal(f.safety_stock, 0);
  assert.equal(f.reorder_point, 20);          // 2/day x 10 days lead time
  assert.equal(f.on_hand, 1000 - 2 * 90);     // 820
  assert.equal(f.days_of_cover, 410);
  assert.equal(f.stockout_date, F.addDays(TODAY, 410));
  assert.equal(f.reorder_by_date, F.addDays(TODAY, 400));
  assert.equal(f.status, 'OK');
});

test('very few days of data: simple average and a low-data flag', () => {
  const list = [mv(5, 'OPENING', 40), mv(4, 'SALE', -3), mv(2, 'SALE', -5)];
  const f = forecast(list);
  assert.equal(f.history_days, 5);            // first movement 5 days ago, up to yesterday
  assert.equal(f.method, 'simple');
  assert.equal(f.low_data, true);
  assert.equal(f.avg_daily, 1.6);             // 8 units / 5 days
});

test('20 days of data: simple average but not low data', () => {
  const list = [mv(20, 'OPENING', 100)];
  for (let d = 19; d >= 1; d--) list.push(mv(d, 'SALE', -1));
  const f = forecast(list);
  assert.equal(f.method, 'simple');
  assert.equal(f.low_data, false);
  assert.equal(f.avg_daily, 0.95);            // 19 units over 20 days
});

test('recent days weigh more than old days', () => {
  const list = [mv(90, 'OPENING', 2000)];
  for (let d = 89; d >= 1; d--) list.push(mv(d, 'SALE', d <= 30 ? -4 : -1));
  const f = forecast(list);
  // The plain average would be (59 x 1 + 30 x 4) / 90 = 1.99; recent weeks pull it up.
  assert.ok(f.avg_daily > 2.5, `expected > 2.5, got ${f.avg_daily}`);
  assert.ok(f.avg_daily < 4);
});

test('a restock in the middle changes stock but not demand', () => {
  const list = steadySales(2, 100);              // would run out after 50 days...
  list.push(mv(45, 'RESTOCK', 300));             // ...but a restock arrives
  list.push(mv(44, 'PRODUCTION', 60));
  const f = forecast(list);
  assert.equal(f.avg_daily, 2);
  assert.equal(f.on_hand, 100 + 360 - 180);
});

test('negative adjustments, damage and expiry are not demand', () => {
  const list = steadySales(1, 500);
  list.push(mv(30, 'ADJUSTMENT', -40, { note: 'Count adjustment' }));
  list.push(mv(20, 'DAMAGED', -5), mv(10, 'EXPIRED', -7));
  const f = forecast(list);
  assert.equal(f.avg_daily, 1);
  assert.equal(f.on_hand, 500 - 90 - 52);
});

test('samples count as demand only when the setting is on', () => {
  const list = steadySales(1, 500);
  for (let d = 90; d >= 1; d--) list.push(mv(d, 'SAMPLE', -1));
  assert.equal(forecast(list).avg_daily, 1);
  assert.equal(forecast(list, PRODUCT, { ...SETTINGS, include_samples_in_demand: 'TRUE' }).avg_daily, 2);
});

test('a reversed sale is ignored completely', () => {
  const list = steadySales(1, 500);
  const typo = mv(15, 'SALE', -1089);
  list.push(typo, mv(0, 'SALE', 1089, { reverses_id: typo.movement_id }));
  const f = forecast(list);
  assert.equal(f.avg_daily, 1);
});

test('days that started with no stock are left out of the average', () => {
  // Sold 2/day for 60 days, then out of stock for the last 30 days.
  const list = [mv(90, 'OPENING', 120)];
  for (let d = 90; d >= 31; d--) list.push(mv(d, 'SALE', -2));
  const f = forecast(list);
  assert.equal(f.on_hand, 0);
  assert.equal(f.status, 'OUT');
  assert.equal(f.avg_daily, 2, 'the sold-out days must not drag the average down');
  assert.ok(f.stockout_days_skipped >= 28);
  assert.equal(f.suggested_qty, 180);          // 2 x (10 + 60) = 140 -> rounded up to 3 x 60
});

test('safety stock uses z x std x sqrt(lead time)', () => {
  const list = [mv(90, 'OPENING', 5000)];
  for (let d = 90; d >= 1; d--) list.push(mv(d, 'SALE', d % 2 ? -1 : -3)); // alternating 1 and 3
  const f = forecast(list);
  const expected = Math.ceil(1.65 * f.std_daily * Math.sqrt(10));
  assert.ok(Math.abs(f.std_daily - 1) < 0.02);
  assert.equal(f.safety_stock, expected);
  assert.equal(f.reorder_point, Math.ceil(f.avg_daily * 10 + f.safety_stock));
});

test('overrides replace the calculated safety stock and reorder point', () => {
  const p = { ...PRODUCT, safety_stock_override: 25, reorder_point_override: 900 };
  const f = forecast(steadySales(2, 1000), p);
  assert.equal(f.safety_stock, 25);
  assert.equal(f.safety_stock_source, 'override');
  assert.equal(f.reorder_point, 900);
  assert.equal(f.reorder_point_source, 'override');
  assert.equal(f.status, 'REORDER NOW');       // 820 on hand <= 900
  // 2 x (10 + 60) + 25 - 820 < 0 -> nothing calculated, so one minimum batch is suggested
  assert.equal(f.suggested_qty, 60);
});

test('an override of 0 is respected (not treated as blank)', () => {
  const f = forecast(steadySales(2, 1000), { ...PRODUCT, safety_stock_override: 0 });
  assert.equal(f.safety_stock, 0);
  assert.equal(f.safety_stock_source, 'override');
  const blank = forecast(steadySales(2, 1000), { ...PRODUCT, safety_stock_override: '' });
  assert.equal(blank.safety_stock_source, 'calculated');
});

test('suggested order is rounded up to the minimum order quantity', () => {
  // 3/day, 50 left: need 3 x (10 + 60) + 0 - 50 = 160 -> 3 batches of 60 = 180
  const list = [mv(90, 'OPENING', 50 + 3 * 90)];
  for (let d = 90; d >= 1; d--) list.push(mv(d, 'SALE', -3));
  const f = forecast(list);
  assert.equal(f.on_hand, 50);
  assert.equal(f.suggested_qty, 180);
  assert.equal(forecast(list, { ...PRODUCT, min_order_qty: 1 }).suggested_qty, 160);
  assert.equal(forecast(list, { ...PRODUCT, min_order_qty: 100 }).suggested_qty, 200);
});

test('status thresholds: REORDER NOW, LOW and OK', () => {
  const withStock = (left) => {
    const list = [mv(90, 'OPENING', left + 90)];
    for (let d = 90; d >= 1; d--) list.push(mv(d, 'SALE', -1));
    return forecast(list);
  };
  assert.equal(withStock(8).status, 'REORDER NOW');   // 8 days of cover < 10-day lead time
  assert.equal(withStock(10).status, 'REORDER NOW');  // on hand <= reorder point (10)
  assert.equal(withStock(20).status, 'LOW');          // runs out within 14 + 10 days
  assert.equal(withStock(24).status, 'LOW');
  assert.equal(withStock(25).status, 'OK');
  assert.equal(forecast([mv(5, 'OPENING', 5)], { ...PRODUCT, active: false }).status, 'INACTIVE');
});

test('z values for the usual service levels', () => {
  assert.equal(F.zForServiceLevel(0.9), 1.28);
  assert.equal(F.zForServiceLevel(0.95), 1.65);
  assert.equal(F.zForServiceLevel(0.98), 2.05);
  assert.ok(Math.abs(F.zForServiceLevel(0.925) - 1.465) < 1e-9);
});

test('forecastAll and urgency sorting', () => {
  const a = [mv(90, 'OPENING', 0 + 89)].concat(Array.from({ length: 89 }, (_, i) => mv(i + 1, 'SALE', -1)));
  const b = [{ ...mv(10, 'OPENING', 500), sku: 'ST-L1V' }];
  const all = F.forecastAll([PRODUCT, { ...PRODUCT, sku: 'ST-L1V' }], a.concat(b), TODAY, SETTINGS);
  assert.equal(all['LB-CORAL'].status, 'OUT');
  assert.equal(all['ST-L1V'].status, 'OK');
  const sorted = [all['ST-L1V'], all['LB-CORAL']].sort(F.compareUrgency);
  assert.equal(sorted[0].sku, 'LB-CORAL');
});

test('typical movement size ignores corrections and splits in/out', () => {
  const list = [mv(9, 'OPENING', 999), mv(8, 'SALE', -1), mv(7, 'SALE', -2), mv(6, 'SALE', -10),
    mv(5, 'PRODUCTION', 60), mv(4, 'ADJUSTMENT', -500)];
  assert.deepEqual(F.typicalMovementSize(list), { out: 10, in: 60 });
});
