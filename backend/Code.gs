/**
 * Code.gs
 * The single API endpoint: checks the access key, sends each request to the
 * right function, and makes sure writes happen one at a time.
 *
 * Request (POST body, sent as text/plain so the browser skips the CORS preflight
 * that Apps Script can't answer):  { key, user, action, payload }
 * Response:                        { ok: true, data } or { ok: false, error }
 */

// action name -> [function name, isWrite]. Writes run inside a lock and clear the cache.
// Functions are listed by name (not by reference) because Apps Script loads files one
// by one, and functions from files loaded after this one don't exist yet at this point.
var ACTIONS = {
  getBootstrap:     ['getBootstrap_', false],
  listMovements:    ['listMovements_', false],
  getProductDetail: ['getProductDetail_', false],
  addMovements:     ['addMovements_', true],
  reverseMovement:  ['reverseMovement_', true],
  upsertProduct:    ['upsertProduct_', true],
  setProductActive: ['setProductActive_', true],
  upsertSupplier:   ['upsertSupplier_', true],
  updateSettings:   ['updateSettings_', true],
  saveCount:        ['saveCount_', true],
  listCounts:       ['listCounts_', false],
  importRows:       ['importRows_', true],
  getReport:        ['getReport_', false]
};

/** A GET just says the API is alive (handy to test the deployment URL in a browser). */
function doGet() {
  return jsonOut_({ ok: true, data: { status: 'SunSpectra inventory API is running' } });
}

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'The request was not valid JSON.' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  if (!expected) {
    return jsonOut_({ ok: false, error: 'The access key has not been set up yet (ACCESS_KEY in Script Properties).' });
  }
  if (typeof request.key !== 'string' || request.key !== expected) {
    return jsonOut_({ ok: false, error: 'unauthorized' });
  }

  var entry = ACTIONS[request.action];
  if (!entry) return jsonOut_({ ok: false, error: 'Unknown action: ' + request.action });

  var ctx = { user: String(request.user || '').trim() || 'Unknown' };
  var fn = globalThis[entry[0]];
  try {
    var data = entry[1] ? runWrite_(fn, request.payload || {}, ctx)
                        : fn(request.payload || {}, ctx);
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    // UserError = a problem the person can fix (shown as is). Anything else is a bug.
    var message = err && err.isUserError ? err.message
      : 'Something went wrong on the server: ' + (err && err.message ? err.message : err);
    return jsonOut_({ ok: false, error: message, details: err && err.details });
  }
}

/**
 * Runs a write action while holding the script lock, so two people saving at the
 * same moment can't both read the old stock and write conflicting rows.
 */
function runWrite_(fn, payload, ctx) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw userError_('Someone else is saving right now. Please try again in a few seconds.');
  }
  try {
    var result = fn(payload, ctx);
    clearCache_();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** An error whose message is safe and useful to show the person in the app. */
function userError_(message, details) {
  var err = new Error(message);
  err.isUserError = true;
  if (details) err.details = details;
  return err;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Cache: the bootstrap data is cached for a few minutes; any write clears it. ----
var CACHE_KEY = 'bootstrap_v1';

function clearCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}
