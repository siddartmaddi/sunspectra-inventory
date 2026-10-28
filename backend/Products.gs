/**
 * Products.gs
 * Products, suppliers and settings. Products are never deleted, only deactivated,
 * so old movements always point to a product that still exists.
 */

var CATEGORIES = ['Sunscreen', 'Sunscreen Stick', 'Tinted Sunscreen', 'Lip Balm', 'Makeup',
  'Skincare', 'Kit', 'Accessory'];
var UNITS = ['unit', 'ml', 'g'];

/**
 * Creates a product (payload.is_new = true) or updates an existing one.
 * payload: { is_new, product: {...columns} }
 */
function upsertProduct_(payload) {
  var input = payload.product || {};
  var sku = String(input.sku || '').trim().toUpperCase();
  var products = readTable_('Products');
  var existing = products.filter(function (p) { return p.sku === sku; })[0];

  if (payload.is_new && existing) throw userError_('SKU ' + sku + ' already exists. Each SKU must be unique.');
  if (!payload.is_new && !existing) throw userError_('Product ' + sku + ' was not found.');

  var product = cleanProduct_(input, sku);
  var now = nowISO_();
  if (existing) {
    product.active = existing.active;
    product.created_at = existing.created_at;
    product.updated_at = now;
    product._row = existing._row;
    updateRow_('Products', product);
  } else {
    product.active = true;
    product.created_at = now;
    product.updated_at = now;
    appendRows_('Products', [product]);
  }
  return { product: stripRow_(product) };
}

/** Checks every field and fills defaults. Throws one message listing all problems. */
function cleanProduct_(p, sku) {
  var errors = [];
  if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(sku)) {
    errors.push('SKU must be 2-30 characters: letters, numbers and dashes (e.g. LB-CORAL).');
  }
  var name = String(p.name || '').trim();
  if (!name) errors.push('Name is required.');
  if (CATEGORIES.indexOf(p.category) === -1) errors.push('Choose a category.');
  var unit = UNITS.indexOf(p.unit) === -1 ? 'unit' : p.unit;

  var unitCost = optionalNumber_(p.unit_cost, 'Unit cost', errors) || 0;
  var retail = optionalNumber_(p.retail_price, 'Retail price', errors) || 0;
  var wholesale = optionalNumber_(p.wholesale_price, 'Wholesale price', errors);
  if (wholesale === null) wholesale = Math.round(retail * 0.7 * 100) / 100;

  var lead = Number(p.lead_time_days);
  if (!(lead > 0) || Math.floor(lead) !== lead) errors.push('Lead time must be a whole number of days above 0.');
  var moq = p.min_order_qty === '' || p.min_order_qty == null ? 1 : Number(p.min_order_qty);
  if (!(moq >= 1) || Math.floor(moq) !== moq) errors.push('Minimum order quantity must be a whole number of at least 1.');
  var cover = p.target_cover_days === '' || p.target_cover_days == null ? 60 : Number(p.target_cover_days);
  if (!(cover > 0) || Math.floor(cover) !== cover) errors.push('Target cover days must be a whole number above 0.');

  var safety = optionalNumber_(p.safety_stock_override, 'Safety stock override', errors);
  var reorder = optionalNumber_(p.reorder_point_override, 'Reorder point override', errors);

  if (errors.length) throw userError_(errors.join(' '), { fields: errors });
  return {
    sku: sku, name: name, category: p.category, unit: unit,
    unit_cost: unitCost, retail_price: retail, wholesale_price: wholesale,
    supplier_id: String(p.supplier_id || ''), lead_time_days: lead, min_order_qty: moq,
    safety_stock_override: safety, reorder_point_override: reorder,
    target_cover_days: cover
  };
}

/** Blank -> null. Otherwise must be a number >= 0. */
function optionalNumber_(value, label, errors) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  if (isNaN(n) || n < 0) {
    errors.push(label + ' must be a number of 0 or more.');
    return null;
  }
  return n;
}

/** payload: { sku, active } */
function setProductActive_(payload) {
  var sku = String(payload.sku || '').toUpperCase();
  var product = readTable_('Products').filter(function (p) { return p.sku === sku; })[0];
  if (!product) throw userError_('Product ' + sku + ' was not found.');
  product.active = !!payload.active;
  product.updated_at = nowISO_();
  updateRow_('Products', product);
  return { product: stripRow_(product) };
}

/** payload: { supplier: {supplier_id?, name, contact, email, phone, notes} } */
function upsertSupplier_(payload) {
  var s = payload.supplier || {};
  var name = String(s.name || '').trim();
  if (!name) throw userError_('Supplier name is required.');
  var email = String(s.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw userError_('That email address does not look right.');

  var supplier = {
    supplier_id: s.supplier_id || newId_('SUP'),
    name: name,
    contact: String(s.contact || '').trim(),
    email: email,
    phone: String(s.phone || '').trim(),
    notes: String(s.notes || '').trim()
  };
  var existing = readTable_('Suppliers').filter(function (r) { return r.supplier_id === supplier.supplier_id; })[0];
  if (existing) {
    supplier._row = existing._row;
    updateRow_('Suppliers', supplier);
  } else {
    appendRows_('Suppliers', [supplier]);
  }
  return { supplier: stripRow_(supplier) };
}

/** payload: { settings: {key: value} }. Only known keys are saved. */
function updateSettings_(payload) {
  var input = payload.settings || {};
  var errors = [];
  var numberRules = {
    alert_hour: [0, 23], service_level: [0.5, 0.999], forecast_window_days: [14, 730],
    stockout_warning_days: [1, 365], spike_multiplier: [1.5, 100]
  };
  Object.keys(input).forEach(function (key) {
    if (!(key in DEFAULT_SETTINGS)) errors.push('Unknown setting: ' + key + '.');
    var rule = numberRules[key];
    if (rule) {
      var n = Number(input[key]);
      if (isNaN(n) || n < rule[0] || n > rule[1]) errors.push(key + ' must be between ' + rule[0] + ' and ' + rule[1] + '.');
    }
  });
  if (input.alert_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+(\s*,\s*[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(input.alert_email)) {
    errors.push('Alert email does not look right (separate several addresses with commas).');
  }
  if (errors.length) throw userError_(errors.join(' '));

  var rows = readTable_('Settings');
  var byKey = indexBy_(rows, 'key');
  var toAdd = [];
  Object.keys(input).forEach(function (key) {
    var value = String(input[key]).trim();
    if (byKey[key]) {
      byKey[key].value = value;
      updateRow_('Settings', byKey[key]);
    } else {
      toAdd.push({ key: key, value: value });
    }
  });
  appendRows_('Settings', toAdd);
  return { settings: getSettings_() };
}
