// app.js: starts the app, shows the login screen, and switches pages based on the URL (#/...).
import { isLoggedIn, getSession, saveSession, clearSession, getBootstrap } from './api.js';
import { t, getLang, setLang, translateStatic } from './i18n.js';
import { esc, withLoading, errorBox, loadingHtml, closeDialog } from './utils.js';
import * as dashboard from './dashboard.js';
import * as products from './products.js';
import * as movements from './movements.js';
import * as settings from './settings.js';
import * as reorder from './reorder.js';

// Each route: URL pattern -> page module (with a render(container, params) function).
const ROUTES = [
  { path: /^\/$/, page: dashboard, nav: 'dashboard' },
  { path: /^\/record$/, page: movements, nav: 'record', params: () => ({ view: 'record' }) },
  { path: /^\/history$/, page: movements, nav: 'history', params: () => ({ view: 'history' }) },
  { path: /^\/products$/, page: products, nav: 'products' },
  { path: /^\/products\/(.+)$/, page: products, nav: 'products', params: (m) => ({ sku: decodeURIComponent(m[1]) }) },
  { path: /^\/reorder$/, page: reorder, nav: 'reorder' },
  { path: /^\/settings$/, page: settings, nav: 'settings' }
];

const NAV = [
  ['dashboard', '#/'],
  ['record', '#/record'],
  ['history', '#/history'],
  ['reorder', '#/reorder'],
  ['products', '#/products'],
  ['settings', '#/settings']
];

const app = document.getElementById('app');
let renderId = 0; // ignores slow page loads that finish after the person already moved on

function currentPath() {
  const hash = location.hash.replace(/^#/, '') || '/';
  return hash.split('?')[0];
}

async function route() {
  closeDialog();
  if (!isLoggedIn()) return renderLogin();
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('nav').classList.remove('open');

  const path = currentPath();
  let match = null;
  const found = ROUTES.find((r) => (match = path.match(r.path)));
  if (!found) { location.hash = '#/'; return; }

  renderNav(found.nav);
  const id = ++renderId;
  app.innerHTML = loadingHtml();
  try {
    const container = document.createElement('div');
    await found.page.render(container, found.params ? found.params(match) : {});
    if (id !== renderId) return;
    app.replaceChildren(container);
    window.scrollTo(0, 0);
  } catch (err) {
    if (id !== renderId) return;
    app.innerHTML = errorBox(err) + `<button type="button" id="retry">${esc(t('common.retry'))}</button>`;
    document.getElementById('retry').addEventListener('click', route);
  }
}

function renderNav(active) {
  document.getElementById('nav').innerHTML = NAV.map(([key, href]) =>
    `<a href="${href}"${key === active ? ' class="active" aria-current="page"' : ''}>${esc(t('nav.' + key))}</a>`
  ).join('');
  document.getElementById('current-user').textContent = getSession().user || '';
  document.getElementById('lang-toggle').textContent = getLang() === 'es' ? 'EN' : 'ES';
  translateStatic();
}

function renderLogin() {
  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('banner').classList.add('hidden');
  app.innerHTML = `
    <form class="card login" id="login-form" novalidate>
      <div class="actions-row" style="justify-content:space-between">
        <h1>${esc(t('login.title'))}</h1>
        <button type="button" class="lang-toggle" id="login-lang">${getLang() === 'es' ? 'EN' : 'ES'}</button>
      </div>
      <p class="muted">${esc(t('login.subtitle'))}</p>
      <div class="field">
        <label for="login-name">${esc(t('login.name'))}</label>
        <input id="login-name" autocomplete="name" value="${esc(getSession().user || '')}" required>
      </div>
      <div class="field">
        <label for="login-key">${esc(t('login.key'))}</label>
        <input id="login-key" type="password" autocomplete="current-password" required>
        <div class="hint">${esc(t('login.keyHint'))}</div>
      </div>
      <div id="login-error"></div>
      <button type="submit" style="width:100%">${esc(t('login.submit'))}</button>
    </form>`;
  document.getElementById('login-lang').addEventListener('click', () => {
    setLang(getLang() === 'es' ? 'en' : 'es');
    renderLogin();
  });
  const form = document.getElementById('login-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value.trim();
    const key = document.getElementById('login-key').value.trim();
    const errorEl = document.getElementById('login-error');
    if (!name) { errorEl.innerHTML = errorBox(t('login.needName')); return; }
    if (!key) { errorEl.innerHTML = errorBox(t('login.needKey')); return; }
    withLoading(form.querySelector('button[type=submit]'), async () => {
      saveSession(name, key);
      try {
        await getBootstrap(true); // checks the key and loads the data in one go
        route();
      } catch (err) {
        clearSession();
        errorEl.innerHTML = errorBox(err);
      }
    });
  });
  (getSession().user ? document.getElementById('login-key') : document.getElementById('login-name')).focus();
}

// ---- header buttons ----
document.getElementById('lang-toggle').addEventListener('click', () => {
  setLang(getLang() === 'es' ? 'en' : 'es');
  route();
});
document.getElementById('logout').addEventListener('click', () => {
  clearSession();
  route();
});
document.getElementById('menu-btn').addEventListener('click', (e) => {
  const nav = document.getElementById('nav');
  nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
});

window.addEventListener('hashchange', route);
window.addEventListener('auth-lost', route);

setLang(getLang());
route();
