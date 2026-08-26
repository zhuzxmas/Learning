# Deploy (Cloudflare Pages — static Direct Upload)

The app is a **pure static SPA** — everything lives in `public/`
(`index.html`, `app.js`, `stock-realization.js`, `style.css`, `categories.js`, `msal-browser.min.js`).
There is no server-side code, so you can deploy by simply uploading a zip in the
Cloudflare dashboard. No GitHub repo, no Node/npm/wrangler needed.

---

## Step 0 — Set Client ID + folder share link FIRST

Open `public/app.js` and set:
```js
const CLIENT_ID = "YOUR-CLIENT-ID";
const FOLDER_SHARE_URL = "https://1drv.ms/f/...";  // EDIT share link of the
                                                   // Apps/SpendingTracker folder
```
To get the folder link: in OneDrive, right-click `Apps/SpendingTracker` →
**Share** → set **Can edit** → **Copy link**.

## Step 1 — Build the zip

```
powershell -NoProfile -ExecutionPolicy Bypass -File spending-tracker/tools/build_zip.ps1
```
This produces `spending-tracker/spending-tracker-public.zip` containing exactly
the static files:
```
app.js  stock-realization.js  categories.js  index.html  msal-browser.min.js  style.css
```
(You can also just skip the zip and drag the raw files from `public/` in Step 2.)

## Step 2 — Direct Upload to Cloudflare Pages

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages**
   → **Upload assets** (Direct Upload).
2. Give the project a name, then upload `spending-tracker-public.zip`
   (or drag the files from `public/`).
3. **Deploy.** You get a URL like `https://<proj>.pages.dev`.

To update later: open the project → **Create deployment** → upload the new zip.

## Step 3 — Attach a.cnmas.top

1. If an OLD project still holds the domain, remove `a.cnmas.top` from it first
   (its **Custom domains** / **Domains & Routes**).
2. This project → **Custom domains** → **Set up a custom domain** →
   `a.cnmas.top` → **Activate**. DNS is created automatically (zone is in your
   account).

## Step 4 — Azure redirect URI + permissions

Azure app registration → **Authentication** → **SPA** redirect URIs: ensure
`https://a.cnmas.top` is listed (add the `*.pages.dev` URL too only if testing
there). **API permissions → Microsoft Graph → Delegated:** `User.Read`,
`Files.ReadWrite`, `Files.ReadWrite.All`.

## Step 5 — Verify

Open https://a.cnmas.top → **使用 Microsoft 登录** → add / view records. On the
very first load, if only a legacy `records.json` exists in the folder, the app
splits it automatically (`正在拆分历史数据…`), then the folder holds
`records-current.json` and `records-archive.json`.

---

## Note on wrangler.toml

`wrangler.toml` is left over from an earlier CLI/Worker layout and is IGNORED by
Direct Upload. It can be deleted; it has no effect on this static deployment.
