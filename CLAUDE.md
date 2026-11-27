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
- Backend files beyond the spec list: `Kpis.gs` (dashboard numbers),  `Counts.gs`, `Import.gs`, `Reports.gs`, `Stock.gs` (bootstrap/summary), `Movements.gs`, `Products.gs` (products, suppliers, settings). `Code.gs` lists actions by function *name* because Apps Script loads files in order.
- Forecast choices beyond the spec: days that *started* with zero stock are left out of the demand average (otherwise a sold-out product looks like it stopped selling); reversed movements and their reversals are ignored; the window ends yesterday; when status is OUT/REORDER NOW but the formula gives 0, suggest one minimum batch.
- Typo ("spike") warning uses the 90th percentile of the last 100 movement sizes, separately for stock out and stock in (median was too small: most web sales are 1 unit).
- Sample data: products from the client's list; movements simulated per product with fixed seeds (`SAMPLE_PROFILES` makes some out of stock, some about to run out, some slow movers). `clearSampleData()` removes rows with entered_by = "Sample data".

- Dashboard KPIs (`backend/Kpis.gs`, `frontend/js/dashboard.js`): only data the app already records, no new fields, no placeholder tiles (a tile or card is simply not shown when its data is absent). `computeStockKpis()` (today's numbers) is part of `getBootstrap` so the Stock tab opens instantly; `computeKpis()` (sales, production, losses, counts, 12-month trends, previous-period comparison) is the cached `getKpis` action (30/90/365 days), loaded for the Sales and Production tabs and for the trend charts. `clearCache_` also clears the `kpis_v2_*` keys. `getBootstrap` still returns the old `sales` block so a browser or site version that still uses the old dashboard keeps working during a deploy (remove it once nobody can have the old site open).
- KPI definitions: revenue is an ESTIMATE (retail price for B2C, wholesale for B2B/B2B2C/INTERNAL; no sale prices are stored); margin = revenue - units x unit_cost. An "order" = same channel+date+customer+reference (no order id exists). Customer concentration and average order size cover B2B and B2B2C only. Overstock = days of cover > 3 x target_cover_days; slow mover = in stock, no sale for 60 days and the product is at least 60 days old. Units produced = PRODUCTION movements, received = RESTOCK. Damage/sample rate = units / units sold in the period. Count accuracy = 1 - sum|variance| / sum(system qty). Reversed movements are ignored; returns are not netted; kits are products of their own (no BOM).
- Monthly trend of stock numbers uses month-end snapshots rebuilt from Movements; days of cover there uses average sales of the last 90 days (at least 14 days of history needed) and slow movers need 60 days of history. The month in progress (or a first month that starts mid-month) is marked `*`.

## Status
Done:
- Phase 0: git, .gitignore, CLAUDE.md.
- Phase 1: setup(), API with access key + LockService + CacheService, products add/edit/deactivate, multi-line movement form (negative-stock block, typo warning), history with filters/CSV/reverse, settings + suppliers page, dashboard with current stock. API tests in `tests/api.test.js`. Checked in the browser (desktop + 375px).
- Phase 2: `backend/forecast.js` (weighted average with 21-day half-life, simple average under 30 days, low-data flag under 14, safety stock, reorder point, cover, stockout/reorder-by dates, suggested qty rounded to MOQ, status). 20 unit tests in `tests/forecast.test.js`. Dashboard KPIs + Needs attention + 2 charts, product page forecast with plain-words explanation + stock and forecast charts, Reorder page with editable qty and CSV.
- Phase 3: `backend/Alerts.gs`: `dailyAlertJob()` (one summary email: Out of stock / Reorder now / Running low; AlertLog; 3-day repeat rule unless status worsens), `installTriggers()` (no duplicates), `previewAlertEmail()`. New setting `app_url` for the email link. Red banner on every page with the urgent count. Tests in `tests/alerts.test.js`.
- Phase 4: `Counts.gs` (saveCount_ uses stock at end of count date, ADJUSTMENT "Count adjustment" with reference = count_id), `Import.gs` (dry run, per-row errors, unknown names, NameMap tab, batches of 300 from the browser, all-or-nothing per batch), `Reports.gs` (one getReport call). Screens: Counts, Import (handles `;` CSV and DD/MM/YYYY), Reports with CSV export. Full Spanish dictionary (test checks key parity). Sample data includes two counts.
- README (non-developer setup: Sheet, pasting .gs files, ACCESS_KEY, deploy, triggers, config.js, Cloudflare Pages; troubleshooting; future ideas). `frontend/_headers` sets Cache-Control: no-cache.

- Phase 5 (2026-11-27): dashboard KPIs (see Decisions). Stock tab: stock on hand, days of cover, stock-out risk (+ estimated lost sales per day), reorder point / safety stock, overstock, slow movers, inventory value, needs-attention table, stock by category, month-end trend charts. Sales tab: units sold (by channel / category / product, by month), estimated revenue and gross margin, top / bottom sellers, kit vs single mix, revenue share by channel, customer concentration, average B2B order size. Production & quality tab: units produced, production vs sales, damage rate, sample rate, count accuracy, shrinkage. `tests/kpis.test.js` checks the numbers against hand-worked values.
- Deployed (2026-10-28) on Siddart's Google account for now: Sheet + bound script created with clasp (`.clasp.json` is gitignored), web app URL in `frontend/config.js`. Site on Netlify: https://dainty-crepe-a910be.netlify.app/ (Cloudflare dashboard wouldn't load for Siddart).

Next:
- Siddart: turn off Netlify visitor protection, set App address + alert email in Settings, run installTriggers.
- Handoff to the client: full checklist in `HANDOFF.md` (Google copy + key + trigger, config.js URL, Netlify, GitHub, real costs). Update the deployment line above afterwards.
- Replace estimated unit costs, lead times and batch sizes with real ones.
- Future ideas are listed in README section 6.
