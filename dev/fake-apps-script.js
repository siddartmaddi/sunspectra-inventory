/**
 * fake-apps-script.js
 * A tiny stand-in for Google Apps Script so the real backend/*.gs files can run in Node
 * on your own computer. Only used for local development and tests; never deployed.
 *
 * It fakes just the parts of SpreadsheetApp, CacheService, LockService, etc. that the
 * backend uses. The "spreadsheet" is a set of 2D arrays saved to dev/data.json.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BACKEND = path.join(__dirname, '..', 'backend');

function createFakeSpreadsheet(saved) {
  const sheets = new Map(); // name -> 2D array of cell values (row 0 = headers)
  if (saved) for (const [name, rows] of Object.entries(saved)) sheets.set(name, rows);

  function makeSheet(name) {
    const data = () => sheets.get(name);
    return {
      getName: () => name,
      getLastRow: () => {
        const rows = data();
        let last = rows.length;
        while (last > 0 && rows[last - 1].every((v) => v === '' || v === null || v === undefined)) last--;
        return last;
      },
      getLastColumn: () => data().reduce((max, r) => Math.max(max, r.length), 0),
      getMaxRows: () => data().length + 1000,
      setFrozenRows: () => {},
      getRange(row, col, numRows = 1, numCols = 1) {
        const rows = data();
        const ensure = () => {
          while (rows.length < row - 1 + numRows) rows.push([]);
        };
        return {
          getValues() {
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const src = rows[row - 1 + r] || [];
              const line = [];
              for (let c = 0; c < numCols; c++) {
                const v = src[col - 1 + c];
                line.push(v === undefined || v === null ? '' : v);
              }
              out.push(line);
            }
            return out;
          },
          setValues(values) {
            ensure();
            values.forEach((line, r) => {
              const target = rows[row - 1 + r];
              // Like Sheets: a leading apostrophe means "plain text" and isn't stored.
              line.forEach((v, c) => { target[col - 1 + c] = typeof v === 'string' && v[0] === "'" ? v.slice(1) : v; });
            });
            return this;
          },
          setValue(v) { return this.setValues([[v]]); },
          clearContent() {
            for (let r = 0; r < numRows; r++) {
              const target = rows[row - 1 + r];
              if (target) for (let c = 0; c < numCols; c++) target[col - 1 + c] = '';
            }
            // Drop trailing empty rows so the saved file stays small.
            while (rows.length && rows[rows.length - 1].every((v) => v === '' || v == null)) rows.pop();
            return this;
          },
          setFontWeight() { return this; },
          setNumberFormat() { return this; }
        };
      }
    };
  }

  const spreadsheet = {
    getSheetByName: (name) => (sheets.has(name) ? makeSheet(name) : null),
    insertSheet: (name) => { sheets.set(name, []); return makeSheet(name); },
    getSheets: () => [...sheets.keys()].map(makeSheet),
    deleteSheet: (sheet) => sheets.delete(sheet.getName()),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fake'
  };
  return { spreadsheet, dump: () => Object.fromEntries(sheets) };
}

/** Formats a Date like Utilities.formatDate for the few patterns the backend uses. */
function formatDate(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute);
}

/**
 * Loads every backend .gs file into one shared sandbox (like Apps Script does) and
 * returns that sandbox, so callers can run doPost(), setup(), etc.
 */
function loadBackend({ saved, accessKey = 'dev-key', now } = {}) {
  const fake = createFakeSpreadsheet(saved);
  const cache = new Map();
  const sentEmails = [];
  const triggers = [];
  const properties = { ACCESS_KEY: accessKey };

  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => fake.spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in properties ? properties[k] : null),
        setProperty: (k, v) => { properties[k] = v; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k)
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; }, getContent() { return content; } })
    },
    Utilities: { formatDate, getUuid: () => require('crypto').randomUUID() },
    Session: { getScriptTimeZone: () => 'America/Costa_Rica' },
    Logger: { log: (...a) => console.log('[Logger]', ...a) },
    MailApp: {
      sendEmail: (options) => sentEmails.push(options),
      getRemainingDailyQuota: () => 100
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: (fnName) => {
        const t = { fnName, getHandlerFunction: () => fnName };
        const builder = { timeBased: () => builder, everyDays: () => builder, atHour: (h) => { t.hour = h; return builder; },
          inTimezone: () => builder, create: () => { triggers.push(t); return t; } };
        return builder;
      },
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      getService: () => ({ getUrl: () => 'https://script.google.com/fake/exec' })
    }
  };
  // Lets tests pretend "today" is a fixed date.
  if (now) {
    const RealDate = Date;
    sandbox.Date = class extends RealDate {
      constructor(...args) { if (args.length) super(...args); else super(now); }
      static now() { return new RealDate(now).getTime(); }
    };
  }
  vm.createContext(sandbox);

  const files = fs.readdirSync(BACKEND).filter((f) => f.endsWith('.gs')).sort();
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(BACKEND, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.__dump = fake.dump;
  sandbox.__sentEmails = sentEmails;
  sandbox.__triggers = triggers;
  return sandbox;
}

/** Calls the API like the browser would and returns the parsed JSON response. */
function callApi(backend, body) {
  const out = backend.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}

module.exports = { loadBackend, callApi };
