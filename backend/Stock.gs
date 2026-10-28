/**
 * Stock.gs
 * Builds the stock summary from the Movements tab. Stock is never stored:
 * it is always the sum of movements, so the app and the email job always agree.
 */

/** Everything the app needs on first load, in one call (cached for 5 minutes). */
function getBootstrap_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  var data = buildBootstrap_();
  var json = JSON.stringify(data);
  // CacheService refuses values over 100 KB; then we simply don't cache.
  if (json.length < 95000) cache.put(CACHE_KEY, json, 300);
  return data;
}

function buildBootstrap_() {
  var products = readTable_('Products').map(stripRow_);
  var movements = readTable_('Movements');
  var settings = getSettings_();

  var today = todayISO_();

  return {
    today: today,
    settings: settings,
    products: products,
    suppliers: readTable_('Suppliers').map(stripRow_),
    summary: buildSummary_(products, movements, today, settings),
    sales: salesStats_(movements, today),
    customers: distinctCustomers_(movements),
    name_map: readTable_('NameMap').map(stripRow_)
  };
}

/**
 * One row per product: stock, value at cost, typical movement size (for the typo
 * warning) and the full forecast (see forecast.js / Forecast.gs).
 */
function buildSummary_(products, movements, today, settings) {
  var forecasts = forecastAll(products, movements, today, settings);
  var bySku = groupBySku_(movements);
  return products.map(function (p) {
    var row = forecasts[p.sku];
    row.typical_qty = typicalMovementSize(bySku[p.sku] || []);
    row.value = Math.max(row.on_hand, 0) * (p.unit_cost || 0);
    return row;
  });
}

/**
 * Small sales summaries for the dashboard charts, so the browser doesn't need
 * every movement: units sold per month and channel (last 12 months) and the
 * top sellers of the last 30 days. Reversed sales are left out.
 */
function salesStats_(movements, today) {
  var reversed = {};
  movements.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });
  var firstMonth = addDays(today, -365).slice(0, 7);
  var since30 = addDays(today, -30);
  var byMonth = {};   // 'YYYY-MM' -> {channel: units}
  var last30 = {};    // sku -> units
  movements.forEach(function (m) {
    if (m.type !== 'SALE' || m.reverses_id || reversed[m.movement_id]) return;
    var units = -m.qty;
    var month = m.date.slice(0, 7);
    if (month >= firstMonth) {
      var row = byMonth[month] = byMonth[month] || {};
      row[m.channel || 'B2C'] = (row[m.channel || 'B2C'] || 0) + units;
    }
    if (m.date > since30) last30[m.sku] = (last30[m.sku] || 0) + units;
  });
  var top = Object.keys(last30).map(function (sku) { return { sku: sku, units: last30[sku] }; })
    .sort(function (a, b) { return b.units - a.units; }).slice(0, 10);
  return { by_month: byMonth, top_30_days: top };
}

/** Product page: the product's movements and counts (oldest first). */
function getProductDetail_(payload) {
  var sku = String(payload.sku || '').toUpperCase();
  var product = readTable_('Products').filter(function (p) { return p.sku === sku; })[0];
  if (!product) throw userError_('Product ' + sku + ' was not found.');
  var movements = readTable_('Movements').filter(function (m) { return m.sku === sku; });
  var counts = readTable_('Counts').filter(function (c) { return c.sku === sku; });
  sortByDate_(movements);
  sortByDate_(counts);
  return {
    product: stripRow_(product),
    movements: movements.map(stripRow_),
    counts: counts.map(stripRow_)
  };
}

function groupBySku_(rows) {
  var groups = {};
  rows.forEach(function (r) {
    (groups[r.sku] = groups[r.sku] || []).push(r);
  });
  return groups;
}

/** Previous customer names, for autocomplete on the movement form. */
function distinctCustomers_(movements) {
  var seen = {};
  movements.forEach(function (m) {
    if (m.customer) seen[m.customer] = true;
  });
  return Object.keys(seen).sort();
}

/** Sorts by business date, then by entry time, oldest first. */
function sortByDate_(rows) {
  rows.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.created_at) < String(b.created_at) ? -1 : 1;
  });
  return rows;
}

/** Removes the internal _row number before sending a record to the browser. */
function stripRow_(obj) {
  var copy = {};
  for (var k in obj) if (k !== '_row') copy[k] = obj[k];
  return copy;
}
