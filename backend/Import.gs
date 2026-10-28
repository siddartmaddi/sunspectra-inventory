/**
 * Import.gs
 * CSV import (the browser reads the file and sends the rows here in batches).
 * Every row is checked; nothing is written if any row in the batch has a problem.
 *
 * Kinds of import:
 *   products   one row per product (new SKUs are created, existing SKUs are updated)
 *   opening    date, sku or product_name, qty           -> OPENING movements
 *   movements  date, sku or product_name, type, qty, channel, customer, reference, note
 */

var IMPORT_KINDS = ['products', 'opening', 'movements'];

/**
 * payload: { kind, rows: [{...}], dry_run, row_offset, new_mappings: [{source_name, sku}] }
 * Returns { imported, errors: [{row, messages}], unknown_names: [] }.
 * With dry_run = true nothing is written (used to check the whole file before importing).
 */
function importRows_(payload, ctx) {
  if (IMPORT_KINDS.indexOf(payload.kind) === -1) throw userError_('Unknown import type.');
  var rows = payload.rows || [];
  if (rows.length > 500) throw userError_('Send at most 500 rows at a time.');
  var offset = Number(payload.row_offset) || 0;

  if (!payload.dry_run && payload.new_mappings && payload.new_mappings.length) saveNameMappings_(payload.new_mappings);

  var products = readTable_('Products');
  var resolver = makeNameResolver_(products, payload.new_mappings || []);
  var result = payload.kind === 'products'
    ? checkProductRows_(rows, products)
    : checkMovementRows_(payload.kind, rows, resolver, ctx);

  // Row numbers as the person sees them in the file (row 1 = headers).
  result.errors.forEach(function (e) { e.row = e.index + offset + 2; delete e.index; });
  var out = { imported: 0, errors: result.errors, unknown_names: Object.keys(result.unknown || {}) };
  if (payload.dry_run || result.errors.length) return out;

  if (payload.kind === 'products') {
    result.create.forEach(function (p) { p.active = true; p.created_at = p.updated_at = nowISO_(); });
    appendRows_('Products', result.create);
    result.update.forEach(function (p) { updateRow_('Products', p); });
    out.imported = result.create.length + result.update.length;
  } else {
    appendRows_('Movements', result.movements);
    out.imported = result.movements.length;
  }
  return out;
}

/** Looks up a SKU from a "sku" column, or from a product name (saved mappings first). */
function makeNameResolver_(products, extraMappings) {
  var bySku = {};
  var byName = {};
  products.forEach(function (p) {
    bySku[p.sku] = p.sku;
    byName[normalizeName_(p.name)] = p.sku;
  });
  readTable_('NameMap').concat(extraMappings).forEach(function (m) {
    if (bySku[String(m.sku).toUpperCase()]) byName[normalizeName_(m.source_name)] = String(m.sku).toUpperCase();
  });
  return function (row) {
    var sku = String(row.sku || '').trim().toUpperCase();
    if (sku) return bySku[sku] ? { sku: sku } : { error: 'Unknown SKU "' + sku + '".' };
    var name = String(row.product_name || '').trim();
    if (!name) return { error: 'Give a sku or a product_name.' };
    var found = byName[normalizeName_(name)];
    return found ? { sku: found } : { unknownName: name };
  };
}

/** "  Lip Balm  CORAL " and "lip balm coral" are treated as the same name. */
function normalizeName_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function saveNameMappings_(mappings) {
  var existing = {};
  readTable_('NameMap').forEach(function (m) { existing[normalizeName_(m.source_name)] = true; });
  var now = nowISO_();
  var rows = [];
  mappings.forEach(function (m) {
    var key = normalizeName_(m.source_name);
    if (!key || !m.sku || existing[key]) return;
    existing[key] = true;
    rows.push({ source_name: String(m.source_name).trim(), sku: String(m.sku).toUpperCase(), created_at: now });
  });
  appendRows_('NameMap', rows);
}

function checkMovementRows_(kind, rows, resolve, ctx) {
  var errors = [];
  var unknown = {};
  var movements = [];
  var now = nowISO_();
  var today = todayISO_();

  rows.forEach(function (row, index) {
    var messages = [];
    var date = String(row.date || '').trim();
    if (!isISODate_(date)) messages.push('Bad date "' + date + '" (use YYYY-MM-DD or DD/MM/YYYY).');
    else if (date > today) messages.push('Date ' + date + ' is in the future.');

    var target = resolve(row);
    if (target.error) messages.push(target.error);
    if (target.unknownName) {
      unknown[target.unknownName] = true;
      messages.push('Unknown product name "' + target.unknownName + '": map it to a SKU.');
    }

    var type = kind === 'opening' ? 'OPENING' : String(row.type || '').trim().toUpperCase();
    if (MOVEMENT_TYPES.indexOf(type) === -1) messages.push('Unknown type "' + row.type + '".');

    var rawQty = String(row.qty === undefined ? '' : row.qty).trim().replace(/,/g, '');
    var qty = Number(rawQty);
    var qtyOk = rawQty !== '' && isFinite(qty) && Math.floor(qty) === qty;
    if (!qtyOk) messages.push('Quantity "' + row.qty + '" is not a whole number.');
    else if (type === 'ADJUSTMENT' ? qty === 0 : qty < 0 || (qty === 0 && kind !== 'opening')) {
      messages.push(type === 'ADJUSTMENT' ? 'An adjustment cannot be 0.' : 'Quantity must be above 0 (the type decides + or -).');
    }

    var channel = String(row.channel || '').trim().toUpperCase() || (type === 'SALE' || type === 'RETURN' ? 'B2C' : 'INTERNAL');
    if (CHANNELS.indexOf(channel) === -1) messages.push('Unknown channel "' + row.channel + '".');

    if (messages.length) return errors.push({ index: index, messages: messages });
    if (qty === 0) return; // opening stock of 0 needs no movement

    movements.push({
      movement_id: newId_('M', index), date: date, sku: target.sku, type: type,
      qty: type === 'ADJUSTMENT' ? qty : signedQty_(type, qty),
      channel: channel, customer: String(row.customer || '').trim(), reference: String(row.reference || '').trim(),
      note: String(row.note || '').trim() || 'Imported', entered_by: ctx.user, created_at: now, reverses_id: ''
    });
  });
  return { errors: errors, unknown: unknown, movements: movements };
}

function checkProductRows_(rows, products) {
  var existing = indexBy_(products, 'sku');
  var errors = [];
  var create = [];
  var update = [];
  var seen = {};
  rows.forEach(function (row, index) {
    var sku = String(row.sku || '').trim().toUpperCase();
    if (seen[sku]) return errors.push({ index: index, messages: ['SKU ' + sku + ' appears twice in the file.'] });
    seen[sku] = true;
    var input = {};
    for (var k in row) input[k] = typeof row[k] === 'string' ? row[k].trim() : row[k];
    try {
      var product = cleanProduct_(input, sku);
      if (existing[sku]) {
        product.active = existing[sku].active;
        product.created_at = existing[sku].created_at;
        product.updated_at = nowISO_();
        product._row = existing[sku]._row;
        update.push(product);
      } else {
        create.push(product);
      }
    } catch (err) {
      errors.push({ index: index, messages: err.details && err.details.fields ? err.details.fields : [err.message] });
    }
  });
  return { errors: errors, create: create, update: update };
}
