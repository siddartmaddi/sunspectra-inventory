/**
 * Movements.gs
 * Recording stock changes. Movements are never edited or deleted:
 * a mistake is fixed with a reversing movement, so the history stays complete.
 */

/**
 * Saves one order (several product lines) as movements in a single write.
 * payload: { date, type, channel, customer, reference, note,
 *            lines: [{ sku, qty, sign }],   qty is positive; sign (+1/-1) only for ADJUSTMENT
 *            allow_negative, negative_note }
 */
function addMovements_(payload, ctx) {
  var header = validateMovementHeader_(payload);
  var lines = payload.lines || [];
  if (!lines.length) throw userError_('Add at least one product line.');

  var products = indexBy_(readTable_('Products'), 'sku');
  var movements = readTable_('Movements');
  var stock = stockBySku(movements);

  var errors = [];
  var newRows = [];
  var after = {}; // stock per SKU after this order, to check for negatives
  lines.forEach(function (line, i) {
    var label = 'Line ' + (i + 1);
    var sku = String(line.sku || '').trim().toUpperCase();
    var product = products[sku];
    if (!product) return errors.push(label + ': unknown product "' + line.sku + '".');
    if (!product.active) return errors.push(label + ': ' + sku + ' is deactivated.');
    var qty = Number(line.qty);
    if (!isPositiveInt_(qty)) return errors.push(label + ': quantity must be a whole number above 0.');

    var signed = signedQty_(header.type, qty, line.sign);
    if (after[sku] === undefined) after[sku] = stock[sku] || 0;
    after[sku] += signed;
    newRows.push(movementRow_(header, sku, signed, ctx, i));
  });
  if (errors.length) throw userError_(errors.join(' '), { lines: errors });

  if (checkNegativeStock_(after, payload)) {
    // Keep the reason next to the data so nobody wonders later why stock went below zero.
    newRows.forEach(function (r) {
      r.note = (r.note ? r.note + ' | ' : '') + 'Negative stock allowed: ' + payload.negative_note.trim();
    });
  }
  appendRows_('Movements', newRows);
  return { saved: newRows.length, movements: newRows };
}

/**
 * Creates the opposite movement of an existing one (same type, opposite qty).
 * payload: { movement_id, allow_negative, negative_note }
 */
function reverseMovement_(payload, ctx) {
  var movements = readTable_('Movements');
  var original = movements.filter(function (m) { return m.movement_id === payload.movement_id; })[0];
  if (!original) throw userError_('That movement was not found.');
  if (original.reverses_id) throw userError_('This movement is already a reversal and cannot be reversed.');
  var already = movements.some(function (m) { return m.reverses_id === original.movement_id; });
  if (already) throw userError_('This movement has already been reversed.');

  var stock = stockBySku(movements);
  var after = {};
  after[original.sku] = (stock[original.sku] || 0) - original.qty;
  var allowed = checkNegativeStock_(after, payload);

  var row = {
    movement_id: newId_('M'),
    date: todayISO_(),
    sku: original.sku,
    type: original.type,
    qty: -original.qty,
    channel: original.channel,
    customer: original.customer,
    reference: original.reference,
    note: 'Reversal of ' + original.movement_id +
      (allowed ? ' | Negative stock allowed: ' + payload.negative_note.trim() : ''),
    entered_by: ctx.user,
    created_at: nowISO_(),
    reverses_id: original.movement_id
  };
  appendRows_('Movements', [row]);
  return { movement: row };
}

/**
 * Movement history with filters, newest first.
 * payload: { from, to, sku, type, channel, customer, limit }
 */
function listMovements_(payload) {
  var all = readTable_('Movements');
  var reversed = {};
  all.forEach(function (m) { if (m.reverses_id) reversed[m.reverses_id] = true; });

  var customer = String(payload.customer || '').toLowerCase();
  var rows = all.filter(function (m) {
    if (payload.from && m.date < payload.from) return false;
    if (payload.to && m.date > payload.to) return false;
    if (payload.sku && m.sku !== payload.sku) return false;
    if (payload.type && m.type !== payload.type) return false;
    if (payload.channel && m.channel !== payload.channel) return false;
    if (customer && String(m.customer).toLowerCase().indexOf(customer) === -1) return false;
    return true;
  });
  sortByDate_(rows).reverse();

  var limit = Number(payload.limit) || 1000;
  return {
    total: rows.length,
    movements: rows.slice(0, limit).map(function (m) {
      var out = stripRow_(m);
      out.is_reversed = !!reversed[m.movement_id];
      return out;
    })
  };
}

// ---------------------------------------------------------------- helpers

function validateMovementHeader_(p) {
  var errors = [];
  if (!isISODate_(p.date)) errors.push('Choose a valid date.');
  if (MOVEMENT_TYPES.indexOf(p.type) === -1) errors.push('Choose a movement type.');
  if (CHANNELS.indexOf(p.channel) === -1) errors.push('Choose a channel.');
  if (errors.length) throw userError_(errors.join(' '));
  return {
    date: p.date,
    type: p.type,
    channel: p.channel,
    customer: String(p.customer || '').trim(),
    reference: String(p.reference || '').trim(),
    note: String(p.note || '').trim()
  };
}

/** The form always asks for a positive number; the movement type decides the sign. */
function signedQty_(type, qty, sign) {
  if (NEGATIVE_TYPES.indexOf(type) !== -1) return -qty;
  if (type === 'ADJUSTMENT') return Number(sign) < 0 ? -qty : qty;
  return qty;
}

/**
 * Refuses a save that would leave any product below zero, unless the person
 * ticked "allow" and wrote a note explaining why.
 * Returns true when stock goes negative with permission.
 */
function checkNegativeStock_(after, payload) {
  var negatives = Object.keys(after).filter(function (sku) { return after[sku] < 0; });
  if (!negatives.length) return false;
  if (!payload.allow_negative) {
    throw userError_('This would make stock negative for: ' +
      negatives.map(function (s) { return s + ' (' + after[s] + ')'; }).join(', ') +
      '. Check the quantities, or tick "allow negative stock" and explain why.',
      { negative: negatives });
  }
  if (!String(payload.negative_note || '').trim()) {
    throw userError_('Please write a note explaining why negative stock is allowed.');
  }
  return true;
}

function movementRow_(header, sku, qty, ctx, index) {
  return {
    movement_id: newId_('M', index),
    date: header.date,
    sku: sku,
    type: header.type,
    qty: qty,
    channel: header.channel,
    customer: header.customer,
    reference: header.reference,
    note: header.note,
    entered_by: ctx.user,
    created_at: nowISO_(),
    reverses_id: ''
  };
}

function isPositiveInt_(n) {
  return typeof n === 'number' && isFinite(n) && n > 0 && Math.floor(n) === n;
}

function isISODate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function indexBy_(rows, key) {
  var map = {};
  rows.forEach(function (r) { map[r[key]] = r; });
  return map;
}
