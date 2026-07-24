# Deploy without any local tools (Cloudflare dashboard upload)

No Node.js / npm / wrangler needed. You upload the static files through the
Cloudflare dashboard (Cloudflare Pages, Direct Upload) and attach `a.cnmas.top`.

## Step 0 — Set Client ID + folder share link FIRST
1. Open `public/app.js` and set:
   ```js
   const CLIENT_ID = "YOUR-CLIENT-ID";
   const FOLDER_SHARE_URL = "https://1drv.ms/f/...";  // EDIT share link of the
                                                      // Apps/SpendingTracker folder
   ```
   To get the folder link: in OneDrive, right-click `Apps/SpendingTracker` →
   **Share** → set **Can edit** → **Copy link**.
2. Re-create the zip (PowerShell):
   ```
   Compress-Archive -Path 'spending-tracker/public/*' -DestinationPath 'spending-tracker/spending-tracker-public.zip' -Force
   ```
   (If you upload before setting CLIENT_ID, the app will show
   "尚未配置 CLIENT_ID". If FOLDER_SHARE_URL is empty it runs in owner mode
   against your own OneDrive.)

## Step 1 — Create the Pages project
1. Go to https://dash.cloudflare.com → **Workers & Pages**.
2. Click **Create** → **Pages** tab → **Upload assets** (a.k.a. Direct Upload).
3. Project name: e.g. `spending-tracker` → **Create project**.
4. Drag **`spending-tracker-public.zip`** onto the upload area (or select the
   files inside `public/`). Make sure `index.html` is at the TOP level of what
   you upload (upload the *contents* of `public/`, not the `public` folder itself).
5. Click **Deploy site**. You'll get a temp URL like
   `https://spending-tracker.pages.dev` — test login there first if you added
   that URL as an Azure redirect URI, otherwise go straight to custom domain.

## Step 2 — Attach a.cnmas.top
1. In the project → **Custom domains** → **Set up a custom domain**.
2. Enter `a.cnmas.top` → **Continue** → **Activate domain**.
   Because the zone is already in your Cloudflare account, the DNS record is
   created automatically. Wait ~1 min for it to go active.

## Step 3 — Azure redirect URI + permissions
In your Azure app registration → **Authentication** → SPA redirect URIs, make
sure `https://a.cnmas.top` is listed. (Add the `*.pages.dev` URL too only if you
want to test there.) Under **API permissions** → **Microsoft Graph → Delegated**,
ensure `User.Read`, `Files.ReadWrite`, and `Files.ReadWrite.All` are present
(`Files.ReadWrite.All` is required to access the folder shared by the other user).

## Step 4 — Test
Open https://a.cnmas.top → **使用 Microsoft 登录** → sign in with a personal
Microsoft account → add a record (it auto-saves). Reload to confirm it persisted.

On the very first load, if only a legacy `records.json` exists in the folder, the
app splits it automatically — you'll see `正在拆分历史数据…` then the record count.
Afterwards the folder contains `records-current.json` and `records-archive.json`.

## Updating later
Any time you change files in `public/`: re-zip (Step 0.2) and in the Pages
project click **Create deployment** → upload the new zip. The custom domain and
Azure settings stay as-is.

## Note on wrangler.toml
`wrangler.toml` is only used for the CLI/wrangler path. With dashboard Direct
Upload you can ignore it.
