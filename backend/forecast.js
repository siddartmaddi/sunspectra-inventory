/**
 * forecast.js
 * Pure stock and forecast math. No Apps Script calls, no DOM, no reading the clock:
 * everything the functions need (including "today") is passed in. That way the same file:
 *   - runs in Node for unit tests (`node --test`),
 *   - is pasted into Apps Script as Forecast.gs (keep the two files identical),
 *   - gives the app and the daily email exactly the same numbers.
 *
 * Dates are 'YYYY-MM-DD' strings everywhere.
 */

// How fast old days lose weight in the average: a day 21 days ago counts half as much as today.
var FORECAST_HALF_LIFE_DAYS = 21;
// Below this many days of history we use a plain average instead of the weighted one.
var MIN_DAYS_FOR_WEIGHTED = 30;
// Below this many days of history the forecast is flagged as "low data".
var LOW_DATA_DAYS = 14;

// ------------------------------------------------------------------ stock

/** Current stock per SKU = sum of all movement quantities. Returns {sku: qty}. */
function stockBySku(movements) {
  var stock = {};
  for (var i = 0; i < movements.length; i++) {
    var m = movements[i];
    stock[m.sku] = (stock[m.sku] || 0) + (Number(m.qty) || 0);
  }
  return stock;
}

/**
 * "Typical" size of one movement for a product, separately for stock going out
 * (sales, samples...) and coming in (restocks, production). We use the 90th percentile
 * of the last 100 everyday movements: big enough that a normal store order doesn't
 * trigger a warning, small enough to catch typos like 1,089 instead of 108.
 * OPENING, ADJUSTMENT and reversal rows are skipped (one-off corrections).
 * Returns { out, in }; 0 means "not enough history to judge".
 */
function typicalMovementSize(movements) {
  var outSizes = [];
  var inSizes = [];
  for (var i = movements.length - 1; i >= 0 && outSizes.length + inSizes.length < 100; i--) {
    var m = movements[i];
    if (m.type === 'OPENING' || m.type === 'ADJUSTMENT' || m.reverses_id) continue;
    var q = Number(m.qty) || 0;
    if (q < 0) outSizes.push(-q);
    else if (q > 0) inSizes.push(q);
  }
  return { out: percentile(outSizes, 0.9), in: percentile(inSizes, 0.9) };
}

// ------------------------------------------------------------------ demand history

/**
 * Daily demand for one product over the forecast window (oldest day first).
 *
 * - Demand = units that left through SALE movements (and SAMPLE when includeSamples).
 * - Days with no sales count as 0 ...
 * - ... except days that started with no stock: nobody could buy, so a 0 there says
 *   nothing about demand. Those days are left out, otherwise a sold-out product
 *   would look like it stopped selling.
 * - A movement that was reversed, and the reversal itself, are both ignored.
 * - The window ends yesterday (today is not over yet) and never starts before the
 *   product's first movement.
 *
 * Returns { days: [{date, qty}], skippedStockoutDays }.
 */
function dailyDemand(movements, today, windowDays, includeSamples) {
  var reversed = {};
  movements.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });

  var end = addDays(today, -1);
  var start = addDays(today, -windowDays);
  var first = null;
  var demandByDate = {};
  var changeByDate = {};     // net stock change per date, to know each day's opening stock
  var stockBefore = 0;       // stock at the start of the window

  movements.forEach(function (m) {
    if (!first || m.date < first) first = m.date;
    var qty = Number(m.qty) || 0;
    if (m.date < start) stockBefore += qty;
    else changeByDate[m.date] = (changeByDate[m.date] || 0) + qty;

    var isDemand = m.type === 'SALE' || (includeSamples && m.type === 'SAMPLE');
    if (isDemand && !m.reverses_id && !reversed[m.movement_id]) {
      demandByDate[m.date] = (demandByDate[m.date] || 0) - qty; // sales are negative
    }
  });

  var days = [];
  var skipped = 0;
  if (!first || first > end) return { days: days, skippedStockoutDays: 0 };
  var stock = stockBefore;
  for (var d = start; d <= end; d = addDays(d, 1)) {
    var opening = stock;
    stock += changeByDate[d] || 0;
    if (d < first) continue;
    var qty = Math.max(0, demandByDate[d] || 0);
    // Movements on the product's very first day usually include the opening stock,
    // so only skip a day for "no stock" when it truly started empty and nothing sold.
    if (opening <= 0 && qty === 0 && d !== first) { skipped++; continue; }
    days.push({ date: d, qty: qty });
  }
  return { days: days, skippedStockoutDays: skipped };
}

/** Average with more weight on recent days (weight halves every FORECAST_HALF_LIFE_DAYS). */
function weightedAverage(days) {
  if (!days.length) return 0;
  var lastIndex = days.length - 1;
  var sum = 0;
  var weights = 0;
  for (var i = 0; i < days.length; i++) {
    var age = lastIndex - i;
    var w = Math.pow(0.5, age / FORECAST_HALF_LIFE_DAYS);
    sum += w * days[i].qty;
    weights += w;
  }
  return sum / weights;
}

function simpleAverage(days) {
  if (!days.length) return 0;
  var sum = 0;
  for (var i = 0; i < days.length; i++) sum += days[i].qty;
  return sum / days.length;
}

/** Sample standard deviation of daily demand (0 with fewer than 2 days). */
function standardDeviation(days) {
  if (days.length < 2) return 0;
  var mean = simpleAverage(days);
  var sq = 0;
  for (var i = 0; i < days.length; i++) sq += Math.pow(days[i].qty - mean, 2);
  return Math.sqrt(sq / (days.length - 1));
}

/**
 * z-score for a service level (the chance of NOT running out during a lead time).
 * Uses the usual table values; anything in between is interpolated.
 */
function zForServiceLevel(level) {
  var table = [[0.5, 0], [0.8, 0.84], [0.85, 1.04], [0.9, 1.28], [0.95, 1.65], [0.97, 1.88], [0.98, 2.05], [0.99, 2.33], [0.999, 3.09]];
  var l = Number(level);
  if (!(l > 0)) l = 0.95;
  if (l <= table[0][0]) return 0;
  for (var i = 1; i < table.length; i++) {
    if (l <= table[i][0]) {
      var a = table[i - 1], b = table[i];
      return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]);
    }
  }
  return table[table.length - 1][1];
}

// ------------------------------------------------------------------ the forecast

var STATUS = { OUT: 'OUT', REORDER: 'REORDER NOW', LOW: 'LOW', OK: 'OK', INACTIVE: 'INACTIVE' };
var STATUS_RANK = { 'OUT': 0, 'REORDER NOW': 1, 'LOW': 2, 'OK': 3, 'INACTIVE': 4 };

/**
 * Full forecast for one product.
 *   product   row from Products (lead_time_days, min_order_qty, overrides, target_cover_days...)
 *   movements this product's movements (any order)
 *   onHand    current stock
 *   today     'YYYY-MM-DD'
 *   settings  { service_level, forecast_window_days, stockout_warning_days, include_samples_in_demand }
 */
function forecastProduct(product, movements, onHand, today, settings) {
  var lead = Math.max(1, Number(product.lead_time_days) || 1);
  var moq = Math.max(1, Number(product.min_order_qty) || 1);
  var targetCover = Number(product.target_cover_days) > 0 ? Number(product.target_cover_days) : 60;
  var windowDays = Number(settings.forecast_window_days) || 90;
  var warningDays = Number(settings.stockout_warning_days);
  if (isNaN(warningDays)) warningDays = 14;
  var includeSamples = String(settings.include_samples_in_demand).toUpperCase() === 'TRUE';
  var z = zForServiceLevel(settings.service_level || 0.95);

  var history = dailyDemand(movements, today, windowDays, includeSamples);
  var days = history.days;
  var method = days.length >= MIN_DAYS_FOR_WEIGHTED ? 'weighted' : 'simple';
  var avg = method === 'weighted' ? weightedAverage(days) : simpleAverage(days);
  var std = standardDeviation(days);

  var hasSafetyOverride = isSet(product.safety_stock_override);
  var safety = hasSafetyOverride ? Number(product.safety_stock_override) : Math.ceil(z * std * Math.sqrt(lead));
  var hasReorderOverride = isSet(product.reorder_point_override);
  var reorderPoint = hasReorderOverride ? Number(product.reorder_point_override) : Math.ceil(avg * lead + safety);

  var daysOfCover = null;
  var stockoutDate = null;
  var reorderByDate = null;
  if (onHand <= 0) {
    daysOfCover = 0;
    stockoutDate = today;
    reorderByDate = addDays(today, -lead);
  } else if (avg > 0) {
    daysOfCover = onHand / avg;
    stockoutDate = addDays(today, Math.floor(daysOfCover));
    reorderByDate = addDays(stockoutDate, -lead);
  }

  var status;
  if (product.active === false) status = STATUS.INACTIVE;
  else if (onHand <= 0) status = STATUS.OUT;
  else if (onHand <= reorderPoint || (daysOfCover !== null && daysOfCover < lead)) status = STATUS.REORDER;
  else if (daysOfCover !== null && daysOfCover <= warningDays + lead) status = STATUS.LOW;
  else status = STATUS.OK;

  var needed = avg * (lead + targetCover) + safety - Math.max(onHand, 0);
  var suggested = needed > 0 ? Math.ceil(needed / moq) * moq : 0;
  // Out of stock or below the reorder point but too little sales history to size an
  // order: suggest at least one minimum batch so the line is never "order 0".
  if (suggested === 0 && (status === STATUS.OUT || status === STATUS.REORDER)) suggested = moq;

  return {
    sku: product.sku,
    on_hand: onHand,
    avg_daily: round(avg, 3),
    std_daily: round(std, 3),
    history_days: days.length,
    stockout_days_skipped: history.skippedStockoutDays,
    method: method,
    low_data: days.length < LOW_DATA_DAYS,
    z: round(z, 2),
    lead_time_days: lead,
    safety_stock: safety,
    safety_stock_source: hasSafetyOverride ? 'override' : 'calculated',
    reorder_point: reorderPoint,
    reorder_point_source: hasReorderOverride ? 'override' : 'calculated',
    days_of_cover: daysOfCover === null ? null : round(daysOfCover, 1),
    stockout_date: stockoutDate,
    reorder_by_date: reorderByDate,
    suggested_qty: suggested,
    status: status
  };
}

/** Forecasts for every product at once. Returns {sku: forecast}. */
function forecastAll(products, movements, today, settings) {
  var bySku = {};
  movements.forEach(function (m) { (bySku[m.sku] = bySku[m.sku] || []).push(m); });
  var stock = stockBySku(movements);
  var out = {};
  products.forEach(function (p) {
    out[p.sku] = forecastProduct(p, bySku[p.sku] || [], stock[p.sku] || 0, today, settings);
  });
  return out;
}

/** Sort helper: most urgent first (status, then fewest days of cover). */
function compareUrgency(a, b) {
  var r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (r !== 0) return r;
  var da = a.days_of_cover === null ? Infinity : a.days_of_cover;
  var db = b.days_of_cover === null ? Infinity : b.days_of_cover;
  return da - db;
}

// ------------------------------------------------------------------ small helpers

function addDays(iso, n) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b ('YYYY-MM-DD'). */
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

function isSet(value) {
  return value !== null && value !== undefined && value !== '' && !isNaN(Number(value));
}

function round(n, decimals) {
  var f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** Value below which the given share (0-1) of the numbers fall. 0 for an empty list. */
function percentile(numbers, share) {
  if (!numbers.length) return 0;
  var sorted = numbers.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}

// Lets Node's test runner load this file. In Apps Script `module` doesn't exist,
// so this block is skipped and the functions above are simply global.
if (typeof module !== 'undefined') {
  module.exports = {
    stockBySku: stockBySku, typicalMovementSize: typicalMovementSize, dailyDemand: dailyDemand,
    weightedAverage: weightedAverage, simpleAverage: simpleAverage, standardDeviation: standardDeviation,
    zForServiceLevel: zForServiceLevel, forecastProduct: forecastProduct, forecastAll: forecastAll,
    compareUrgency: compareUrgency, addDays: addDays, daysBetween: daysBetween, percentile: percentile,
    STATUS: STATUS
  };
}
