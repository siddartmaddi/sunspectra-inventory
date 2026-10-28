/**
 * forecast.js
 * Pure stock and forecast math. No Apps Script calls, no DOM, no dates from the clock:
 * everything the functions need is passed in. That way the same file:
 *   - runs in Node for unit tests (`node --test tests/`),
 *   - is pasted into Apps Script as Forecast.gs (keep the two files identical),
 *   - gives the app and the daily email exactly the same numbers.
 */

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

/** Value below which the given share (0-1) of the numbers fall. 0 for an empty list. */
function percentile(numbers, share) {
  if (!numbers.length) return 0;
  var sorted = numbers.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}

function median(numbers) {
  if (!numbers.length) return 0;
  var sorted = numbers.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Lets Node's test runner load this file. In Apps Script `module` doesn't exist,
// so this line is skipped and the functions above are simply global.
if (typeof module !== 'undefined') {
  module.exports = {
    stockBySku: stockBySku, typicalMovementSize: typicalMovementSize, percentile: percentile, median: median
  };
}
