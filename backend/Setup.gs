/**
 * Setup.gs
 * One-time setup functions you run by hand from the Apps Script editor
 * (select the function name in the toolbar, then click Run).
 *
 *   setup()            creates any missing tab with the right headers. Safe to run again.
 *   loadSampleData()   fills the Sheet with SunSpectra's products and 90 days of made-up movements.
 *   clearSampleData()  removes the made-up movements (products and your real data stay).
 */

function setup() {
  var ss = getSpreadsheet_();
  Object.keys(SCHEMA).forEach(function (table) {
    var sheet = ss.getSheetByName(table) || ss.insertSheet(table);
    var headers = columnNames_(table);
    var lastCol = sheet.getLastColumn();
    var current = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

    // Only write headers that are missing, so re-running never touches existing data.
    for (var c = 0; c < headers.length; c++) {
      if (current[c] !== headers[c]) {
        if (current[c]) {
          throw new Error('Tab "' + table + '" column ' + (c + 1) + ' is "' + current[c] +
            '" but should be "' + headers[c] + '". Fix the header row by hand, then run setup() again.');
        }
        sheet.getRange(1, c + 1).setValue(headers[c]);
      }
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // Text and date columns are formatted as plain text so Sheets doesn't
    // "helpfully" turn SKUs or dates into numbers.
    SCHEMA[table].forEach(function (col, i) {
      if (col[1] === 'str' || col[1] === 'date' || col[1] === 'ts') {
        sheet.getRange(2, i + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      }
    });
  });

  // Add any missing setting with its default value.
  var existing = indexBy_(readTable_('Settings'), 'key');
  var missing = Object.keys(DEFAULT_SETTINGS).filter(function (k) { return !existing[k]; })
    .map(function (k) { return { key: k, value: DEFAULT_SETTINGS[k] }; });
  appendRows_('Settings', missing);

  // Remove the empty "Sheet1" that every new spreadsheet starts with.
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  clearCache_();
  Logger.log('Setup complete.');
}

// ------------------------------------------------------------------ sample data

var SAMPLE_USER = 'Sample data';

// SunSpectra's product list (from the client's spreadsheet).
// Unit costs were not provided, so they are estimated at ~30% of retail: replace them with real costs.
// Columns: sku, name, category, retail, lead time (days), min order qty, avg daily sales used for the sample.
var PRODUCT_LIST = [
  ['SS-SPF50-300', 'SkinSaver SPF50 Cream 300 ml', 'Sunscreen', 25.99, 21, 50, 0.6],
  ['SS-SPF50-60', 'SkinSaver SPF50 Facial Fluid 60 ml', 'Sunscreen', 12.99, 21, 50, 1.5],
  ['OP-GREEN', 'Opticks Green 100 ml (combination-oily)', 'Tinted Sunscreen', 17.99, 21, 50, 1.2],
  ['OP-BLUE', 'Opticks Blue 100 ml (normal-dry)', 'Tinted Sunscreen', 17.99, 21, 50, 1.1],
  ['ST-CLEAR', 'Sport Mineral Stick 80 g Transparent', 'Sunscreen Stick', 17.99, 21, 40, 1.0],
  ['ST-K1V', 'Sport Mineral Stick 80 g Shade K1V', 'Sunscreen Stick', 15.99, 21, 40, 0.7],
  ['ST-L1V', 'Sport Mineral Stick 80 g Shade L1V', 'Sunscreen Stick', 15.99, 21, 40, 0.8],
  ['ST-M1V', 'Sport Mineral Stick 80 g Shade M1V', 'Sunscreen Stick', 15.99, 21, 40, 0.6],
  ['OPP-K1V', 'Opticks Powder K1V (compact)', 'Tinted Sunscreen', 0, 30, 20, 0],
  ['OPP-L1V', 'Opticks Powder L1V (compact)', 'Tinted Sunscreen', 0, 30, 20, 0],
  ['OPP-M1V', 'Opticks Powder M1V (compact)', 'Tinted Sunscreen', 0, 30, 20, 0],
  ['SK-LUMINA', 'Lumina Serum (depigmenting)', 'Skincare', 15.99, 14, 30, 0.8],
  ['SK-ALIA', 'Alia Hydrating Facial Lotion', 'Skincare', 10.99, 14, 30, 0.6],
  ['SK-GLOW', 'Glow Reset Facial Soap 60 ml', 'Skincare', 8.99, 14, 30, 0.7],
  ['SK-ALOE', 'SkinSaver Aloe Vera Gel (after-sun)', 'Skincare', 6.99, 14, 30, 0.9],
  ['LB-CORAL', 'Lip Balm Coral SPF30 12 g', 'Lip Balm', 6.99, 10, 60, 2.0],
  ['LB-AURA', 'Lip Balm Aura SPF30 12 g', 'Lip Balm', 6.99, 10, 60, 1.6],
  ['LB-CARMESI', 'Lip Balm Carmesí SPF30 12 g', 'Lip Balm', 6.99, 10, 60, 1.4],
  ['MU-PALETTE', 'Palette (multi-use)', 'Makeup', 28.99, 30, 20, 0.3],
  ['MU-BLUSH', 'Blush Flora (cream stick)', 'Makeup', 9.99, 30, 20, 0.4],
  ['MU-AURORA', 'Highlighter Aurora', 'Makeup', 9.99, 30, 20, 0.4],
  ['AC-BAG', 'SunSpectra Cosmetic Bag', 'Accessory', 9.99, 30, 50, 0.3],
  ['KIT-LUMINA', 'Kit Lumina (depigmenting)', 'Kit', 28.5, 7, 10, 0.3],
  ['KIT-DARKSPOT', 'Dark Spot Control Kit', 'Kit', 31.99, 7, 10, 0.2],
  ['KIT-MAKEUP', 'Makeup Kit', 'Kit', 31.99, 7, 10, 0.2],
  ['KIT-ALIA', 'Kit Alia (care & hydration)', 'Kit', 38.99, 7, 10, 0.2],
  ['KIT-OPTICKS', 'Kit Opticks (sun protection set)', 'Kit', 54.99, 7, 10, 0.15],
  ['KIT-SKINCARE', 'Kit Skincare (facial routine)', 'Kit', 30.99, 7, 10, 0.2],
  ['KIT-PALETTE', 'Palette Kit (promo)', 'Kit', 33.0, 7, 10, 0.15],
  ['KIT-LIPBALM', 'Kit Lip Balms', 'Kit', 16.99, 7, 10, 0.4],
  ['KIT-DUO-OPT', 'Kit 1+1 Opticks (duo)', 'Kit', 23.0, 7, 10, 0.3],
  ['KIT-DUO', 'Kit 1+1 (promo 2 products)', 'Kit', 22.0, 7, 10, 0.3],
  ['KIT-SPORT', 'Kit S+1 (sport promo)', 'Kit', 24.99, 7, 10, 0.3]
];
var DISCONTINUED = ['OPP-K1V', 'OPP-L1V', 'OPP-M1V'];

// How each product behaves in the sample, so every screen has something to show.
//   out   = sold out and not restocked          tight = will run out within days
//   slow  = no sales in the last 60 days        (default) = restocked normally
var SAMPLE_PROFILES = {
  'LB-CARMESI': 'out', 'ST-M1V': 'out',
  'OP-BLUE': 'tight', 'SS-SPF50-60': 'tight', 'LB-CORAL': 'tight',
  'MU-BLUSH': 'slow', 'KIT-PALETTE': 'slow'
};

var SAMPLE_SUPPLIERS = [
  ['SUP-INHOUSE', 'SunSpectra workshop (in-house production)', '', '', '', 'Lead time = time to get raw materials and produce a batch.'],
  ['SUP-NEESER', 'Neeser', '', '', '', 'Cosmetic bags'],
  ['SUP-CARIBE', 'Distribuidora del Caribe', '', '', '', 'Raw materials: starch, glycerin, zinc oxide, oils (about 1 week)'],
  ['SUP-APOTECARIO', 'Apotecario Artesanal', '', '', '', 'Raw materials: waxes, pigments, flavors (about 1 week)'],
  ['SUP-CARSEN', 'Carsen', '', '', '', 'Raw materials: triglycerides, vitamin E, shea butter (2-3 weeks)'],
  ['SUP-DEVERAUX', 'Deveraux Specialties', '', '', '', 'ZinClear zinc oxide dispersion (about 3 months)'],
  ['SUP-ASTEK', 'Astek', '', '', '', 'Fragrances (about 1 month)']
];

var SAMPLE_CUSTOMERS = {
  B2B: ['Distribuidora Verde', 'Pura Vida Wholesale'],
  B2B2C: ['Surf Shop Tamarindo', 'Eco Tienda Nosara', 'Hotel Pacífico Boutique', 'Farmacia La Paz'],
  B2C: ['Web store', 'Instagram', 'Feria Verde']
};

/** Adds the product list (if Products is empty), suppliers and 90 days of movements. */
function loadSampleData() {
  setup();
  var now = nowISO_();

  if (readTable_('Suppliers').length === 0) {
    appendRows_('Suppliers', SAMPLE_SUPPLIERS.map(function (s) {
      return { supplier_id: s[0], name: s[1], contact: s[2], email: s[3], phone: s[4], notes: s[5] };
    }));
  }

  if (readTable_('Products').length === 0) {
    appendRows_('Products', PRODUCT_LIST.map(function (p) {
      return {
        sku: p[0], name: p[1], category: p[2], unit: 'unit',
        unit_cost: Math.round(p[3] * 0.3 * 100) / 100, retail_price: p[3],
        wholesale_price: Math.round(p[3] * 0.7 * 100) / 100,
        supplier_id: p[0] === 'AC-BAG' ? 'SUP-NEESER' : 'SUP-INHOUSE',
        lead_time_days: p[4], min_order_qty: p[5], target_cover_days: 60,
        active: DISCONTINUED.indexOf(p[0]) === -1, created_at: now, updated_at: now
      };
    }));
  }

  var already = readTable_('Movements').some(function (m) { return m.entered_by === SAMPLE_USER; });
  if (already) {
    Logger.log('Sample movements are already loaded. Run clearSampleData() first to reload them.');
    return;
  }
  var rows = generateSampleMovements_(todayISO_(), 90);
  appendRows_('Movements', rows);
  addSampleCounts_();
  clearCache_();
  Logger.log('Loaded ' + rows.length + ' sample movements.');
}

/** Two sample stock counts with a few small differences, so the Counts screens have history. */
function addSampleCounts_() {
  var today = todayISO_();
  [[-35, { 'LB-CORAL': -2, 'LB-AURA': 0, 'ST-CLEAR': -1, 'SK-ALOE': 0, 'OP-GREEN': 1 }],
   [-8, { 'LB-CORAL': 0, 'LB-AURA': -1, 'ST-CLEAR': 0, 'SK-LUMINA': -3, 'MU-PALETTE': 0 }]].forEach(function (count) {
    var date = addDaysISO_(today, count[0]);
    var stock = stockBySku(readTable_('Movements').filter(function (m) { return m.date <= date; }));
    var lines = Object.keys(count[1]).map(function (sku) {
      return { sku: sku, counted_qty: Math.max(0, (stock[sku] || 0) + count[1][sku]) };
    });
    saveCount_({ date: date, lines: lines }, { user: SAMPLE_USER });
  });
}

/** Deletes every movement, count and alert entered by the sample loader. */
function clearSampleData() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ['Movements', 'Counts'].forEach(function (table) {
      var keep = readTable_(table).filter(function (r) { return r.entered_by !== SAMPLE_USER; });
      rewriteTable_(table, keep);
    });
    var alerts = readTable_('AlertLog');
    if (alerts.length) rewriteTable_('AlertLog', []);
    clearCache_();
    Logger.log('Sample movements removed. Products and suppliers were kept.');
  } finally {
    lock.releaseLock();
  }
}

/** Replaces all data rows of a tab (headers stay). Only used by clearSampleData(). */
function rewriteTable_(table, rows) {
  var sheet = getSheet_(table);
  var width = SCHEMA[table].length;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
  appendRows_(table, rows);
}

/**
 * Simulates 90 days of business for each product: an opening stock, daily web/Instagram
 * sales, weekly store orders, the odd wholesale order, samples, damage, and production
 * batches when stock gets low. Fixed random seeds make the result the same every time.
 */
function generateSampleMovements_(todayIso, days) {
  var rows = [];
  var start = addDaysISO_(todayIso, -days);
  var createdAt = nowISO_();
  var seq = 0;

  function add(date, sku, type, qty, channel, customer, reference, note) {
    rows.push({
      movement_id: 'S-' + (++seq), date: date, sku: sku, type: type, qty: qty,
      channel: channel, customer: customer || '', reference: reference || '', note: note || '',
      entered_by: SAMPLE_USER, created_at: createdAt, reverses_id: ''
    });
  }

  PRODUCT_LIST.forEach(function (p, index) {
    var sku = p[0], lead = p[4], batch = p[5], rate = p[6];
    var profile = SAMPLE_PROFILES[sku] || 'normal';

    if (DISCONTINUED.indexOf(sku) !== -1) {
      // Discontinued: a few leftovers sold off early in the period.
      add(start, sku, 'OPENING', 4, 'INTERNAL', '', '', 'Opening stock');
      add(addDaysISO_(start, 5 + index), sku, 'SALE', -4, 'B2C', 'Feria Verde', '', 'Clearance');
      return;
    }

    // 1) Decide what customers want each day (before knowing the stock).
    var events = sampleDemand_(rate, index, days, profile);

    // 2) Pick an opening stock that gives the product its intended story.
    var total = function (fromDay, toDay) {
      return events.filter(function (e) { return e.day >= fromDay && e.day < toDay; })
        .reduce(function (sum, e) { return sum + e.qty; }, 0);
    };
    var stock = Math.round(rate * 45 + batch * 0.5);
    if (profile === 'slow') stock = 25;
    if (profile === 'out') stock = total(1, days - 20);                         // ran out ~3 weeks ago
    if (profile === 'tight') stock = total(1, days) + Math.ceil(rate * 1.2 * 6); // about a week left
    add(start, sku, 'OPENING', stock, 'INTERNAL', '', '', 'Opening stock');

    // 3) Walk through the days: production arrives, then sales (never more than what's on hand).
    var arrivalDay = -1;
    var reorderLevel = rate * (lead + 10);
    var neverRestock = profile === 'tight' || profile === 'out';
    var e = 0;
    for (var d = 1; d < days; d++) {
      var date = addDaysISO_(start, d);
      if (d === arrivalDay) {
        var made = batchSize_(rate, lead, batch);
        add(date, sku, 'PRODUCTION', made, 'INTERNAL', '', 'BATCH-' + sku + '-' + d, '');
        stock += made;
        arrivalDay = -1;
      }
      for (; e < events.length && events[e].day === d; e++) {
        var ev = events[e];
        var qty = Math.min(ev.qty, stock); // you can't sell what you don't have
        if (qty <= 0) continue;
        add(date, sku, ev.type, -qty, ev.channel, ev.customer, ev.reference, ev.note);
        stock -= qty;
      }
      // Start a production batch when stock gets low (it arrives after the lead time).
      if (stock <= reorderLevel && arrivalDay === -1 && !neverRestock) arrivalDay = d + lead;
    }
  });
  return rows;
}

/** List of {day, type, qty, channel, customer, reference, note} for one product, sorted by day. */
function sampleDemand_(rate, index, days, profile) {
  var rand = seededRandom_(20261028 + index * 7919);
  var storeDay = index % 7; // each product's store orders land on a different weekday
  var events = [];
  for (var d = 1; d < days; d++) {
    var selling = !(profile === 'slow' && d > days - 62); // slow movers: no sales for 60+ days
    if (selling) {
      var web = poisson_(rate * 0.45, rand);
      if (web) events.push({ day: d, type: 'SALE', qty: web, channel: 'B2C', customer: pick_(SAMPLE_CUSTOMERS.B2C, rand) });
      if (d % 7 === storeDay && rand() < 0.75) {
        events.push({ day: d, type: 'SALE', qty: Math.max(1, Math.round(rate * 7 * 0.45 * (0.6 + rand() * 0.8))),
          channel: 'B2B2C', customer: pick_(SAMPLE_CUSTOMERS.B2B2C, rand), reference: 'INV-' + (1000 + d * 40 + index) });
      }
      if (rand() < 0.04 && rate >= 0.5) {
        events.push({ day: d, type: 'SALE', qty: Math.round(rate * 10 * (0.8 + rand() * 0.5)),
          channel: 'B2B', customer: pick_(SAMPLE_CUSTOMERS.B2B, rand), reference: 'INV-' + (1000 + d * 40 + index) });
      }
    }
    if (rand() < 0.02) events.push({ day: d, type: 'SAMPLE', qty: 1, channel: 'INTERNAL', note: 'Sample for influencer' });
    if (rand() < 0.01) events.push({ day: d, type: 'DAMAGED', qty: 1, channel: 'INTERNAL', note: 'Broken in storage' });
  }
  return events;
}

function pick_(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

/** A batch big enough for about 60 days of sales, at least the minimum batch size. */
function batchSize_(rate, lead, minBatch) {
  return Math.max(minBatch, Math.ceil(rate * (lead + 60) / minBatch) * minBatch);
}

/** Small deterministic random number generator (mulberry32). */
function seededRandom_(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Random count with the given average (for daily sales). */
function poisson_(mean, rand) {
  var limit = Math.exp(-mean), k = 0, p = 1;
  do { k++; p *= rand(); } while (p > limit);
  return k - 1;
}

function addDaysISO_(iso, n) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
