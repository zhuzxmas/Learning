/* ============================================================================
 * Family Spending Tracker
 * Sign in with Microsoft (MSAL, PKCE) + Microsoft Graph read/write of a JSON
 * file in personal OneDrive. All in-browser; no secrets stored.
 * ==========================================================================*/

/* ----------------------------- CONFIG ------------------------------------ */
// Paste your Azure app registration "Application (client) ID" here:
const CLIENT_ID = "d85a5f93-4dd1-4bec-84ac-f3a9e2953e43";

// SHARED-FOLDER MODE (append-oriented storage):
// Paste the OneDrive "edit" share link of the FOLDER /Apps/SpendingTracker here
// so BOTH accounts (owner + celinemas) read/write the same family data. The data
// is split across two files inside that folder:
//   records-current.json  = the current month (small; written on every add)
//   records-archive.json  = everything older  (large; rarely written)
// Leave "" to use the signed-in user's own OneDrive (owner mode, for seeding).
const FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgCGdH0TNLOIQInfHmoTAnSYAanpUnbuXtyJrp43lNZa8Dw?email=celine_mas%40outlook.com&e=wKoVZ8";

// Owner-mode fallback folder path (used only when FOLDER_SHARE_URL is empty):
const FOLDER_PATH = "/Apps/SpendingTracker";

// File names inside the folder.
const HOT_FILE = "records-current.json";   // current-month bucket (hot)
const COLD_FILE = "records-archive.json";   // older records bucket (cold)
const LEGACY_FILE = "records.json";         // single-file layout (auto-migrated)
const CATS_FILE = "categories-custom.json"; // user-added categories (delta tree)

/* ------------------------ IndexedDB record cache -------------------------- *
 * Best-effort local cache of the (large) archive file keyed by its eTag, so a
 * session whose archive is unchanged skips the ~1MB download entirely. All
 * operations fail silently — the cache only accelerates, never affects data. */
const IDB_NAME = "spending-cache";
const IDB_STORE = "files";
let _idbPromise = null;
function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _idbPromise;
}
async function idbGet(key) {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbSet(key, etag, records) {
  const db = await idbOpen();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ etag, records }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

// Graph scopes. Files.ReadWrite.All is needed to read/write a file shared by
// another user (the shared-file mode); User.Read = your display name.
const SCOPES = ["User.Read", "Files.ReadWrite", "Files.ReadWrite.All"];

// "consumers" = personal Microsoft accounts only. If your app registration is
// multi-tenant + personal, "common" also works. Keep "consumers" for personal
// OneDrive to avoid work-account confusion.
const AUTHORITY = "https://login.microsoftonline.com/consumers";

const GRAPH = "https://graph.microsoft.com/v1.0";

/* --------------------------- INCOME CONFIG ------------------------------- */
// Separate OneDrive folder for the income tracker (both accounts have access).
const INCOME_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgDkv42DfbuDTJfM1C3hWX1FAXlv1jCiXLSpnrL-BqpZhQU?email=celine_mas%40outlook.com&e=F7TDX1";
const INCOME_RECORDS_FILE = "income-records.json";
const INCOME_META_FILE = "income-meta.json"; // {cats:{custom,hidden}, payees:{custom,hidden}}

// Base (seed) income categories + payees, from the migrated data.
const INCOME_BASE_TITLES = [
  "工资收入", "年终奖(含13薪)", "项目奖金收入", "南昌外派补贴", "南京人才安居",
  "育儿补贴", "看病报销", "节日红包收入", "理财收益", "股票投资收入",
  "闲鱼卖出", "其他收入",
  "Ford AA Plan", "Ford储蓄计划", "Ford弹性福利", "Ford股票权益",
];
const INCOME_BASE_PAYEES = ["Nathan Zhu", "Celine Rao", "Cloud Zhu"];

/* --------------------------- MSAL setup ---------------------------------- */
const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: AUTHORITY,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

// Created during boot() after we confirm the MSAL library loaded (see boot()).
let msalApp = null;
let account = null;

/* --------------------------- App state ----------------------------------- */
let records = [];          // combined view (archive + current), for rendering
let currentRecords = [];   // hot bucket: records in the current month
let archiveRecords = [];   // cold bucket: older records
let etagHot = null;        // eTag of the hot file (optimistic concurrency)
let etagCold = null;       // eTag of the cold file
let customCats = {};       // user-added categories (delta over base CATEGORIES)
let hiddenCats = { l1: [], l2: {}, l3: {} }; // hidden categories per level
let etagCats = null;       // eTag of categories-custom.json
let dirty = false;         // unsaved changes flag
let spendingLoaded = false; // spending data fetched once per session (lazy + cached)
let archiveLoaded = false;  // cold (archive) file fetched? Deferred until 显示全部 etc.

/* --------------------------- DOM refs ------------------------------------ */
const $ = (id) => document.getElementById(id);
const els = {
  loginView: $("loginView"),
  appView: $("appView"),
  loginBtn: $("loginBtn"),
  loginBtn2: $("loginBtn2"),
  logoutBtn: $("logoutBtn"),
  userName: $("userName"),
  form: $("recordForm"),
  editId: $("editId"),
  iCat: $("iCat"),
  iiCat: $("iiCat"),
  iiiCat: $("iiiCat"),
  addICat: $("addICat"),
  addIICat: $("addIICat"),
  addIIICat: $("addIIICat"),
  hideICat: $("hideICat"),
  hideIICat: $("hideIICat"),
  hideIIICat: $("hideIIICat"),
  catManager: $("catManager"),
  tabSettingsBtn: $("tabSettingsBtn"),
  tabSettings: $("tabSettings"),
  hiddenList: $("hiddenList"),
  amount: $("amount"),
  date: $("date"),
  note: $("note"),
  addBtn: $("addBtn"),
  cancelEditBtn: $("cancelEditBtn"),
  deleteEditBtn: $("deleteEditBtn"),
  formTitle: $("formTitle"),
  tabAddBtn: $("tabAddBtn"),
  tabListBtn: $("tabListBtn"),
  tabChartBtn: $("tabChartBtn"),
  tabAdd: $("tabAdd"),
  tabList: $("tabList"),
  tabChart: $("tabChart"),
  chartYearTitle: $("chartYearTitle"),
  chartTotal: $("chartTotal"),
  chartYear: $("chartYear"),
  chartEmpty: $("chartEmpty"),
  pieTitle: $("pieTitle"),
  barChart: $("barChart"),
  pieChart: $("pieChart"),
  pieLegend: $("pieLegend"),
  topSelect: $("topSelect"),
  statusMsg: $("statusMsg"),
  savebar: $("savebar"),
  bootStatus: $("bootStatus"),
  recordsBody: $("recordsBody"),
  recordCount: $("recordCount"),
  emptyHint: $("emptyHint"),
  filterDate: $("filterDate"),
  searchInput: $("searchInput"),
  catFilterL1: $("catFilterL1"),
  catFilterL2: $("catFilterL2"),
  catFilterL3: $("catFilterL3"),
  clearFilterBtn: $("clearFilterBtn"),
  showAllBtn: $("showAllBtn"),
  // --- mode switch ---
  modeSpendingBtn: $("modeSpendingBtn"),
  modeIncomeBtn: $("modeIncomeBtn"),
  spendingApp: $("spendingApp"),
  incomeApp: $("incomeApp"),
  // --- income tabs ---
  incTabAddBtn: $("incTabAddBtn"),
  incTabListBtn: $("incTabListBtn"),
  incTabChartBtn: $("incTabChartBtn"),
  incTabSettingsBtn: $("incTabSettingsBtn"),
  incTabAdd: $("incTabAdd"),
  incTabList: $("incTabList"),
  incTabChart: $("incTabChart"),
  incTabSettings: $("incTabSettings"),
  // --- income form ---
  incForm: $("incForm"),
  incEditId: $("incEditId"),
  incTitle: $("incTitle"),
  incPayee: $("incPayee"),
  incAddTitle: $("incAddTitle"),
  incHideTitle: $("incHideTitle"),
  incAddPayee: $("incAddPayee"),
  incHidePayee: $("incHidePayee"),
  incDate: $("incDate"),
  incBase: $("incBase"),
  incOvertime: $("incOvertime"),
  incBonus: $("incBonus"),
  incOther: $("incOther"),
  incSocial: $("incSocial"),
  incFund: $("incFund"),
  incTax: $("incTax"),
  incGross: $("incGross"),
  incNet: $("incNet"),
  incNote: $("incNote"),
  incAddBtn: $("incAddBtn"),
  incCancelBtn: $("incCancelBtn"),
  incFormTitle: $("incFormTitle"),
  // --- income list ---
  incBody: $("incBody"),
  incRecordCount: $("incRecordCount"),
  incEmptyHint: $("incEmptyHint"),
  incFilterDate: $("incFilterDate"),
  incClearFilterBtn: $("incClearFilterBtn"),
  incShowAllBtn: $("incShowAllBtn"),
  // --- income charts ---
  incChartTitle: $("incChartTitle"),
  incChartTotal: $("incChartTotal"),
  incChartYear: $("incChartYear"),
  incWaterfall: $("incWaterfall"),
  incMonthBars: $("incMonthBars"),
  incCatLegend: $("incCatLegend"),
  incChartEmpty: $("incChartEmpty"),
  // --- income settings ---
  incHiddenCats: $("incHiddenCats"),
  incHiddenPayees: $("incHiddenPayees"),
};

/* --------------------------- Helpers ------------------------------------- */
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function fmtAmount(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
let statusTimer = null;
function setStatus(msg, kind, autoHideMs) {
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  els.statusMsg.textContent = msg || "";
  els.statusMsg.className = "status" + (kind ? " " + kind : "");
  if (els.savebar) els.savebar.classList.toggle("hidden", !msg);
  // Mirror to the login-view status line (visible before sign-in).
  if (els.bootStatus) {
    els.bootStatus.textContent = msg || "";
    els.bootStatus.className = "status" + (kind ? " " + kind : "");
  }
  if (autoHideMs) {
    statusTimer = setTimeout(() => {
      els.statusMsg.textContent = "";
      els.statusMsg.className = "status";
      if (els.savebar) els.savebar.classList.add("hidden");
      if (els.bootStatus) { els.bootStatus.textContent = ""; els.bootStatus.className = "status"; }
      statusTimer = null;
    }, autoHideMs);
  }
}
function setDirty(v) {
  dirty = v;
}

/* --------------------------- Auth ---------------------------------------- */
async function getToken() {
  const req = { scopes: SCOPES, account };
  try {
    const res = await msalApp.acquireTokenSilent(req);
    return res.accessToken;
  } catch (e) {
    const res = await msalApp.acquireTokenPopup(req);
    return res.accessToken;
  }
}

async function login() {
  const res = await msalApp.loginPopup({ scopes: SCOPES });
  account = res.account;
  msalApp.setActiveAccount(account);
  await onSignedIn();
}

function logout() {
  msalApp.logoutPopup({ account }).catch(() => {});
  account = null;
  records = [];
  currentRecords = [];
  archiveRecords = [];
  etagHot = null;
  etagCold = null;
  setDirty(false);
  spendingLoaded = false;
  archiveLoaded = false;
  // Reset income module state too.
  incomeLoaded = false;
  incomeRecords = [];
  incEtag = null;
  incDriveBase = null;
  incEtagMeta = null;
  if (mode === "income") setMode("spending");
  hide(els.appView);
  show(els.loginView);
  hide(els.logoutBtn);
  show(els.loginBtn);
  els.userName.textContent = "";
}

async function onSignedIn() {
  els.userName.textContent = account.name || account.username || "";
  hide(els.loginView);
  show(els.appView);
  hide(els.loginBtn);
  show(els.logoutBtn);
  // Lazily load whichever mode is active (defaults to 支出). Each mode's data
  // is fetched once and cached; switching modes never reloads.
  await setMode(mode);
}

/* --------------------------- Graph I/O ----------------------------------- */
// Resolved folder addressing, set once by resolveFolder().
let driveBase = null;      // Graph URL prefix for the folder holding our files
let folderMode = null;     // "share" | "own"

// Encode a sharing URL into a Graph share id (u!base64url).
function encodeShareUrl(u) {
  const b64 = btoa(unescape(encodeURIComponent(u)));
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

// First day of the current month, "YYYY-MM-01" — the hot/cold cutoff.
function monthCutoff() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}
function isHotDate(date, cutoff) { return (date || "") >= cutoff; }

// Resolve the shared folder (or own-folder base) once.
async function resolveFolder(token) {
  if (driveBase) return;
  if (FOLDER_SHARE_URL) {
    const sid = encodeShareUrl(FOLDER_SHARE_URL);
    const res = await fetch(
      `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) {
      throw new Error("无法访问共享文件夹：" + res.status + " " + (await res.text()));
    }
    const item = await res.json();
    const driveId = item.parentReference && item.parentReference.driveId;
    driveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
    folderMode = "share";
  } else {
    const p = FOLDER_PATH.replace(/^\/+/, "");
    driveBase = `${GRAPH}/me/drive/root:/${encodeURI(p)}`;
    folderMode = "own";
  }
}

// Build content + metadata URLs for a child file (by name) in the folder.
function fileUrls(name) {
  if (folderMode === "share") {
    // /drives/{d}/items/{folderId}:/name:/content
    return {
      content: `${driveBase}:/${name}:/content`,
      meta: `${driveBase}:/${name}?$select=id,eTag`,
    };
  }
  // own mode: driveBase already opens the path (root:/Apps/SpendingTracker)
  return {
    content: `${driveBase}/${name}:/content`,
    meta: `${driveBase}/${name}?$select=id,eTag`,
  };
}

// Read the eTag of a named file. Returns null if missing/unreadable.
async function readETag(token, name) {
  const { meta } = fileUrls(name);
  const res = await fetch(meta, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.eTag || null;
}

// Read a named JSON records file. Returns { list, etag, exists }.
async function readFile(token, name) {
  const { content } = fileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { list: [], etag: null, exists: false };
  if (!res.ok) {
    throw new Error("载入失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  let list = [];
  try {
    const d = await res.json();
    list = Array.isArray(d.records) ? d.records : [];
  } catch { list = []; }
  // Prefer the ETag from the download response header (saves a round-trip);
  // fall back to a metadata request only if CORS doesn't expose it.
  const etag = res.headers.get("ETag") || (await readETag(token, name));
  return { list, etag, exists: true };
}

// Write a records list to a named file with optimistic concurrency.
//   getList()          -> the array to serialize (re-read each attempt)
//   etag               -> If-Match value (null = create / no guard)
//   applyOnConflict(f) -> on 412, re-apply our change onto fresh server list `f`
// Returns the new eTag.
async function writeFile(token, name, getList, etag, applyOnConflict) {
  const { content } = fileUrls(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
    if (etag) headers["If-Match"] = etag;
    const list = getList();
    const body = JSON.stringify({ records: list });
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      const newEtag = item.eTag || (await readETag(token, name));
      // Keep the archive cache fresh so the next session hits it (no download).
      if (name === COLD_FILE) idbSet(COLD_FILE, newEtag, list);
      return newEtag;
    }
    if (res.status === 412 && applyOnConflict) {
      setStatus("有人同时更新了数据，正在合并…", "warn");
      const fresh = await readFile(token, name);
      applyOnConflict(fresh.list);
      etag = fresh.etag;
      render();
      continue;
    }
    throw new Error("保存失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存冲突，重试多次仍失败(" + name + ")。");
}

// Rebuild the combined render view from the two buckets.
function syncRecords() {
  records = archiveRecords.concat(currentRecords);
}

/* ----------------------- Custom categories I/O --------------------------- */
// Read an arbitrary JSON file by name. Returns { data, etag, exists }.
async function readJson(token, name) {
  const { content } = fileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { data: null, etag: null, exists: false };
  if (!res.ok) throw new Error("载入失败(" + name + ")：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const etag = res.headers.get("ETag") || (await readETag(token, name));
  return { data, etag, exists: true };
}

// Merge a category delta tree (src) into a target tree, in place.
function deepMergeCats(target, src) {
  for (const i in src) {
    if (!target[i]) target[i] = {};
    for (const ii in src[i]) {
      if (!Array.isArray(target[i][ii])) target[i][ii] = [];
      for (const iii of src[i][ii]) {
        if (!target[i][ii].includes(iii)) target[i][ii].push(iii);
      }
    }
  }
}

// Merge the loaded customCats delta into the live CATEGORIES tree.
function applyCustomCats() {
  deepMergeCats(CATEGORIES, customCats);
}

// Ensure a hidden structure has all three level maps.
function normalizeHidden(h) {
  h = (h && typeof h === "object") ? h : {};
  return {
    l1: Array.isArray(h.l1) ? h.l1 : [],
    l2: (h.l2 && typeof h.l2 === "object") ? h.l2 : {},
    l3: (h.l3 && typeof h.l3 === "object") ? h.l3 : {},
  };
}

// Union another hidden structure into ours (for conflict merges).
function mergeHidden(target, src) {
  src = normalizeHidden(src);
  for (const i of src.l1) if (!target.l1.includes(i)) target.l1.push(i);
  for (const i in src.l2) {
    target.l2[i] = target.l2[i] || [];
    for (const ii of src.l2[i]) if (!target.l2[i].includes(ii)) target.l2[i].push(ii);
  }
  for (const i in src.l3) {
    target.l3[i] = target.l3[i] || {};
    for (const ii in src.l3[i]) {
      target.l3[i][ii] = target.l3[i][ii] || [];
      for (const iii of src.l3[i][ii])
        if (!target.l3[i][ii].includes(iii)) target.l3[i][ii].push(iii);
    }
  }
}

// Interpret the stored file: new format {custom, hidden} or legacy bare tree.
function parseCatsFile(data) {
  const d = (data && typeof data === "object") ? data : {};
  if ("custom" in d || "hidden" in d) {
    customCats = (d.custom && typeof d.custom === "object") ? d.custom : {};
    hiddenCats = normalizeHidden(d.hidden);
  } else {
    customCats = d;                     // legacy: whole file was the add-tree
    hiddenCats = normalizeHidden(null);
  }
}

async function loadCustomCats(token) {
  const r = await readJson(token, CATS_FILE);
  parseCatsFile(r.data);
  etagCats = r.etag;
  applyCustomCats();
  fillCatFilters();
}

// Persist custom + hidden categories with optimistic concurrency.
async function saveCustomCats() {
  const token = await getToken();
  const { content } = fileUrls(CATS_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
    if (etagCats) headers["If-Match"] = etagCats;
    const body = JSON.stringify({ custom: customCats, hidden: hiddenCats });
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      etagCats = item.eTag || (await readETag(token, CATS_FILE));
      return true;
    }
    if (res.status === 412) {
      const fresh = await readJson(token, CATS_FILE);
      const d = (fresh.data && typeof fresh.data === "object") ? fresh.data : {};
      const otherCustom = ("custom" in d || "hidden" in d) ? (d.custom || {}) : d;
      const otherHidden = ("custom" in d || "hidden" in d) ? d.hidden : null;
      deepMergeCats(customCats, otherCustom);
      mergeHidden(hiddenCats, otherHidden);
      applyCustomCats();
      etagCats = fresh.etag;
      continue;
    }
    throw new Error("保存分类失败：" + res.status);
  }
  throw new Error("保存分类冲突，重试多次仍失败。");
}


async function loadRecords() {
  setStatus("正在从 OneDrive 载入…");
  const token = await getToken();
  await resolveFolder(token);
  await loadCustomCats(token);
  rebuildLevel1();
  resetForm(); // recompute visible defaults now that hiddenCats is loaded
  const cutoff = monthCutoff();

  // TRAFFIC-SAVING: by default only download the small hot file (current month).
  // The (potentially large) archive is fetched lazily via ensureArchive().
  const hot = await readFile(token, HOT_FILE);

  if (hot.exists) {
    currentRecords = hot.list;
    etagHot = hot.etag;
    archiveRecords = [];
    etagCold = null;
    archiveLoaded = false;         // defer archive + any rollover until needed
    finishLoad();
    // New-month cleanup: if the hot file still holds last month's records,
    // load the archive once to run the deferred rollover (moves them to cold).
    if (currentRecords.some((r) => !isHotDate(r.date, cutoff))) {
      await ensureArchive();
    }
    return;
  }

  // Hot file missing — fall back to the full path (needs the archive/legacy).
  const cold = await readFile(token, COLD_FILE);
  if (!cold.exists) {
    // No split layout yet. Migrate a legacy single records.json if present.
    const legacy = await readFile(token, LEGACY_FILE);
    if (legacy.exists && legacy.list.length) {
      setStatus("正在拆分历史数据…", "warn");
      archiveRecords = legacy.list.filter((r) => !isHotDate(r.date, cutoff));
      currentRecords = legacy.list.filter((r) => isHotDate(r.date, cutoff));
      etagCold = await writeFile(token, COLD_FILE, () => archiveRecords, null, null);
      etagHot = await writeFile(token, HOT_FILE, () => currentRecords, null, null);
      archiveLoaded = true;        // archive already in memory after migration
      finishLoad();
      return;
    }
    // Nothing at all yet — start empty; files are created on first save.
    archiveRecords = [];
    currentRecords = [];
    etagCold = null;
    etagHot = null;
    archiveLoaded = true;
    setStatus("未找到数据文件，将在首次保存时创建。", "warn");
    finishLoad();
    return;
  }

  // Hot missing but archive exists: load the archive (it holds everything).
  archiveRecords = cold.list;
  etagCold = cold.etag;
  currentRecords = [];
  etagHot = null;
  archiveLoaded = true;
  finishLoad();
}

// Fetch the cold (archive) file on demand and run the deferred month-rollover.
// No-op if the archive is already loaded. Returns true on success.
async function ensureArchive() {
  if (archiveLoaded) return true;
  setStatus("正在载入历史数据…");
  const token = await getToken();
  await resolveFolder(token);

  // Fast path: if our IndexedDB cache matches the server's current eTag, use it
  // and skip the (~1MB) content download entirely.
  let cold;
  const liveEtag = await readETag(token, COLD_FILE);
  const cached = liveEtag ? await idbGet(COLD_FILE) : null;
  if (cached && cached.etag === liveEtag && Array.isArray(cached.records)) {
    cold = { list: cached.records, etag: liveEtag, exists: true };
  } else {
    cold = await readFile(token, COLD_FILE);
    if (cold.exists && cold.etag) idbSet(COLD_FILE, cold.etag, cold.list);
  }

  // Keep any records added since load that already live in archiveRecords.
  const pending = archiveRecords.slice();
  const have = new Set(cold.list.map((r) => r.id));
  archiveRecords = cold.list.concat(pending.filter((r) => !have.has(r.id)));
  etagCold = cold.etag;
  archiveLoaded = true;

  // Deferred auto-rollover: hot records older than this month move to cold.
  const cutoff = monthCutoff();
  const stale = currentRecords.filter((r) => !isHotDate(r.date, cutoff));
  if (stale.length) {
    setStatus("正在整理上月数据…", "warn");
    const ids = new Set(archiveRecords.map((r) => r.id));
    archiveRecords = archiveRecords.concat(stale.filter((r) => !ids.has(r.id)));
    currentRecords = currentRecords.filter((r) => isHotDate(r.date, cutoff));
    etagCold = await writeFile(
      token, COLD_FILE, () => archiveRecords, etagCold,
      (fresh) => {
        const s = new Set(fresh.map((r) => r.id));
        archiveRecords = fresh.concat(stale.filter((r) => !s.has(r.id)));
      }
    );
    etagHot = await writeFile(
      token, HOT_FILE, () => currentRecords, etagHot,
      (fresh) => { currentRecords = fresh.filter((r) => isHotDate(r.date, cutoff)); }
    );
  }

  syncRecords();
  setStatus("已载入全部 " + records.length + " 条记录。", "ok", 4000);
  render();
  return true;
}

function finishLoad() {
  syncRecords();
  spendingLoaded = true;
  setStatus("已载入 " + records.length + " 条记录。", "ok", 2000);
  render();
  renderHiddenList();
  setDirty(false);
}

// Re-apply this user's pending op onto a freshly-fetched copy of ONE bucket,
// keyed by record id. `bucket` is "hot" or "cold"; `cutoff` decides membership.
function applyOpToBucket(fresh, op, bucket, cutoff) {
  const list = fresh.slice();
  const removeId = (id) => {
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) list.splice(i, 1);
  };
  const upsert = (rec) => {
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
  };
  if (op.type === "delete") { removeId(op.id); return list; }
  const target = isHotDate(op.rec.date, cutoff) ? "hot" : "cold";
  if (op.type === "add") {
    if (bucket === target) upsert(op.rec);
    return list;
  }
  // edit: record belongs to `target` now; drop it from any other bucket.
  if (bucket === target) upsert(op.rec); else removeId(op.rec.id);
  return list;
}

// Persist a single add/edit/delete. Writes ONLY the affected bucket file(s),
// each with optimistic-concurrency merge-retry. The common case (adding a
// current-month record) rewrites only the small hot file.
async function persist(op) {
  setStatus("正在保存到 OneDrive…");
  try {
    const token = await getToken();
    const cutoff = monthCutoff();

    const buckets = new Set();
    if (op.type === "add") {
      buckets.add(isHotDate(op.rec.date, cutoff) ? "hot" : "cold");
    } else if (op.type === "delete") {
      buckets.add(op.wasHot ? "hot" : "cold");
    } else { // edit — may move between buckets
      buckets.add(op.wasHot ? "hot" : "cold");
      buckets.add(isHotDate(op.rec.date, cutoff) ? "hot" : "cold");
    }

    // Writing the cold file requires the full archive in memory first, or we
    // would overwrite history with just this record. Loads it if not yet done.
    if (buckets.has("cold")) await ensureArchive();

    for (const b of buckets) {
      if (b === "hot") {
        etagHot = await writeFile(
          token, HOT_FILE, () => currentRecords, etagHot,
          (fresh) => { currentRecords = applyOpToBucket(fresh, op, "hot", cutoff); syncRecords(); }
        );
      } else {
        etagCold = await writeFile(
          token, COLD_FILE, () => archiveRecords, etagCold,
          (fresh) => { archiveRecords = applyOpToBucket(fresh, op, "cold", cutoff); syncRecords(); }
        );
      }
    }

    syncRecords();
    setStatus("已保存 " + records.length + " 条记录。", "ok");
    setDirty(false);
    return true;
  } catch (e) {
    setStatus("保存出错：" + (e.message || e), "error");
    return false;
  }
}

/* --------------------- Cascading category dropdowns ---------------------- */
function fillSelect(sel, options, placeholder) {
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
}

/* ----------------------- Category visibility ----------------------------- */
function isHiddenL1(i) { return hiddenCats.l1.includes(i); }
function isHiddenL2(i, ii) { return (hiddenCats.l2[i] || []).includes(ii); }
function isHiddenL3(i, ii, iii) {
  return ((hiddenCats.l3[i] || {})[ii] || []).includes(iii);
}
// Visible option lists (hidden entries removed).
function visL1() { return Object.keys(CATEGORIES).filter((i) => !isHiddenL1(i)); }
function visL2(i) {
  return CATEGORIES[i] ? Object.keys(CATEGORIES[i]).filter((ii) => !isHiddenL2(i, ii)) : [];
}
function visL3(i, ii) {
  return (CATEGORIES[i] && CATEGORIES[i][ii])
    ? CATEGORIES[i][ii].filter((iii) => !isHiddenL3(i, ii, iii)) : [];
}
// Like fillSelect, but guarantees `keep` is present (so editing a record whose
// category was later hidden still shows its own value).
function fillSelectKeep(sel, options, placeholder, keep) {
  const opts = options.slice();
  if (keep && !opts.includes(keep)) opts.push(keep);
  fillSelect(sel, opts, placeholder);
}

function initCategoryDropdowns() {
  fillSelect(els.iCat, visL1(), "请选择一级分类");
  fillSelect(els.iiCat, [], "请选择二级分类");
  fillSelect(els.iiiCat, [], "请选择三级分类");

  els.iCat.addEventListener("change", () => {
    const l2 = visL2(els.iCat.value);
    fillSelect(els.iiCat, l2, "请选择二级分类");
    els.iiCat.value = l2[0] || "";           // default to first 二级
    const l3 = els.iiCat.value ? visL3(els.iCat.value, els.iiCat.value) : [];
    fillSelect(els.iiiCat, l3, "请选择三级分类");
    els.iiiCat.value = l3[0] || "";           // default to first 三级
    applyNoteDefault();
  });

  els.iiCat.addEventListener("change", () => {
    const l3 = visL3(els.iCat.value, els.iiCat.value);
    fillSelect(els.iiiCat, l3, "请选择三级分类");
    els.iiiCat.value = l3[0] || "";           // default to first 三级
    applyNoteDefault();
  });

  els.iiiCat.addEventListener("change", applyNoteDefault);
}

// Set the three dropdowns to specific values (used when editing).
function setCategoryValues(i, ii, iii) {
  fillSelectKeep(els.iCat, visL1(), "请选择一级分类", i);
  els.iCat.value = i || "";
  fillSelectKeep(els.iiCat, visL2(i), "请选择二级分类", ii);
  els.iiCat.value = ii || "";
  fillSelectKeep(els.iiiCat, visL3(i, ii), "请选择三级分类", iii);
  els.iiiCat.value = iii || "";
}

// Refill the level-1 dropdown from CATEGORIES, preserving the current choice.
function rebuildLevel1() {
  const keep = els.iCat.value;
  fillSelect(els.iCat, visL1(), "请选择一级分类");
  if (keep && CATEGORIES[keep] && !isHiddenL1(keep)) els.iCat.value = keep;
}

// Add a new category at the given level (1/2/3) under the current selection,
// persist it to OneDrive, and select it.
async function addCategory(level) {
  const i = els.iCat.value;
  const ii = els.iiCat.value;
  if (level >= 2 && !i) { setStatus("请先选择一级分类。", "warn"); return; }
  if (level === 3 && !ii) { setStatus("请先选择二级分类。", "warn"); return; }

  const prompts = { 1: "新增一级分类名称：", 2: "新增二级分类名称：", 3: "新增三级分类名称：" };
  const name = (prompt(prompts[level]) || "").trim();
  if (!name) return;

  if (level === 1) {
    if (!CATEGORIES[name]) CATEGORIES[name] = {};
    if (!customCats[name]) customCats[name] = {};
    rebuildLevel1();
    els.iCat.value = name;
    els.iCat.dispatchEvent(new Event("change"));
  } else if (level === 2) {
    if (!CATEGORIES[i][name]) CATEGORIES[i][name] = [];
    customCats[i] = customCats[i] || {};
    if (!customCats[i][name]) customCats[i][name] = [];
    fillSelect(els.iiCat, visL2(i), "请选择二级分类");
    els.iiCat.value = name;
    els.iiCat.dispatchEvent(new Event("change"));
  } else {
    if (!CATEGORIES[i][ii].includes(name)) CATEGORIES[i][ii].push(name);
    customCats[i] = customCats[i] || {};
    customCats[i][ii] = customCats[i][ii] || [];
    if (!customCats[i][ii].includes(name)) customCats[i][ii].push(name);
    fillSelect(els.iiiCat, visL3(i, ii), "请选择三级分类");
    els.iiiCat.value = name;
    applyNoteDefault();
  }

  try {
    setStatus("正在保存分类…");
    await saveCustomCats();
    setStatus("已新增分类：" + name, "ok");
  } catch (e) {
    setStatus("分类保存失败：" + (e.message || e), "error");
  }
  fillCatFilters();
}

// Hide the currently-selected category at the given level (1/2/3). Hidden
// categories disappear from dropdowns but existing records still display them.
async function hideCategory(level) {
  const i = els.iCat.value;
  const ii = els.iiCat.value;
  const iii = els.iiiCat.value;
  if (level === 1 && !i) { setStatus("请先选择要隐藏的一级分类。", "warn"); return; }
  if (level === 2 && !ii) { setStatus("请先选择要隐藏的二级分类。", "warn"); return; }
  if (level === 3 && !iii) { setStatus("请先选择要隐藏的三级分类。", "warn"); return; }

  const label = level === 1 ? i : level === 2 ? `${i} / ${ii}` : `${i} / ${ii} / ${iii}`;
  if (!confirm(`隐藏分类「${label}」？\n它将从下拉菜单中移除（已有记录仍会显示），可在“管理隐藏分类”中恢复。`))
    return;

  if (level === 1) {
    if (!hiddenCats.l1.includes(i)) hiddenCats.l1.push(i);
  } else if (level === 2) {
    hiddenCats.l2[i] = hiddenCats.l2[i] || [];
    if (!hiddenCats.l2[i].includes(ii)) hiddenCats.l2[i].push(ii);
  } else {
    hiddenCats.l3[i] = hiddenCats.l3[i] || {};
    hiddenCats.l3[i][ii] = hiddenCats.l3[i][ii] || [];
    if (!hiddenCats.l3[i][ii].includes(iii)) hiddenCats.l3[i][ii].push(iii);
  }

  try {
    setStatus("正在保存分类…");
    await saveCustomCats();
    resetForm();          // picks fresh visible defaults
    renderHiddenList();
    setStatus("已隐藏分类：" + label, "ok");
  } catch (e) {
    setStatus("分类保存失败：" + (e.message || e), "error");
  }
  fillCatFilters();
}

// Restore (un-hide) a category previously hidden. keys depend on level.
async function restoreCategory(level, i, ii, iii) {
  if (level === 1) {
    hiddenCats.l1 = hiddenCats.l1.filter((x) => x !== i);
  } else if (level === 2) {
    hiddenCats.l2[i] = (hiddenCats.l2[i] || []).filter((x) => x !== ii);
    if (!hiddenCats.l2[i].length) delete hiddenCats.l2[i];
  } else {
    if (hiddenCats.l3[i] && hiddenCats.l3[i][ii]) {
      hiddenCats.l3[i][ii] = hiddenCats.l3[i][ii].filter((x) => x !== iii);
      if (!hiddenCats.l3[i][ii].length) delete hiddenCats.l3[i][ii];
      if (!Object.keys(hiddenCats.l3[i]).length) delete hiddenCats.l3[i];
    }
  }
  try {
    setStatus("正在保存分类…");
    await saveCustomCats();
    rebuildLevel1();
    renderHiddenList();
    setStatus("已恢复分类。", "ok");
  } catch (e) {
    setStatus("分类保存失败：" + (e.message || e), "error");
  }
  fillCatFilters();
}

// Render the "管理隐藏分类" panel listing every hidden entry with a 恢复 button.
function renderHiddenList() {
  if (!els.hiddenList) return;
  const rows = [];
  for (const i of hiddenCats.l1) rows.push({ level: 1, i, label: i });
  for (const i in hiddenCats.l2)
    for (const ii of hiddenCats.l2[i]) rows.push({ level: 2, i, ii, label: `${i} / ${ii}` });
  for (const i in hiddenCats.l3)
    for (const ii in hiddenCats.l3[i])
      for (const iii of hiddenCats.l3[i][ii])
        rows.push({ level: 3, i, ii, iii, label: `${i} / ${ii} / ${iii}` });

  els.hiddenList.innerHTML = "";
  if (!rows.length) {
    els.hiddenList.innerHTML = '<p class="muted">暂无隐藏的分类。</p>';
    return;
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "hidden-row";
    const span = document.createElement("span");
    span.textContent = r.label;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-mini";
    btn.textContent = "恢复";
    btn.onclick = () => restoreCategory(r.level, r.i, r.ii, r.iii);
    row.appendChild(span);
    row.appendChild(btn);
    els.hiddenList.appendChild(row);
  }
}

/* --------------------------- Form ---------------------------------------- */
const CATEGORIES = window.CATEGORIES || {};

function defaultCategoryTriple() {
  const i = visL1()[0] || "";
  const ii = visL2(i)[0] || "";
  const iii = visL3(i, ii)[0] || "";
  return { i, ii, iii };
}

// Signed-in user's email (Power Apps User().Email equivalent), lower-cased.
function userEmail() {
  const e = (account && (account.username || "")) || "";
  return e.toLowerCase();
}

/* Smart default for the 备注 field on NEW records — ported from the Power Apps
 * Default formula. Recomputed whenever the categories change (add mode only). */
function computeNoteDefault(i, ii, iii) {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
  const t = (h, m) => h * 60 + m;
  const email = userEmail();

  if (mins >= t(7, 40) && mins <= t(9, 30) &&
      i === "南昌外派" && ii === "餐饮" && iii === "在外面吃")
    return "小朱早饭";
  if (mins >= t(6, 40) && mins <= t(9, 50) &&
      i === "日常生活" && ii === "餐饮" && iii === "早饭")
    return "小朱早饭";
  if (i === "南昌外派" && ii === "外派租房" && iii === "房租")
    return "江西国际汽车广场B栋房租900";
  if (i === "日常生活" && ii === "居家生活" && iii === "水电气")
    return "江宁淳化万科金域东方水费 电费 燃气费；马鞍山绿地3期3307水费 电费 燃气费";
  if (i === "日常生活" && ii === "居家住房" && iii === "物业费")
    return "马鞍山绿地3期3307物业费 20 年 月 - 20 年 月";
  if (i === "日常生活" && ii === "居家住房" && iii === "房租")
    return "江宁淳化万科金域东方房租";
  if (i === "南昌外派" && ii === "行车交通" && iii === "打车租车" &&
      (email === "zhuzx2006@outlook.com"))
    return "小朱打车";
  if (i === "日常生活" && ii === "行车交通" && iii === "打车租车" &&
      (email === "celinemas@outlook.com" || email === "celine_mas@outlook.com"))
    return "小饶打车上班 下班";
  if (i === "南昌外派" && ii === "外派租房" && iii === "水电气")
    return "江西国际汽车广场B栋房水费 电费 ";
  return "";
}

// Grow the 备注 textarea to fit its content (no inner scrollbar).
function autoGrowNote() {
  if (!els.note) return;
  els.note.style.height = "auto";
  els.note.style.height = els.note.scrollHeight + "px";
}

// Apply the smart default to the 备注 input — only when adding a new record.
function applyNoteDefault() {
  if (els.editId.value) return; // editing: keep the record's own note
  els.note.value = computeNoteDefault(els.iCat.value, els.iiCat.value, els.iiiCat.value);
  autoGrowNote();
}

function resetForm() {
  els.form.reset();
  els.editId.value = "";
  els.date.value = todayStr();
  // Pre-select the first category at each level so you don't reselect every time.
  const d = defaultCategoryTriple();
  setCategoryValues(d.i, d.ii, d.iii);
  applyNoteDefault();
  els.formTitle.textContent = "添加记录";
  els.addBtn.textContent = "添加到列表";
  hide(els.cancelEditBtn);
  hide(els.deleteEditBtn);
}

async function onSubmitForm(e) {
  e.preventDefault();
  const isEdit = !!els.editId.value;
  const rec = {
    id: els.editId.value || uuid(),
    i_cat: els.iCat.value,
    ii_cat: els.iiCat.value,
    iii_cat: els.iiiCat.value,
    amount: parseFloat(els.amount.value),
    date: els.date.value,
    note: els.note.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.i_cat || !rec.ii_cat || !rec.iii_cat) {
    setStatus("请完整选择三级分类。", "warn");
    return;
  }

  // Snapshot both buckets for rollback if the save fails.
  const snapHot = currentRecords.slice();
  const snapCold = archiveRecords.slice();
  const cutoff = monthCutoff();

  let wasHot;
  if (isEdit) {
    // Remove the existing record from whichever bucket holds it.
    let idx = currentRecords.findIndex((r) => r.id === rec.id);
    if (idx >= 0) {
      wasHot = true;
      rec.createdBy = currentRecords[idx].createdBy || rec.createdBy; // preserve
      currentRecords.splice(idx, 1);
    } else {
      idx = archiveRecords.findIndex((r) => r.id === rec.id);
      if (idx >= 0) {
        wasHot = false;
        rec.createdBy = archiveRecords[idx].createdBy || rec.createdBy;
        archiveRecords.splice(idx, 1);
      } else {
        wasHot = isHotDate(rec.date, cutoff);
      }
    }
  }
  // Insert into the bucket the record now belongs to (by its date).
  (isHotDate(rec.date, cutoff) ? currentRecords : archiveRecords).push(rec);
  syncRecords();

  els.addBtn.disabled = true;
  render();
  const op = isEdit ? { type: "edit", rec, wasHot } : { type: "add", rec };
  const ok = await persist(op);
  els.addBtn.disabled = false;

  if (ok) {
    resetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok");
  } else {
    // Roll back the in-memory change so the table matches OneDrive.
    currentRecords = snapHot;
    archiveRecords = snapCold;
    syncRecords();
    render();
    // status already shows the save error
  }
}

function startEdit(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  els.editId.value = r.id;
  setCategoryValues(r.i_cat, r.ii_cat, r.iii_cat);
  els.amount.value = r.amount;
  els.date.value = r.date;
  els.note.value = r.note || "";
  els.formTitle.textContent = "编辑记录";
  els.addBtn.textContent = "保存修改";
  show(els.cancelEditBtn);
  show(els.deleteEditBtn);
  switchTab("add");
  autoGrowNote();   // measure after the panel is visible
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return false;
  if (!confirm(`确定删除这条记录吗？\n${r.date} ${r.i_cat}/${r.ii_cat}/${r.iii_cat} ${fmtAmount(r.amount)}`))
    return false;
  const snapHot = currentRecords.slice();
  const snapCold = archiveRecords.slice();
  const wasHot = currentRecords.some((x) => x.id === id);
  if (wasHot) currentRecords = currentRecords.filter((x) => x.id !== id);
  else archiveRecords = archiveRecords.filter((x) => x.id !== id);
  syncRecords();
  render();
  const ok = await persist({ type: "delete", id, wasHot });
  if (!ok) {
    currentRecords = snapHot; // rollback
    archiveRecords = snapCold;
    syncRecords();
    render();
  }
  return ok;
}

/* --------------------------- Render table -------------------------------- */
const PAGE_LIMIT = 50;   // default rows shown when no date filter
let showAll = false;     // toggle to show all rows (no date filter)
let dateFilterOn = false; // whether the date filter is active
let catL1Val = "";        // selected 一级 filter ("" = 全部)
let catL2Val = "";        // selected 二级 filter
let catL3Val = "";        // selected 三级 filter
let searchText = "";      // text search (分类 + 备注)
let searchTimer = null;   // debounce timer for the search box

// Fill a filter <select> with an "全部" (value="") option plus the given list,
// keeping `keep` selected if still present.
function fillFilterSelect(sel, options, keep) {
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部";
  sel.appendChild(all);
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = options.includes(keep) ? keep : "";
}

// Rebuild the three category filter dropdowns from the current selection.
function fillCatFilters() {
  fillFilterSelect(els.catFilterL1, visL1(), catL1Val);
  catL1Val = els.catFilterL1.value;
  fillFilterSelect(els.catFilterL2, catL1Val ? visL2(catL1Val) : [], catL2Val);
  catL2Val = els.catFilterL2.value;
  fillFilterSelect(
    els.catFilterL3,
    catL1Val && catL2Val ? visL3(catL1Val, catL2Val) : [],
    catL3Val
  );
  catL3Val = els.catFilterL3.value;
}

function render() {
  const monthFilter = dateFilterOn && els.filterDate ? els.filterDate.value.slice(0, 7) : "";
  const anyFilter = dateFilterOn || catL1Val || searchText;
  const search = searchText.toLowerCase();
  const sorted = [...records].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    // Same day: newest-added (latest 修改时间) on top.
    return (b.modified || "") < (a.modified || "") ? -1
         : (b.modified || "") > (a.modified || "") ? 1 : 0;
  });

  // Apply filters (AND-combined). When any filter is active, show all matches;
  // otherwise limit to the latest PAGE_LIMIT (unless showAll).
  let view;
  let limited = false;
  if (anyFilter) {
    view = sorted.filter((r) => {
      if (monthFilter && (r.date || "").slice(0, 7) !== monthFilter) return false;
      if (catL1Val && r.i_cat !== catL1Val) return false;
      if (catL2Val && r.ii_cat !== catL2Val) return false;
      if (catL3Val && r.iii_cat !== catL3Val) return false;
      if (search) {
        const hay = `${r.i_cat || ""}|${r.ii_cat || ""}|${r.iii_cat || ""}|${r.note || ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  } else if (showAll) {
    view = sorted;
  } else {
    view = sorted.slice(0, PAGE_LIMIT);
    limited = sorted.length > PAGE_LIMIT;
  }

  els.recordsBody.innerHTML = "";
  let prevDate = null;
  let dateBand = 0;   // alternates 0/1 each time the date changes
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    tr.innerHTML = `
      <td>${escapeHtml(fmtDateShort(r.date))}</td>
      <td>${escapeHtml(r.i_cat)}</td>
      <td>${escapeHtml(r.ii_cat)}</td>
      <td>${escapeHtml(r.iii_cat)}</td>
      <td class="num">${fmtAmount(r.amount)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini";
    editB.textContent = "编辑";
    editB.onclick = () => startEdit(r.id);
    actions.appendChild(editB);
    els.recordsBody.appendChild(tr);
  }

  // Count / status text
  const total = records.length;
  const daySum = view.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (anyFilter) {
    els.recordCount.textContent = `${view.length} 条，合计 ${fmtAmount(daySum)}`;
  } else if (!archiveLoaded) {
    els.recordCount.textContent = `本月 ${total} 条`;
  } else if (showAll) {
    els.recordCount.textContent = `显示全部 ${total} 条`;
  } else {
    els.recordCount.textContent = limited
      ? `显示最近 ${view.length} 条（共 ${total} 条）`
      : `共 ${total} 条`;
  }

  // Button visibility
  els.clearFilterBtn.classList.toggle("hidden", !anyFilter);
  // Always offer 显示全部 while the archive is unloaded (that's what triggers
  // the history download); otherwise only when the recent view is truncated.
  els.showAllBtn.classList.toggle(
    "hidden", !!anyFilter || (archiveLoaded && !limited && !showAll)
  );
  els.showAllBtn.textContent =
    (archiveLoaded && showAll) ? "显示50条" : "显示全部";

  els.emptyHint.classList.toggle("hidden", view.length !== 0);
}

// Smooth-scroll the records table to the given YYYY-MM-DD: exact day if present,
// else the nearest earlier day in view, else the top. Aligns the target just
// below the sticky tabs + filter controls.
function scrollToDay(day) {
  if (!day) return;
  const rows = els.recordsBody.querySelectorAll("tr[data-date]");
  let target = null;
  for (const tr of rows) {
    const d = tr.dataset.date;
    if (d === day) { target = tr; break; }
    if (d <= day) { target = tr; break; } // rows are newest-first, so first <= day is nearest earlier
  }
  if (!target) target = rows[rows.length - 1] || null;
  if (!target) return;
  // Offset = height of everything stuck to the top (tabs + list controls).
  const tabs = document.querySelector("#spendingApp .tabs");
  const controls = document.querySelector("#tabList .list-controls");
  const offset = (tabs ? tabs.offsetHeight : 0) + (controls ? controls.offsetHeight : 0) + 6;
  const y = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

// Format a YYYY-MM-DD date as YY/MM/DD (e.g. 2026-07-28 -> 26/07/28).
function fmtDateShort(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[1].slice(2)}/${m[2]}/${m[3]}` : (d || "");
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* --------------------------- Analytics chart ---------------------------- */
// Power BI-ish palette. 人情往来 gets the magenta accent like the reference.
const CHART_BLUE = "#118DFF";
const CHART_MAGENTA = "#E23DA8";
const PIE_COLORS = [
  "#118DFF", "#12239E", "#E23DA8", "#6B007B", "#E66C37",
  "#F2C80F", "#3599B8", "#26890D", "#D64550", "#8AD4EB",
  "#9B57D3", "#FE9666", "#A66999", "#4A588A",
];
const ACCENT_L1 = { "人情往来": CHART_MAGENTA };

let chartAgg = null;     // cached { total, l1: [{name,val,l2:[{name,val}]}] }
let selectedRank = 0;    // which top-N level-1 category the pie shows (0/1/2)
let chartYearVal = null; // selected year for the spending chart

// Distinct years present in the records (descending).
function spendYears() {
  const s = new Set();
  for (const r of records) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

// Aggregate the selected year's records by level-1 (and level-2).
function yearAgg() {
  const year = chartYearVal || String(new Date().getFullYear());
  const l1map = new Map();
  let total = 0;
  for (const r of records) {
    if (!r.date || r.date.slice(0, 4) !== year) continue;
    const amt = Number(r.amount) || 0;
    total += amt;
    let e = l1map.get(r.i_cat);
    if (!e) { e = { name: r.i_cat, val: 0, l2: new Map() }; l1map.set(r.i_cat, e); }
    e.val += amt;
    e.l2.set(r.ii_cat, (e.l2.get(r.ii_cat) || 0) + amt);
  }
  const l1 = [...l1map.values()].map((e) => ({
    name: e.name,
    val: e.val,
    l2: [...e.l2.entries()].map(([name, val]) => ({ name, val }))
      .sort((a, b) => b.val - a.val),
  })).sort((a, b) => b.val - a.val);
  return { year, total, l1 };
}

function renderChart() {
  // Populate the year selector (defaults to the current year if present).
  const years = spendYears();
  const cur = String(new Date().getFullYear());
  if (!chartYearVal || !years.includes(chartYearVal)) {
    chartYearVal = years.includes(cur) ? cur : (years[0] || cur);
  }
  els.chartYear.innerHTML = "";
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === chartYearVal) o.selected = true;
    els.chartYear.appendChild(o);
  }

  chartAgg = yearAgg();
  els.chartYearTitle.textContent = chartAgg.year + " 年度家庭支出明细";
  els.chartTotal.textContent = fmtAmount(chartAgg.total);

  const has = chartAgg.l1.length > 0;
  els.chartEmpty.classList.toggle("hidden", has);
  if (!has) {
    els.barChart.innerHTML = "";
    els.pieChart.style.background = "";
    els.pieLegend.innerHTML = "";
    els.pieTitle.textContent = "分类明细";
    return;
  }
  if (selectedRank >= chartAgg.l1.length) selectedRank = 0;
  buildBars();
  buildPie();
  syncTopButtons();
}

// Static HTML/CSS column chart of level-1 totals.
function buildBars() {
  const data = chartAgg.l1;
  const max = Math.max(...data.map((d) => d.val), 1);
  els.barChart.innerHTML = "";
  data.forEach((d, k) => {
    const col = document.createElement("div");
    col.className = "bar-col" + (k === selectedRank ? " active" : "");
    const color = ACCENT_L1[d.name] || CHART_BLUE;
    col.innerHTML =
      `<div class="bar-val">${fmtInt(d.val)}</div>` +
      `<div class="bar-track"><div class="bar-fill" style="height:${(d.val / max) * 100}%;background:${color}"></div></div>` +
      `<div class="bar-name">${escapeHtml(d.name)}</div>`;
    col.onclick = () => { selectedRank = k; buildPie(); syncTopButtons(); highlightBars(); };
    els.barChart.appendChild(col);
  });
}

function highlightBars() {
  const cols = els.barChart.querySelectorAll(".bar-col");
  cols.forEach((c, k) => c.classList.toggle("active", k === selectedRank));
}

// Static pie via CSS conic-gradient + DOM legend, for the selected category.
function buildPie() {
  const entry = chartAgg.l1[selectedRank];
  els.pieTitle.textContent = entry ? (entry.name + " 明细") : "分类明细";
  if (!entry) { els.pieChart.style.background = ""; els.pieLegend.innerHTML = ""; return; }
  const slices = entry.l2;
  const sum = slices.reduce((s, x) => s + x.val, 0) || 1;

  const stops = [];
  let acc = 0;
  slices.forEach((s, k) => {
    const col = PIE_COLORS[k % PIE_COLORS.length];
    const from = (acc / sum) * 100;
    acc += s.val;
    const to = (acc / sum) * 100;
    stops.push(`${col} ${from}% ${to}%`);
  });
  els.pieChart.style.background = `conic-gradient(${stops.join(",")})`;

  els.pieLegend.innerHTML = "";
  slices.forEach((s, k) => {
    const col = PIE_COLORS[k % PIE_COLORS.length];
    const pct = ((s.val / sum) * 100).toFixed(0);
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="legend-dot" style="background:${col}"></span>` +
      `<span class="legend-name">${escapeHtml(s.name)}</span>` +
      `<span class="legend-val">${fmtInt(s.val)} (${pct}%)</span>`;
    els.pieLegend.appendChild(row);
  });
}

// Reflect the current rank on the Top-N buttons; disable ranks with no data.
function syncTopButtons() {
  if (!els.topSelect) return;
  const btns = els.topSelect.querySelectorAll(".top-btn");
  btns.forEach((b) => {
    const rank = Number(b.dataset.rank);
    b.classList.toggle("active", rank === selectedRank);
    b.disabled = rank >= chartAgg.l1.length;
  });
}

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString("zh-CN"); }

/* --------------------------- Tabs ---------------------------------------- */
function switchTab(name) {
  const tabs = {
    add: { panel: els.tabAdd, btn: els.tabAddBtn },
    list: { panel: els.tabList, btn: els.tabListBtn },
    chart: { panel: els.tabChart, btn: els.tabChartBtn },
    settings: { panel: els.tabSettings, btn: els.tabSettingsBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") { ensureArchive().then(() => renderChart()); }
  if (name === "settings") renderHiddenList();
}

/* --------------------------- Wire up ------------------------------------- */
function wireEvents() {
  els.loginBtn.onclick = login;
  els.loginBtn2.onclick = login;
  els.logoutBtn.onclick = logout;
  els.form.addEventListener("submit", onSubmitForm);
  els.note.addEventListener("input", autoGrowNote);
  els.cancelEditBtn.onclick = resetForm;
  els.deleteEditBtn.onclick = async () => {
    const id = els.editId.value;
    if (!id) return;
    if (await deleteRecord(id)) { resetForm(); switchTab("list"); }
  };

  els.tabAddBtn.onclick = () => switchTab("add");
  els.tabListBtn.onclick = () => switchTab("list");
  if (els.tabChartBtn) els.tabChartBtn.onclick = () => switchTab("chart");
  if (els.tabSettingsBtn) els.tabSettingsBtn.onclick = () => switchTab("settings");
  if (els.chartYear) els.chartYear.onchange = () => { chartYearVal = els.chartYear.value; renderChart(); };
  if (els.topSelect) els.topSelect.querySelectorAll(".top-btn").forEach((b) => {
    b.onclick = () => {
      const rank = Number(b.dataset.rank);
      if (rank >= (chartAgg ? chartAgg.l1.length : 0)) return;
      selectedRank = rank;
      buildPie();
      syncTopButtons();
      highlightBars();
    };
  });

  els.addICat.onclick = () => addCategory(1);
  els.addIICat.onclick = () => addCategory(2);
  els.addIIICat.onclick = () => addCategory(3);

  if (els.hideICat) els.hideICat.onclick = () => hideCategory(1);
  if (els.hideIICat) els.hideIICat.onclick = () => hideCategory(2);
  if (els.hideIIICat) els.hideIIICat.onclick = () => hideCategory(3);

  els.filterDate.addEventListener("change", async () => {
    dateFilterOn = true; showAll = false;
    await ensureArchive();
    render();
    els.filterDate.blur();               // release focus so the closing picker doesn't yank the page to the top input
    const day = els.filterDate.value;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToDay(day)) // run after the picker's focus-scroll settles
    );
  });
  els.searchInput.addEventListener("input", () => {
    // Debounce: wait for a typing pause before loading the archive / re-rendering.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      searchText = els.searchInput.value.trim();
      if (searchText) { showAll = false; await ensureArchive(); }
      render();
    }, 300);
  });
  els.catFilterL1.addEventListener("change", async () => {
    catL1Val = els.catFilterL1.value; catL2Val = ""; catL3Val = "";
    fillCatFilters();
    if (catL1Val) { showAll = false; await ensureArchive(); }
    render();
  });
  els.catFilterL2.addEventListener("change", async () => {
    catL2Val = els.catFilterL2.value; catL3Val = "";
    fillCatFilters();
    await ensureArchive();
    render();
  });
  els.catFilterL3.addEventListener("change", async () => {
    catL3Val = els.catFilterL3.value;
    await ensureArchive();
    render();
  });
  els.clearFilterBtn.onclick = () => {
    clearTimeout(searchTimer);
    dateFilterOn = false;
    els.filterDate.value = todayStr();
    searchText = ""; els.searchInput.value = "";
    catL1Val = ""; catL2Val = ""; catL3Val = "";
    fillCatFilters();
    render();
  };
  els.showAllBtn.onclick = async () => {
    if (!archiveLoaded) { await ensureArchive(); showAll = true; }
    else { showAll = !showAll; }
    render();
  };
}

/* ========================================================================= *
 *                           INCOME  MODULE                                  *
 * ========================================================================= */
let mode = "spending";          // "spending" | "income"
let incomeRecords = [];
let incEtag = null;
let incomeLoaded = false;
let incDriveBase = null;
let incMeta = { cats: { custom: [], hidden: [] }, payees: { custom: [], hidden: [] } };
let incEtagMeta = null;
let incShowAll = false;
let incFilterOn = false;
let incTab = "add";
let incChartYearVal = null;

// The nine money fields, in form order (used for reset / gather).
const INC_MONEY = [
  "incBase", "incOvertime", "incBonus", "incOther",
  "incSocial", "incFund", "incTax", "incGross", "incNet",
];

function incNormMeta(d) {
  d = (d && typeof d === "object") ? d : {};
  const arr = (x) => (Array.isArray(x) ? x.slice() : []);
  const cats = (d.cats && typeof d.cats === "object") ? d.cats : {};
  const pay = (d.payees && typeof d.payees === "object") ? d.payees : {};
  return {
    cats: { custom: arr(cats.custom), hidden: arr(cats.hidden) },
    payees: { custom: arr(pay.custom), hidden: arr(pay.hidden) },
  };
}
function incMergeMeta(target, src) {
  src = incNormMeta(src);
  const uni = (t, s) => { for (const x of s) if (!t.includes(x)) t.push(x); };
  uni(target.cats.custom, src.cats.custom);
  uni(target.cats.hidden, src.cats.hidden);
  uni(target.payees.custom, src.payees.custom);
  uni(target.payees.hidden, src.payees.hidden);
}

// Visible option lists (base + custom, minus hidden).
function incVisTitles() {
  const all = INCOME_BASE_TITLES.concat(incMeta.cats.custom.filter((x) => !INCOME_BASE_TITLES.includes(x)));
  return all.filter((x) => !incMeta.cats.hidden.includes(x));
}
function incVisPayees() {
  const all = INCOME_BASE_PAYEES.concat(incMeta.payees.custom.filter((x) => !INCOME_BASE_PAYEES.includes(x)));
  return all.filter((x) => !incMeta.payees.hidden.includes(x));
}

/* ------------------------- Income Graph I/O ------------------------------ */
async function incResolveFolder(token) {
  if (incDriveBase) return;
  const sid = encodeShareUrl(INCOME_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问收入文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  incDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function incFileUrls(name) {
  return {
    content: `${incDriveBase}:/${name}:/content`,
    meta: `${incDriveBase}:/${name}?$select=id,eTag`,
  };
}
async function incReadETag(token, name) {
  const { meta } = incFileUrls(name);
  const res = await fetch(meta, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.eTag || null;
}
async function incReadJson(token, name) {
  const { content } = incFileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { data: null, etag: null, exists: false };
  if (!res.ok) throw new Error("载入失败(" + name + ")：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const etag = res.headers.get("ETag") || (await incReadETag(token, name));
  return { data, etag, exists: true };
}
// PUT with optimistic concurrency (If-Match + 412 merge-retry).
async function incWriteJson(token, name, getData, etag, applyOnConflict) {
  const { content } = incFileUrls(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (etag) headers["If-Match"] = etag;
    const data = getData();
    const body = JSON.stringify(data);
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      const newEtag = item.eTag || (await incReadETag(token, name));
      // Keep the income records cache fresh so the next session hits it.
      if (name === INCOME_RECORDS_FILE) {
        idbSet(INCOME_RECORDS_FILE, newEtag, (data && data.records) || []);
      }
      return newEtag;
    }
    if (res.status === 412 && applyOnConflict) {
      setStatus("有人同时更新了收入数据，正在合并…", "warn");
      const fresh = await incReadJson(token, name);
      applyOnConflict(fresh.data);
      etag = fresh.etag;
      incRender();
      continue;
    }
    throw new Error("保存失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存冲突，重试多次仍失败(" + name + ")。");
}

/* --------------------------- Income load --------------------------------- */
async function incLoad() {
  if (incomeLoaded) return;
  setStatus("正在载入收入数据…");
  const token = await getToken();
  await incResolveFolder(token);
  const m = await incReadJson(token, INCOME_META_FILE);
  incMeta = incNormMeta(m.data);
  incEtagMeta = m.etag;

  // Records: use the IndexedDB cache when the server eTag is unchanged (skips
  // the records download entirely); otherwise download and refresh the cache.
  const liveEtag = await incReadETag(token, INCOME_RECORDS_FILE);
  const cached = liveEtag ? await idbGet(INCOME_RECORDS_FILE) : null;
  if (cached && cached.etag === liveEtag && Array.isArray(cached.records)) {
    incomeRecords = cached.records;
    incEtag = liveEtag;
  } else {
    const r = await incReadJson(token, INCOME_RECORDS_FILE);
    incomeRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
    incEtag = r.etag;
    if (r.exists && r.etag) idbSet(INCOME_RECORDS_FILE, r.etag, incomeRecords);
  }
  incomeLoaded = true;
  incInitForm();
  incRender();
  incRenderHidden();
  setStatus("已载入 " + incomeRecords.length + " 条收入记录。", "ok", 2000);
}

async function incSaveMeta() {
  const token = await getToken();
  incEtagMeta = await incWriteJson(
    token, INCOME_META_FILE, () => incMeta, incEtagMeta,
    (fresh) => { incMergeMeta(incMeta, fresh); }
  );
}

// Apply one add/edit/delete op to a records list (by id).
function incApplyOp(list, op) {
  const out = list.slice();
  const idx = (id) => out.findIndex((r) => r.id === id);
  if (op.type === "delete") {
    const i = idx(op.id); if (i >= 0) out.splice(i, 1);
    return out;
  }
  const i = idx(op.rec.id);
  if (i >= 0) out[i] = op.rec; else out.push(op.rec);
  return out;
}

async function incPersist(op) {
  setStatus("正在保存收入…");
  const token = await getToken();
  incEtag = await incWriteJson(
    token, INCOME_RECORDS_FILE, () => ({ records: incomeRecords }), incEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      incomeRecords = incApplyOp(list, op);
    }
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- Income form --------------------------------- */
function incFillSelect(sel, options, placeholder, keep) {
  const opts = options.slice();
  if (keep && !opts.includes(keep)) opts.push(keep);
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = placeholder; ph.disabled = true; ph.selected = true;
  sel.appendChild(ph);
  for (const o of opts) {
    const op = document.createElement("option");
    op.value = o; op.textContent = o; sel.appendChild(op);
  }
}
function incRebuildSelects(keepTitle, keepPayee) {
  incFillSelect(els.incTitle, incVisTitles(), "请选择收入分类", keepTitle);
  if (keepTitle) els.incTitle.value = keepTitle;
  incFillSelect(els.incPayee, incVisPayees(), "请选择收款人", keepPayee);
  if (keepPayee) els.incPayee.value = keepPayee;
}
function incNum(el) { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }

// Auto-compute 税前总收入 and 实际收入 from the components.
function incRecalc() {
  const gross = incNum(els.incBase) + incNum(els.incOvertime) + incNum(els.incBonus) + incNum(els.incOther);
  els.incGross.value = gross ? round2(gross) : "";
  const net = gross - incNum(els.incSocial) - incNum(els.incFund) - incNum(els.incTax);
  els.incNet.value = net ? round2(net) : "";
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function incInitForm() {
  incRebuildSelects();
  incResetForm();
}
function incResetForm() {
  els.incForm.reset();
  els.incEditId.value = "";
  els.incDate.value = todayStr();
  incRebuildSelects();
  els.incFormTitle.textContent = "添加收入";
  els.incAddBtn.textContent = "添加并保存";
  hide(els.incCancelBtn);
}

async function incOnSubmit(e) {
  e.preventDefault();
  const isEdit = !!els.incEditId.value;
  const rec = {
    id: els.incEditId.value || uuid(),
    title: els.incTitle.value,
    payee: els.incPayee.value,
    date: els.incDate.value,
    baseSalary: incNum(els.incBase),
    overtime: incNum(els.incOvertime),
    bonus: incNum(els.incBonus),
    otherIncome: incNum(els.incOther),
    grossTotal: incNum(els.incGross),
    socialSecurity: incNum(els.incSocial),
    housingFund: incNum(els.incFund),
    incomeTax: incNum(els.incTax),
    netAmount: incNum(els.incNet),
    note: els.incNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.title) { setStatus("请选择收入分类。", "warn"); return; }
  if (!rec.payee) { setStatus("请选择收款人。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = incomeRecords.slice();
  if (isEdit) {
    const i = incomeRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = incomeRecords[i].createdBy || rec.createdBy; incomeRecords[i] = rec; }
    else incomeRecords.push(rec);
  } else {
    incomeRecords.push(rec);
  }
  els.incAddBtn.disabled = true;
  incRender();
  try {
    await incPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    incResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    incomeRecords = snap; incRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.incAddBtn.disabled = false;
  }
}

function incStartEdit(id) {
  const r = incomeRecords.find((x) => x.id === id);
  if (!r) return;
  els.incEditId.value = r.id;
  incRebuildSelects(r.title, r.payee);
  els.incDate.value = r.date;
  els.incBase.value = r.baseSalary || "";
  els.incOvertime.value = r.overtime || "";
  els.incBonus.value = r.bonus || "";
  els.incOther.value = r.otherIncome || "";
  els.incSocial.value = r.socialSecurity || "";
  els.incFund.value = r.housingFund || "";
  els.incTax.value = r.incomeTax || "";
  els.incGross.value = r.grossTotal || "";
  els.incNet.value = r.netAmount || "";
  els.incNote.value = r.note || "";
  els.incFormTitle.textContent = "编辑收入";
  els.incAddBtn.textContent = "保存修改";
  show(els.incCancelBtn);
  incSwitchTab("list");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function incDelete(id) {
  const r = incomeRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条收入记录吗？\n${r.date} ${r.title} ${r.payee} ${fmtAmount(r.netAmount)}`)) return;
  const snap = incomeRecords.slice();
  incomeRecords = incomeRecords.filter((x) => x.id !== id);
  incRender();
  try {
    await incPersist({ type: "delete", id });
  } catch (err) {
    incomeRecords = snap; incRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* ------------------------- Income add/hide meta -------------------------- */
async function incAddTitle() {
  const name = (prompt("新增收入分类名称：") || "").trim();
  if (!name) return;
  if (!incMeta.cats.custom.includes(name) && !INCOME_BASE_TITLES.includes(name))
    incMeta.cats.custom.push(name);
  incMeta.cats.hidden = incMeta.cats.hidden.filter((x) => x !== name);
  incRebuildSelects(name, els.incPayee.value);
  try { setStatus("正在保存…"); await incSaveMeta(); setStatus("已新增分类：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function incAddPayee() {
  const name = (prompt("新增收款人名称：") || "").trim();
  if (!name) return;
  if (!incMeta.payees.custom.includes(name) && !INCOME_BASE_PAYEES.includes(name))
    incMeta.payees.custom.push(name);
  incMeta.payees.hidden = incMeta.payees.hidden.filter((x) => x !== name);
  incRebuildSelects(els.incTitle.value, name);
  try { setStatus("正在保存…"); await incSaveMeta(); setStatus("已新增收款人：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function incHideTitle() {
  const v = els.incTitle.value;
  if (!v) { setStatus("请先选择要隐藏的收入分类。", "warn"); return; }
  if (!confirm(`隐藏收入分类「${v}」？（已有记录仍会显示，可在设置中恢复）`)) return;
  if (!incMeta.cats.hidden.includes(v)) incMeta.cats.hidden.push(v);
  incRebuildSelects(); incResetForm(); incRenderHidden();
  try { setStatus("正在保存…"); await incSaveMeta(); setStatus("已隐藏：" + v, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function incHidePayee() {
  const v = els.incPayee.value;
  if (!v) { setStatus("请先选择要隐藏的收款人。", "warn"); return; }
  if (!confirm(`隐藏收款人「${v}」？（已有记录仍会显示，可在设置中恢复）`)) return;
  if (!incMeta.payees.hidden.includes(v)) incMeta.payees.hidden.push(v);
  incRebuildSelects(); incResetForm(); incRenderHidden();
  try { setStatus("正在保存…"); await incSaveMeta(); setStatus("已隐藏：" + v, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function incRestore(kind, name) {
  if (kind === "cat") incMeta.cats.hidden = incMeta.cats.hidden.filter((x) => x !== name);
  else incMeta.payees.hidden = incMeta.payees.hidden.filter((x) => x !== name);
  incRebuildSelects(); incRenderHidden();
  try { setStatus("正在保存…"); await incSaveMeta(); setStatus("已恢复：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
function incRenderHidden() {
  const build = (container, list, kind) => {
    if (!container) return;
    container.innerHTML = "";
    if (!list.length) { container.innerHTML = '<p class="muted">暂无隐藏项。</p>'; return; }
    for (const name of list) {
      const row = document.createElement("div");
      row.className = "hidden-row";
      const span = document.createElement("span"); span.textContent = name;
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn btn-mini"; btn.textContent = "恢复";
      btn.onclick = () => incRestore(kind, name);
      row.appendChild(span); row.appendChild(btn); container.appendChild(row);
    }
  };
  build(els.incHiddenCats, incMeta.cats.hidden, "cat");
  build(els.incHiddenPayees, incMeta.payees.hidden, "payee");
}

/* --------------------------- Income table -------------------------------- */
function incRender() {
  const monthFilter = incFilterOn && els.incFilterDate ? els.incFilterDate.value.slice(0, 7) : "";
  const sorted = [...incomeRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (incShowAll) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.incBody.innerHTML = "";
  let prevDate = null;
  let dateBand = 0;   // alternates 0/1 each time the date changes
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.payee)}</td>
      <td class="num">${fmtAmount(r.grossTotal)}</td>
      <td class="num">${fmtAmount(r.socialSecurity)}</td>
      <td class="num">${fmtAmount(r.housingFund)}</td>
      <td class="num">${fmtAmount(r.incomeTax)}</td>
      <td class="num strong">${fmtAmount(r.netAmount)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => incStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => incDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.incBody.appendChild(tr);
  }

  const total = incomeRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.netAmount) || 0), 0);
  if (monthFilter) els.incRecordCount.textContent = `${view.length} 条，实际合计 ${fmtAmount(sum)}`;
  else if (incShowAll) els.incRecordCount.textContent = `显示全部 ${total} 条`;
  else els.incRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.incClearFilterBtn.classList.toggle("hidden", !monthFilter);
  els.incShowAllBtn.classList.toggle("hidden", !!monthFilter || (!limited && !incShowAll));
  els.incShowAllBtn.textContent = incShowAll ? "仅显示最近50条" : "显示全部";
  els.incEmptyHint.classList.toggle("hidden", view.length !== 0);
}

// Smooth-scroll the income table to the given YYYY-MM-DD (exact day, else nearest
// earlier day, else top), aligned below the sticky tabs + filter controls.
function incScrollToDay(day) {
  if (!day) return;
  const rows = els.incBody.querySelectorAll("tr[data-date]");
  let target = null;
  for (const tr of rows) {
    const d = tr.dataset.date;
    if (d === day) { target = tr; break; }
    if (d <= day) { target = tr; break; } // rows newest-first: first <= day is nearest earlier
  }
  if (!target) target = rows[rows.length - 1] || null;
  if (!target) return;
  const tabs = document.querySelector("#incomeApp .tabs");
  const controls = document.querySelector("#incTabList .list-controls");
  const offset = (tabs ? tabs.offsetHeight : 0) + (controls ? controls.offsetHeight : 0) + 6;
  const y = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

/* --------------------------- Income charts ------------------------------- */
const INC_CAT_COLORS = [
  "#118DFF", "#26890D", "#E23DA8", "#F2C80F", "#E66C37",
  "#6B007B", "#3599B8", "#D64550", "#12239E", "#8AD4EB",
  "#9B57D3", "#FE9666", "#A66999", "#4A588A", "#5AC8FA", "#00B294",
];
function incCatColor(name, index) { return INC_CAT_COLORS[index % INC_CAT_COLORS.length]; }

function incYears() {
  const s = new Set();
  for (const r of incomeRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

function incRenderChart() {
  // Populate the year selector (once per render).
  const years = incYears();
  const cur = String(new Date().getFullYear());
  if (!incChartYearVal) incChartYearVal = years.includes(cur) ? cur : (years[0] || cur);
  els.incChartYear.innerHTML = "";
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === incChartYearVal) o.selected = true;
    els.incChartYear.appendChild(o);
  }

  const year = incChartYearVal;
  const rows = incomeRecords.filter((r) => r.date && r.date.slice(0, 4) === year);
  const monthTotals = new Array(12).fill(0);
  const catTotals = new Map();       // name -> total (for legend ordering)
  const monthCat = Array.from({ length: 12 }, () => new Map()); // per-month cat map
  for (const r of rows) {
    const mi = parseInt(r.date.slice(5, 7), 10) - 1;
    if (mi < 0 || mi > 11) continue;
    const v = Number(r.netAmount) || 0;
    monthTotals[mi] += v;
    catTotals.set(r.title, (catTotals.get(r.title) || 0) + v);
    monthCat[mi].set(r.title, (monthCat[mi].get(r.title) || 0) + v);
  }
  const grand = monthTotals.reduce((a, b) => a + b, 0);
  els.incChartTitle.textContent = year + " 年度家庭收入";
  els.incChartTotal.textContent = fmtAmount(grand);

  const has = grand > 0;
  els.incChartEmpty.classList.toggle("hidden", has);
  if (!has) { els.incWaterfall.innerHTML = ""; els.incMonthBars.innerHTML = ""; els.incCatLegend.innerHTML = ""; return; }

  // Stable color map ordered by descending total.
  const catOrder = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const colorOf = new Map();
  catOrder.forEach((name, i) => colorOf.set(name, incCatColor(name, i)));

  incBuildWaterfall(monthTotals, grand);
  incBuildMonthBars(monthTotals, monthCat, colorOf);
  incBuildCatLegend(catOrder, catTotals, colorOf);
}

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

// Chart 1: cumulative waterfall — each month floats on the running total,
// ending with a full-height 合计 bar. Dashed connectors link each bar's top
// to the next month's base.
function incBuildWaterfall(monthTotals, grand) {
  const max = grand || 1;
  els.incWaterfall.innerHTML = "";
  let run = 0;
  for (let m = 0; m < 12; m++) {
    const v = monthTotals[m];
    const basePct = (run / max) * 100;
    const fillPct = (v / max) * 100;
    const topPct = basePct + fillPct;
    const col = document.createElement("div");
    col.className = "wf-col";
    // Connector: sits at this month's base height, linking from the previous top.
    const connector = (m > 0 && v)
      ? `<div class="wf-connector" style="bottom:${basePct}%"></div>` : "";
    col.innerHTML =
      `<div class="wf-track">` +
        connector +
        (v ? `<div class="wf-fill" style="bottom:${basePct}%;height:${fillPct}%"></div>` : "") +
        (v ? `<div class="wf-val" style="bottom:${topPct}%">${fmtInt(v)}</div>` : "") +
      `</div>` +
      `<div class="wf-name">${MONTH_LABELS[m]}</div>`;
    run += v;
    els.incWaterfall.appendChild(col);
  }
  // Grand total bar (full height).
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  tot.innerHTML =
    `<div class="wf-track">` +
      `<div class="wf-fill total" style="bottom:0;height:100%"></div>` +
      `<div class="wf-val" style="bottom:100%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  els.incWaterfall.appendChild(tot);
}

// Chart 2: per-month stacked bar, colored by income category.
function incBuildMonthBars(monthTotals, monthCat, colorOf) {
  const max = Math.max(...monthTotals, 1);
  const TRACK_PX = 190; // approx track pixel height for label-fit estimation
  els.incMonthBars.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    const total = monthTotals[m];
    const col = document.createElement("div");
    col.className = "mb-col";
    const segs = [...monthCat[m].entries()].sort((a, b) => b[1] - a[1]);
    let inner = "";
    for (const [name, val] of segs) {
      const h = (val / max) * 100;
      const px = (val / max) * TRACK_PX;
      const label = px >= 16 ? `<span class="mb-seg-label">${fmtInt(val)}</span>` : "";
      inner += `<div class="mb-seg" style="height:${h}%;background:${colorOf.get(name) || "#118DFF"}" title="${escapeHtml(name)}：${fmtInt(val)}">${label}</div>`;
    }
    col.innerHTML =
      `<div class="mb-val">${total ? fmtInt(total) : ""}</div>` +
      `<div class="mb-track">${inner}</div>` +
      `<div class="mb-name">${MONTH_LABELS[m]}</div>`;
    els.incMonthBars.appendChild(col);
  }
}

function incBuildCatLegend(catOrder, catTotals, colorOf) {
  els.incCatLegend.innerHTML = "";
  for (const name of catOrder) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="legend-dot" style="background:${colorOf.get(name)}"></span>` +
      `<span class="legend-name">${escapeHtml(name)}</span>` +
      `<span class="legend-val">${fmtInt(catTotals.get(name))}</span>`;
    els.incCatLegend.appendChild(row);
  }
}

/* --------------------------- Income tabs --------------------------------- */
function incSwitchTab(name) {
  incTab = name;
  const tabs = {
    add: { panel: els.incTabAdd, btn: els.incTabAddBtn },
    list: { panel: els.incTabList, btn: els.incTabListBtn },
    chart: { panel: els.incTabChart, btn: els.incTabChartBtn },
    settings: { panel: els.incTabSettings, btn: els.incTabSettingsBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") incRenderChart();
  if (name === "settings") incRenderHidden();
}

/* --------------------------- Mode switch --------------------------------- */
async function setMode(next) {
  mode = next;
  const isInc = next === "income";
  els.modeIncomeBtn.classList.toggle("active", isInc);
  els.modeSpendingBtn.classList.toggle("active", !isInc);
  els.incomeApp.classList.toggle("hidden", !isInc);
  els.spendingApp.classList.toggle("hidden", isInc);
  if (!account) return;
  if (isInc) {
    // Load income once; clicking 收入 never triggers a 支出 (re)load.
    try { await incLoad(); }
    catch (e) { setStatus("收入数据载入失败：" + (e.message || e), "error"); }
  } else if (!spendingLoaded) {
    // Load spending only if it hasn't been fetched yet this session.
    try { await loadRecords(); }
    catch (e) { setStatus("支出数据载入失败：" + (e.message || e), "error"); }
  }
}

function incWireEvents() {
  els.modeSpendingBtn.onclick = () => setMode("spending");
  els.modeIncomeBtn.onclick = () => setMode("income");

  els.incTabAddBtn.onclick = () => incSwitchTab("add");
  els.incTabListBtn.onclick = () => incSwitchTab("list");
  els.incTabChartBtn.onclick = () => incSwitchTab("chart");
  els.incTabSettingsBtn.onclick = () => incSwitchTab("settings");

  els.incForm.addEventListener("submit", incOnSubmit);
  els.incCancelBtn.onclick = incResetForm;
  els.incAddTitle.onclick = incAddTitle;
  els.incAddPayee.onclick = incAddPayee;
  els.incHideTitle.onclick = incHideTitle;
  els.incHidePayee.onclick = incHidePayee;

  // Auto-recalc 税前/实际 as components change (add mode & edit alike).
  ["incBase", "incOvertime", "incBonus", "incOther", "incSocial", "incFund", "incTax"]
    .forEach((k) => els[k].addEventListener("input", incRecalc));

  els.incFilterDate.addEventListener("change", () => {
    incFilterOn = true; incShowAll = false;
    incRender();
    els.incFilterDate.blur();
    const day = els.incFilterDate.value;
    requestAnimationFrame(() => requestAnimationFrame(() => incScrollToDay(day)));
  });
  els.incClearFilterBtn.onclick = () => { incFilterOn = false; els.incFilterDate.value = todayStr(); incRender(); };
  els.incShowAllBtn.onclick = () => { incShowAll = !incShowAll; incRender(); };
  els.incChartYear.onchange = () => { incChartYearVal = els.incChartYear.value; incRenderChart(); };
}

/* --------------------------- Boot ---------------------------------------- */
(async function boot() {
  // Always wire up UI first so the page is usable and errors are visible.
  initCategoryDropdowns();
  resetForm();
  wireEvents();
  els.filterDate.value = todayStr(); // show today's date instead of a blank box
  fillCatFilters();                  // populate 分类 filter dropdowns

  // Income module UI (data loads lazily when switching to 收入 mode).
  incWireEvents();
  incInitForm();
  els.incFilterDate.value = todayStr();

  // Surface any uncaught errors to the status bar instead of failing silently.
  window.addEventListener("error", (e) => {
    setStatus("脚本错误：" + (e.message || e.error || e), "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    setStatus("操作失败：" + ((e.reason && e.reason.message) || e.reason || e), "error");
  });

  if (!CLIENT_ID || CLIENT_ID.startsWith("PASTE-")) {
    setStatus("尚未配置 CLIENT_ID，请编辑 app.js。", "error");
    return;
  }

  // Confirm the MSAL library actually loaded (local vendor file).
  if (typeof msal === "undefined" || !msal.PublicClientApplication) {
    setStatus("登录组件未加载（msal-browser.min.js 缺失或被拦截）。", "error");
    return;
  }

  try {
    msalApp = new msal.PublicClientApplication(msalConfig);
    // MSAL v3 requires initialize() before any other call.
    if (typeof msalApp.initialize === "function") {
      await msalApp.initialize();
    }
  } catch (e) {
    setStatus("登录初始化失败：" + (e.message || e), "error");
    return;
  }

  // Handle redirect (if any) and restore existing session.
  await msalApp.handleRedirectPromise().catch(() => {});
  const accounts = msalApp.getAllAccounts();
  if (accounts.length > 0) {
    account = accounts[0];
    msalApp.setActiveAccount(account);
    try {
      await onSignedIn();
    } catch (e) {
      setStatus("自动登录失败，请手动登录。", "warn");
    }
  }
})();
