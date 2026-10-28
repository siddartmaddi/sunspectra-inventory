// Tests for the daily alert email (backend/Alerts.gs), run against the fake spreadsheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, callApi } = require('../dev/fake-apps-script');

const DAY1 = '2026-10-28T13:00:00Z'; // 7:00 in Costa Rica

/** Backend with sample data and an alert email, at a fixed date. Pass `saved` to keep data. */
function backendAt(now, saved) {
  const b = loadBackend({ now, saved });
  if (!saved) {
    b.loadSampleData();
    callApi(b, { key: 'dev-key', user: 'T', action: 'updateSettings', payload: { settings: { alert_email: 'owner@example.com', app_url: 'https://inventory.example.com/' } } });
  }
  return b;
}

test('sends one summary email with the three sections, then stays quiet for 3 days', () => {
  const b = backendAt(DAY1);
  const result = b.dailyAlertJob();
  assert.equal(result.sent, true);
  assert.equal(b.__sentEmails.length, 1);
  const mail = b.__sentEmails[0];
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.subject, /out of stock/);
  assert.match(mail.body, /OUT OF STOCK/);
  assert.match(mail.body, /REORDER NOW/);
  assert.match(mail.body, /RUNNING LOW/);
  assert.match(mail.body, /LB-CARMESI/);
  assert.match(mail.htmlBody, /https:\/\/inventory\.example\.com\/#\/reorder/);
  assert.doesNotMatch(mail.body, /OPP-K1V/, 'deactivated products are never alerted');

  // Every alert is logged.
  const logged = b.__dump().AlertLog.length - 1;
  assert.equal(logged, result.count);

  // Same day and the next 2 days: nothing new, so no email.
  assert.equal(b.dailyAlertJob().sent, false);
  const day3 = backendAt('2026-10-30T13:00:00Z', b.__dump());
  assert.equal(day3.dailyAlertJob().sent, false);

  // After 3 days the still-open problems are reported again.
  const day4 = backendAt('2026-10-31T13:00:00Z', b.__dump());
  assert.equal(day4.dailyAlertJob().sent, true);
});

test('a product whose status gets worse is reported again right away', () => {
  const b = backendAt(DAY1);
  b.dailyAlertJob();
  const api = (action, payload) => callApi(b, { key: 'dev-key', user: 'T', action, payload });
  const row = api('getBootstrap').data.summary.find((s) => s.sku === 'LB-CORAL');
  assert.equal(row.status, 'REORDER NOW');
  api('addMovements', { date: '2026-10-28', type: 'SALE', channel: 'B2C', lines: [{ sku: 'LB-CORAL', qty: row.on_hand }] });

  const again = b.dailyAlertJob();
  assert.equal(again.sent, true);
  assert.equal(again.count, 1);
  assert.match(b.__sentEmails[1].body, /OUT OF STOCK\n- Lip Balm Coral/);
});

test('no email without an alert address, or when nothing needs attention', () => {
  const b = loadBackend({ now: DAY1 });
  b.setup();
  assert.equal(b.dailyAlertJob().reason, 'no alert_email');
  callApi(b, { key: 'dev-key', user: 'T', action: 'updateSettings', payload: { settings: { alert_email: 'owner@example.com' } } });
  assert.equal(b.dailyAlertJob().reason, 'nothing new');
  assert.equal(b.__sentEmails.length, 0);
});

test('installTriggers never creates duplicates', () => {
  const b = backendAt(DAY1);
  b.installTriggers();
  b.installTriggers();
  assert.equal(b.__triggers.length, 1);
  assert.equal(b.__triggers[0].hour, 7);
});
