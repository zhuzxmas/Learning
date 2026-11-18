# Deploy (Cloudflare Pages — static Direct Upload)

The app is a **pure static SPA** — everything lives in `public/`
(`index.html`, `app.js`, `stock-realization.js`, `valuation.js`, `style.css`, `categories.js`, `msal-browser.min.js`).
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
app.js  stock-realization.js  valuation.js  categories.js  index.html  msal-browser.min.js  style.css
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

## Stock email automation — Tencent enterprise mailbox

Stock detail emails and scheduled chip-ranking emails are sent by the repository
root scripts `send_stock_detail_mail.py` and `send_chip_ranking_mail.py` through
GitHub Actions (`stock-detail-mail.yml` and `finance-quarterly.yml`).

In GitHub → repository Settings → Secrets and variables → Actions, configure:

| Repository Secret | Value |
| --- | --- |
| `STOCK_MAIL_FROM` | Existing full sender address; also the SMTP login username |
| `STOCK_MAIL_TO` | Existing recipient address |
| `STOCK_MAIL_SMTP_PASSWORD` | Sender mailbox's client-specific password |

The sender display name defaults to **Nathan Zhu CN**. To override it, set the
optional repository **Variable** `STOCK_MAIL_FROM_NAME` (not a Secret), or the
same environment variable for local runs. This changes only the email's display
name; the SMTP login and sender address remain `STOCK_MAIL_FROM`.

Enable SMTP/client access in the Tencent enterprise mailbox settings. The default
connection is `smtp.exmail.qq.com:465`, using SSL with certificate verification
and a 30-second timeout. No new Python dependencies are required.

For local execution, supply the same values as environment variables. Optional
`STOCK_MAIL_SMTP_HOST` and `STOCK_MAIL_SMTP_PORT` environment variables override
the server and port (SSL only); GitHub workflows use the defaults. OneDrive HTTP
proxy configuration does not apply to SMTP. SMTP sends are not automatically
retried, to avoid duplicate delivery after an ambiguous connection failure.

The original personal OneDrive Secrets (`ONEDRIVE_CLIENT_ID`, `TOKEN_ENC_KEY`,
`ONEDRIVE_REFRESH_TOKEN`) are still required for reading stock data. Enterprise
`CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID` are no longer injected into these
mail steps, but other repository workflows still reference them.

After deploying the code and configuring the SMTP password, use the stock detail
page's “发送邮件” button to verify receipt at the existing recipient address.
Scheduled ranking delivery keeps its existing trigger and non-fatal failure behavior.

## Enterprise WeChat intelligent bot — `/run wallpaper`

The Cloudflare Worker (`tools/deepseek-worker.js`) exposes
`https://api.cnmas.top/wecom-bot` for an Enterprise WeChat **智能机器人 → API 模式**
callback. In a group chat, an authorized member sends:

```text
@机器人 /run wallpaper
```

The Worker verifies WeCom's encrypted callback, triggers the existing
`BingWallPaper.yml` GitHub Actions workflow through `repository_dispatch`
(`ms-power-automate-event`), and replies with the Actions link.

### 1. Deploy the Worker code first

Paste the latest `tools/deepseek-worker.js` into the `api.cnmas.top` Worker and
deploy it **before** saving the bot callback URL. WeCom verifies the URL
immediately when you click Save.

### 2. Add Worker secrets

In Cloudflare → the `api.cnmas.top` Worker → **Settings → Variables and Secrets**,
add encrypted secrets:

| Worker secret | Value |
| --- | --- |
| `WECOM_BOT_TOKEN` | Same Token as WeCom; use the random Token shown in WeCom or a 3–32 character letters/numbers string |
| `WECOM_BOT_AES_KEY` | Same EncodingAESKey as WeCom; exactly 43 characters (use WeCom's “随机获取”) |
| `WECOM_ALLOWED_USERIDS` | Optional comma-separated WeCom userids allowed to run commands |
| `WECOM_ALLOWED_CHATIDS` | Optional comma-separated group chatids allowed to run commands |

At least one of `WECOM_ALLOWED_USERIDS` or `WECOM_ALLOWED_CHATIDS` must be set.
Setting only `WECOM_ALLOWED_CHATIDS` allows any member of those groups. Setting
`WECOM_ALLOWED_USERIDS` restricts commands to those users; add `WECOM_ALLOWED_CHATIDS`
too if the bot is in more than one group.

If your WeCom account is not the enterprise super administrator, the callback's
`userid` may be an encrypted ID instead of the plain userid. In that case copy the
ID printed by the bot's “未授权” reply into the allow-list.

### 3. Fill the three WeCom fields

In the intelligent bot's **API 设置**:

| Field | Value |
| --- | --- |
| `URL` | `https://api.cnmas.top/wecom-bot` |
| `Token` | Same value as Worker secret `WECOM_BOT_TOKEN` |
| `EncodingAESKey` | Same 43-character value as Worker secret `WECOM_BOT_AES_KEY` (click 随机获取 and copy it) |

Click **保存**. WeCom sends a `GET` verification request to the URL; the Worker
must return the decrypted `echostr` for the save to succeed.

### 4. Test

Add the bot to the target group, then send:

```text
@机器人 /run wallpaper
```

Expected reply: `已提交 Bing WallPaper action。` plus the Actions link. Confirm a
new `Bing WallPaper action` run appears in GitHub Actions with event type
`repository_dispatch`.

Available commands are deliberately allow-listed in `WECOM_COMMANDS`. Only
`/run wallpaper` is currently enabled; unsupported commands do not trigger any
workflow.
