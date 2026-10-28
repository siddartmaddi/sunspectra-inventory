/**
 * Counts.gs
 * Physical stock counts. Saving a count records what was on the shelf and, when it
 * differs from what the app expected, adds an ADJUSTMENT movement so stock matches reality.
 */

/**
 * payload: { date, lines: [{ sku, counted_qty }] }  (lines left blank are simply not sent)
 * The expected ("system") quantity is the stock at the end of the count date.
 */
function saveCount_(payload, ctx) {
  if (!isISODate_(payload.date)) throw userError_('Choose a valid count date.');
  if (payload.date > todayISO_()) throw userError_('The count date cannot be in the future.');
  var lines = payload.lines || [];
  if (!lines.length) throw userError_('Enter at least one counted quantity.');

  var products = indexBy_(readTable_('Products'), 'sku');
  var upToDate = readTable_('Movements').filter(function (m) { return m.date <= payload.date; });
  var stock = stockBySku(upToDate);
  var now = nowISO_();

  var errors = [];
  var seen = {};
  var counts = [];
  var adjustments = [];
  lines.forEach(function (line, i) {
    var sku = String(line.sku || '').toUpperCase();
    var qty = Number(line.counted_qty);
    if (!products[sku]) return errors.push('Line ' + (i + 1) + ': unknown product "' + line.sku + '".');
    if (seen[sku]) return errors.push(sku + ' is counted twice.');
    seen[sku] = true;
    if (!(qty >= 0) || Math.floor(qty) !== qty || line.counted_qty === '' || line.counted_qty === null) {
      return errors.push(sku + ': the counted quantity must be a whole number of 0 or more.');
    }
    var system = stock[sku] || 0;
    var count = {
      count_id: newId_('C', i), date: payload.date, sku: sku, counted_qty: qty, system_qty: system,
      variance: qty - system, entered_by: ctx.user, created_at: now
    };
    counts.push(count);
    if (count.variance !== 0) {
      adjustments.push({
        movement_id: newId_('M', i), date: payload.date, sku: sku, type: 'ADJUSTMENT', qty: count.variance,
        channel: 'INTERNAL', customer: '', reference: count.count_id, note: 'Count adjustment',
        entered_by: ctx.user, created_at: now, reverses_id: ''
      });
    }
  });
  if (errors.length) throw userError_(errors.join(' '), { lines: errors });

  appendRows_('Counts', counts);
  appendRows_('Movements', adjustments);
  return { saved: counts.length, adjusted: adjustments.length, counts: counts };
}

/** All counts, newest first. */
function listCounts_() {
  var counts = readTable_('Counts').map(stripRow_);
  sortByDate_(counts).reverse();
  return { counts: counts };
}
