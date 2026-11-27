/**
 * Kpis.gs
 * The numbers behind the Dashboard.
 *
 *   computeStockKpis()  "right now" numbers (stock, cover, risk, overstock, value). Built from the
 *                       stock summary, so it is part of getBootstrap and the Stock tab opens instantly.
 *   computeKpis()       sales, production, losses and counts for a period, plus a month-by-month
 *                       trend of everything. Sent by the getKpis action (the Sales and Production tabs
 *                       and the trend charts).
 *
 * Both are plain functions: no Apps Script calls, so tests can run them in Node.
 * Only data the app already records is used. Nothing is invented:
 *   - Revenue is an ESTIMATE (the Movements tab has no sale prices): units x the product's retail
 *     price for direct (B2C) sales, x its wholesale price for B2B and store sales.
 *   - Margin is that revenue minus units x the product's unit cost.
 *   - An "order" is all sale lines with the same channel, date, customer and reference.
 * Reversed movements (and their reversals) are ignored everywhere.
 */

var KPI_PERIODS = [30, 90, 365];
var KPI_CACHE_PREFIX = 'kpis_v2_';
var KPI_MONTHS = 12;            // how many months of trend to send
var SLOW_MOVER_DAYS = 60;       // in stock but no sale for this many days
var COVER_WINDOW_DAYS = 90;     // trend of days of cover uses the average sales of the last 90 days
var OVERSTOCK_FACTOR = 3;       // overstock = more than 3 x the product's target days of cover
var BUSINESS_CHANNELS = ['B2B', 'B2B2C'];
var KPI_LIST_LIMIT = 8;         // rows in the overstock / slow mover lists
var KPI_TOP_SKUS = 8;           // products shown separately in the monthly units chart

// ================================================================ right now (stock)

/**
 * products: Products rows. summary: buildSummary_ rows (forecast + value + last_sale).
 * settings: needs stockout_warning_days.
 */
function computeStockKpis(products, summary, today, settings) {
  var warnDays = Number(settings && settings.stockout_warning_days);
  if (isNaN(warnDays)) warnDays = 14;
  var soonLimit = addDays(today, warnDays);
  var slowBefore = addDays(today, -SLOW_MOVER_DAYS);
  var productBySku = kpiIndex_(products);

  var rows = summary.filter(function (r) {
    return productBySku[r.sku] && productBySku[r.sku].active;
  });

  var k = {
    units: 0, in_stock: 0, out: 0, reorder: 0, low: 0, stockout_soon: 0, lost_per_day: 0,
    below_rop: 0, safety_total: 0, safety_held: 0, value_cost: 0, value_retail: 0
  };
  var sellingStock = 0;
  var demand = 0;
  var covers = [];
  var categories = {};
  var overstock = [];
  var slow = [];

  rows.forEach(function (r) {
    var p = productBySku[r.sku];
    var onHand = Math.max(r.on_hand, 0);
    var cost = Number(p.unit_cost) || 0;
    var retail = Number(p.retail_price) || 0;

    k.units += onHand;
    if (onHand > 0) k.in_stock++;
    if (r.status === 'OUT') k.out++;
    if (r.status === 'REORDER NOW') k.reorder++;
    if (r.status === 'LOW') k.low++;
    if (onHand > 0 && r.stockout_date && r.stockout_date <= soonLimit) k.stockout_soon++;
    if (onHand <= 0) k.lost_per_day += (r.avg_daily || 0) * retail;

    if (onHand > 0 && onHand <= r.reorder_point) k.below_rop++;
    k.safety_total += r.safety_stock || 0;
    k.safety_held += Math.min(onHand, r.safety_stock || 0);

    var valueCost = r.value !== undefined ? r.value : onHand * cost;
    var valueRetail = r.value_retail !== undefined ? r.value_retail : onHand * retail;
    k.value_cost += valueCost;
    k.value_retail += valueRetail;

    if (r.avg_daily > 0) {
      sellingStock += onHand;
      demand += r.avg_daily;
    }
    if (onHand > 0 && r.days_of_cover !== null) covers.push(r.days_of_cover);

    var cat = categories[p.category] || (categories[p.category] = {
      category: p.category, products: 0, units: 0, value_cost: 0, value_retail: 0, selling_stock: 0, demand: 0
    });
    cat.products++;
    cat.units += onHand;
    cat.value_cost += valueCost;
    cat.value_retail += valueRetail;
    if (r.avg_daily > 0) { cat.selling_stock += onHand; cat.demand += r.avg_daily; }

    // Overstock: far more cover than the product's own target.
    var target = Number(p.target_cover_days) > 0 ? Number(p.target_cover_days) : 60;
    if (onHand > 0 && r.days_of_cover !== null && r.days_of_cover > OVERSTOCK_FACTOR * target) {
      var excess = onHand - r.avg_daily * (r.lead_time_days + target);
      if (excess > 0) {
        overstock.push({
          sku: r.sku, on_hand: onHand, days_of_cover: r.days_of_cover,
          excess_units: Math.round(excess), excess_value: kpiRound_(excess * cost, 2)
        });
      }
    }

    // Slow mover: in stock, but nothing sold for 60 days. A product that is itself younger than 60 days
    // has not had the chance yet, so it is not counted.
    var age = (r.history_days || 0) + (r.stockout_days_skipped || 0);
    if (onHand > 0 && age >= SLOW_MOVER_DAYS && (!r.last_sale || r.last_sale <= slowBefore)) {
      slow.push({
        sku: r.sku, on_hand: onHand, last_sale: r.last_sale || '',
        days_since_sale: r.last_sale ? daysBetween(r.last_sale, today) : null,
        value: kpiRound_(onHand * cost, 2)
      });
    }
  });

  overstock.sort(function (a, b) { return b.excess_value - a.excess_value; });
  slow.sort(function (a, b) { return b.value - a.value; });

  return {
    active_products: rows.length,
    units: k.units,
    in_stock: k.in_stock,
    days_of_cover: demand > 0 ? kpiRound_(sellingStock / demand, 1) : null,
    median_cover: covers.length ? kpiRound_(kpiMedian_(covers), 1) : null,
    risk: {
      out: k.out, reorder: k.reorder, low: k.low, at_risk: k.out + k.reorder,
      stockout_soon: k.stockout_soon, warn_days: warnDays, lost_per_day: kpiRound_(k.lost_per_day, 2)
    },
    reorder_point: {
      below: k.below_rop,
      safety_total: k.safety_total,
      safety_held: k.safety_held,
      safety_coverage: k.safety_total > 0 ? kpiRound_(k.safety_held / k.safety_total, 3) : null
    },
    overstock: {
      count: overstock.length,
      excess_value: kpiRound_(overstock.reduce(function (s, o) { return s + o.excess_value; }, 0), 2),
      factor: OVERSTOCK_FACTOR,
      items: overstock.slice(0, KPI_LIST_LIMIT)
    },
    slow_movers: {
      count: slow.length,
      value: kpiRound_(slow.reduce(function (s, o) { return s + o.value; }, 0), 2),
      days: SLOW_MOVER_DAYS,
      items: slow.slice(0, KPI_LIST_LIMIT)
    },
    value: { cost: kpiRound_(k.value_cost, 2), retail: kpiRound_(k.value_retail, 2) },
    by_category: Object.keys(categories).map(function (name) {
      var c = categories[name];
      return {
        category: c.category, products: c.products, units: c.units,
        days_of_cover: c.demand > 0 ? kpiRound_(c.selling_stock / c.demand, 1) : null,
        value_cost: kpiRound_(c.value_cost, 2), value_retail: kpiRound_(c.value_retail, 2)
      };
    }).sort(function (a, b) { return b.value_cost - a.value_cost; })
  };
}

// ================================================================ a period + monthly trend

/**
 * products, movements, counts: rows from the three tabs. days: 30, 90 or 365.
 * Returns the totals of the last `days` days (current), the same numbers for the `days` before
 * that (prev, for "up/down vs before"), and 12 months of trend (months).
 */
function computeKpis(products, movements, counts, today, days) {
  var ctx = kpiContext_(products, movements, counts, today);
  var since = addDays(today, -days);
  var current = kpiSummarize_(kpiPeriod_(ctx, since, today));
  var before = kpiSummarize_(kpiPeriod_(ctx, addDays(today, -2 * days), since));

  // Best and worst sellers of the period.
  var onHandBySku = stockBySku(movements.filter(function (m) { return m.date <= today; }));
  var unitsBySku = {};
  current.by_sku.forEach(function (r) { unitsBySku[r.sku] = r; });
  var top = current.by_sku.slice(0, 5).map(function (r) {
    return { sku: r.sku, units: r.units, revenue: r.revenue, prev_units: before.sku_units[r.sku] || 0 };
  });
  // Bottom: products that are in stock (so a zero is not just "we had none"), fewest sales first.
  var bottom = products.filter(function (p) { return p.active && (onHandBySku[p.sku] || 0) > 0; })
    .map(function (p) {
      var row = unitsBySku[p.sku];
      return { sku: p.sku, name: p.name, units: row ? row.units : 0, revenue: row ? row.revenue : 0,
        prev_units: before.sku_units[p.sku] || 0 };
    })
    .sort(function (a, b) { return a.units - b.units || a.name.localeCompare(b.name); })
    .slice(0, 5)
    .map(function (r) { delete r.name; return r; });

  var out = { days: days, today: today, since: since, top: top, bottom: bottom, months: kpiMonthly_(ctx) };
  for (var key in current) if (key !== 'sku_units') out[key] = current[key];
  out.prev = {
    units: before.units, revenue: before.revenue, margin: before.margin, margin_pct: before.margin_pct,
    kit_revenue_share: before.kit.revenue_share, produced: before.flows.produced, received: before.flows.received,
    damage_rate: before.flows.damage_rate, sample_rate: before.flows.sample_rate,
    biz_avg_units: before.biz.avg_units, biz_avg_revenue: before.biz.avg_revenue,
    top3_share: before.customers.top3_share, count_accuracy: before.counts.unit_accuracy
  };
  return out;
}

/** Cleans the three tabs once: valid sales, stock flows and counts with their prices and costs. */
function kpiContext_(products, movements, counts, today) {
  var productBySku = kpiIndex_(products);
  var reversed = {};
  movements.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });

  var sales = [];
  var flows = [];
  var firstDate = '';
  movements.forEach(function (m) {
    if (m.date > today) return;
    if (!firstDate || m.date < firstDate) firstDate = m.date;
    if (m.reverses_id || reversed[m.movement_id]) return;
    var p = productBySku[m.sku];
    var cost = p ? Number(p.unit_cost) || 0 : 0;
    var qty = Number(m.qty) || 0;

    if (m.type === 'SALE') {
      var units = -qty;
      if (units <= 0) return;
      var channel = m.channel || 'B2C';
      sales.push({
        date: m.date, sku: m.sku, category: p ? p.category : '', channel: channel,
        customer: String(m.customer || '').trim(), reference: String(m.reference || '').trim(),
        units: units, revenue: units * kpiUnitPrice_(p, channel), cogs: units * cost
      });
    } else if (m.type === 'PRODUCTION' || m.type === 'RESTOCK' || m.type === 'DAMAGED' ||
      m.type === 'EXPIRED' || m.type === 'SAMPLE') {
      flows.push({ date: m.date, sku: m.sku, type: m.type, units: Math.abs(qty), cost: Math.abs(qty) * cost });
    }
  });
  sales.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  var countRows = counts.filter(function (c) { return c.date <= today; }).map(function (c) {
    var p = productBySku[c.sku];
    return { date: c.date, sku: c.sku, variance: Number(c.variance) || 0, system: Number(c.system_qty) || 0,
      cost: p ? Number(p.unit_cost) || 0 : 0 };
  });

  return {
    today: today, products: products, productBySku: productBySku, movements: movements,
    sales: sales, flows: flows, counts: countRows,
    firstDate: firstDate,
    months: kpiMonthList_(today, firstDate)
  };
}

/** Retail price for direct sales, wholesale (default 70% of retail) for B2B and stores. */
function kpiUnitPrice_(product, channel) {
  if (!product) return 0;
  var retail = Number(product.retail_price) || 0;
  if (channel === 'B2C') return retail;
  var wholesale = Number(product.wholesale_price);
  return wholesale > 0 ? wholesale : retail * 0.7;
}

/** Adds sales to a bucket {units, revenue, cogs} inside a map. */
function kpiBucket_(map, key) {
  return map[key] || (map[key] = { units: 0, revenue: 0, cogs: 0 });
}

/** Raw totals for dates after `from` up to and including `to`. */
function kpiPeriod_(ctx, from, to) {
  var r = {
    units: 0, revenue: 0, cogs: 0, by_channel: {}, by_category: {}, by_sku: {}, kit_units: 0, kit_revenue: 0,
    biz_revenue: 0, biz_no_customer: 0, customers: {}, orders: {},
    produced: 0, received: 0, damaged: 0, expired: 0, samples: 0, damaged_cost: 0, expired_cost: 0, sample_cost: 0,
    count_lines: 0, count_exact: 0, count_abs: 0, count_system: 0, short_units: 0, over_units: 0,
    short_value: 0, over_value: 0, count_days: {}, count_by_sku: {}
  };

  ctx.sales.forEach(function (s) {
    if (s.date <= from || s.date > to) return;
    r.units += s.units; r.revenue += s.revenue; r.cogs += s.cogs;
    [kpiBucket_(r.by_channel, s.channel), kpiBucket_(r.by_category, s.category || '-'), kpiBucket_(r.by_sku, s.sku)]
      .forEach(function (b) { b.units += s.units; b.revenue += s.revenue; b.cogs += s.cogs; });
    if (s.category === 'Kit') { r.kit_units += s.units; r.kit_revenue += s.revenue; }

    if (BUSINESS_CHANNELS.indexOf(s.channel) !== -1) {
      r.biz_revenue += s.revenue;
      var orderKey = s.channel + '|' + s.date + '|' + s.customer.toLowerCase() + '|' + s.reference.toLowerCase();
      var order = r.orders[orderKey] || (r.orders[orderKey] = { channel: s.channel, units: 0, revenue: 0 });
      order.units += s.units;
      order.revenue += s.revenue;
      if (!s.customer) {
        r.biz_no_customer += s.revenue;
      } else {
        var customerKey = s.customer.toLowerCase();
        var c = r.customers[customerKey] || (r.customers[customerKey] = { name: s.customer, units: 0, revenue: 0, orders: {} });
        c.units += s.units;
        c.revenue += s.revenue;
        c.orders[orderKey] = true;
      }
    }
  });

  ctx.flows.forEach(function (f) {
    if (f.date <= from || f.date > to) return;
    if (f.type === 'PRODUCTION') r.produced += f.units;
    else if (f.type === 'RESTOCK') r.received += f.units;
    else if (f.type === 'DAMAGED') { r.damaged += f.units; r.damaged_cost += f.cost; }
    else if (f.type === 'EXPIRED') { r.expired += f.units; r.expired_cost += f.cost; }
    else if (f.type === 'SAMPLE') { r.samples += f.units; r.sample_cost += f.cost; }
  });

  ctx.counts.forEach(function (c) {
    if (c.date <= from || c.date > to) return;
    r.count_lines++;
    if (c.variance === 0) r.count_exact++;
    r.count_abs += Math.abs(c.variance);
    r.count_system += c.system;
    if (c.variance < 0) { r.short_units -= c.variance; r.short_value -= c.variance * c.cost; }
    if (c.variance > 0) { r.over_units += c.variance; r.over_value += c.variance * c.cost; }
    r.count_days[c.date] = true;
    var s = r.count_by_sku[c.sku] || (r.count_by_sku[c.sku] = { sku: c.sku, net: 0, abs: 0, value: 0 });
    s.net += c.variance; s.abs += Math.abs(c.variance); s.value += c.variance * c.cost;
  });
  return r;
}

/** Turns raw period totals into the lists and rates the dashboard shows. */
function kpiSummarize_(r) {
  var margin = r.revenue - r.cogs;
  var sold = r.units;

  var channelRows = Object.keys(r.by_channel).map(function (ch) {
    var b = r.by_channel[ch];
    return { channel: ch, units: b.units, revenue: kpiRound_(b.revenue, 2), margin: kpiRound_(b.revenue - b.cogs, 2),
      revenue_share: r.revenue > 0 ? kpiRound_(b.revenue / r.revenue, 4) : null };
  }).sort(function (a, b) { return b.revenue - a.revenue; });

  var categoryRows = Object.keys(r.by_category).map(function (cat) {
    var b = r.by_category[cat];
    return { category: cat, units: b.units, revenue: kpiRound_(b.revenue, 2), margin: kpiRound_(b.revenue - b.cogs, 2) };
  }).sort(function (a, b) { return b.units - a.units; });

  var skuUnits = {};
  var skuRows = Object.keys(r.by_sku).map(function (sku) {
    var b = r.by_sku[sku];
    skuUnits[sku] = b.units;
    return { sku: sku, units: b.units, revenue: kpiRound_(b.revenue, 2), margin: kpiRound_(b.revenue - b.cogs, 2) };
  }).sort(function (a, b) { return b.units - a.units; });

  // Business orders (B2B and stores).
  var bizByChannel = {};
  var bizOrders = 0, bizUnits = 0, bizRevenue = 0;
  Object.keys(r.orders).forEach(function (key) {
    var o = r.orders[key];
    var ch = bizByChannel[o.channel] || (bizByChannel[o.channel] = { channel: o.channel, orders: 0, units: 0, revenue: 0 });
    ch.orders++; ch.units += o.units; ch.revenue += o.revenue;
    bizOrders++; bizUnits += o.units; bizRevenue += o.revenue;
  });
  var bizRows = Object.keys(bizByChannel).sort().map(function (key) {
    var ch = bizByChannel[key];
    return { channel: ch.channel, orders: ch.orders, avg_units: kpiRound_(ch.units / ch.orders, 1),
      avg_revenue: kpiRound_(ch.revenue / ch.orders, 2) };
  });

  // Customer concentration among business customers.
  var customerRows = Object.keys(r.customers).map(function (key) {
    var c = r.customers[key];
    return { customer: c.name, orders: Object.keys(c.orders).length, units: c.units, revenue: kpiRound_(c.revenue, 2),
      share: r.biz_revenue > 0 ? kpiRound_(c.revenue / r.biz_revenue, 4) : null };
  }).sort(function (a, b) { return b.revenue - a.revenue; });
  var shareOfTop = function (n) {
    if (r.biz_revenue <= 0 || !customerRows.length) return null;
    return kpiRound_(customerRows.slice(0, n).reduce(function (s, c) { return s + c.revenue; }, 0) / r.biz_revenue, 4);
  };

  var written = r.damaged + r.expired;
  return {
    units: sold,
    revenue: kpiRound_(r.revenue, 2),
    cogs: kpiRound_(r.cogs, 2),
    margin: kpiRound_(margin, 2),
    margin_pct: r.revenue > 0 ? kpiRound_(margin / r.revenue, 4) : null,
    kit: {
      units: r.kit_units, revenue: kpiRound_(r.kit_revenue, 2),
      units_share: sold > 0 ? kpiRound_(r.kit_units / sold, 4) : null,
      revenue_share: r.revenue > 0 ? kpiRound_(r.kit_revenue / r.revenue, 4) : null
    },
    by_channel: channelRows,
    by_category: categoryRows,
    by_sku: skuRows,
    sku_units: skuUnits,
    biz: {
      orders: bizOrders,
      avg_units: bizOrders ? kpiRound_(bizUnits / bizOrders, 1) : null,
      avg_revenue: bizOrders ? kpiRound_(bizRevenue / bizOrders, 2) : null,
      by_channel: bizRows
    },
    customers: {
      named: customerRows.length,
      top: customerRows.slice(0, 5),
      top1_share: shareOfTop(1), top3_share: shareOfTop(3), top5_share: shareOfTop(5),
      no_customer_share: r.biz_revenue > 0 ? kpiRound_(r.biz_no_customer / r.biz_revenue, 4) : null
    },
    flows: {
      produced: r.produced, received: r.received,
      production_vs_sales: sold > 0 ? kpiRound_(r.produced / sold, 2) : null,
      damaged: r.damaged, expired: r.expired, samples: r.samples,
      damaged_cost: kpiRound_(r.damaged_cost, 2), expired_cost: kpiRound_(r.expired_cost, 2),
      sample_cost: kpiRound_(r.sample_cost, 2),
      damage_rate: sold > 0 ? kpiRound_(r.damaged / sold, 4) : null,
      expired_rate: sold > 0 ? kpiRound_(r.expired / sold, 4) : null,
      writeoff_rate: sold > 0 ? kpiRound_(written / sold, 4) : null,
      sample_rate: sold > 0 ? kpiRound_(r.samples / sold, 4) : null
    },
    counts: {
      sessions: Object.keys(r.count_days).length,
      lines: r.count_lines,
      exact: r.count_exact,
      line_accuracy: r.count_lines ? kpiRound_(r.count_exact / r.count_lines, 4) : null,
      unit_accuracy: r.count_system > 0 ? kpiRound_(Math.max(0, 1 - r.count_abs / r.count_system), 4) : null,
      short_units: r.short_units, over_units: r.over_units,
      short_value: kpiRound_(r.short_value, 2), over_value: kpiRound_(r.over_value, 2),
      worst: Object.keys(r.count_by_sku).map(function (k) { return r.count_by_sku[k]; })
        .filter(function (s) { return s.abs > 0; })
        .sort(function (a, b) { return b.abs - a.abs; }).slice(0, 5)
        .map(function (s) { return { sku: s.sku, net: s.net, abs: s.abs, value: kpiRound_(s.value, 2) }; })
    }
  };
}

// ================================================================ trend by month

/** The last 12 months ('YYYY-MM', oldest first), without months before the first movement. */
function kpiMonthList_(today, firstDate) {
  if (!firstDate) return [];
  var y = Number(today.slice(0, 4));
  var m = Number(today.slice(5, 7));
  var list = [];
  for (var i = 0; i < KPI_MONTHS; i++) {
    list.unshift(y + '-' + (m < 10 ? '0' : '') + m);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  var first = firstDate.slice(0, 7);
  return list.filter(function (month) { return month >= first; });
}

/** Last day of a 'YYYY-MM' month as 'YYYY-MM-DD'. */
function kpiMonthEnd_(month) {
  var y = Number(month.slice(0, 4));
  var m = Number(month.slice(5, 7));
  var day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + '-' + (day < 10 ? '0' : '') + day;
}

function kpiMonthly_(ctx) {
  var rows = {};
  var list = ctx.months.map(function (month) {
    // How much of the month has data: from the first movement (or the 1st) to today (or the last day).
    var monthEnd = kpiMonthEnd_(month);
    var covered = daysBetween(ctx.firstDate > month + '-01' ? ctx.firstDate : month + '-01', ctx.today < monthEnd ? ctx.today : monthEnd) + 1;
    return (rows[month] = {
      month: month, partial: covered < Number(monthEnd.slice(8, 10)), units: 0, revenue: 0, margin: 0, by_channel: {}, revenue_by_channel: {},
      by_category: {}, by_sku: {}, kit_revenue: 0, kit_units: 0,
      biz_orders: 0, biz_units: 0, biz_revenue: 0, top3_share: null,
      produced: 0, received: 0, damaged: 0, expired: 0, samples: 0,
      counts: { lines: 0, exact: 0, abs: 0, system: 0, short_value: 0 },
      stock: null
    });
  });

  var orders = {};
  var customersByMonth = {};
  ctx.sales.forEach(function (s) {
    var row = rows[s.date.slice(0, 7)];
    if (!row) return;
    row.units += s.units;
    row.revenue += s.revenue;
    row.margin += s.revenue - s.cogs;
    row.by_channel[s.channel] = (row.by_channel[s.channel] || 0) + s.units;
    row.revenue_by_channel[s.channel] = (row.revenue_by_channel[s.channel] || 0) + s.revenue;
    row.by_category[s.category || '-'] = (row.by_category[s.category || '-'] || 0) + s.units;
    row.by_sku[s.sku] = (row.by_sku[s.sku] || 0) + s.units;
    if (s.category === 'Kit') { row.kit_units += s.units; row.kit_revenue += s.revenue; }
    if (BUSINESS_CHANNELS.indexOf(s.channel) !== -1) {
      row.biz_units += s.units;
      row.biz_revenue += s.revenue;
      var key = s.channel + '|' + s.date + '|' + s.customer.toLowerCase() + '|' + s.reference.toLowerCase();
      if (!orders[key]) { orders[key] = true; row.biz_orders++; }
      if (s.customer) {
        var perMonth = customersByMonth[row.month] || (customersByMonth[row.month] = {});
        perMonth[s.customer.toLowerCase()] = (perMonth[s.customer.toLowerCase()] || 0) + s.revenue;
      }
    }
  });
  list.forEach(function (row) {
    var perMonth = customersByMonth[row.month];
    if (perMonth && row.biz_revenue > 0) {
      var revenues = Object.keys(perMonth).map(function (k) { return perMonth[k]; }).sort(function (a, b) { return b - a; });
      row.top3_share = kpiRound_(revenues.slice(0, 3).reduce(function (s, v) { return s + v; }, 0) / row.biz_revenue, 4);
    }
  });

  ctx.flows.forEach(function (f) {
    var row = rows[f.date.slice(0, 7)];
    if (!row) return;
    if (f.type === 'PRODUCTION') row.produced += f.units;
    else if (f.type === 'RESTOCK') row.received += f.units;
    else if (f.type === 'DAMAGED') row.damaged += f.units;
    else if (f.type === 'EXPIRED') row.expired += f.units;
    else if (f.type === 'SAMPLE') row.samples += f.units;
  });

  ctx.counts.forEach(function (c) {
    var row = rows[c.date.slice(0, 7)];
    if (!row) return;
    row.counts.lines++;
    if (c.variance === 0) row.counts.exact++;
    row.counts.abs += Math.abs(c.variance);
    row.counts.system += c.system;
    if (c.variance < 0) row.counts.short_value -= c.variance * c.cost;
  });

  // Keep the biggest products as their own series in the monthly chart; the rest become "_other".
  var skuTotals = {};
  list.forEach(function (row) {
    Object.keys(row.by_sku).forEach(function (sku) { skuTotals[sku] = (skuTotals[sku] || 0) + row.by_sku[sku]; });
  });
  var keep = Object.keys(skuTotals).sort(function (a, b) { return skuTotals[b] - skuTotals[a]; }).slice(0, KPI_TOP_SKUS);
  list.forEach(function (row) {
    var other = 0;
    var kept = {};
    Object.keys(row.by_sku).forEach(function (sku) {
      if (keep.indexOf(sku) !== -1) kept[sku] = row.by_sku[sku]; else other += row.by_sku[sku];
    });
    if (other) kept._other = other;
    row.by_sku = kept;
  });

  var snapshots = kpiSnapshots_(ctx);
  list.forEach(function (row, i) {
    row.stock = snapshots[i];
    row.revenue = kpiRound_(row.revenue, 2);
    row.margin = kpiRound_(row.margin, 2);
    row.kit_revenue = kpiRound_(row.kit_revenue, 2);
    row.biz_revenue = kpiRound_(row.biz_revenue, 2);
    Object.keys(row.revenue_by_channel).forEach(function (ch) { row.revenue_by_channel[ch] = kpiRound_(row.revenue_by_channel[ch], 2); });
    row.counts.short_value = kpiRound_(row.counts.short_value, 2);
  });
  return list;
}

/**
 * Stock at the end of each month (and today for the current month): units, value at cost,
 * products at zero, days of cover and slow movers. Walks through every stock movement once.
 * Only products that already had a movement by that date are counted.
 */
function kpiSnapshots_(ctx) {
  var dates = ctx.months.map(function (month, i) {
    return i === ctx.months.length - 1 ? ctx.today : kpiMonthEnd_(month);
  });
  var sorted = ctx.movements.filter(function (m) { return m.date <= ctx.today; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var active = ctx.products.filter(function (p) { return p.active; });
  var stock = {};
  var seen = {};
  var next = 0;

  return dates.map(function (date) {
    while (next < sorted.length && sorted[next].date <= date) {
      var m = sorted[next++];
      stock[m.sku] = (stock[m.sku] || 0) + (Number(m.qty) || 0);
      if (!seen[m.sku]) seen[m.sku] = m.date;   // the day the product first appeared
    }
    // Sales up to this date: units in the last 90 days, and the last sale day, per product.
    var windowStart = addDays(date, -COVER_WINDOW_DAYS);
    var slowBefore = addDays(date, -SLOW_MOVER_DAYS);
    var recent = {};
    var lastSale = {};
    for (var i = 0; i < ctx.sales.length; i++) {
      var s = ctx.sales[i];
      if (s.date > date) break;
      if (s.date > windowStart) recent[s.sku] = (recent[s.sku] || 0) + s.units;
      lastSale[s.sku] = s.date;
    }

    // Average daily sales = units in the window / days of history (at most 90). With under 14 days
    // of history there is nothing reliable to divide by, so no days-of-cover figure is shown.
    var history = ctx.firstDate ? daysBetween(ctx.firstDate, date) + 1 : 0;
    var windowDays = Math.min(COVER_WINDOW_DAYS, history);
    var snap = { units: 0, value: 0, out: 0, selling_stock: 0, demand: 0, slow_count: 0, slow_value: 0 };
    active.forEach(function (p) {
      if (!seen[p.sku] && date !== ctx.today) return;
      var onHand = stock[p.sku] || 0;
      var cost = Number(p.unit_cost) || 0;
      var held = Math.max(onHand, 0);
      snap.units += held;
      snap.value += held * cost;
      if (onHand <= 0) snap.out++;
      if (recent[p.sku] > 0) {
        snap.selling_stock += held;
        snap.demand += recent[p.sku] / Math.max(windowDays, 1);
      }
      var productAge = seen[p.sku] ? daysBetween(seen[p.sku], date) + 1 : 0;
      if (held > 0 && productAge >= SLOW_MOVER_DAYS && (!lastSale[p.sku] || lastSale[p.sku] <= slowBefore)) {
        snap.slow_count++;
        snap.slow_value += held * cost;
      }
    });
    return {
      date: date, units: snap.units, value: kpiRound_(snap.value, 2), out: snap.out,
      cover: snap.demand > 0 && history >= 14 ? kpiRound_(snap.selling_stock / snap.demand, 1) : null,
      slow_count: snap.slow_count, slow_value: kpiRound_(snap.slow_value, 2)
    };
  });
}

// ================================================================ API action

/** payload: { days: 30 | 90 | 365 }. Cached for 5 minutes; any write clears the cache. */
function getKpis_(payload) {
  var days = Number(payload.days) || 90;
  if (KPI_PERIODS.indexOf(days) === -1) throw userError_('Choose 30, 90 or 365 days.');
  var cache = CacheService.getScriptCache();
  var key = KPI_CACHE_PREFIX + days;
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  var data = computeKpis(readTable_('Products'), readTable_('Movements'), readTable_('Counts'), todayISO_(), days);
  var json = JSON.stringify(data);
  if (json.length < 95000) cache.put(key, json, 300);
  return data;
}

// ================================================================ small helpers

function kpiIndex_(products) {
  var map = {};
  products.forEach(function (p) { map[p.sku] = p; });
  return map;
}

function kpiRound_(n, decimals) {
  var f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function kpiMedian_(numbers) {
  var sorted = numbers.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
