# SunSpectra Inventory: project notes for Claude

Inventory web app for SunSpectra (reef-safe sunscreen and skincare, Costa Rica). Full spec: `SPEC.md`.

## Stack
- Database: one Google Sheet, one tab per table (`backend/Setup.gs` creates them).
- API: Google Apps Script web app (`backend/*.gs`), single POST endpoint `{key, user, action, payload}` -> `{ok, data, error}`.
- Frontend: static HTML/CSS/vanilla JS ES modules in `frontend/`, Chart.js from CDN, no build step.
- Hosting: Cloudflare Pages from GitHub repo `siddartmaddi/sunspectra-inventory` (branch `main`).

## Decisions
- Repo root is this folder (spec calls it `sunspectra-inventory/`).
- Product list comes from the client's `Purdue_info.xlsx` (33 products; 3 Opticks Powders are discontinued -> inactive). Unit costs were confidential/blank, so sample costs are estimated at ~30% of retail and must be replaced by the client.
- Extra category `Sunscreen` (creams/fluids) added to the spec's category list.
- Setting `include_samples_in_demand` (default FALSE) decides whether SAMPLE movements count as demand; the client was unsure.
- Default language English with an English/Español toggle.
- Movements has an extra column `reverses_id` so a movement can only be reversed once.
- `backend/forecast.js` is the source of truth; `backend/Forecast.gs` must be an identical copy (a test checks this).
- Local testing: `dev/server.js` runs the real `.gs` files in Node against a fake in-memory Sheet (saved to `dev/data.json`) and serves the frontend. Start: `node dev/server.js [--reset]`, open http://localhost:8787, key `dev-key`.
- Node is not installed system-wide on Siddart's Mac: use `~/.local/node/current/bin/node` (Node 22 LTS).
- Tests: `node --test` from the repo root (runs `tests/*.test.js`).
- CSV templates live in `frontend/templates/` (not root `templates/`) so the deployed site can serve them.
- Imports skip the negative-stock check (history may be loaded out of order). Server error messages are English only.
- Backend files beyond the spec list: `Counts.gs`, `Import.gs`, `Reports.gs`, `Stock.gs` (bootstrap/summary), `Movements.gs`, `Products.gs` (products, suppliers, settings). `Code.gs` lists actions by function *name* because Apps Script loads files in order.
- Forecast choices beyond the spec: days that *started* with zero stock are left out of the demand average (otherwise a sold-out product looks like it stopped selling); reversed movements and their reversals are ignored; the window ends yesterday; when status is OUT/REORDER NOW but the formula gives 0, suggest one minimum batch.
- Typo ("spike") warning uses the 90th percentile of the last 100 movement sizes, separately for stock out and stock in (median was too small: most web sales are 1 unit).
- Sample data: products from the client's list; movements simulated per product with fixed seeds (`SAMPLE_PROFILES` makes some out of stock, some about to run out, some slow movers). `clearSampleData()` removes rows with entered_by = "Sample data".

## Status
Done:
- Phase 0: git, .gitignore, CLAUDE.md.
- Phase 1: setup(), API with access key + LockService + CacheService, products add/edit/deactivate, multi-line movement form (negative-stock block, typo warning), history with filters/CSV/reverse, settings + suppliers page, dashboard with current stock. API tests in `tests/api.test.js`. Checked in the browser (desktop + 375px).
- Phase 2: `backend/forecast.js` (weighted average with 21-day half-life, simple average under 30 days, low-data flag under 14, safety stock, reorder point, cover, stockout/reorder-by dates, suggested qty rounded to MOQ, status). 20 unit tests in `tests/forecast.test.js`. Dashboard KPIs + Needs attention + 2 charts, product page forecast with plain-words explanation + stock and forecast charts, Reorder page with editable qty and CSV.
- Phase 3: `backend/Alerts.gs`: `dailyAlertJob()` (one summary email: Out of stock / Reorder now / Running low; AlertLog; 3-day repeat rule unless status worsens), `installTriggers()` (no duplicates), `previewAlertEmail()`. New setting `app_url` for the email link. Red banner on every page with the urgent count. Tests in `tests/alerts.test.js`.
- Phase 4: `Counts.gs` (saveCount_ uses stock at end of count date, ADJUSTMENT "Count adjustment" with reference = count_id), `Import.gs` (dry run, per-row errors, unknown names, NameMap tab, batches of 300 from the browser, all-or-nothing per batch), `Reports.gs` (one getReport call). Screens: Counts, Import (handles `;` CSV and DD/MM/YYYY), Reports with CSV export. Full Spanish dictionary (test checks key parity). Sample data includes two counts.

Next:
- README for the client (setup, deploy, troubleshooting, future ideas), Cloudflare `_headers` so browsers don't keep old JS.
