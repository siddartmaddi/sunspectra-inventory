// i18n.js: every label shown in the app, in English and Spanish.
// To change a word, edit it here. Use {name} for values filled in by the code.
import { storageGet, storageSet } from './api.js';

const LANG_STORAGE = 'sunspectra.lang';
let lang = storageGet(LANG_STORAGE) === 'es' ? 'es' : 'en';

const en = {
  'nav.dashboard': 'Dashboard',
  'nav.record': 'Record',
  'nav.history': 'History',
  'nav.products': 'Products',
  'nav.settings': 'Settings',
  'nav.menu': 'Menu',
  'nav.logout': 'Log out',

  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.search': 'Search',
  'common.all': 'All',
  'common.exportCsv': 'Export CSV',
  'common.apply': 'Apply',
  'common.clear': 'Clear',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.saved': 'Saved.',
  'common.fixThese': 'Please fix these:',
  'common.noCharts': 'Charts could not load (no internet connection to the chart library).',
  'common.retry': 'Try again',
  'common.none': 'Nothing to show.',

  'login.title': 'SunSpectra Inventory',
  'login.subtitle': 'Sign in on this device. Your name is saved with every change you make.',
  'login.name': 'Your name',
  'login.key': 'Access key',
  'login.keyHint': 'Ask the owner for the access key.',
  'login.submit': 'Sign in',
  'login.needName': 'Please enter your name.',
  'login.needKey': 'Please enter the access key.',

  'dash.title': 'Dashboard',
  'dash.activeProducts': 'Active products',
  'dash.outOfStock': 'Out of stock',
  'dash.inventoryValue': 'Inventory value (cost)',
  'dash.currentStock': 'Current stock',
  'dash.asOf': 'As of {date}',

  'col.product': 'Product',
  'col.sku': 'SKU',
  'col.category': 'Category',
  'col.onHand': 'On hand',
  'col.value': 'Value',
  'col.date': 'Date',
  'col.type': 'Type',
  'col.qty': 'Qty',
  'col.channel': 'Channel',
  'col.customer': 'Customer',
  'col.reference': 'Reference',
  'col.note': 'Note',
  'col.enteredBy': 'Entered by',
  'col.status': 'Status',
  'col.price': 'Retail',
  'col.cost': 'Cost',
  'col.leadTime': 'Lead time',
  'col.supplier': 'Supplier',

  'type.OPENING': 'Opening stock',
  'type.SALE': 'Sale',
  'type.RESTOCK': 'Restock',
  'type.PRODUCTION': 'Production',
  'type.RETURN': 'Return',
  'type.DAMAGED': 'Damaged',
  'type.EXPIRED': 'Expired',
  'type.SAMPLE': 'Sample',
  'type.ADJUSTMENT': 'Adjustment',

  'channel.B2B': 'B2B (wholesale)',
  'channel.B2B2C': 'B2B2C (retail stores)',
  'channel.B2C': 'B2C (direct)',
  'channel.INTERNAL': 'Internal',

  'rec.title': 'Record stock movement',
  'rec.subtitle': 'One form per order or delivery. Add a line for each product.',
  'rec.quickSale': 'Sale',
  'rec.quickRestock': 'Restock / Production',
  'rec.quickDamaged': 'Damaged',
  'rec.quickSample': 'Sample',
  'rec.otherType': 'Other type',
  'rec.restockKind': 'Where did the stock come from?',
  'rec.date': 'Date',
  'rec.type': 'Type',
  'rec.channel': 'Channel',
  'rec.customer': 'Customer',
  'rec.reference': 'Reference (invoice, order or batch)',
  'rec.note': 'Note',
  'rec.products': 'Products',
  'rec.productPlaceholder': 'Type a name or SKU…',
  'rec.qty': 'Quantity',
  'rec.addLine': '+ Add product',
  'rec.remove': 'Remove',
  'rec.adjAdd': '+ Add',
  'rec.adjRemove': '− Remove',
  'rec.adjDirection': 'Adjustment direction',
  'rec.lineInfo': 'On hand: {onHand} → after: {after}',
  'rec.unknownProduct': 'Pick a product from the list.',
  'rec.badQty': 'Enter a whole number above 0.',
  'rec.wouldBeNegative': 'Not enough stock: this leaves {after}.',
  'rec.spike': 'Unusually large: {qty} is more than {mult}× the usual {typical}. Typo?',
  'rec.allowNegative': 'Allow negative stock (explain why in the box below)',
  'rec.negativeNote': 'Why is negative stock OK?',
  'rec.save': 'Save {n} line(s)',
  'rec.saved': 'Saved {n} line(s).',
  'rec.needLines': 'Add at least one product with a quantity.',
  'rec.fixLines': 'Some lines need attention (see the red messages).',
  'rec.negativeBlocked': 'Some products would go below zero. Fix the quantities, or tick "Allow negative stock" and write why.',
  'rec.spikeTitle': 'Check these quantities',
  'rec.spikeBody': 'These quantities are much bigger than usual for these products. Are they correct?',
  'rec.spikeConfirm': 'Yes, save anyway',
  'rec.needNegativeNote': 'Write a note explaining why negative stock is OK.',

  'hist.title': 'Movement history',
  'hist.from': 'From',
  'hist.to': 'To',
  'hist.product': 'Product',
  'hist.showing': 'Showing {shown} of {total} movements.',
  'hist.reverse': 'Reverse',
  'hist.reversed': 'Reversed',
  'hist.reversal': 'Reversal',
  'hist.reverseTitle': 'Reverse this movement?',
  'hist.reverseBody': 'This adds a new movement of {qty} for {sku} that cancels this one (nothing is deleted). Use it to fix a mistake, then record the correct movement.',
  'hist.reverseConfirm': 'Reverse it',
  'hist.reverseDone': 'Movement reversed.',
  'hist.negativeReverse': 'Reversing this would make {sku} negative. Explain why this is OK to continue:',

  'prod.title': 'Products',
  'prod.add': 'Add product',
  'prod.showInactive': 'Show deactivated',
  'prod.inactive': 'Deactivated',
  'prod.active': 'Active',
  'prod.deactivate': 'Deactivate',
  'prod.activate': 'Reactivate',
  'prod.deactivateConfirm': 'Deactivate {name}? It will be hidden from forms and alerts. Its history is kept, and you can reactivate it at any time.',
  'prod.editTitle': 'Edit {sku}',
  'prod.newTitle': 'New product',
  'prod.name': 'Name',
  'prod.sku': 'SKU',
  'prod.skuHint': 'Short code, capital letters and dashes, e.g. LB-CORAL. Cannot be changed later.',
  'prod.category': 'Category',
  'prod.unit': 'Unit',
  'prod.unitCost': 'Unit cost (USD)',
  'prod.retail': 'Retail price (USD)',
  'prod.wholesale': 'Wholesale price (USD)',
  'prod.wholesaleHint': 'Leave blank to use 70% of retail.',
  'prod.supplier': 'Supplier',
  'prod.leadTime': 'Lead time (days)',
  'prod.leadTimeHint': 'Days from ordering (or starting production) to stock on the shelf.',
  'prod.moq': 'Minimum order / batch size',
  'prod.targetCover': 'Target cover (days)',
  'prod.targetCoverHint': 'How many days of stock to aim for after reordering.',
  'prod.safetyOverride': 'Safety stock (manual)',
  'prod.reorderOverride': 'Reorder point (manual)',
  'prod.overrideHint': 'Leave blank to let the app calculate it.',
  'prod.notFound': 'Product not found.',
  'prod.back': '← All products',
  'prod.recentMovements': 'Recent movements',
  'prod.currentStock': 'Current stock',
  'prod.stockValue': 'Stock value (cost)',
  'prod.count': '{n} products',

  'set.title': 'Settings',
  'set.general': 'General',
  'set.companyName': 'Company name',
  'set.alertEmail': 'Alert email(s)',
  'set.alertEmailHint': 'Where the daily stock email goes. Separate several addresses with commas.',
  'set.alertHour': 'Alert hour (0-23)',
  'set.appUrl': 'App address (link in emails)',
  'set.serviceLevel': 'Service level',
  'set.serviceLevelHint': 'How sure you want to be of not running out. Higher = more safety stock.',
  'set.forecastWindow': 'Forecast window (days)',
  'set.warningDays': 'Stockout warning (days)',
  'set.spike': 'Typo warning multiplier',
  'set.spikeHint': 'Warn when a quantity is this many times the usual size.',
  'set.includeSamples': 'Count samples as demand in the forecast',
  'set.suppliers': 'Suppliers',
  'set.addSupplier': 'Add supplier',
  'set.supplierName': 'Name',
  'set.contact': 'Contact person',
  'set.email': 'Email',
  'set.phone': 'Phone',
  'set.notes': 'Notes',
  'set.editSupplier': 'Edit supplier',
  'set.newSupplier': 'New supplier'
};

// Spanish labels are filled in Phase 4; until then missing ones fall back to English.
const es = {};

const dictionaries = { en, es };

/** Translates a key, filling {placeholders} from vars. Falls back to English, then the key. */
export function t(key, vars) {
  let text = dictionaries[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll('{' + k + '}', v);
  return text;
}

export function getLang() { return lang; }

export function setLang(next) {
  lang = next === 'es' ? 'es' : 'en';
  storageSet(LANG_STORAGE, lang);
  document.documentElement.lang = lang;
}

/** Fills static elements marked with data-i18n="key" (the header buttons). */
export function translateStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}
