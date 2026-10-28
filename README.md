# SunSpectra Inventory

A simple inventory app for SunSpectra. It tracks stock for every product, warns you before
things run out, keeps a record of *why* stock changed, and tells you when and how much to reorder.

- **Your data** lives in a Google Sheet that you own (one tab per table).
- **The "server"** is a small Google Apps Script attached to that Sheet.
- **The website** is a few plain files hosted for free on Cloudflare Pages.

Nothing here costs money and nothing needs to be installed to use the app.

---

## Contents

1. [Set it up (about 30 minutes, once)](#1-set-it-up)
2. [Everyday use](#2-everyday-use)
3. [How to fix common problems](#3-how-to-fix-common-problems)
4. [Making changes later](#4-making-changes-later)
5. [For developers](#5-for-developers)
6. [Future ideas](#6-future-ideas)

---

## 1. Set it up

### Step 1: Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **blank spreadsheet**.
2. Name it, for example, **SunSpectra Inventory**.
3. Open **File → Settings** and set the time zone to **(GMT-06:00) Central Time - Costa Rica**.

### Step 2: Paste the Apps Script files

1. In the Sheet, open **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
2. Click the project name at the top ("Untitled project") and rename it **SunSpectra Inventory**.
3. For **each** file in the `backend` folder of this project, create a file with the same name and
   paste the whole content:

   | File in this project      | Name in Apps Script |
   |---------------------------|---------------------|
   | `backend/Code.gs`         | `Code`              |
   | `backend/Data.gs`         | `Data`              |
   | `backend/Stock.gs`        | `Stock`             |
   | `backend/Movements.gs`    | `Movements`         |
   | `backend/Products.gs`     | `Products`          |
   | `backend/Counts.gs`       | `Counts`            |
   | `backend/Import.gs`       | `Import`            |
   | `backend/Reports.gs`      | `Reports`           |
   | `backend/Alerts.gs`       | `Alerts`            |
   | `backend/Setup.gs`        | `Setup`             |
   | `backend/Forecast.gs`     | `Forecast`          |

   To add a file: click **+** next to "Files" → **Script**, type the name (without `.gs`), then
   select everything in the new file and paste. `Code` already exists: replace its content.
4. Show the manifest: click the **gear icon (Project Settings)** → tick
   **Show "appsscript.json" manifest file in editor**. Go back to the editor (`< >` icon), open
   `appsscript.json` and replace its content with `backend/appsscript.json`.
5. Click the **save icon** (or press Ctrl+S / Cmd+S).

### Step 3: Create the tabs

1. At the top of the editor, choose **setup** in the function list and click **Run**.
2. Google asks for permission the first time. Click **Review permissions**, choose your account.
   If you see "Google hasn't verified this app", click **Advanced → Go to SunSpectra Inventory**.
   This is your own script, so this is safe.
3. Go back to the Sheet: you will see the tabs Products, Movements, Counts, Suppliers, Settings,
   AlertLog and NameMap.

`setup()` is safe to run again at any time. It only adds what is missing.

### Step 4 (optional): Load the sample data

To try every screen with realistic numbers, run **loadSampleData** the same way. It adds:

- SunSpectra's real product list (33 products; the 3 Opticks Powders are discontinued and inactive),
- the suppliers,
- 90 days of made-up sales, production and two stock counts. A few products are out of stock or
  about to run out on purpose.

When you're ready to use real data, run **clearSampleData**. It removes the made-up movements and
counts, and keeps the products and suppliers.

> **Important:** the unit costs in the product list are estimates (30% of the retail price) because
> the real costs weren't shared. Lead times and batch sizes are also first guesses. Update them on
> the **Products** page: the forecast and the inventory value depend on them.

### Step 5: Set the access key

The access key is the password everyone types to use the app.

1. In Apps Script, click the **gear icon (Project Settings)**.
2. Scroll to **Script Properties** → **Add script property**.
3. Property: `ACCESS_KEY`. Value: a long phrase that is hard to guess (for example
   `coral-reef-sunrise-2026-tamarindo`). Click **Save script properties**.

The key is never stored in the website files. To change it later, edit it here; everyone then
needs to log in again with the new key.

### Step 6: Publish the script as a web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Description: `v1`. **Execute as: Me**. **Who has access: Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
5. Check it works: paste the URL in a browser. You should see
   `{"ok":true,"data":{"status":"SunSpectra inventory API is running"}}`.

"Anyone" is needed so the website can reach the script. Your data stays protected by the
access key: without it the script answers `unauthorized`.

### Step 7: Put the URL in `config.js`

1. Open `frontend/config.js` (on GitHub: open the file → pencil icon to edit).
2. Replace the placeholder URL with your Web app URL:
   ```js
   export const API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
3. Save (on GitHub: **Commit changes**).

### Step 8: Publish the website on Cloudflare Pages

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, and connect your GitHub account.
3. Pick the repository **sunspectra-inventory**.
4. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`frontend`**
5. Click **Save and Deploy**. After a minute you get an address like
   `https://sunspectra-inventory.pages.dev`.
6. Open it, enter your name and the access key. Done!

From now on, every change pushed to GitHub is published automatically.

### Step 9: Turn on the daily email

1. In the app, open **Settings** and fill in:
   - **Alert email(s)**: where the daily email goes (several addresses separated by commas).
   - **Alert hour**: the hour it arrives (default 7, Costa Rica time).
   - **App address**: your Cloudflare address, so the email can link to the app.
   Click **Save**.
2. In Apps Script, choose **installTriggers** and click **Run** (allow the new permissions).
3. To check what the email will look like without sending it, run **previewAlertEmail** and
   open **Execution log**.

The email is sent only when there is something to report: products out of stock, to reorder now,
or running low. The same product is repeated at most every 3 days, unless its situation gets worse.
If you change the alert hour, run **installTriggers** again (it never creates duplicates).

---

## 2. Everyday use

| I want to… | Go to |
|---|---|
| Record a sale, a delivery, production, damage or samples | **Record**. Use one form per order, with a line per product. |
| Fix a mistake | **History** → **Reverse** on the wrong line, then record the right one. Nothing is ever deleted. |
| See what needs attention | **Dashboard** (the red banner on every page also counts urgent products) |
| Know what to order and how much | **Reorder** → adjust quantities → **Export CSV** to send to suppliers |
| Count the storeroom | **Counts** → type what you counted → **Save**. Differences are fixed automatically. |
| Load old sales or a stock list | **Import** → download the template → fill it → upload |
| Add or change a product | **Products** → **Add product** or **Edit** (deactivate instead of deleting) |
| Change the email, alert hour or forecast settings | **Settings** |

**Data checks on the Record form**

- It won't save if stock would go below zero, unless you tick "Allow negative stock" and say why.
- It warns when a quantity is much bigger than usual (for example 1,089 instead of 108).

**What the statuses mean**

| Status | Meaning |
|---|---|
| **OUT** (red) | Nothing left. |
| **REORDER NOW** (orange) | Stock is at or below the reorder point, or will run out before a new batch could arrive. |
| **LOW** (amber) | Will run out within the warning days (default 14) plus the lead time. |
| **OK** (green) | Enough stock. |

Each product page explains in plain words how its forecast was calculated.

---

## 3. How to fix common problems

**"The app is not connected yet: put the Apps Script URL in config.js"**
→ Step 7 wasn't done, or the change hasn't been published yet. Check `frontend/config.js` on GitHub.

**"The access key is wrong or has changed"**
→ Check the key in Apps Script → Project Settings → Script Properties (`ACCESS_KEY`). It is
case-sensitive.

**"The access key has not been set up yet"**
→ Do Step 5.

**"Could not reach the server"**
→ Check the internet connection. If it keeps happening, open the Web app URL in a browser (Step 6.5).

**I changed the Apps Script code but the app still behaves the old way**
→ Apps Script keeps serving the old version until you publish a new one:
**Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.

**"The 'Movements' tab is missing. Run setup()"**
→ A tab was deleted or renamed. Run `setup()` again.

**"Tab 'X' column N is 'Y' but should be 'Z'"**
→ Someone edited the header row in the Sheet. Put the header back as the message says, then run `setup()`.

**The daily email doesn't arrive**
→ Check: Settings has an alert email; `installTriggers` was run (Apps Script → **Triggers**, the
clock icon, should show one `dailyAlertJob`); the spam folder. Apps Script → **Executions** shows
each run and any error. Remember: no email is sent on days with nothing new.

**"Someone else is saving right now"**
→ Two people saved at the same second. Wait a few seconds and save again.

**A product's numbers look wrong**
→ Open the product page: the forecast explains each number. Check its lead time and batch size, and
look at **History** filtered by that product for a wrong quantity (then **Reverse** it).

**Can I edit the Sheet by hand?**
→ Reading it is fine. Avoid editing it: the app can't check hand edits for mistakes. Never edit
the header row or delete rows in Movements. To fix a movement, use **Reverse** in the app.

**The site shows an old version after an update**
→ Reload the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows).

### Moving the app to another Google account (handoff)

The app was first set up on a developer's Google account. To move it to the owner's account:

1. While signed in as the **new owner**, open the Sheet (it must be shared with her) and choose
   **File → Make a copy**. The copy includes all data and the Apps Script code.
2. In the copy, open **Extensions → Apps Script** and do Steps 3, 5, 6 and 9 above (run `setup`,
   set her own `ACCESS_KEY`, deploy a new web app, run `installTriggers`).
3. Put the new Web app URL in `frontend/config.js` (Step 7) and commit. Cloudflare publishes it.
4. Everyone logs in again with the new key. In the old Apps Script, archive the old deployment
   (**Deploy → Manage deployments → Archive**) and delete its trigger, so the old copy stops
   answering and stops emailing.

---

## 4. Making changes later

- **Labels and translations:** all texts are in `frontend/js/i18n.js` (English and Spanish).
- **Colors:** at the top of `frontend/styles.css`.
- **Forecast rules:** `backend/forecast.js`. After changing it, copy it over `backend/Forecast.gs`
  (they must be identical), paste the new `Forecast` into Apps Script, and publish a new version.
- **Any backend (`.gs`) change:** paste the file into Apps Script, then publish a new version
  (see "I changed the Apps Script code" above).
- **Any frontend change:** commit to GitHub; Cloudflare publishes it in about a minute.

---

## 5. For developers

You need [Node.js](https://nodejs.org) 18 or newer, only for tests and the local server. The site
itself has no build step and no dependencies.

```sh
node --test                    # all tests (forecast math, API, alerts, translations)
node dev/server.js             # app at http://localhost:8787 with sample data, access key: dev-key
node dev/server.js --reset     # same, starting again from fresh sample data
```

Pushing the backend with [clasp](https://github.com/google/clasp) instead of copy-paste:
`npm install -g @google/clasp`, `clasp login`, then from the repo root `clasp push` (uses
`.clasp.json`, which is not committed because it points at one person's script; `.claspignore`
keeps `forecast.js` out because `Forecast.gs` is its copy). After pushing, publish a new version
of the deployment so the web app uses the new code.

`dev/server.js` runs the real `backend/*.gs` files in Node against a fake spreadsheet
(`dev/fake-apps-script.js`, data saved in `dev/data.json`), so you can try changes without Google.

Project layout:

```
backend/        Apps Script files (paste into the Sheet's script project)
  forecast.js   forecast math, source of truth; Forecast.gs must be an identical copy
frontend/       the website (Cloudflare Pages output directory)
  templates/    CSV import templates (served by the site)
  _headers      tells Cloudflare not to let browsers keep old files
dev/            local development server and fake Apps Script
tests/          node --test
CLAUDE.md       project notes and decisions
SPEC.md         original specification
```

API: one POST endpoint, body `{ key, user, action, payload }`, sent as `text/plain` so browsers skip
the CORS preflight that Apps Script can't answer. Answer: `{ ok, data }` or `{ ok: false, error }`.
Actions: `getBootstrap`, `listMovements`, `getProductDetail`, `addMovements`, `reverseMovement`,
`saveCount`, `listCounts`, `upsertProduct`, `setProductActive`, `upsertSupplier`, `updateSettings`,
`importRows`, `getReport`.

---

## 6. Future ideas

Not built yet, but the design leaves room for them:

- Raw materials and production recipes (bill of materials): know which ingredients each batch uses
  and when to reorder them (the raw-material lead times are already in the original spreadsheet).
- Multiple storage locations (storeroom, stores on consignment, fairs).
- Supplier purchase orders with receiving (ordered → partly received → received).
- Barcode scanning on the phone for the Record and Counts screens.
- Seasonality in the forecast (high and low tourist seasons).
- User roles (for example, someone who can record sales but not change products or settings).
