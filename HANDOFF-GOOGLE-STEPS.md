# Google handover: steps to read out on the call

About 15 minutes. She needs a Google account (Gmail) and a laptop. The Google screens look slightly
different depending on language or account type, so use the names in **bold** as a guide.

## Before the call (Siddart)
1. Open the SunSpectra Inventory Sheet.
2. Click **Share** (top right), type her Gmail address, set **Viewer**, click **Send**.
3. Ask her to open the email, or Google Drive → **Shared with me**, and have it open before the call.

## Part 1: make her own copy of the Sheet
1. On the Sheet, click **File → Make a copy**.
2. A box appears. Name: **SunSpectra Inventory**. Click **Make a copy**.
3. A new tab opens with her copy. From now on everything happens in this copy (check that it says
   "Copy of..." or the name she typed, and that her account picture is top right).

## Part 2: open the code and approve it
4. In her copy, click **Extensions → Apps Script**. A new tab opens with a code editor.
5. In the left list ("Files"), click **Setup.gs**.
6. In the top bar there is a dropdown showing a function name. Choose **setup**, then click **Run**.
7. A box says **Authorization required**. Click **Review permissions** and choose her account.
8. A warning says **Google hasn't verified this app**. This is expected: it is her own script.
   Click **Advanced**, then **Go to SunSpectra Inventory (unsafe)**, then **Allow**.
9. At the bottom, the log should show **Execution completed**. If it shows a red error, stop and
   screenshot it.

## Part 3: set her access key (the password for the app)
10. On the left bar, click the **gear icon (Project Settings)**.
11. Scroll to **Script Properties** and click **Add script property**.
12. **Property:** `ACCESS_KEY`. **Value:** a long phrase only she chooses, for example four or five
    words. Click **Save script properties**.
13. She should write it down and give it to Siddart privately (not in a group chat).

## Part 4: publish it as a web app
14. On the left bar, click the **< > icon (Editor)** to go back to the code.
15. Click the blue **Deploy** button (top right) → **New deployment**.
16. Click the **gear icon** next to "Select type" → **Web app**.
17. Description: `v1`. **Execute as: Me** (her email). **Who has access: Anyone**.
18. Click **Deploy**. If asked again to authorize, repeat step 7 and 8.
19. Click **Copy** next to **Web app URL** (it ends in `/exec`), and send it to Siddart. It's not a
    secret, but it is long, so use copy and paste.
20. Test it: she pastes the URL in a new browser tab. It should say
    `{"ok":true,"data":{"status":"SunSpectra inventory API is running"}}`.

## Part 5: turn on the daily email, clean the sample data
21. Back in the code editor, click **Alerts.gs** in the file list, choose **installTriggers** in the
    dropdown, click **Run**. Approve any new permission box the same way (steps 7 and 8). The log
    should say the daily alert was scheduled.
22. Click **Setup.gs**, choose **clearSampleData**, click **Run**. It removes only the made-up
    movements and counts. The products and suppliers stay.

## Afterwards (Siddart and Claude, not on the call)
- Siddart sends Claude the new Web app URL. Claude puts it in `frontend/config.js` and pushes.
- The site on Netlify updates in about a minute. Then she opens the site and signs in with her
  name and her new key, and Settings gets her alert email and the site address.
- Siddart archives his old deployment and deletes his old trigger (see `HANDOFF.md`, step 8).

## If something goes wrong
- **"Authorization required" keeps appearing:** she is not signed in as the account that owns the
  copy. Check the account picture in the top right.
- **Red error mentioning a missing tab:** run **setup** again (step 6).
- **Can't find "Make a copy":** she is on the shared view; she needs to be signed in to Google.
- **Web app URL shows a Google sign-in page:** step 17 was not set to **Anyone**. Redo
  **Deploy → Manage deployments → pencil icon → Who has access: Anyone → Deploy**.
