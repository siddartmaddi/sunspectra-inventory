// api.js: talks to the Apps Script backend and remembers who is logged in.
import { API_URL } from '../config.js';

const KEY_STORAGE = 'sunspectra.key';
const USER_STORAGE = 'sunspectra.user';

// localStorage can be blocked (private mode, strict settings), so every access is wrapped.
export function storageGet(name) {
  try { return localStorage.getItem(name); } catch { return null; }
}
export function storageSet(name, value) {
  try {
    if (value === null) localStorage.removeItem(name);
    else localStorage.setItem(name, value);
  } catch { /* the app still works, it just won't remember this */ }
}

// Kept in memory too, so the app works even when localStorage is blocked.
let session = { key: storageGet(KEY_STORAGE), user: storageGet(USER_STORAGE) };

export function getSession() { return session; }
export function isLoggedIn() { return !!session.key; }

export function saveSession(user, key) {
  session = { user, key };
  storageSet(USER_STORAGE, user);
  storageSet(KEY_STORAGE, key);
}

export function clearSession() {
  session = { user: session.user, key: null }; // keep the name to pre-fill the login form
  storageSet(KEY_STORAGE, null);
}

/** An error the screen can show as is. `details` holds extra info from the server. */
export class ApiError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

/**
 * Calls one backend action. Sent as text/plain on purpose: Apps Script can't answer
 * the CORS "preflight" request that application/json would trigger.
 */
export async function call(action, payload = {}) {
  if (API_URL.includes('PASTE_YOUR')) {
    throw new ApiError('The app is not connected yet: put the Apps Script URL in config.js (see README).');
  }
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: session.key, user: session.user, action, payload })
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your internet connection and try again.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('The server sent an unexpected answer. If this keeps happening, check the Apps Script deployment.');
  }
  if (!body.ok) {
    if (body.error === 'unauthorized') {
      clearSession();
      window.dispatchEvent(new Event('auth-lost'));
      throw new ApiError('The access key is wrong or has changed. Please log in again.');
    }
    throw new ApiError(body.error || 'Unknown error', body.details);
  }
  return body.data;
}

// ---- Bootstrap data (products, settings, stock summary) shared by all pages ----
let bootstrapData = null;

/** Returns the cached bootstrap data, loading it from the server when needed. */
export async function getBootstrap(force = false) {
  if (!bootstrapData || force) {
    bootstrapData = await call('getBootstrap');
    window.dispatchEvent(new CustomEvent('bootstrap', { detail: bootstrapData }));
  }
  return bootstrapData;
}

/** Call after any save so the next page shows fresh numbers. */
export function invalidateBootstrap() { bootstrapData = null; }

/** Runs a write action, then marks the cached data as stale. */
export async function write(action, payload) {
  const data = await call(action, payload);
  invalidateBootstrap();
  return data;
}
