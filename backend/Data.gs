/**
 * Data.gs
 * Read/write helpers for each tab of the Google Sheet.
 *
 * Every tab is a simple table: row 1 = headers, one record per row below.
 * We always read a whole tab at once (one getValues() call) because many small
 * calls to the Sheet are what makes Apps Script slow.
 */

// The exact columns of every tab. setup() creates tabs from this list,
// and the read/write helpers use it to know each column's type.
// Types: str = text, num = number, int = whole number, bool = TRUE/FALSE,
//        date = YYYY-MM-DD text, ts = ISO timestamp text.
var SCHEMA = {
  Products: [
    ['sku', 'str'], ['name', 'str'], ['category', 'str'], ['unit', 'str'],
    ['unit_cost', 'num'], ['retail_price', 'num'], ['wholesale_price', 'num'],
    ['supplier_id', 'str'], ['lead_time_days', 'int'], ['min_order_qty', 'int'],
    ['safety_stock_override', 'num'], ['reorder_point_override', 'num'],
    ['target_cover_days', 'int'], ['active', 'bool'],
    ['created_at', 'ts'], ['updated_at', 'ts']
  ],
  Movements: [
    ['movement_id', 'str'], ['date', 'date'], ['sku', 'str'], ['type', 'str'],
    ['qty', 'int'], ['channel', 'str'], ['customer', 'str'], ['reference', 'str'],
    ['note', 'str'], ['entered_by', 'str'], ['created_at', 'ts'],
    // Extra column (not in the original spec): id of the movement this row reverses.
    // Lets us refuse to reverse the same movement twice.
    ['reverses_id', 'str']
  ],
  Counts: [
    ['count_id', 'str'], ['date', 'date'], ['sku', 'str'], ['counted_qty', 'int'],
    ['system_qty', 'int'], ['variance', 'int'], ['entered_by', 'str'], ['created_at', 'ts']
  ],
  Suppliers: [
    ['supplier_id', 'str'], ['name', 'str'], ['contact', 'str'], ['email', 'str'],
    ['phone', 'str'], ['notes', 'str']
  ],
  Settings: [
    ['key', 'str'], ['value', 'str']
  ],
  AlertLog: [
    ['date', 'date'], ['sku', 'str'], ['alert_type', 'str'], ['message', 'str'], ['emailed', 'bool']
  ],
  // Remembers "this name in a sales file means this SKU" (used by the import page).
  NameMap: [
    ['source_name', 'str'], ['sku', 'str'], ['created_at', 'ts']
  ]
};

// Default values for the Settings tab. setup() adds any missing key.
var DEFAULT_SETTINGS = {
  alert_email: '',
  alert_hour: '7',
  currency: 'USD',
  service_level: '0.95',
  forecast_window_days: '90',
  stockout_warning_days: '14',
  spike_multiplier: '3',
  company_name: 'SunSpectra',
  app_url: '',
  include_samples_in_demand: 'FALSE'
};

var MOVEMENT_TYPES = ['OPENING', 'SALE', 'RESTOCK', 'PRODUCTION', 'RETURN', 'DAMAGED',
  'EXPIRED', 'SAMPLE', 'ADJUSTMENT'];
// These types always remove stock, so their qty is stored as a negative number.
var NEGATIVE_TYPES = ['SALE', 'DAMAGED', 'EXPIRED', 'SAMPLE'];
var CHANNELS = ['B2B', 'B2B2C', 'B2C', 'INTERNAL'];

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('The "' + name + '" tab is missing. Run setup() in Apps Script.');
  return sheet;
}

function columnNames_(table) {
  return SCHEMA[table].map(function (c) { return c[0]; });
}

function timeZone_() {
  return Session.getScriptTimeZone() || 'America/Costa_Rica';
}

/** Today's business date as YYYY-MM-DD in the script's time zone (Costa Rica). */
function todayISO_() {
  return Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd');
}

function nowISO_() {
  return new Date().toISOString();
}

/**
 * Turns a raw cell value into the right JS type for its column.
 * Sheets sometimes turns "2026-01-05" into a Date object or "TRUE" into a boolean,
 * so we normalise everything here once.
 */
function fromCell_(value, type) {
  if (value === '' || value === null || value === undefined) {
    if (type === 'bool') return false;
    return (type === 'num' || type === 'int') ? null : '';
  }
  switch (type) {
    case 'num': {
      var n = Number(value);
      return isNaN(n) ? null : n;
    }
    case 'int': {
      var i = Number(value);
      return isNaN(i) ? null : Math.round(i);
    }
    case 'bool':
      return value === true || String(value).toUpperCase() === 'TRUE';
    case 'date':
      if (value instanceof Date) return Utilities.formatDate(value, timeZone_(), 'yyyy-MM-dd');
      return String(value).slice(0, 10);
    case 'ts':
      if (value instanceof Date) return value.toISOString();
      return String(value);
    default:
      return String(value);
  }
}

/** Turns a JS value into what we write to the cell. */
function toCell_(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'bool') return value === true || String(value).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  if (type === 'num' || type === 'int') {
    var n = Number(value);
    return isNaN(n) ? '' : n;
  }
  var s = String(value);
  // A text starting with = + - @ would be treated by Sheets as a formula.
  // The leading apostrophe makes Sheets keep it as plain text.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** Reads a whole tab and returns an array of plain objects (one per row). */
function readTable_(table) {
  var sheet = getSheet_(table);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var cols = SCHEMA[table];
  var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    // Skip completely empty rows (e.g. a row someone cleared by hand).
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var obj = {};
    for (var c = 0; c < cols.length; c++) obj[cols[c][0]] = fromCell_(row[c], cols[c][1]);
    obj._row = r + 2; // sheet row number, used when updating this record
    rows.push(obj);
  }
  return rows;
}

function objectToRow_(table, obj) {
  return SCHEMA[table].map(function (c) { return toCell_(obj[c[0]], c[1]); });
}

/** Adds records at the bottom of a tab in one write. */
function appendRows_(table, objects) {
  if (!objects.length) return;
  var sheet = getSheet_(table);
  var rows = objects.map(function (o) { return objectToRow_(table, o); });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Overwrites one existing record (obj._row must be set by readTable_). */
function updateRow_(table, obj) {
  var row = objectToRow_(table, obj);
  getSheet_(table).getRange(obj._row, 1, 1, row.length).setValues([row]);
}

/** Settings tab as a {key: value} object, with defaults for missing keys. */
function getSettings_() {
  var settings = {};
  for (var k in DEFAULT_SETTINGS) settings[k] = DEFAULT_SETTINGS[k];
  readTable_('Settings').forEach(function (r) {
    if (r.key) settings[r.key] = r.value;
  });
  return settings;
}

/** Short unique id like "M-lx2k9a-3f". prefix tells you which tab it belongs to. */
function newId_(prefix, index) {
  var rand = Math.floor(Math.random() * 1296).toString(36);
  return prefix + '-' + Date.now().toString(36) + '-' + (index || 0) + rand;
}
