# SunSpectra Inventory: complete handover guide

How to move the app from Siddart's accounts to the client, step by step. Steps are numbered from 1 to
the end so they can be referred to on a call. Each step says who does it:
**[Siddart]**, **[Client]** or **[Claude]** (the assistant working with Siddart on this Mac).
Google screens can look slightly different by language or account type, so use the names in bold as a guide.

## What is handed over

Today everything runs on Siddart's accounts:
- **Google Sheet + Apps Script:** the data, the API, the daily email and the access key. This always moves to the client.
- **Website on Netlify** (currently dainty-crepe-a910be.netlify.app): what people open.
- **GitHub repo** (siddartmaddi/sunspectra-inventory): the code that Netlify publishes.
- **frontend/config.js:** the one line that connects the website to the Google script.

Choose before starting:
- **Path A, Siddart keeps hosting:** only Google moves. GitHub and Netlify stay with Siddart, who stays responsible for website updates. Skip Part 4B.
- **Path B, full handover:** GitHub and Netlify move to the client too. Skip Part 4A.

Nothing secret is stored in the repo (the access key lives only in Apps Script), so the repo can be handed over as it is.

## Part 1: Before you start
1. **[Siddart]** Decide Path A or B and tell the client what to prepare: a Gmail account and a laptop. For Path B also a GitHub username (free account) and a Netlify sign-up. Allow about 30 minutes for Path A, 60 for Path B.
2. **[Siddart]** Open the SunSpectra Inventory Sheet, click **Share** (top right), type her Gmail address, set **Viewer**, click **Send**.
3. **[Client]** Open the email, or Google Drive and **Shared with me**, and have the Sheet open.

## Part 2: The client's own Google copy (always)
4. **[Client]** On the Sheet, click **File** and **Make a copy**.
5. **[Client]** In the box, Name: **SunSpectra Inventory**, click **Make a copy**. A new tab opens: this copy is owned by her. Check that her account picture is top right. Everything from here happens in this copy.
6. **[Client]** Click **Extensions** and **Apps Script**. A code editor opens in a new tab.
7. **[Client]** In the left list ("Files"), click **Setup.gs**.
8. **[Client]** In the top bar, open the function dropdown, choose **setup**, click **Run**.
9. **[Client]** A box says **Authorization required**. Click **Review permissions** and choose her account.
10. **[Client]** A warning says **Google hasn't verified this app**. This is expected: it is her own script. Click **Advanced**, then **Go to SunSpectra Inventory (unsafe)**, then **Allow**.
11. **[Client]** At the bottom, the log should show **Execution completed**. A red error means stop and take a screenshot.
12. **[Client]** On the left bar, click the **gear icon (Project Settings)**.
13. **[Client]** Scroll to **Script Properties**, click **Add script property**. Property: `ACCESS_KEY`. Value: a long phrase only she chooses. Click **Save script properties**. She gives the key to Siddart privately, not in a group chat. Script properties and triggers do not come over with a copy, so this step is always needed.
14. **[Client]** On the left bar, click the **< > icon (Editor)** to go back to the code.
15. **[Client]** Click the blue **Deploy** button (top right) and **New deployment**.
16. **[Client]** Click the **gear icon** next to "Select type" and choose **Web app**.
17. **[Client]** Description: `v1`. **Execute as: Me** (her email). **Who has access: Anyone**. (The access key is what protects the data.)
18. **[Client]** Click **Deploy**. If asked to authorize again, repeat steps 9 and 10.
19. **[Client]** Click **Copy** next to **Web app URL** (it ends in `/exec`) and send it to Siddart.
20. **[Client]** Test: paste the URL in a new browser tab. It should say `{"ok":true,"data":{"status":"SunSpectra inventory API is running"}}`.
21. **[Client]** In the code editor, click **Alerts.gs**, choose **installTriggers**, click **Run**. Approve any new permission box the same way (steps 9 and 10). This schedules the daily email.
22. **[Client]** Click **Setup.gs**, choose **clearSampleData**, click **Run**. It removes only the made-up movements and counts. Products and suppliers stay.

## Part 3: Connect the website to her script (always)
23. **[Siddart]** Send Claude the new Web app URL.
24. **[Claude]** Replace `API_URL` in `frontend/config.js` with the new URL, commit and push. This is the only code change. The website republishes in about a minute (Path A: on Siddart's Netlify. Path B: the client's Netlify picks it up when she creates it in step 36).
25. **[Siddart]** Path A: open the website in a private window (Path B: do this after step 37). Sign in with a name and the client's new key. If the dashboard loads, the connection works. The old key must now be refused here.

## Part 4A: Path A, Siddart keeps hosting
26. **[Siddart]** Leave GitHub and Netlify as they are. In Netlify, check **Site configuration**, **Access & security**, **Visitor access** is still **Public**, otherwise the client cannot open the site.
27. **[Siddart]** Optional: **Site configuration**, **General**, **Change site name** for a nicer address such as `sunspectra-inventory.netlify.app`. The address changes, so do step 41 with the new one.
28. **[Siddart]** Tell the client the website address and agree who pays attention to it: updates to screens or labels need Siddart (push to GitHub, Netlify publishes). The free Netlify plan has monthly deploy credits, so changes should be grouped.

## Part 4B: Path B, GitHub and Netlify move too
29. **[Client]** Create a free account at github.com (**Sign up**) and send Siddart the username.
30. **[Siddart]** Open github.com/siddartmaddi/sunspectra-inventory, **Settings**, **General**, scroll to **Danger Zone**, click **Transfer ownership**, enter her username and the repo name, confirm.
31. **[Client]** Open the email from GitHub about the transfer and accept it. The repo is now hers.
32. **[Client]** In the repo, **Settings**, **Collaborators**, **Add people**, add `siddartmaddi` with write access, so Siddart and Claude can keep helping. Skip this if no further help is wanted.
33. **[Claude]** Point the Mac's git at the new address (`git remote set-url origin ...`) and test a push (needs step 32). The old address forwards for a while.
34. **[Client]** Go to app.netlify.com and **Sign up** with GitHub.
35. **[Client]** Click **Add new site**, **Import an existing project**, **GitHub**, allow Netlify to read her repositories, pick **sunspectra-inventory**.
36. **[Client]** Branch `main`, Base directory empty, Build command empty, Publish directory `frontend`. Click **Deploy**. (The repo's `netlify.toml` already says this.)
37. **[Client]** **Site configuration**, **Access & security**, **Visitor access**: choose **Customize this project's visibility**, **Public**, applies to **Production and previews**, **Save**. Without this the site asks for a Netlify login.
38. **[Client]** Optional: **Site configuration**, **General**, **Change site name**. Send Siddart the final website address.
39. **[Siddart]** After Part 8 passes on her site, delete the old Netlify site (**Site configuration**, **General**, **Danger zone**, **Delete site**).

## Part 5: First sign-in and settings
40. **[Client]** Open the website address, sign in with her name and the new access key. The name is saved next to every change she makes.
41. **[Client]** Open **Settings**. Fill in **Company name**, **Alert email(s)** (several separated by commas), **Alert hour** (0 to 23, default 7, Costa Rica time) and **App address** (the final website address, used for the link in the daily email). Click **Save**. These values were copied from Siddart's Sheet, so change them.
42. **[Client]** Further down in Settings, **Suppliers**: click **Edit** or **Add supplier** and enter real contact names, emails and phones.
43. **[Client]** If the alert hour was changed, run **installTriggers** again (step 21).
44. **[Client]** Optional test: in Apps Script, **Alerts.gs**, choose **previewAlertEmail**, **Run**, open the **Execution log** to read what the email would say. No email is sent on days with nothing to report.

## Part 6: Real business numbers (the forecast depends on them)
45. **[Client]** Open the Sheet's **Movements** and **Counts** tabs and check for leftover test rows (anything entered by "Tester" or Siddart while trying things). The simplest clean-up is to delete those rows in the Sheet once, now, before real data goes in. Never delete rows later: use **Reverse** in the app.
46. **[Client]** **Products**, **Edit** each product: replace **Unit cost (USD)**. The sample list used 30% of the retail price as a placeholder, so inventory value and order costs are wrong until this is done.
47. **[Client]** On each product also set **Lead time (days)**, **Minimum order / batch size** and **Target cover (days)** (default 60). The current values are first guesses.
48. **[Client]** Tick **Show deactivated** and check that the three discontinued Opticks Powders are inactive.
49. **[Client]** Load starting stock: **Import**, choose **Opening stock**, **Download template**, fill date, sku and qty, upload and **Import**. Or use **Record** with type **Opening stock**.
50. **[Client]** Do a first **Counts**: count the shelf, type the numbers, **Save count**. Differences are fixed automatically.
51. **[Client]** In **Settings**, decide whether **Count samples as demand in the forecast** (off by default).

## Part 7: Clean up the old copy
52. **[Siddart]** In Siddart's old Apps Script: **Deploy**, **Manage deployments**, **Archive** the web app deployment. After this the old URL stops answering.
53. **[Siddart]** In the old script, click the **clock icon (Triggers)**, open the menu on the `dailyAlertJob` row, **Delete trigger**. Otherwise the old copy may keep sending emails.
54. **[Siddart]** Keep the old Sheet as a backup or delete it in Google Drive (it holds the sample data).
55. **[Claude]** Sign clasp out on the Mac (`clasp logout`) and remove the local `.clasp.json`, so the Mac no longer has access to Siddart's script.
56. **[Claude]** Update the deployment section of `CLAUDE.md` so it no longer points at Siddart's accounts.

## Part 8: Final check
- [ ] The website address opens without a Netlify login.
- [ ] Sign-in works with the client's new key; the old key is refused.
- [ ] Dashboard shows the client's real products and no sample movements.
- [ ] Record a test sale, see the stock drop, then **Reverse** it.
- [ ] Settings show her alert email and the final website address.
- [ ] In Apps Script, **Triggers** shows one `dailyAlertJob`, and the first email arrives from her Gmail.
- [ ] Unit costs, lead times and batch sizes are real, not the placeholders.
- [ ] Old deployment archived, old trigger deleted.

## Part 9: Looking after it afterwards
- **Website changes** (screens, labels, colors, Spanish text): push to GitHub and Netlify publishes in about a minute. Under Path A this is Siddart's account; under Path B the client's.
- **Backend changes** (saving data, forecasts, emails): Google keeps running the old code until a new version is published by the account that owns the script, now the client. The simplest way: Siddart or Claude sends the changed `.gs` files, she pastes them into Apps Script and publishes with **Deploy**, **Manage deployments**, the **pencil icon**, **Version: New version**, **Deploy**. The URL stays the same.
- **Costs:** Google, GitHub (private repo) and Netlify are used on free plans.
- **Safety copy:** now and then, **File** and **Make a copy** of the Sheet in Google Drive.

## If something goes wrong
- **"Authorization required" keeps appearing:** she is not signed in as the owner of the copy. Check the account picture top right.
- **Red error about a missing tab:** run **setup** again (step 8).
- **The web app URL shows a Google sign-in page:** step 17 was not set to **Anyone**. Fix it in **Deploy**, **Manage deployments**, **pencil icon**, **Who has access: Anyone**, **Deploy**.
- **The website says the access key is wrong:** check `ACCESS_KEY` in Project Settings, **Script Properties**. It is case-sensitive.
- **The website asks for a Netlify login:** step 26 or 37, Visitor access must be **Public**.
- **The website says it is not connected:** `config.js` still has the old URL (step 24).
- **No daily email:** check Settings has an alert email, check **Triggers** has `dailyAlertJob`, check spam. Remember: nothing is sent on days with nothing new.
- **The site shows an old version after an update:** reload with Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows).
