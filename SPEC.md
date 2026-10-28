# SunSpectra Inventory App: Build Spec for Claude Code

## 1. Context

SunSpectra is a small Costa Rican company that makes reef-safe mineral sunscreens and skincare
(lip balms, sunscreen sticks, tinted sunscreens, makeup, kits). The founder runs the business
almost alone and today tracks stock in a spreadsheet where every new count adds two more columns.

Her main pain points:
1. **Stockouts:** products run out before she notices (several items are already at 0).
2. **No alerts:** nothing warns her when stock is low.
3. **No data management:** there is no record of why stock changed (sale, restock, damage), names
   don't match across files, and typos (e.g. a count of 1,089 instead of ~108) go unnoticed.
4. **No prediction:** she can't see when each product will run out or when to reorder.

Build a simple, reliable inventory web app that solves these four problems. It will be used by
1 to 3 people, mostly on a laptop and sometimes on a phone in the storeroom.

## 2. Tech stack (keep it simple, free, and easy for a non-developer to maintain)

- **Database:** one Google Sheet owned by the client. Each table is one tab.
- **Backend/API:** Google Apps Script bound to that Sheet, deployed as a Web App
  (Execute as: me, Who has access: Anyone). It exposes `doGet` and `doPost` returning JSON.
- **Frontend:** a static site in plain HTML, CSS and vanilla JavaScript (ES modules), with
  Chart.js from a CDN. **No build step, no framework, no npm required to run the site.**
- **Hosting:** Cloudflare Pages (free), deployed from a private GitHub repo.
- **Version control:** Git + GitHub. Commit after every working feature.

Important technical notes:
- Apps Script web apps don't handle CORS preflight. Send POST requests with
  `Content-Type: text/plain;charset=utf-8` and a JSON string body so the browser does not send a
  preflight. Parse with `JSON.parse(e.postData.contents)` on the server.
- Every request must include an access key. The key is stored in Apps Script **Script Properties**
  (never in the repo). The frontend asks for the key once on a login screen and keeps it in
  `localStorage` (wrapped in try/catch). Wrong key returns `{ok:false, error:"unauthorized"}`.
- The Apps Script URL lives in `frontend/config.js`. Commit a `config.example.js`; put
  `config.js` in `.gitignore` only if it contains secrets (the URL alone is fine to commit).
- Use `LockService` around every write so two people saving at once can't corrupt rows.
- Never hard-delete data. Products are deactivated; movements are corrected with a reversing entry.

## 3. Data model (Google Sheet tabs)

`setup()` in Apps Script must create any missing tab with these exact headers (row 1, frozen,
bold) and must be safe to run more than once.

**Products**
| Column | Notes |
|---|---|
| sku | Unique, uppercase, e.g. `LB-CORAL`, `ST-L1V` |
| name | Display name |
| category | Lip Balm, Sunscreen Stick, Tinted Sunscreen, Makeup, Skincare, Kit, Accessory |
| unit | unit, ml, g |
| unit_cost | USD |
| retail_price | USD |
| wholesale_price | USD (optional; default retail x 0.7) |
| supplier_id | links to Suppliers |
| lead_time_days | days from placing an order (or starting production) to stock on shelf |
| min_order_qty | minimum batch or order size |
| safety_stock_override | optional manual safety stock; blank = calculated |
| reorder_point_override | optional manual reorder point; blank = calculated |
| target_cover_days | how many days of stock to aim for after reordering (default 60) |
| active | TRUE/FALSE |
| created_at, updated_at | ISO timestamps |

**Movements** (the source of truth for stock; one row per change)
| Column | Notes |
|---|---|
| movement_id | unique id |
| date | YYYY-MM-DD (the business date, editable) |
| sku | |
| type | OPENING, SALE, RESTOCK, PRODUCTION, RETURN, DAMAGED, EXPIRED, SAMPLE, ADJUSTMENT |
| qty | signed integer: + adds stock, - removes stock. The UI asks for a positive number and the type sets the sign (SALE/DAMAGED/EXPIRED/SAMPLE are negative; ADJUSTMENT can be either) |
| channel | B2B, B2B2C (retail stores), B2C (direct), INTERNAL |
| customer | free text with autocomplete from previous values |
| reference | invoice, order or batch number |
| note | |
| entered_by | name from the login screen |
| created_at | timestamp |

**Counts** (physical stock counts)
| count_id | date | sku | counted_qty | system_qty | variance | entered_by | created_at |

When a count is saved, the app calculates `system_qty` from Movements and, if there is a
variance, automatically adds an ADJUSTMENT movement with the note "Count adjustment" so stock
matches reality.

**Suppliers**
| supplier_id | name | contact | email | phone | notes |

**Settings** (key/value)
`alert_email`, `alert_hour` (default 7), `currency` (USD), `service_level` (default 0.95),
`forecast_window_days` (default 90), `stockout_warning_days` (default 14),
`spike_multiplier` (default 3), `company_name`.

**AlertLog**
| date | sku | alert_type | message | emailed |

## 4. Features

### 4.1 Login
- Simple screen asking for name + access key. Remember them on this device.
- Language toggle **English / Español** for all UI labels (the founder is in Costa Rica).

### 4.2 Dashboard (home page)
- KPI tiles: active products, out of stock, below reorder point, stockouts expected in the next
  14 days, total inventory value at cost.
- **"Needs attention" table**, sorted by urgency: product, on hand, avg daily demand,
  days of cover, projected stockout date, reorder-by date, status badge.
  - Status: `OUT` (0 on hand), `REORDER NOW` (on hand <= reorder point or stockout date before
    today + lead time), `LOW` (stockout within `stockout_warning_days` + lead time), `OK`.
  - Colors: red / orange / amber / green, plus text so it doesn't rely on color alone.
- Charts: sales units by month (stacked by channel), top 10 sellers last 30 days.

### 4.3 Products
- List with search and category filter; add, edit, deactivate.
- Product detail page: current stock, stock-over-time line chart (running total from
  Movements, with count points overlaid), recent movements, forecast numbers and how they were
  calculated in plain words.
- Validate: SKU unique, prices and costs >= 0, lead time > 0.

### 4.4 Record stock movements (the most-used screen; must be fast)
- One form for a whole order: date, type, channel, customer, reference, then **multiple product
  lines** (SKU picker with search + qty). Save all lines in one request.
- Quick buttons for the common types: Sale, Restock / Production, Damaged, Sample.
- **Data quality checks before saving:**
  - Block a movement that would make stock negative unless the user ticks "allow" (with a note).
  - Warn if a quantity is more than `spike_multiplier` x the product's typical movement size
    (catches typos like 1,089 vs 108).
  - Required fields and positive integer quantities.
- Movement history page with filters (date range, SKU, type, channel, customer) and CSV export.
- Corrections: "Reverse" button creates an opposite movement instead of editing or deleting.

### 4.5 Stock counts
- Count sheet listing all active products with system quantity, an input for counted quantity,
  and live variance. Save creates Counts rows and the ADJUSTMENT movements.
- Count history with variance by product (shows shrinkage or data entry problems).

### 4.6 Forecasting and reorder planning
Implement all forecast math as **pure functions in one file with no Apps Script or DOM calls**
(`backend/forecast.js`, copied into Apps Script as `Forecast.gs`) so it can be unit-tested in
Node and reused by the email alert job.

For each product:
- **Demand history:** daily demand = units out from SALE movements (and optionally SAMPLE) over
  the last `forecast_window_days`. Days with no sales count as 0.
- **Average daily demand:** exponentially weighted average (more weight on recent weeks).
  Fall back to a simple average when there are fewer than 30 days of history, and show a
  "low data" flag when there are fewer than 14 days.
- **Demand variability:** standard deviation of daily demand.
- **Safety stock** = z x std_daily x sqrt(lead_time_days), where z comes from `service_level`
  (0.90 -> 1.28, 0.95 -> 1.65, 0.98 -> 2.05). Use the override if set.
- **Reorder point** = avg_daily x lead_time_days + safety stock. Use the override if set.
- **Days of cover** = on_hand / avg_daily (show "no recent sales" when avg_daily is 0).
- **Projected stockout date** = today + days of cover.
- **Reorder-by date** = projected stockout date - lead_time_days.
- **Suggested order qty** = max(0, avg_daily x (lead_time_days + target_cover_days)
  + safety stock - on_hand), rounded up to `min_order_qty`.
- Reorder Plan page: every product that needs ordering, suggested qty, reorder-by date,
  supplier, estimated cost; export to CSV so she can send it to suppliers.
- Forecast chart on the product page: past daily/weekly sales and a projected stock line
  going down to the stockout date.
- Write unit tests (`tests/forecast.test.js`, run with `node --test`) covering: no sales,
  very few days of data, a restock in the middle, negative adjustments, overrides, rounding to
  minimum order quantity.

### 4.7 Alerts
- Apps Script function `dailyAlertJob()` run by a daily time-driven trigger at `alert_hour`.
- Sends ONE summary email to `alert_email` with three sections: Out of stock, Reorder now,
  Running low in the next N days. Each line: product, on hand, days of cover, reorder-by date,
  suggested qty. Include a link to the app. Send nothing if there is nothing to report.
- Log every alert in AlertLog and don't repeat the same alert for the same product more than
  once every 3 days unless the status gets worse.
- In the app: an alert banner on every page with the count of urgent items.
- Function `installTriggers()` that creates the daily trigger once (no duplicates).

### 4.8 Reports
- Sales by month and channel, top sellers, slow movers (no sales in 60 days, with stock value
  tied up), stock value by category, count variance summary. All exportable to CSV.

### 4.9 Data import (for the first load and for history)
- Import page that accepts CSV files for Products, opening stock (as OPENING movements),
  and historical Movements.
- Provide downloadable CSV templates with the exact headers.
- Preview the rows, show validation errors per row (unknown SKU, bad date, non-number qty),
  and only import when there are no errors. Import in batches so Apps Script doesn't time out.
- Include a **name-mapping step**: if an imported name doesn't match a SKU, let the user map it
  once and remember the mapping (sales files use different names than the inventory sheet).

## 5. API (Apps Script)

Single endpoint. Request body: `{ key, action, payload }`. Response: `{ ok, data, error }`.
Actions: `getBootstrap` (products, settings, suppliers, stock summary with forecasts),
`listMovements`, `addMovements`, `reverseMovement`, `saveCount`, `upsertProduct`,
`setProductActive`, `upsertSupplier`, `updateSettings`, `importRows`, `getReport`.
Compute stock and forecasts on the server from Movements so the email job and the app always
agree. Cache the stock summary with `CacheService` for a few minutes and clear it on any write.

## 6. Non-functional requirements

- Mobile friendly (works at 375px wide), large tap targets on the movement form.
- Fast: the dashboard should load in one API call (`getBootstrap`).
- Clear error messages in plain language; loading states on every button.
- Accessible: labels on inputs, status shown with text and color.
- Code a beginner can maintain: small files, comments explaining *why*, no clever abstractions.

## 7. Project structure

```
sunspectra-inventory/
  README.md              setup, deploy, and "how to fix common problems" guide for the client
  SPEC.md                this file
  CLAUDE.md              short summary of the project, decisions, and what's done / next
  backend/
    Code.gs              doGet/doPost router, auth, LockService
    Setup.gs             setup(), installTriggers(), sample data loader
    Data.gs              read/write helpers for each tab
    Forecast.gs          copy of backend/forecast.js (pure functions)
    Alerts.gs            dailyAlertJob()
    forecast.js          pure forecast functions (source of truth, Node-testable)
    appsscript.json
  frontend/
    index.html
    styles.css
    config.example.js    API URL placeholder
    js/                  api.js, i18n.js, dashboard.js, products.js, movements.js,
                         counts.js, reorder.js, reports.js, import.js, utils.js
  templates/             CSV import templates
  tests/forecast.test.js
  .gitignore
```

## 8. How to work

1. Read this spec, then reply with a short build plan by phase and any questions. Wait for my OK.
2. Initialize git and create `.gitignore` and `CLAUDE.md` first.
3. Build in this order, and after each phase make sure it works, update `CLAUDE.md`
   (done / next), and **commit with a clear message**:
   - Phase 1: Sheet setup script, API with auth, products CRUD, movements entry and history,
     current stock on the dashboard.
   - Phase 2: forecasting functions + unit tests, dashboard "Needs attention", product detail
     charts, reorder plan.
   - Phase 3: daily email alerts and in-app banner.
   - Phase 4: stock counts, CSV import with name mapping, reports, Spanish translation.
4. Load realistic sample data (about 15 products and 90 days of movements, including a few
   products close to stockout) so I can test every screen. Provide a `clearSampleData()` function.
5. At the end, write the README with step-by-step setup for a non-developer: creating the Sheet,
   pasting the Apps Script files, setting the access key in Script Properties, deploying the web
   app, installing the trigger, putting the URL in `config.js`, and deploying to Cloudflare Pages.

Out of scope for now (list in README as future ideas): raw materials and production recipes
(bill of materials), multiple warehouse locations, supplier purchase orders with receiving,
barcode scanning, seasonality in the forecast, user roles.
