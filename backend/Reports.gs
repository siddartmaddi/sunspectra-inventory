/**
 * Reports.gs
 * All reports in one call: sales by month and channel, top sellers, slow movers,
 * stock value by category and count variances.
 *
 * Revenue is an estimate: B2B and B2B2C sales are valued at the wholesale price,
 * direct (B2C) sales at the retail price. The Movements tab has no sale prices.
 */

/** payload: { top_days } (period for the top sellers, default 90) */
function getReport_(payload) {
  var today = todayISO_();
  var products = readTable_('Products').map(stripRow_);
  var bySku = indexBy_(products, 'sku');
  var movements = readTable_('Movements');
  var settings = getSettings_();
  var topDays = Number(payload.top_days) || 90;

  var reversed = {};
  movements.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });
  var sales = movements.filter(function (m) {
    return m.type === 'SALE' && !m.reverses_id && !reversed[m.movement_id];
  });
  var revenue = function (m) {
    var p = bySku[m.sku] || {};
    var price = m.channel === 'B2C' ? p.retail_price : p.wholesale_price;
    return -m.qty * (price || 0);
  };

  // ---- sales by month and channel (last 12 months)
  var firstMonth = addDays(today, -365).slice(0, 7);
  var months = {};
  sales.forEach(function (m) {
    var month = m.date.slice(0, 7);
    if (month < firstMonth) return;
    var key = month + '|' + m.channel;
    var row = months[key] = months[key] || { month: month, channel: m.channel, units: 0, revenue: 0 };
    row.units += -m.qty;
    row.revenue += revenue(m);
  });
  var salesByMonth = Object.keys(months).sort().map(function (k) { return roundMoney_(months[k]); });

  // ---- top sellers in the period
  var since = addDays(today, -topDays);
  var top = {};
  sales.forEach(function (m) {
    if (m.date <= since) return;
    var row = top[m.sku] = top[m.sku] || { sku: m.sku, name: (bySku[m.sku] || {}).name || m.sku, units: 0, revenue: 0 };
    row.units += -m.qty;
    row.revenue += revenue(m);
  });
  var topSellers = Object.keys(top).map(function (k) { return roundMoney_(top[k]); })
    .sort(function (a, b) { return b.units - a.units; });

  // ---- slow movers: in stock, but no sale in the last 60 days
  var stock = stockBySku(movements);
  var lastSale = {};
  sales.forEach(function (m) { if (!lastSale[m.sku] || m.date > lastSale[m.sku]) lastSale[m.sku] = m.date; });
  var slowSince = addDays(today, -60);
  var slowMovers = products.filter(function (p) {
    return p.active && (stock[p.sku] || 0) > 0 && (!lastSale[p.sku] || lastSale[p.sku] <= slowSince);
  }).map(function (p) {
    return roundMoney_({ sku: p.sku, name: p.name, on_hand: stock[p.sku], last_sale: lastSale[p.sku] || '',
      days_since_sale: lastSale[p.sku] ? daysBetween(lastSale[p.sku], today) : null,
      value: stock[p.sku] * (p.unit_cost || 0) });
  }).sort(function (a, b) { return b.value - a.value; });

  // ---- stock value by category (active products)
  var categories = {};
  products.forEach(function (p) {
    if (!p.active) return;
    var onHand = Math.max(stock[p.sku] || 0, 0);
    var row = categories[p.category] = categories[p.category] || { category: p.category, products: 0, units: 0, value_cost: 0, value_retail: 0 };
    row.products += 1;
    row.units += onHand;
    row.value_cost += onHand * (p.unit_cost || 0);
    row.value_retail += onHand * (p.retail_price || 0);
  });
  var valueByCategory = Object.keys(categories).map(function (k) { return roundMoney_(categories[k]); })
    .sort(function (a, b) { return b.value_cost - a.value_cost; });

  // ---- count variance summary per product
  var variance = {};
  readTable_('Counts').forEach(function (c) {
    var row = variance[c.sku] = variance[c.sku] || { sku: c.sku, name: (bySku[c.sku] || {}).name || c.sku,
      counts: 0, counts_with_difference: 0, total_variance: 0, abs_variance: 0, value: 0, last_count: '' };
    row.counts += 1;
    if (c.variance) row.counts_with_difference += 1;
    row.total_variance += c.variance;
    row.abs_variance += Math.abs(c.variance);
    row.value += c.variance * ((bySku[c.sku] || {}).unit_cost || 0);
    if (c.date > row.last_count) row.last_count = c.date;
  });
  var countVariance = Object.keys(variance).map(function (k) { return roundMoney_(variance[k]); })
    .sort(function (a, b) { return b.abs_variance - a.abs_variance; });

  return {
    today: today,
    currency: settings.currency,
    top_days: topDays,
    sales_by_month: salesByMonth,
    top_sellers: topSellers,
    slow_movers: slowMovers,
    value_by_category: valueByCategory,
    count_variance: countVariance
  };
}

/** Rounds money fields to cents so the browser shows clean numbers. */
function roundMoney_(row) {
  ['revenue', 'value', 'value_cost', 'value_retail'].forEach(function (k) {
    if (typeof row[k] === 'number') row[k] = Math.round(row[k] * 100) / 100;
  });
  return row;
}
