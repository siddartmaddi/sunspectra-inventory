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
  var summary = buildSummary_(products, movements, today, settings);

  return {
    today: today,
    settings: settings,
    products: products,
    suppliers: readTable_('Suppliers').map(stripRow_),
    summary: summary,
    stock_kpis: computeStockKpis(products, summary, today, settings),
    customers: distinctCustomers_(movements),
    name_map: readTable_('NameMap').map(stripRow_)
  };
}

/**
 * One row per product: stock, value at cost and retail, last sale date, typical movement size
 * (for the typo warning) and the full forecast (see forecast.js / Forecast.gs).
 */
function buildSummary_(products, movements, today, settings) {
  var forecasts = forecastAll(products, movements, today, settings);
  var bySku = groupBySku_(movements);
  var lastSale = lastSaleBySku_(movements);
  return products.map(function (p) {
    var row = forecasts[p.sku];
    var held = Math.max(row.on_hand, 0);
    row.typical_qty = typicalMovementSize(bySku[p.sku] || []);
    row.value = held * (p.unit_cost || 0);
    row.value_retail = held * (p.retail_price || 0);
    row.last_sale = lastSale[p.sku] || '';
    return row;
  });
}

/** Date of the most recent sale of each product (reversed sales don't count). */
function lastSaleBySku_(movements) {
  var reversed = {};
  movements.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });
  var last = {};
  movements.forEach(function (m) {
    if (m.type !== 'SALE' || m.reverses_id || reversed[m.movement_id]) return;
    if (!last[m.sku] || m.date > last[m.sku]) last[m.sku] = m.date;
  });
  return last;
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
