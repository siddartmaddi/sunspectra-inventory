// Tests for the Apps Script API, run in Node against a fake spreadsheet.
// Run all tests with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, callApi } = require('../dev/fake-apps-script');

function freshBackend() {
  const backend = loadBackend();
  backend.setup();
  const api = (action, payload) => callApi(backend, { key: 'dev-key', user: 'Tester', action, payload });
  api('upsertProduct', { is_new: true, product: { sku: 'LB-TEST', name: 'Test balm', category: 'Lip Balm', lead_time_days: 10, retail_price: 7, unit_cost: 2 } });
  api('addMovements', { date: '2026-10-01', type: 'OPENING', channel: 'INTERNAL', lines: [{ sku: 'LB-TEST', qty: 20 }] });
  return { backend, api };
}

function onHand(api, sku) {
  return api('getBootstrap').data.summary.find((s) => s.sku === sku).on_hand;
}

test('rejects a wrong access key', () => {
  const { backend } = freshBackend();
  const res = callApi(backend, { key: 'nope', action: 'getBootstrap' });
  assert.deepEqual(res, { ok: false, error: 'unauthorized' });
});

test('setup() is safe to run twice and creates the default settings once', () => {
  const { backend, api } = freshBackend();
  backend.setup();
  const settings = backend.__dump().Settings;
  const keys = settings.slice(1).map((r) => r[0]);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(api('getBootstrap').data.settings.service_level, '0.95');
});

test('sales are stored as negative quantities and reduce stock', () => {
  const { api } = freshBackend();
  const res = api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 3 }, { sku: 'lb-test', qty: 2 }] });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.movements[0].qty, -3);
  assert.equal(onHand(api, 'LB-TEST'), 15);
});

test('adjustments use the sign chosen in the form', () => {
  const { api } = freshBackend();
  api('addMovements', { date: '2026-10-02', type: 'ADJUSTMENT', channel: 'INTERNAL', lines: [{ sku: 'LB-TEST', qty: 4, sign: -1 }] });
  api('addMovements', { date: '2026-10-02', type: 'ADJUSTMENT', channel: 'INTERNAL', lines: [{ sku: 'LB-TEST', qty: 1, sign: 1 }] });
  assert.equal(onHand(api, 'LB-TEST'), 17);
});

test('blocks negative stock unless allowed with a note', () => {
  const { api } = freshBackend();
  const order = { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 25 }] };
  const blocked = api('addMovements', order);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /negative/);
  assert.equal(api('addMovements', { ...order, allow_negative: true }).ok, false, 'a note is required');
  const allowed = api('addMovements', { ...order, allow_negative: true, negative_note: 'Count was wrong' });
  assert.equal(allowed.ok, true);
  assert.match(allowed.data.movements[0].note, /Count was wrong/);
  assert.equal(onHand(api, 'LB-TEST'), -5);
});

test('rejects bad input with plain-language errors', () => {
  const { api } = freshBackend();
  const res = api('addMovements', { date: '2026-02-30', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 1 }] });
  assert.equal(res.ok, false);
  assert.match(res.error, /valid date/);
  const lines = api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'NOPE', qty: 1 }, { sku: 'LB-TEST', qty: 1.5 }] });
  assert.equal(lines.ok, false);
  assert.equal(lines.details.lines.length, 2);
});

test('a movement can be reversed exactly once', () => {
  const { api } = freshBackend();
  const sale = api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 5 }] }).data.movements[0];
  const rev = api('reverseMovement', { movement_id: sale.movement_id });
  assert.equal(rev.ok, true, rev.error);
  assert.equal(rev.data.movement.qty, 5);
  assert.equal(rev.data.movement.type, 'SALE');
  assert.equal(onHand(api, 'LB-TEST'), 20);
  assert.equal(api('reverseMovement', { movement_id: sale.movement_id }).ok, false);
  assert.equal(api('reverseMovement', { movement_id: rev.data.movement.movement_id }).ok, false);
  const list = api('listMovements', { type: 'SALE' }).data.movements;
  assert.equal(list.find((m) => m.movement_id === sale.movement_id).is_reversed, true);
});

test('product validation: unique SKU, prices >= 0, lead time > 0, wholesale default', () => {
  const { api } = freshBackend();
  assert.match(api('upsertProduct', { is_new: true, product: { sku: 'LB-TEST', name: 'Dup', category: 'Lip Balm', lead_time_days: 5 } }).error, /already exists/);
  const bad = api('upsertProduct', { is_new: true, product: { sku: 'X-1', name: 'Bad', category: 'Kit', lead_time_days: 0, retail_price: -1 } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Lead time/);
  assert.match(bad.error, /Retail price/);
  const ok = api('upsertProduct', { is_new: true, product: { sku: 'kit-new', name: 'New kit', category: 'Kit', lead_time_days: 7, retail_price: 20 } });
  assert.equal(ok.data.product.sku, 'KIT-NEW');
  assert.equal(ok.data.product.wholesale_price, 14);
  assert.equal(ok.data.product.target_cover_days, 60);
});

test('deactivated products cannot receive new movements but keep their history', () => {
  const { api } = freshBackend();
  api('setProductActive', { sku: 'LB-TEST', active: false });
  const res = api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 1 }] });
  assert.match(res.error, /deactivated/);
  assert.equal(onHand(api, 'LB-TEST'), 20);
});

test('text that looks like a formula is stored as plain text', () => {
  const { api } = freshBackend();
  api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', customer: '=HYPERLINK("x")', lines: [{ sku: 'LB-TEST', qty: 1 }] });
  const m = api('listMovements', { type: 'SALE' }).data.movements[0];
  assert.equal(m.customer, '=HYPERLINK("x")');
});

test('bootstrap cache is cleared after a write', () => {
  const { api } = freshBackend();
  assert.equal(onHand(api, 'LB-TEST'), 20); // fills the cache
  api('addMovements', { date: '2026-10-02', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-TEST', qty: 1 }] });
  assert.equal(onHand(api, 'LB-TEST'), 19);
});

test('settings are validated and saved', () => {
  const { api } = freshBackend();
  assert.equal(api('updateSettings', { settings: { alert_hour: 30 } }).ok, false);
  assert.equal(api('updateSettings', { settings: { alert_email: 'not-an-email' } }).ok, false);
  const ok = api('updateSettings', { settings: { alert_email: 'owner@example.com', alert_hour: 6 } });
  assert.equal(ok.data.settings.alert_email, 'owner@example.com');
  assert.equal(ok.data.settings.alert_hour, '6');
});

test('sample data loads and can be cleared without touching products', () => {
  const backend = loadBackend();
  backend.loadSampleData();
  const api = (action, payload) => callApi(backend, { key: 'dev-key', user: 'T', action, payload });
  const boot = api('getBootstrap').data;
  assert.equal(boot.products.length, 33);
  assert.ok(boot.summary.every((s) => s.on_hand >= 0), 'sample data never goes negative');
  backend.clearSampleData();
  const after = api('getBootstrap').data;
  assert.equal(after.products.length, 33);
  assert.ok(after.summary.every((s) => s.on_hand === 0));
});
