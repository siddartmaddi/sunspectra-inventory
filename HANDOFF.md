# Handing SunSpectra Inventory over to the client

Everything the app depends on currently lives on **Siddart's accounts**. This is the full list of
what to move or change. Nothing secret is stored in the repo (the access key lives only in Apps
Script), so the repo itself can be handed over as it is.

Legend: **[Me]** = Claude can do it from Siddart's Mac once the needed access exists.
**[Client]** = must be done by the client, signed in to their own account (permission screens,
passwords and "Run" approvals can't be done for them).

## What lives where today

| Piece | Today | Where it is referenced |
|---|---|---|
| Google Sheet + Apps Script (the data and the API) | Siddart's Google account (maddisiddart@gmail.com) | `frontend/config.js` (web app URL) |
| Access key | `ACCESS_KEY` in that script's Script Properties | typed on the app's sign-in screen |
| Daily email trigger | created by Siddart in that script | Apps Script → Triggers |
| Website | Netlify site `dainty-crepe-a910be` on Siddart's Netlify | **Settings → App address** (link in emails) |
| Code | GitHub repo `siddartmaddi/sunspectra-inventory` | Netlify deploys from it |
| `clasp` (uploads backend code from the Mac) | logged in as Siddart; `.clasp.json` (not in git) points at Siddart's script | only on Siddart's Mac |

## Recommended order

### 1. GitHub: give the client the repo
- **[Client]** Create a free GitHub account (or use theirs).
- **[Siddart]** Repo → Settings → Danger Zone → **Transfer ownership** to the client's username. The
  client accepts by email. Then the client adds Siddart as a **collaborator** (Settings →
  Collaborators) so updates can still be pushed.
- Easier alternative: keep the repo with Siddart and only add the client as a collaborator.
- **[Me]** After a transfer, repoint the local git remote and check that pushing still works.

### 2. Google: client's own Sheet, script, key and trigger
Details are in README "Moving the app to another Google account". Summary:
1. **[Siddart]** Share the current Sheet with the client (Viewer is enough).
2. **[Client]** Open it → **File → Make a copy**. The copy has all data and the script code and is
   owned by the client. (Copies get a *new* script and a *new* web app URL.)
3. **[Client]** In the copy: **Extensions → Apps Script**, then:
   - Run **setup** (safe to repeat), approve permissions
     (**Advanced → Go to SunSpectra Inventory → Allow**).
   - Set a **new `ACCESS_KEY`**: Project Settings → Script Properties. Script properties and
     triggers do not come over with a copy, so always set them again.
   - **Deploy → New deployment → Web app**: Execute as **Me**, access **Anyone**. Copy the URL
     (ends in `/exec`).
   - Run **installTriggers** (daily email).
   - Open the URL in a browser: it should say `SunSpectra inventory API is running`.
4. **[Client]** Run **clearSampleData** (removes only the made-up movements and counts and the
   alert log; products and suppliers stay). Then look through **Movements** and **Counts** for
   leftover test entries (anything entered by "Tester" or by Siddart while trying things) and
   remove them from the Sheet with the app's Reverse, or ask Claude to help.

Note: the daily email is sent from the account that owns the script, so it will come from the
client's Gmail.

### 3. Website points to the new backend
- **[Me]** Replace `API_URL` in `frontend/config.js` with the client's new `/exec` URL, commit and
  push (needs the URL from step 2). This is the only code change.
- **[Me]** Check the live API and the site afterwards.

### 4. Netlify: site under the client's account
- **Option A, transfer:** **[Siddart]** Site configuration → General → transfer the site to the
  client's Netlify team (the client needs a Netlify account; if you can't find the option, use B).
- **Option B, new site (recommended, 2 minutes):** **[Client]** Sign up at app.netlify.com with
  GitHub → Add new site → Import an existing project → the repo → branch `main`, build command
  empty, publish directory `frontend` (the repo's `netlify.toml` already says this). Then
  Site configuration → **Access & security → Visitor access → Public** (otherwise only the client's
  Netlify team can open it).
- **[Client]** Optional: Site configuration → General → **Change site name**, so the address looks
  like `sunspectra-inventory.netlify.app`. The address changes, so repeat step 5 after.
- **[Siddart]** When the client's site works, delete or pause the old Netlify site.
- Netlify's free plan has monthly deploy credits; `netlify.toml` skips deploys unless `frontend/`
  changed. Cloudflare Pages (README step 8) is an alternative if credits run short.

### 5. Settings inside the app (copied from Siddart's Sheet, change them)
**[Client]** Sign in with the new key, open **Settings**:
- **Alert email(s)**: the client's address(es).
- **App address**: the client's final website address (used for the link in the email).
- **Company name**, **Alert hour** (default 7 am Costa Rica), service level and forecast settings
  as wanted. If you change the alert hour later, run **installTriggers** again.
- Suppliers: add real contact names, emails and phones.

### 6. Real business numbers (the forecast depends on these)
**[Client]** On **Products**, for every product replace the estimated values:
- **Unit cost**: the sample list used ~30% of retail as a placeholder. Wrong costs mean a wrong
  inventory value and wrong order costs.
- **Lead time (days)** and **minimum order / batch size**: currently first guesses (7–30 days).
- **Target cover (days)** (default 60), supplier, and anything else that differs. Check that the
  three discontinued Opticks Powders stay inactive.
- Load the real starting stock with **Import → Opening stock** (or **Record → Opening stock**),
  then do a first **Counts** to confirm it matches the shelf.
- Decide whether samples should count as demand (**Settings**, off by default).

### 7. Keeping the app maintained afterwards
- Website changes (`frontend/`): push to GitHub, Netlify publishes in about a minute.
- Backend changes (`.gs` files) need to be uploaded and a new version of the web app published *by
  the account that owns the script*. Today that is Siddart's login on this Mac; after the handoff
  it would have to be the client's. Options: **[Client]** signs in to `clasp` on the Mac when a
  change is needed (**[Me]** then creates a new `.clasp.json` for the client's script and runs
  `clasp push` and a new deployment), or the client pastes updated files into Apps Script by hand
  (README "Making changes later"). If the client wants Siddart to keep helping, they can share
  the Sheet with Siddart as Editor.
- **[Me]** After the handoff, update `CLAUDE.md` (deployment section) so it stops pointing at
  Siddart's accounts.

### 8. Shut down the old copy
**[Siddart]** In Siddart's old script: **Deploy → Manage deployments → Archive**, and delete the
`dailyAlertJob` trigger (Triggers → clock icon). Otherwise the old copy keeps answering and may
keep sending daily emails. Keep or delete the old Sheet; it still has the sample data. Optionally
run `clasp logout` on the Mac.

## Final check before telling the client it's live
- [ ] Client's site address opens without a Netlify login.
- [ ] Sign-in works with the client's **new** key; the **old** key no longer works.
- [ ] Dashboard shows the client's real products and no sample movements.
- [ ] Record a test sale, see stock drop, then **Reverse** it.
- [ ] Settings: alert email and app address are the client's.
- [ ] Run **previewAlertEmail** in Apps Script and read the log; confirm a trigger exists in
      Triggers (one `dailyAlertJob`).
- [ ] Costs, lead times and batch sizes are real (not the 30% placeholder).
- [ ] Old script archived, old trigger deleted.

## Not in the repo (needs a decision)
`docs/SOP.pdf` is an untracked file in the project folder that this project did not create. It
hasn't been committed; decide whether it belongs in the repo before the client gets access.
