/**
 * Alerts.gs
 * The daily stock email.
 *
 *   installTriggers()     run once by hand: schedules dailyAlertJob every day at alert_hour.
 *                         Safe to run again (e.g. after changing alert_hour): it never duplicates.
 *   dailyAlertJob()       run by the trigger: emails ONE summary to alert_email, only when
 *                         there is something new to report.
 *   previewAlertEmail()   run by hand to see in the log what would be sent, without sending.
 */

var ALERT_REPEAT_DAYS = 3;          // don't repeat the same alert for a product within 3 days...
var ALERT_STATUSES = ['OUT', 'REORDER NOW', 'LOW'];
var ALERT_RANK = { 'OUT': 0, 'REORDER NOW': 1, 'LOW': 2 }; // ...unless it got worse (lower rank)

function dailyAlertJob() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var settings = getSettings_();
    if (!settings.alert_email) {
      Logger.log('No alert_email in Settings: nothing sent.');
      return { sent: false, reason: 'no alert_email' };
    }
    var plan = buildAlertPlan_(settings);
    if (!plan.items.length) {
      Logger.log('Nothing new to report today: no email sent.');
      return { sent: false, reason: 'nothing new' };
    }
    var email = composeAlertEmail_(plan, settings);
    MailApp.sendEmail({ to: settings.alert_email, subject: email.subject, body: email.text, htmlBody: email.html });

    appendRows_('AlertLog', plan.items.map(function (item) {
      return { date: plan.today, sku: item.sku, alert_type: item.status, message: item.message, emailed: true };
    }));
    Logger.log('Sent alert email with ' + plan.items.length + ' product(s) to ' + settings.alert_email);
    return { sent: true, count: plan.items.length };
  } finally {
    lock.releaseLock();
  }
}

/** Logs the email that would be sent today (ignores the 3-day rule), without sending it. */
function previewAlertEmail() {
  var settings = getSettings_();
  var plan = buildAlertPlan_(settings, { ignoreLog: true });
  if (!plan.items.length) {
    Logger.log('Nothing to report.');
    return null;
  }
  var email = composeAlertEmail_(plan, settings);
  Logger.log(email.subject + '\n\n' + email.text);
  return email;
}

/** Creates the daily trigger. Removes old ones first so there is never more than one. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'dailyAlertJob') ScriptApp.deleteTrigger(trigger);
  });
  var hour = Number(getSettings_().alert_hour);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 7;
  ScriptApp.newTrigger('dailyAlertJob').timeBased().everyDays(1).atHour(hour)
    .inTimezone(timeZone_()).create();
  Logger.log('Daily alert scheduled at about ' + hour + ':00 (' + timeZone_() + ').');
}

/**
 * Decides which products go in today's email.
 * A product is included when its status is OUT, REORDER NOW or LOW and either
 * it wasn't alerted in the last 3 days, or its status is worse than last time.
 */
function buildAlertPlan_(settings, options) {
  options = options || {};
  var today = todayISO_();
  var products = readTable_('Products').map(stripRow_);
  var activeBySku = {};
  products.forEach(function (p) { if (p.active) activeBySku[p.sku] = p; });
  var summary = buildSummary_(products, readTable_('Movements'), today, settings);

  // Most recent alert per product within the repeat window.
  var since = addDays(today, -(ALERT_REPEAT_DAYS - 1));
  var recent = {};
  if (!options.ignoreLog) {
    readTable_('AlertLog').forEach(function (a) {
      if (a.date < since || !(a.alert_type in ALERT_RANK)) return;
      var prev = recent[a.sku];
      if (!prev || ALERT_RANK[a.alert_type] < ALERT_RANK[prev]) recent[a.sku] = a.alert_type;
    });
  }

  var items = summary.filter(function (row) {
    if (!activeBySku[row.sku] || ALERT_STATUSES.indexOf(row.status) === -1) return false;
    var last = recent[row.sku];
    return !last || ALERT_RANK[row.status] < ALERT_RANK[last];
  }).sort(compareUrgency).map(function (row) {
    var p = activeBySku[row.sku];
    return {
      sku: row.sku,
      name: p.name,
      status: row.status,
      on_hand: row.on_hand,
      days_of_cover: row.days_of_cover,
      reorder_by_date: row.reorder_by_date,
      suggested_qty: row.suggested_qty,
      message: row.status + ': ' + p.name + ', ' + row.on_hand + ' on hand' +
        (row.days_of_cover !== null ? ', ' + row.days_of_cover + ' days of cover' : '')
    };
  });
  return { today: today, items: items };
}

/** Builds the subject, plain text and HTML of the summary email. */
function composeAlertEmail_(plan, settings) {
  var company = settings.company_name || 'SunSpectra';
  var warnDays = Number(settings.stockout_warning_days) || 14;
  var sections = [
    ['OUT', 'Out of stock'],
    ['REORDER NOW', 'Reorder now'],
    ['LOW', 'Running low (could run out within ' + warnDays + ' days plus lead time)']
  ];
  var counts = {};
  plan.items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
  var subjectParts = [];
  if (counts['OUT']) subjectParts.push(counts['OUT'] + ' out of stock');
  if (counts['REORDER NOW']) subjectParts.push(counts['REORDER NOW'] + ' to reorder');
  if (counts['LOW']) subjectParts.push(counts['LOW'] + ' running low');
  var subject = company + ' stock alert: ' + subjectParts.join(', ');

  var cover = function (i) { return i.days_of_cover === null ? 'no recent sales' : i.days_of_cover + ' days'; };
  var text = [company + ' daily stock alert for ' + plan.today, ''];
  var html = ['<div style="font-family:Arial,sans-serif;color:#1f2a2e">',
    '<h2 style="color:#0f766e;margin:0 0 4px">' + esc_(company) + ' stock alert</h2>',
    '<p style="margin:0 0 16px;color:#5f6b70">' + esc_(plan.today) + '</p>'];

  sections.forEach(function (section) {
    var items = plan.items.filter(function (i) { return i.status === section[0]; });
    if (!items.length) return;
    text.push(section[1].toUpperCase());
    items.forEach(function (i) {
      text.push('- ' + i.name + ' (' + i.sku + '): ' + i.on_hand + ' on hand, ' + cover(i) +
        ', reorder by ' + (i.reorder_by_date || '-') + ', suggested order ' + i.suggested_qty);
    });
    text.push('');
    html.push('<h3 style="margin:16px 0 6px">' + esc_(section[1]) + '</h3>',
      '<table cellpadding="6" style="border-collapse:collapse;font-size:14px">',
      '<tr style="background:#f1eee6;text-align:left"><th>Product</th><th>On hand</th><th>Days of cover</th><th>Reorder by</th><th>Suggested qty</th></tr>');
    items.forEach(function (i) {
      html.push('<tr style="border-bottom:1px solid #e2ddd2"><td>' + esc_(i.name) + '<br><small style="color:#5f6b70">' + esc_(i.sku) +
        '</small></td><td align="right">' + i.on_hand + '</td><td align="right">' + esc_(cover(i)) +
        '</td><td>' + esc_(i.reorder_by_date || '-') + '</td><td align="right">' + i.suggested_qty + '</td></tr>');
    });
    html.push('</table>');
  });

  if (settings.app_url) {
    text.push('Open the app: ' + settings.app_url + '#/reorder');
    html.push('<p style="margin-top:20px"><a href="' + esc_(settings.app_url) + '#/reorder" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the reorder plan</a></p>');
  }
  text.push('', 'You get this email because your address is in the alert_email setting.');
  html.push('<p style="color:#5f6b70;font-size:12px;margin-top:24px">You get this email because your address is in the alert_email setting. ' +
    'Each product is repeated at most every ' + ALERT_REPEAT_DAYS + ' days unless its status gets worse.</p></div>');
  return { subject: subject, text: text.join('\n'), html: html.join('') };
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
