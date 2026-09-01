# Family Spending Tracker (家庭记账)

A single-page web app hosted on **Cloudflare Pages** (Direct Upload) at
`a.cnmas.top`. Both family members **sign in with their personal Microsoft
account** and the app reads/edits/auto-saves shared JSON files in **OneDrive**
via the Microsoft Graph API.

No passwords or secrets are stored. Auth happens entirely in the browser with
MSAL.js (OAuth 2.0 PKCE). Cloudflare Pages only serves static files.

## Project structure
```
spending-tracker/
├─ public/
│  ├─ index.html          # UI: login, add/edit form, records table
│  ├─ app.js              # MSAL sign-in + Graph I/O + logic (SET CLIENT_ID + FOLDER_SHARE_URL)
│  ├─ stock-realization.js # stock moving-average realized-profit engine
│  ├─ valuation.js         # browser AV/EPV calculations and sensitivity analysis
│  ├─ categories.js       # AUTO-GENERATED category tree (do not hand-edit)
│  ├─ msal-browser.min.js # bundled MSAL v3 library (loaded locally, not from CDN)
│  └─ style.css
├─ tools/
│  ├─ gen_categories.py   # regenerates categories.js from ../../SpendingCat.csv
│  └─ migrate_list.py     # converts a Microsoft Lists CSV export -> records.json
├─ spending-tracker-public.zip  # deployment artifact (rebuild after any edit)
└─ README.md
```

## Storage model (append-oriented, shared folder)

Data lives in a **shared OneDrive folder** `/Apps/SpendingTracker/`, split across
**two files** so day-to-day saves stay small:

| File | Holds | Written |
|------|-------|---------|
| `records-current.json` | the current calendar month | on every normal add (small, ~tens of KB) |
| `records-archive.json` | everything older | rarely (only when editing old rows or at month rollover) |

- **Both users edit the same folder** via one folder **edit** share link
  (`FOLDER_SHARE_URL` in `app.js`), so changes are shared live.
- **Auto-migration:** on first load, if only a legacy single `records.json`
  exists, the app splits it into the two files automatically.
- **Auto-rollover:** at load, records that are no longer current-month are folded
  from the hot file into the archive.
- **Concurrency-safe:** each file uses optimistic concurrency (ETag + `If-Match`).
  If two people save at the same instant, the second save merges its change onto
  the latest copy and retries — no lost records.

Each file has the same JSON shape:

## Data model (each `records-*.json` in OneDrive)
```json
{
  "records": [
    {
      "id": "uuid",
      "i_cat": "日常生活", "ii_cat": "餐饮", "iii_cat": "早饭",
      "amount": 42.50, "date": "2026-01-15",
      "note": "", "createdBy": "your name", "modified": "2026-01-15T09:00:00Z"
    }
  ]
}
```
The 一级/二级/三级 cascading dropdowns come from `categories.js`, whose option
order follows `SpendingCat.csv` first-appearance order (the `ID` column).

---

## 1. Azure app registration
1. https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. **Supported account types**: *"Accounts in any organizational directory and personal Microsoft accounts"* (MUST allow **personal Microsoft accounts**).
3. **Redirect URI** → platform **Single-page application (SPA)** → `https://a.cnmas.top`
   (add `http://localhost:8787` too for local testing).
4. **Register**, then copy the **Application (client) ID**.
5. **API permissions** → **Add** → **Microsoft Graph** → **Delegated**: add `User.Read`, `Files.ReadWrite`, and `Files.ReadWrite.All`. `Files.ReadWrite.All` is required so a user can read/write files in a folder **shared by the other account**. (Users consent at first sign-in; no admin consent needed.)

## 2. Configure the app
Edit `public/app.js`:
```js
const CLIENT_ID = "YOUR-CLIENT-ID";   // required
// The OneDrive EDIT share link of the /Apps/SpendingTracker FOLDER.
// Both accounts use this to read/write the same shared data.
const FOLDER_SHARE_URL = "https://1drv.ms/f/...";
// Owner-mode fallback (used only when FOLDER_SHARE_URL is "") — signs into your
// own OneDrive, handy for seeding/splitting the data the first time.
const FOLDER_PATH = "/Apps/SpendingTracker";
```
`AUTHORITY` defaults to `.../consumers` (personal accounts). Leave as-is unless
you need work accounts.

**Creating the folder share link:** in OneDrive, right-click the
`Apps/SpendingTracker` folder → **Share** → set **Can edit** → copy link → paste
into `FOLDER_SHARE_URL`. Leaving it `""` runs in owner mode (your own drive),
which is only useful to seed the files before sharing.

## 3. Deploy to Cloudflare Pages (dashboard, no local tools)
See **DEPLOY.md** for the full click-by-click. In short: rebuild the zip and
upload it via **Workers & Pages → Pages → Direct Upload**.
```powershell
Compress-Archive -Path 'spending-tracker/public/*' -DestinationPath 'spending-tracker/spending-tracker-public.zip' -Force
```
> Rebuild this zip after **any** change under `public/`. All files must be flat at
> the zip root (upload the *contents* of `public/`, not the folder itself).

## 4. Regenerating categories
If `SpendingCat.csv` changes:
```bash
python spending-tracker/tools/gen_categories.py
```

## 5. Migrating existing Microsoft Lists data
1. Export the List(s) to CSV.
2. Run the converter (handles multiple CSVs, auto-detects delimiter, normalizes
   dates/amounts, maps `Created By`/`Recorded by`):
   ```bash
   python spending-tracker/tools/migrate_list.py "Family Spending.csv" "Family Spending Database.csv"
   ```
3. Upload the generated `records.json` to `Apps/SpendingTracker/`. On first load
   the app auto-splits it into `records-current.json` + `records-archive.json`.

## Notes / limitations
- No client secret — safe for a public SPA. Only your Microsoft accounts can sign in.
- **Concurrency-safe:** per-file ETag + `If-Match` with merge-and-retry means
  simultaneous saves never clobber each other. The only last-write-wins case is
  two people editing the *exact same existing row* at the same instant.
- **Append-oriented:** normal adds rewrite only the small current-month file.
  Editing/deleting an old record rewrites the larger archive (rare).
- OneDrive keeps its own file version history.
