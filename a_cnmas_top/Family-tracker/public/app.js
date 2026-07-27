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

/* --------------------------- STOCK CONFIG -------------------------------- */
// Stock files live in a dedicated folder. By default we reuse the income
// folder's share URL (files are separately named, so data stays independent).
// Replace with a dedicated folder's 1drv.ms share URL if you want them apart.
const STOCK_FOLDER_SHARE_URL = INCOME_FOLDER_SHARE_URL;
const STOCK_RECORDS_FILE = "stock-records.json";
const STOCK_META_FILE = "stock-meta.json"; // {codes:{custom,hidden}, accounts:{custom,hidden}, fees}

/* --------------------------- MEDICAL CONFIG ------------------------------ */
// Medical records live in their own dedicated shared folder (both accounts
// must have access). File sits at the folder root.
const MEDICAL_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgBiVoPS0SYBSbfbXr-vtMdnAUqsXIOMJFgfPigTUBFY4Ok?email=celine_mas%40outlook.com&e=KniYbc";
const MEDICAL_RECORDS_FILE = "medical-records.json";

/* --------------------------- EXTRA MODULES CONFIG ------------------------ */
// A single shared folder holds the data files for all the extra modules
// (Celine 收入, 借还款, 理财, 储值卡, 车辆保养, 健康). One JSON per module.
const EXTRA_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgCbS1q24rUkSajMLkNxkDtLAcWbFicegxxe-3yOfzGATqc?email=celine_mas%40outlook.com&e=76QT2n";
const CELINE_INCOME_FILE = "celine-income.json";

// Default fee rates (editable in the stock Settings tab, stored in stock-meta.json).
// Rates are plain decimals (0.0001 = 万一); commMin is a flat 元 floor.
const STK_FEE_DEFAULTS = {
  a: { comm: 0.0001, commMin: 5, stamp: 0.0005,   transfer: 0.00001 }, // A股(非H)
  h: { comm: 0.0002, commMin: 5, stamp: 0.001127, transfer: 0 },       // H股(H开头)
};

// Base (seed) stock codes + accounts, from the migrated data.
const STOCK_BASE_CODES = [
  "000999华润三九", "600132重庆啤酒", "600690海尔智家", "600845宝信软件",
  "600885宏发股份", "603259药明康德", "603369今世缘", "603899晨光文具",
  "H01548金斯瑞", "东方电气600875", "隆基绿能601012",
];
const STOCK_BASE_ACCOUNTS = ["15--7583教", "88--5302"];

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
   medCatHint: $("medCatHint"),
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
  // --- stock mode ---
  modeStockBtn: $("modeStockBtn"),
  stockApp: $("stockApp"),
  // --- stock tabs ---
  stkTabAddBtn: $("stkTabAddBtn"),
  stkTabListBtn: $("stkTabListBtn"),
  stkTabChartBtn: $("stkTabChartBtn"),
  stkTabSettingsBtn: $("stkTabSettingsBtn"),
  stkTabAdd: $("stkTabAdd"),
  stkTabList: $("stkTabList"),
  stkTabChart: $("stkTabChart"),
  stkTabSettings: $("stkTabSettings"),
  // --- stock form ---
  stkForm: $("stkForm"),
  stkEditId: $("stkEditId"),
  stkCode: $("stkCode"),
  stkAccount: $("stkAccount"),
  stkAddCode: $("stkAddCode"),
  stkHideCode: $("stkHideCode"),
  stkAddAccount: $("stkAddAccount"),
  stkHideAccount: $("stkHideAccount"),
  stkPrice: $("stkPrice"),
  stkShares: $("stkShares"),
  stkFx: $("stkFx"),
  stkFxField: $("stkFxField"),
  stkDate: $("stkDate"),
  stkAmount: $("stkAmount"),
  stkCommission: $("stkCommission"),
  stkStamp: $("stkStamp"),
  stkTransfer: $("stkTransfer"),
  stkTotal: $("stkTotal"),
  stkDerivedTitle: $("stkDerivedTitle"),
  stkDerivedNote: $("stkDerivedNote"),
  stkAddBtn: $("stkAddBtn"),
  stkCancelBtn: $("stkCancelBtn"),
  stkFormTitle: $("stkFormTitle"),
  // --- stock list ---
  stkBody: $("stkBody"),
  stkRecordCount: $("stkRecordCount"),
  stkEmptyHint: $("stkEmptyHint"),
  stkFilterDate: $("stkFilterDate"),
  stkSearchInput: $("stkSearchInput"),
  stkFilterCode: $("stkFilterCode"),
  stkFilterAccount: $("stkFilterAccount"),
  stkClearFilterBtn: $("stkClearFilterBtn"),
  stkShowAllBtn: $("stkShowAllBtn"),
  // --- stock charts ---
  stkChartTotal: $("stkChartTotal"),
  stkChartTotalLabel: $("stkChartTotalLabel"),
  stkChartYear: $("stkChartYear"),
  stkAcctBreakdown: $("stkAcctBreakdown"),
  stkPnlBars: $("stkPnlBars"),
  stkPnlLegend: $("stkPnlLegend"),
  stkFeeBars: $("stkFeeBars"),
  stkChartEmpty: $("stkChartEmpty"),
  // --- stock settings ---
  stkHiddenCodes: $("stkHiddenCodes"),
  stkHiddenAccounts: $("stkHiddenAccounts"),
  // --- stock fee settings ---
  feeAComm: $("feeAComm"),
  feeACommMin: $("feeACommMin"),
  feeAStamp: $("feeAStamp"),
  feeATransfer: $("feeATransfer"),
  feeHComm: $("feeHComm"),
  feeHCommMin: $("feeHCommMin"),
  feeHStamp: $("feeHStamp"),
  feeHTransfer: $("feeHTransfer"),
  feeSaveBtn: $("feeSaveBtn"),
  feeResetBtn: $("feeResetBtn"),
  // --- medical mode ---
  modeMedicalBtn: $("modeMedicalBtn"),
  medicalApp: $("medicalApp"),
  // --- medical tabs ---
  medTabAddBtn: $("medTabAddBtn"),
  medTabListBtn: $("medTabListBtn"),
  medTabChartBtn: $("medTabChartBtn"),
  medTabAdd: $("medTabAdd"),
  medTabList: $("medTabList"),
  medTabChart: $("medTabChart"),
  // --- medical form ---
   medForm: $("medForm"),
   medEditId: $("medEditId"),
   medPerson: $("medPerson"),
   medPersonCustom: $("medPersonCustom"),
   medTitle: $("medTitle"),
  medTitleList: $("medTitleList"),
  medDate: $("medDate"),
  medPersonal: $("medPersonal"),
  medInsurance: $("medInsurance"),
  medTotal: $("medTotal"),
  medNote: $("medNote"),
  medAddBtn: $("medAddBtn"),
  medCancelBtn: $("medCancelBtn"),
  medFormTitle: $("medFormTitle"),
  // --- medical list ---
  medBody: $("medBody"),
  medRecordCount: $("medRecordCount"),
  medEmptyHint: $("medEmptyHint"),
  medFilterDate: $("medFilterDate"),
  medSearchInput: $("medSearchInput"),
  medClearFilterBtn: $("medClearFilterBtn"),
  medShowAllBtn: $("medShowAllBtn"),
  // --- medical charts ---
  medChartTitle: $("medChartTitle"),
  medChartTotal: $("medChartTotal"),
  medChartYear: $("medChartYear"),
  medWaterfall: $("medWaterfall"),
   medMonthBars: $("medMonthBars"),
   medCatLegend: $("medCatLegend"),
   medPersonBars: $("medPersonBars"),
   medPersonLegend: $("medPersonLegend"),
   medChartEmpty: $("medChartEmpty"),
  // --- more dropdown + celine mode ---
  modeMoreWrap: $("modeMoreWrap"),
  modeMoreBtn: $("modeMoreBtn"),
  modeMoreMenu: $("modeMoreMenu"),
  celineApp: $("celineApp"),
  // --- celine tabs ---
  celTabAddBtn: $("celTabAddBtn"),
  celTabListBtn: $("celTabListBtn"),
  celTabChartBtn: $("celTabChartBtn"),
  celTabAdd: $("celTabAdd"),
  celTabList: $("celTabList"),
  celTabChart: $("celTabChart"),
  // --- celine form ---
  celForm: $("celForm"),
  celEditId: $("celEditId"),
  celDate: $("celDate"),
  celType: $("celType"),
  celAmount: $("celAmount"),
  celNote: $("celNote"),
  celAddBtn: $("celAddBtn"),
  celCancelBtn: $("celCancelBtn"),
  celFormTitle: $("celFormTitle"),
  // --- celine list ---
  celBody: $("celBody"),
  celRecordCount: $("celRecordCount"),
  celEmptyHint: $("celEmptyHint"),
  celFilterDate: $("celFilterDate"),
  celSearchInput: $("celSearchInput"),
  celClearFilterBtn: $("celClearFilterBtn"),
  celShowAllBtn: $("celShowAllBtn"),
  // --- celine charts ---
  celChartTitle: $("celChartTitle"),
  celChartTotal: $("celChartTotal"),
  celChartYear: $("celChartYear"),
  celWaterfall: $("celWaterfall"),
  celMonthBars: $("celMonthBars"),
  celCatLegend: $("celCatLegend"),
  celChartEmpty: $("celChartEmpty"),
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
    // Silent renewal failed (session/refresh token expired). Use a full-page
    // redirect instead of a popup so browser popup blockers can't stop it.
    // The page navigates away; on return handleRedirectPromise() restores the
    // session and re-runs onSignedIn().
    setStatus("正在跳转到登录页面…", "info");
    await msalApp.acquireTokenRedirect(req);
    // Navigation started; this promise never resolves. Return to satisfy callers.
    return new Promise(() => {});
  }
}

async function login() {
  // Full-page redirect login — never blocked by popup blockers. The response
  // is handled by handleRedirectPromise() during boot when the page returns.
  await msalApp.loginRedirect({ scopes: SCOPES });
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

  // Block manual creation of 日常生活/看病/看病 — those come from 看病.
  els.iCat.addEventListener("change", updateMedCatLock);
  els.iiCat.addEventListener("change", updateMedCatLock);
  els.iiiCat.addEventListener("change", updateMedCatLock);
}

// Disable "添加到列表" when a NEW record targets 日常生活/看病/看病
// (those are auto-recorded via the 看病 feature). Editing is unaffected.
function updateMedCatLock() {
  const locked =
    !els.editId.value &&
    els.iCat.value === "日常生活" &&
    els.iiCat.value === "看病" &&
    els.iiiCat.value === "看病";
  els.addBtn.disabled = locked;
  els.medCatHint.classList.toggle("hidden", !locked);
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
  updateMedCatLock();
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
  if (!isEdit && rec.i_cat === "日常生活" && rec.ii_cat === "看病" && rec.iii_cat === "看病") {
    setStatus("该分类由「看病」功能记录，请通过「看病」提交。", "warn");
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
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
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
   updateMedCatLock();
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
  if (name === "settings") { renderHiddenList(); }
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
  els.incShowAllBtn.textContent = incShowAll ? "显示50条" : "显示全部";
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
  const isStk = next === "stock";
  const isMed = next === "medical";
  const isSpend = next === "spending";
  const isCel = next === "celine";
  els.modeSpendingBtn.classList.toggle("active", isSpend);
  els.modeIncomeBtn.classList.toggle("active", isInc);
  els.modeStockBtn.classList.toggle("active", isStk);
  els.modeMedicalBtn.classList.toggle("active", isMed);
  els.modeMoreBtn.classList.toggle("active", isCel);
  els.spendingApp.classList.toggle("hidden", !isSpend);
  els.incomeApp.classList.toggle("hidden", !isInc);
  els.stockApp.classList.toggle("hidden", !isStk);
  els.medicalApp.classList.toggle("hidden", !isMed);
  els.celineApp.classList.toggle("hidden", !isCel);
  els.modeMoreMenu.classList.add("hidden");
  if (!account) return;
  if (isInc) {
    // Load income once; clicking 收入 never triggers a 支出 (re)load.
    try { await incLoad(); }
    catch (e) { setStatus("收入数据载入失败：" + (e.message || e), "error"); }
  } else if (isStk) {
    try { await stkLoad(); }
    catch (e) { setStatus("股票数据载入失败：" + (e.message || e), "error"); }
  } else if (isMed) {
    try { await medLoad(); }
    catch (e) { setStatus("看病数据载入失败：" + (e.message || e), "error"); }
  } else if (isCel) {
    try { await celLoad(); }
    catch (e) { setStatus("Celine 收入数据载入失败：" + (e.message || e), "error"); }
  } else if (!spendingLoaded) {
    // Load spending only if it hasn't been fetched yet this session.
    try { await loadRecords(); }
    catch (e) { setStatus("支出数据载入失败：" + (e.message || e), "error"); }
  }
}

function incWireEvents() {
  els.modeSpendingBtn.onclick = () => setMode("spending");
  els.modeIncomeBtn.onclick = () => setMode("income");
  els.modeStockBtn.onclick = () => setMode("stock");
  els.modeMedicalBtn.onclick = () => setMode("medical");

  // 更多 ▾ dropdown: toggle menu, pick a mode, close on outside-click.
  els.modeMoreBtn.onclick = (e) => {
    e.stopPropagation();
    els.modeMoreMenu.classList.toggle("hidden");
  };
  els.modeMoreMenu.querySelectorAll(".mode-more-item").forEach((it) => {
    it.onclick = () => { els.modeMoreMenu.classList.add("hidden"); setMode(it.dataset.mode); };
  });
  document.addEventListener("click", (e) => {
    if (!els.modeMoreWrap.contains(e.target)) els.modeMoreMenu.classList.add("hidden");
  });


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

/* ========================================================================= *
 *                            STOCK  MODULE                                  *
 * ========================================================================= */
let stockRecords = [];
let stkEtag = null;
let stockLoaded = false;
let stkDriveBase = null;
let stkMeta = { codes: { custom: [], hidden: [] }, accounts: { custom: [], hidden: [] }, fees: stkCloneFees(STK_FEE_DEFAULTS) };
let stkEtagMeta = null;
let stkShowAll = false;
let stkFilterOn = false;
let stkTab = "add";
let stkSearchText = "";
let stkCodeFilter = "";
let stkAccountFilter = "";
let stkChartYearVal = null;
let stkSearchTimer = null;

function stkNormMeta(d) {
  d = (d && typeof d === "object") ? d : {};
  const arr = (x) => (Array.isArray(x) ? x.slice() : []);
  const codes = (d.codes && typeof d.codes === "object") ? d.codes : {};
  const accts = (d.accounts && typeof d.accounts === "object") ? d.accounts : {};
  return {
    codes: { custom: arr(codes.custom), hidden: arr(codes.hidden) },
    accounts: { custom: arr(accts.custom), hidden: arr(accts.hidden) },
    fees: stkNormFees(d.fees),
  };
}
// Fill missing/invalid fee fields with defaults; keep numbers only.
function stkNormFees(f) {
  f = (f && typeof f === "object") ? f : {};
  const grp = (g, def) => {
    g = (g && typeof g === "object") ? g : {};
    const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    return {
      comm: num(g.comm, def.comm),
      commMin: num(g.commMin, def.commMin),
      stamp: num(g.stamp, def.stamp),
      transfer: num(g.transfer, def.transfer),
    };
  };
  return { a: grp(f.a, STK_FEE_DEFAULTS.a), h: grp(f.h, STK_FEE_DEFAULTS.h) };
}
function stkCloneFees(f) {
  return { a: Object.assign({}, f.a), h: Object.assign({}, f.h) };
}
function stkMergeMeta(target, src) {
  src = stkNormMeta(src);
  const uni = (t, s) => { for (const x of s) if (!t.includes(x)) t.push(x); };
  uni(target.codes.custom, src.codes.custom);
  uni(target.codes.hidden, src.codes.hidden);
  uni(target.accounts.custom, src.accounts.custom);
  uni(target.accounts.hidden, src.accounts.hidden);
  // Fees: keep local (they represent the current, just-edited rates).
  if (!target.fees) target.fees = stkNormFees(src.fees);
}
function stkVisCodes() {
  const all = STOCK_BASE_CODES.concat(stkMeta.codes.custom.filter((x) => !STOCK_BASE_CODES.includes(x)));
  return all.filter((x) => !stkMeta.codes.hidden.includes(x));
}
function stkVisAccounts() {
  const all = STOCK_BASE_ACCOUNTS.concat(stkMeta.accounts.custom.filter((x) => !STOCK_BASE_ACCOUNTS.includes(x)));
  return all.filter((x) => !stkMeta.accounts.hidden.includes(x));
}

/* ------------------------ Stock derived formulas ------------------------- *
 * H-share detection: code[0] === "H". All fee formulas match the migration
 * script (tools/migrate_stock.py) and were verified against the source CSV.
 * Intermediate values are kept unrounded; 总金额 sums the unrounded parts.  */
function stkComputeDerived(code, price, shares, fx) {
  const isH = !!code && code[0] === "H";
  const rate = isH ? (fx || 1) : 1;
  const amt = isH ? price * shares * rate : price * shares;

  const fees = (stkMeta && stkMeta.fees) ? stkMeta.fees : STK_FEE_DEFAULTS;
  const fee = isH ? fees.h : fees.a;

  // Commission: magnitude = max(最低佣金, |金额|×费率), always a cost (negative).
  const comm = -Math.max(fee.commMin, Math.abs(amt) * fee.comm);

  let stamp;
  if (isH) stamp = shares <= 0 ? amt * fee.stamp : -amt * fee.stamp;
  else stamp = shares <= 0 ? 0 : -amt * fee.stamp;

  let transfer;
  if (isH) transfer = 0;
  else transfer = shares <= 0 ? amt * fee.transfer : -amt * fee.transfer;

  const total = amt + comm + stamp + transfer;
  return {
    amount: round2(amt),
    commission: round2(comm),
    stampTax: round2(stamp),
    transferFee: round2(transfer),
    total: round2(total),
  };
}

/* ------------------------- Stock Graph I/O ------------------------------- */
async function stkResolveFolder(token) {
  if (stkDriveBase) return;
  const sid = encodeShareUrl(STOCK_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问股票文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  stkDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function stkFileUrls(name) {
  return {
    content: `${stkDriveBase}:/${name}:/content`,
    meta: `${stkDriveBase}:/${name}?$select=id,eTag`,
  };
}
async function stkReadETag(token, name) {
  const { meta } = stkFileUrls(name);
  const res = await fetch(meta, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.eTag || null;
}
async function stkReadJson(token, name) {
  const { content } = stkFileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { data: null, etag: null, exists: false };
  if (!res.ok) throw new Error("载入失败(" + name + ")：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const etag = res.headers.get("ETag") || (await stkReadETag(token, name));
  return { data, etag, exists: true };
}
async function stkWriteJson(token, name, getData, etag, applyOnConflict) {
  const { content } = stkFileUrls(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (etag) headers["If-Match"] = etag;
    const data = getData();
    const body = JSON.stringify(data);
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      const newEtag = item.eTag || (await stkReadETag(token, name));
      if (name === STOCK_RECORDS_FILE) {
        idbSet(STOCK_RECORDS_FILE, newEtag, (data && data.records) || []);
      }
      return newEtag;
    }
    if (res.status === 412 && applyOnConflict) {
      setStatus("有人同时更新了股票数据，正在合并…", "warn");
      const fresh = await stkReadJson(token, name);
      applyOnConflict(fresh.data);
      etag = fresh.etag;
      stkRender();
      continue;
    }
    throw new Error("保存失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存冲突，重试多次仍失败(" + name + ")。");
}

/* ---------------------------- Stock load --------------------------------- */
async function stkLoad() {
  if (stockLoaded) return;
  setStatus("正在载入股票数据…");
  const token = await getToken();
  await stkResolveFolder(token);
  const m = await stkReadJson(token, STOCK_META_FILE);
  stkMeta = stkNormMeta(m.data);
  stkEtagMeta = m.etag;

  const liveEtag = await stkReadETag(token, STOCK_RECORDS_FILE);
  const cached = liveEtag ? await idbGet(STOCK_RECORDS_FILE) : null;
  if (cached && cached.etag === liveEtag && Array.isArray(cached.records)) {
    stockRecords = cached.records;
    stkEtag = liveEtag;
  } else {
    const r = await stkReadJson(token, STOCK_RECORDS_FILE);
    stockRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
    stkEtag = r.etag;
    if (r.exists && r.etag) idbSet(STOCK_RECORDS_FILE, r.etag, stockRecords);
  }
  stockLoaded = true;
  stkInitForm();
  stkFillFilters();
  stkRender();
  stkRenderHidden();
  setStatus("已载入 " + stockRecords.length + " 条交易记录。", "ok", 2000);
}

async function stkSaveMeta() {
  const token = await getToken();
  stkEtagMeta = await stkWriteJson(
    token, STOCK_META_FILE, () => stkMeta, stkEtagMeta,
    (fresh) => { stkMergeMeta(stkMeta, fresh); }
  );
}

function stkApplyOp(list, op) {
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

async function stkPersist(op) {
  setStatus("正在保存交易…");
  const token = await getToken();
  stkEtag = await stkWriteJson(
    token, STOCK_RECORDS_FILE, () => ({ records: stockRecords }), stkEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      stockRecords = stkApplyOp(list, op);
    }
  );
  setStatus("已保存。", "ok", 3000);
}

/* ---------------------------- Stock form --------------------------------- */
function stkFillSelect(sel, options, placeholder, keep) {
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
function stkRebuildSelects(keepCode, keepAccount) {
  stkFillSelect(els.stkCode, stkVisCodes(), "请选择股票代码", keepCode);
  if (keepCode) els.stkCode.value = keepCode;
  stkFillSelect(els.stkAccount, stkVisAccounts(), "请选择交易账户", keepAccount);
  if (keepAccount) els.stkAccount.value = keepAccount;
}
function stkNum(el) { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }

// Toggle the 汇率 field visibility based on whether the selected code is H-share.
function stkUpdateFxVisibility() {
  const code = els.stkCode.value || "";
  const isH = code[0] === "H";
  if (els.stkFxField) els.stkFxField.style.display = isH ? "" : "none";
}

// Dividend/bonus mode: shares field is non-empty AND exactly 0. Such a record
// represents a cash event (股息/红利/现金调整) with manually-entered amounts.
function stkIsDividend() {
  const raw = els.stkShares.value.trim();
  return raw !== "" && stkNum(els.stkShares) === 0;
}

// Toggle the 5 derived fields between read-only (auto-computed) and editable
// (manual, dividend mode), and update the section title/note accordingly.
const STK_DERIVED_FIELDS = ["stkAmount", "stkCommission", "stkStamp", "stkTransfer", "stkTotal"];
function stkSetDerivedEditable(editable) {
  for (const k of STK_DERIVED_FIELDS) {
    const el = els[k];
    el.readOnly = !editable;
    if (editable) el.removeAttribute("tabindex"); else el.setAttribute("tabindex", "-1");
    el.classList.toggle("editable", editable);
  }
  if (editable) {
    els.stkDerivedTitle.textContent = "手动填写（股息/红利）";
    els.stkDerivedNote.textContent = "股数为 0 视作股息/红利/现金调整，请手动填写以下金额。";
  } else {
    els.stkDerivedTitle.textContent = "自动计算（只读）";
    els.stkDerivedNote.textContent = "成交金额/佣金/印花税/过户费/总金额 按交易规则自动算出，无需填写。";
  }
}

// Live-preview the derived (read-only) fields from the current inputs.
function stkRecalc() {
  // Dividend mode: fields are user-editable; never overwrite/clear them.
  if (stkIsDividend()) { stkSetDerivedEditable(true); return; }
  stkSetDerivedEditable(false);
  const code = els.stkCode.value || "";
  const price = stkNum(els.stkPrice);
  const shares = stkNum(els.stkShares);
  const fx = stkNum(els.stkFx);
  if (!code || !price || !shares) {
    els.stkAmount.value = ""; els.stkCommission.value = "";
    els.stkStamp.value = ""; els.stkTransfer.value = ""; els.stkTotal.value = "";
    return;
  }
  const d = stkComputeDerived(code, price, shares, fx);
  els.stkAmount.value = d.amount;
  els.stkCommission.value = d.commission;
  els.stkStamp.value = d.stampTax;
  els.stkTransfer.value = d.transferFee;
  els.stkTotal.value = d.total;
}

function stkInitForm() {
  stkRebuildSelects();
  stkResetForm();
}
function stkResetForm() {
  els.stkForm.reset();
  els.stkEditId.value = "";
  els.stkShares.value = "-1";   // default: buy 1 share (买入为负)
  els.stkDate.value = todayStr();
  stkRebuildSelects();
  stkUpdateFxVisibility();
  stkRecalc();
  els.stkFormTitle.textContent = "添加交易";
  els.stkAddBtn.textContent = "添加并保存";
  hide(els.stkCancelBtn);
}

async function stkOnSubmit(e) {
  e.preventDefault();
  const isEdit = !!els.stkEditId.value;
  const code = els.stkCode.value;
  const price = stkNum(els.stkPrice);
  const sharesRaw = els.stkShares.value.trim();
  const shares = stkNum(els.stkShares);
  const isDividend = sharesRaw !== "" && shares === 0;
  const isH = !!code && code[0] === "H";
  const fx = isH ? stkNum(els.stkFx) : 0;
  if (!code) { setStatus("请选择股票代码。", "warn"); return; }
  if (!els.stkAccount.value) { setStatus("请选择交易账户。", "warn"); return; }
  if (sharesRaw === "") { setStatus("请填写交易股数（买入负、卖出正；股息填 0）。", "warn"); return; }
  if (!isDividend && !price) { setStatus("请填写交易价格。", "warn"); return; }
  if (isH && !isDividend && !fx) { setStatus("H 股请填写汇率。", "warn"); return; }
  if (!els.stkDate.value) { setStatus("请选择交易时间。", "warn"); return; }

  // Dividend mode: take the manually-entered amounts as-is; otherwise compute.
  const d = isDividend
    ? {
        amount: round2(stkNum(els.stkAmount)),
        commission: round2(stkNum(els.stkCommission)),
        stampTax: round2(stkNum(els.stkStamp)),
        transferFee: round2(stkNum(els.stkTransfer)),
        total: round2(stkNum(els.stkTotal)),
      }
    : stkComputeDerived(code, price, shares, fx);
  const rec = {
    id: els.stkEditId.value || uuid(),
    code: code,
    account: els.stkAccount.value,
    price: price,
    shares: shares,
    fx: isH ? fx : 0,
    date: els.stkDate.value,
    amount: d.amount,
    commission: d.commission,
    stampTax: d.stampTax,
    transferFee: d.transferFee,
    total: d.total,
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };

  const snap = stockRecords.slice();
  if (isEdit) {
    const i = stockRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = stockRecords[i].createdBy || rec.createdBy; stockRecords[i] = rec; }
    else stockRecords.push(rec);
  } else {
    stockRecords.push(rec);
  }
  els.stkAddBtn.disabled = true;
  stkFillFilters();
  stkRender();
  try {
    await stkPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    stkResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    stockRecords = snap; stkRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.stkAddBtn.disabled = false;
  }
}

function stkStartEdit(id) {
  const r = stockRecords.find((x) => x.id === id);
  if (!r) return;
  els.stkEditId.value = r.id;
  stkRebuildSelects(r.code, r.account);
  els.stkPrice.value = r.price;
  els.stkShares.value = r.shares;
  els.stkFx.value = r.fx || "";
  els.stkDate.value = r.date;
  // Pre-fill derived fields from the record; stkRecalc recomputes for normal
  // trades (overwriting) but keeps these values for dividend (shares==0) rows.
  els.stkAmount.value = r.amount;
  els.stkCommission.value = r.commission;
  els.stkStamp.value = r.stampTax;
  els.stkTransfer.value = r.transferFee;
  els.stkTotal.value = r.total;
  stkUpdateFxVisibility();
  stkRecalc();
  els.stkFormTitle.textContent = "编辑交易";
  els.stkAddBtn.textContent = "保存修改";
  show(els.stkCancelBtn);
  stkSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function stkDelete(id) {
  const r = stockRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条交易记录吗？\n${r.date} ${r.code} ${r.account} ${fmtAmount(r.total)}`)) return;
  const snap = stockRecords.slice();
  stockRecords = stockRecords.filter((x) => x.id !== id);
  stkRender();
  try {
    await stkPersist({ type: "delete", id });
  } catch (err) {
    stockRecords = snap; stkRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* ------------------------- Stock add/hide meta --------------------------- */
async function stkAddCodeFn() {
  const name = (prompt("新增股票代码（含名称，如 000001平安银行；H 股以 H 开头）：") || "").trim();
  if (!name) return;
  if (!stkMeta.codes.custom.includes(name) && !STOCK_BASE_CODES.includes(name))
    stkMeta.codes.custom.push(name);
  stkMeta.codes.hidden = stkMeta.codes.hidden.filter((x) => x !== name);
  stkRebuildSelects(name, els.stkAccount.value);
  stkUpdateFxVisibility(); stkRecalc();
  try { setStatus("正在保存…"); await stkSaveMeta(); setStatus("已新增股票：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function stkAddAccountFn() {
  const name = (prompt("新增交易账户名称：") || "").trim();
  if (!name) return;
  if (!stkMeta.accounts.custom.includes(name) && !STOCK_BASE_ACCOUNTS.includes(name))
    stkMeta.accounts.custom.push(name);
  stkMeta.accounts.hidden = stkMeta.accounts.hidden.filter((x) => x !== name);
  stkRebuildSelects(els.stkCode.value, name);
  try { setStatus("正在保存…"); await stkSaveMeta(); setStatus("已新增账户：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function stkHideCodeFn() {
  const v = els.stkCode.value;
  if (!v) { setStatus("请先选择要隐藏的股票代码。", "warn"); return; }
  if (!confirm(`隐藏股票「${v}」？（已有记录仍会显示，可在设置中恢复）`)) return;
  if (!stkMeta.codes.hidden.includes(v)) stkMeta.codes.hidden.push(v);
  stkRebuildSelects(); stkResetForm(); stkRenderHidden();
  try { setStatus("正在保存…"); await stkSaveMeta(); setStatus("已隐藏：" + v, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function stkHideAccountFn() {
  const v = els.stkAccount.value;
  if (!v) { setStatus("请先选择要隐藏的交易账户。", "warn"); return; }
  if (!confirm(`隐藏账户「${v}」？（已有记录仍会显示，可在设置中恢复）`)) return;
  if (!stkMeta.accounts.hidden.includes(v)) stkMeta.accounts.hidden.push(v);
  stkRebuildSelects(); stkResetForm(); stkRenderHidden();
  try { setStatus("正在保存…"); await stkSaveMeta(); setStatus("已隐藏：" + v, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
async function stkRestore(kind, name) {
  if (kind === "code") stkMeta.codes.hidden = stkMeta.codes.hidden.filter((x) => x !== name);
  else stkMeta.accounts.hidden = stkMeta.accounts.hidden.filter((x) => x !== name);
  stkRebuildSelects(); stkRenderHidden();
  try { setStatus("正在保存…"); await stkSaveMeta(); setStatus("已恢复：" + name, "ok", 3000); }
  catch (e) { setStatus("保存失败：" + (e.message || e), "error"); }
}
function stkRenderHidden() {
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
      btn.onclick = () => stkRestore(kind, name);
      row.appendChild(span); row.appendChild(btn); container.appendChild(row);
    }
  };
  build(els.stkHiddenCodes, stkMeta.codes.hidden, "code");
  build(els.stkHiddenAccounts, stkMeta.accounts.hidden, "account");
}

/* ------------------------- Stock fee settings ---------------------------- */
// Fill the fee inputs from stkMeta.fees (decimals as stored).
function stkRenderFees() {
  const f = (stkMeta && stkMeta.fees) ? stkMeta.fees : STK_FEE_DEFAULTS;
  const set = (el, v) => { if (el) el.value = (v != null ? v : ""); };
  set(els.feeAComm, f.a.comm);      set(els.feeACommMin, f.a.commMin);
  set(els.feeAStamp, f.a.stamp);    set(els.feeATransfer, f.a.transfer);
  set(els.feeHComm, f.h.comm);      set(els.feeHCommMin, f.h.commMin);
  set(els.feeHStamp, f.h.stamp);    set(els.feeHTransfer, f.h.transfer);
}

// Read a fee input; fall back to the given default when blank/invalid.
function stkReadFee(el, def) {
  const v = parseFloat(el && el.value);
  return (isFinite(v) && v >= 0) ? v : def;
}

async function stkSaveFees() {
  const d = STK_FEE_DEFAULTS;
  stkMeta.fees = {
    a: {
      comm: stkReadFee(els.feeAComm, d.a.comm),
      commMin: stkReadFee(els.feeACommMin, d.a.commMin),
      stamp: stkReadFee(els.feeAStamp, d.a.stamp),
      transfer: stkReadFee(els.feeATransfer, d.a.transfer),
    },
    h: {
      comm: stkReadFee(els.feeHComm, d.h.comm),
      commMin: stkReadFee(els.feeHCommMin, d.h.commMin),
      stamp: stkReadFee(els.feeHStamp, d.h.stamp),
      transfer: stkReadFee(els.feeHTransfer, d.h.transfer),
    },
  };
  stkRenderFees();   // reflect normalized values back
  stkRecalc();       // update the add-form's auto-computed fees immediately
  try {
    setStatus("正在保存费率…");
    await stkSaveMeta();
    setStatus("已保存费率设置。", "ok", 3000);
  } catch (e) {
    setStatus("保存费率失败：" + (e.message || e), "error");
  }
}

async function stkResetFees() {
  stkMeta.fees = stkCloneFees(STK_FEE_DEFAULTS);
  stkRenderFees();
  stkRecalc();
  try {
    setStatus("正在恢复默认费率…");
    await stkSaveMeta();
    setStatus("已恢复默认费率。", "ok", 3000);
  } catch (e) {
    setStatus("保存费率失败：" + (e.message || e), "error");
  }
}

/* ---------------------------- Stock filters ------------------------------ */
// Populate the 代码 / 账户 filter dropdowns from records + meta.
function stkFillFilters() {
  const codes = new Set(stkVisCodes());
  const accounts = new Set(stkVisAccounts());
  for (const r of stockRecords) { if (r.code) codes.add(r.code); if (r.account) accounts.add(r.account); }
  const fill = (sel, values, placeholder, keep) => {
    if (!sel) return;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = placeholder; sel.appendChild(ph);
    for (const v of [...values].sort()) {
      const o = document.createElement("option");
      o.value = v; o.textContent = v; if (v === keep) o.selected = true;
      sel.appendChild(o);
    }
    sel.value = keep || "";
  };
  fill(els.stkFilterCode, codes, "全部股票", stkCodeFilter);
  fill(els.stkFilterAccount, accounts, "全部账户", stkAccountFilter);
}

/* ---------------------------- Stock table -------------------------------- */
function stkRender() {
  const monthFilter = stkFilterOn && els.stkFilterDate ? els.stkFilterDate.value.slice(0, 7) : "";
  const sorted = [...stockRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const q = stkSearchText.trim().toLowerCase();
  let view = sorted;
  if (stkCodeFilter) view = view.filter((r) => r.code === stkCodeFilter);
  if (stkAccountFilter) view = view.filter((r) => r.account === stkAccountFilter);
  if (q) view = view.filter((r) =>
    (r.code || "").toLowerCase().includes(q) || (r.account || "").toLowerCase().includes(q));

  const anyFilter = !!(monthFilter || stkCodeFilter || stkAccountFilter || q);
  let limited = false;
  if (monthFilter) view = view.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  if (!anyFilter && !stkShowAll) { limited = view.length > PAGE_LIMIT; view = view.slice(0, PAGE_LIMIT); }

  els.stkBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    const sharesCls = (Number(r.shares) || 0) < 0 ? "num neg" : "num";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.account)}</td>
      <td class="num">${fmtAmount(r.price)}</td>
      <td class="${sharesCls}">${fmtInt(r.shares)}</td>
      <td class="num strong">${fmtAmount(r.total)}</td>
      <td class="num">${fmtAmount(r.amount)}</td>
      <td class="num">${fmtAmount(r.commission)}</td>
      <td class="num">${fmtAmount(r.stampTax)}</td>
      <td class="num">${fmtAmount(r.transferFee)}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => stkStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => stkDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.stkBody.appendChild(tr);
  }

  const total = stockRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.total) || 0), 0);
  if (anyFilter) els.stkRecordCount.textContent = `${view.length} 条，总金额合计 ${fmtAmount(sum)}`;
  else if (stkShowAll) els.stkRecordCount.textContent = `显示全部 ${total} 条`;
  else els.stkRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.stkClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.stkShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !stkShowAll));
  els.stkShowAllBtn.textContent = stkShowAll ? "显示50条" : "显示全部";
  els.stkEmptyHint.classList.toggle("hidden", view.length !== 0);
}

function stkScrollToDay(day) {
  if (!day) return;
  const rows = els.stkBody.querySelectorAll("tr[data-date]");
  let target = null;
  for (const tr of rows) {
    const d = tr.dataset.date;
    if (d === day) { target = tr; break; }
    if (d <= day) { target = tr; break; }
  }
  if (!target) target = rows[rows.length - 1] || null;
  if (!target) return;
  const tabs = document.querySelector("#stockApp .tabs");
  const controls = document.querySelector("#stkTabList .list-controls");
  const offset = (tabs ? tabs.offsetHeight : 0) + (controls ? controls.offsetHeight : 0) + 6;
  const y = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

/* ---------------------------- Stock charts ------------------------------- */
const STK_BAR_COLORS = [
  "#118DFF", "#26890D", "#E23DA8", "#F2C80F", "#E66C37",
  "#6B007B", "#3599B8", "#D64550", "#12239E", "#8AD4EB",
];

// Distinct years across all trades, ASCENDING (chronological x-axis).
function stkYearsAsc() {
  const s = new Set();
  for (const r of stockRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort();
}

// Realized P&L per (buy-year, account). Cleared-cycle detection is done per
// code+account independently. Returns byYearAcct: year -> (account -> pnl),
// the sorted account list, and yearTotals: year -> net pnl.
function stkRealizedByYearAccount() {
  const groups = new Map();
  for (const r of stockRecords) {
    const key = (r.code || "") + "\u0000" + (r.account || "(未知)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const byYearAcct = new Map();
  const accounts = new Set();
  for (const [key, trades] of groups) {
    const acct = key.slice(key.indexOf("\u0000") + 1);
    trades.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    let net = 0, sum = 0, buyYear = null;
    for (const r of trades) {
      const sh = Number(r.shares) || 0;
      net += sh;
      sum += Number(r.total) || 0;
      const y = (r.date || "").slice(0, 4);
      if (sh < 0 && y && (!buyYear || y < buyYear)) buyYear = y;
      if (Math.abs(net) < 0.5) { // cycle cleared
        const year = buyYear || y || "";
        if (!byYearAcct.has(year)) byYearAcct.set(year, new Map());
        const am = byYearAcct.get(year);
        am.set(acct, round2((am.get(acct) || 0) + sum));
        accounts.add(acct);
        net = 0; sum = 0; buyYear = null;
      }
    }
  }
  const yearTotals = new Map();
  for (const [year, am] of byYearAcct) {
    let t = 0; for (const v of am.values()) t += v;
    yearTotals.set(year, round2(t));
  }
  return { byYearAcct, accounts: [...accounts].sort(), yearTotals };
}

// Total fees (佣金+印花税+过户费, shown as positive cost) per year across ALL trades.
function stkFeesByYear() {
  const m = new Map();
  for (const r of stockRecords) {
    const y = (r.date || "").slice(0, 4);
    if (!y) continue;
    const fee = (Number(r.commission) || 0) + (Number(r.stampTax) || 0) + (Number(r.transferFee) || 0);
    m.set(y, round2((m.get(y) || 0) - fee)); // fees stored negative -> flip to positive cost
  }
  return m;
}

// Cumulative waterfall. `steps` = [{name, val, parts?}] chronological; a 合计 bar
// is appended. When a step has `parts` (array of {account, val}) and opts.colorOf
// is given, the year bar is split by account with positive contributions stacked
// UPWARD from the running base and negative ones stacked DOWNWARD (net = val).
// Otherwise a single fill is drawn (green/red by sign). Total bar is blue.
// A specific highlightYear dims the other year bars.
function stkBuildWaterfall(container, steps, opts) {
  opts = opts || {};
  const hl = opts.highlightYear;
  const posColor = opts.posColor || "#26890D";
  const negColor = opts.negColor || "#D64550";
  const colorOf = opts.colorOf || null;
  container.innerHTML = "";
  const anyData = steps.some((s) => s.val || (s.parts && s.parts.some((p) => p.val)));
  if (!steps.length || !anyData) {
    container.innerHTML = '<p class="muted">暂无数据。</p>';
    return;
  }
  let run = 0;
  const rows = [];
  for (const s of steps) {
    const prev = run;
    const val = round2(s.val || 0);
    run = round2(prev + val);
    let pos = 0, neg = 0;
    if (s.parts) { for (const p of s.parts) { if (p.val > 0) pos += p.val; else neg += p.val; } }
    else { if (val > 0) pos = val; else neg = val; }
    const hi = prev + pos, lo = prev + neg;
    rows.push({
      name: s.name, val, prev, run, parts: s.parts || null,
      low: Math.min(prev, run, lo), high: Math.max(prev, run, hi),
    });
  }
  const grand = run;
  let minD = 0, maxD = 0;
  for (const r of rows) { minD = Math.min(minD, r.low); maxD = Math.max(maxD, r.high); }
  minD = Math.min(minD, grand); maxD = Math.max(maxD, grand);
  const range = (maxD - minD) || 1;
  const pct = (v) => ((v - minD) / range) * 100;
  const zeroPct = pct(0);
  const showZero = minD < -0.005;

  rows.forEach((r, i) => {
    const dim = (hl && hl !== "ALL" && r.name !== hl) ? " dim" : "";
    const connector = i > 0
      ? `<div class="wf-connector" style="bottom:${pct(r.prev)}%"></div>` : "";
    let fills = "";
    if (r.parts && colorOf) {
      // positive parts stacked upward from prev
      let cum = r.prev;
      for (const p of r.parts.filter((p) => p.val > 0).sort((a, b) => b.val - a.val)) {
        const b = pct(cum), h = pct(cum + p.val) - pct(cum);
        fills += `<div class="wf-fill" style="bottom:${b}%;height:${h}%;background:${colorOf.get(p.account) || posColor}" title="${escapeHtml(p.account)}：${fmtAmount(p.val)}"></div>`;
        cum += p.val;
      }
      // negative parts stacked downward from prev
      cum = r.prev;
      for (const p of r.parts.filter((p) => p.val < 0).sort((a, b) => a.val - b.val)) {
        const b = pct(cum + p.val), h = pct(cum) - pct(cum + p.val);
        fills += `<div class="wf-fill" style="bottom:${b}%;height:${h}%;background:${colorOf.get(p.account) || negColor}" title="${escapeHtml(p.account)}：${fmtAmount(p.val)}"></div>`;
        cum += p.val;
      }
    } else if (r.val) {
      const color = r.val < 0 ? negColor : posColor;
      const b = pct(Math.min(r.prev, r.run));
      const h = pct(Math.max(r.prev, r.run)) - b;
      fills += `<div class="wf-fill" style="bottom:${b}%;height:${h}%;background:${color}"></div>`;
    }
    const col = document.createElement("div");
    col.className = "wf-col" + dim;
    col.innerHTML =
      `<div class="wf-track">` +
        connector +
        (showZero ? `<div class="stk-zero" style="bottom:${zeroPct}%"></div>` : "") +
        fills +
        (r.val ? `<div class="wf-val" style="bottom:${pct(r.high)}%">${fmtInt(r.val)}</div>` : "") +
      `</div>` +
      `<div class="wf-name">${r.name} 年</div>`;
    container.appendChild(col);
  });

  // Grand total bar.
  const tLow = Math.min(0, grand), tHigh = Math.max(0, grand);
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  tot.innerHTML =
    `<div class="wf-track">` +
      (showZero ? `<div class="stk-zero" style="bottom:${zeroPct}%"></div>` : "") +
      `<div class="wf-fill total" style="bottom:${pct(tLow)}%;height:${pct(tHigh) - pct(tLow)}%"></div>` +
      `<div class="wf-val" style="bottom:${pct(tHigh)}%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  container.appendChild(tot);
}

function stkRenderChart() {
  // Year selector: 全部年度 + each year (ascending). Selection highlights that
  // year across both charts and drives the 金额 total.
  const yearsAsc = stkYearsAsc();
  const cur = String(new Date().getFullYear());
  if (!stkChartYearVal) stkChartYearVal = "ALL";
  if (stkChartYearVal !== "ALL" && !yearsAsc.includes(stkChartYearVal)) {
    stkChartYearVal = yearsAsc.includes(cur) ? cur : "ALL";
  }
  els.stkChartYear.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "ALL"; allOpt.textContent = "全部年度";
  if (stkChartYearVal === "ALL") allOpt.selected = true;
  els.stkChartYear.appendChild(allOpt);
  for (const y of [...yearsAsc].reverse()) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === stkChartYearVal) o.selected = true;
    els.stkChartYear.appendChild(o);
  }

  const hasData = stockRecords.length > 0;
  els.stkChartEmpty.classList.toggle("hidden", hasData);
  if (!hasData) {
    els.stkPnlBars.innerHTML = ""; els.stkFeeBars.innerHTML = "";
    els.stkPnlLegend.innerHTML = "";
    els.stkAcctBreakdown.innerHTML = "";
    els.stkChartTotal.textContent = "0.00";
    els.stkChartTotalLabel.textContent = "已清仓盈亏合计";
    return;
  }

  const yr = stkChartYearVal;
  const { byYearAcct, accounts, yearTotals } = stkRealizedByYearAccount();

  // Stable account color map.
  const colorOf = new Map();
  accounts.forEach((a, i) => colorOf.set(a, STK_BAR_COLORS[i % STK_BAR_COLORS.length]));

  // Header total: selected year's realized P&L (or grand total when 全部年度).
  let headTotal = 0;
  if (yr === "ALL") { for (const v of yearTotals.values()) headTotal += v; }
  else headTotal = yearTotals.get(yr) || 0;
  els.stkChartTotal.textContent = fmtAmount(round2(headTotal));
  els.stkChartTotal.classList.toggle("neg", headTotal < 0);
  els.stkChartTotalLabel.textContent = (yr === "ALL" ? "全部年度" : yr + " 年") + "已清仓盈亏";

  // Per-account realized P&L for the selected year (grand total when 全部年度),
  // driven by the same year selector. Lists ALL accounts (0.00 when none).
  const acctPnl = new Map(accounts.map((a) => [a, 0]));
  if (yr === "ALL") {
    for (const [, am] of byYearAcct) for (const [a, v] of am) acctPnl.set(a, round2((acctPnl.get(a) || 0) + v));
  } else {
    for (const [a, v] of (byYearAcct.get(yr) || new Map())) acctPnl.set(a, round2(v));
  }
  els.stkAcctBreakdown.innerHTML = "";
  for (const a of accounts) {
    const v = round2(acctPnl.get(a) || 0);
    const item = document.createElement("div");
    item.className = "stk-acct-item";
    item.innerHTML =
      `<span class="legend-dot" style="background:${colorOf.get(a)}"></span>` +
      `<span class="stk-acct-name">${escapeHtml(a)}</span>` +
      `<span class="stk-acct-val${v < 0 ? " neg" : ""}">${fmtAmount(v)}</span>`;
    els.stkAcctBreakdown.appendChild(item);
  }

  // Chart 1: realized P&L waterfall, each year bar split by account.
  const pnlSteps = yearsAsc.map((y) => {
    const am = byYearAcct.get(y) || new Map();
    const parts = accounts.map((a) => ({ account: a, val: round2(am.get(a) || 0) })).filter((p) => p.val);
    const val = round2(parts.reduce((s, p) => s + p.val, 0));
    return { name: y, val, parts };
  });
  stkBuildWaterfall(els.stkPnlBars, pnlSteps, { highlightYear: yr, colorOf, posColor: "#26890D", negColor: "#D64550" });

  // P&L account legend.
  els.stkPnlLegend.innerHTML = "";
  for (const a of accounts) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="legend-dot" style="background:${colorOf.get(a)}"></span>` +
      `<span class="legend-name">${escapeHtml(a)}</span>`;
    els.stkPnlLegend.appendChild(row);
  }

  // Chart 2: fees waterfall by year (positive costs, single color).
  const feeMap = stkFeesByYear();
  const feeSteps = yearsAsc.map((y) => ({ name: y, val: round2(feeMap.get(y) || 0) }));
  stkBuildWaterfall(els.stkFeeBars, feeSteps, { highlightYear: yr, posColor: "#E66C37", negColor: "#D64550" });
}

/* ---------------------------- Stock tabs --------------------------------- */
function stkSwitchTab(name) {
  stkTab = name;
  const tabs = {
    add: { panel: els.stkTabAdd, btn: els.stkTabAddBtn },
    list: { panel: els.stkTabList, btn: els.stkTabListBtn },
    chart: { panel: els.stkTabChart, btn: els.stkTabChartBtn },
    settings: { panel: els.stkTabSettings, btn: els.stkTabSettingsBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") stkRenderChart();
  if (name === "settings") { stkRenderHidden(); stkRenderFees(); }
}

function stkWireEvents() {
  els.stkTabAddBtn.onclick = () => stkSwitchTab("add");
  els.stkTabListBtn.onclick = () => stkSwitchTab("list");
  els.stkTabChartBtn.onclick = () => stkSwitchTab("chart");
  els.stkTabSettingsBtn.onclick = () => stkSwitchTab("settings");

  els.stkForm.addEventListener("submit", stkOnSubmit);
  els.stkCancelBtn.onclick = stkResetForm;
  els.stkAddCode.onclick = stkAddCodeFn;
  els.stkAddAccount.onclick = stkAddAccountFn;
  els.stkHideCode.onclick = stkHideCodeFn;
  els.stkHideAccount.onclick = stkHideAccountFn;
  els.feeSaveBtn.onclick = stkSaveFees;
  els.feeResetBtn.onclick = stkResetFees;

  els.stkCode.addEventListener("change", () => { stkUpdateFxVisibility(); stkRecalc(); });
  ["stkPrice", "stkShares", "stkFx"].forEach((k) => els[k].addEventListener("input", stkRecalc));

  els.stkSearchInput.addEventListener("input", () => {
    clearTimeout(stkSearchTimer);
    stkSearchTimer = setTimeout(() => { stkSearchText = els.stkSearchInput.value; stkRender(); }, 300);
  });
  els.stkFilterCode.addEventListener("change", () => { stkCodeFilter = els.stkFilterCode.value; stkRender(); });
  els.stkFilterAccount.addEventListener("change", () => { stkAccountFilter = els.stkFilterAccount.value; stkRender(); });

  els.stkFilterDate.addEventListener("change", () => {
    stkFilterOn = true; stkShowAll = false;
    stkRender();
    els.stkFilterDate.blur();
    const day = els.stkFilterDate.value;
    requestAnimationFrame(() => requestAnimationFrame(() => stkScrollToDay(day)));
  });
  els.stkClearFilterBtn.onclick = () => {
    clearTimeout(stkSearchTimer);
    stkFilterOn = false; els.stkFilterDate.value = todayStr();
    stkSearchText = ""; els.stkSearchInput.value = "";
    stkCodeFilter = ""; stkAccountFilter = "";
    stkFillFilters();
    stkRender();
  };
  els.stkShowAllBtn.onclick = () => { stkShowAll = !stkShowAll; stkRender(); };
  els.stkChartYear.onchange = () => { stkChartYearVal = els.stkChartYear.value; stkRenderChart(); };
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

  // Stock module UI (data loads lazily when switching to 股票 mode).
  stkWireEvents();
  stkInitForm();
  stkFillFilters();
  els.stkFilterDate.value = todayStr();

  // Medical module UI (data loads lazily when switching to 看病 mode).
  medWireEvents();
  medResetForm();
  els.medFilterDate.value = todayStr();

  // Celine 收入 module UI (data loads lazily when switching to that mode).
  celWireEvents();
  celResetForm();
  els.celFilterDate.value = todayStr();


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

  // Handle redirect response (login or token) then restore existing session.
  let redirectResult = null;
  try {
    redirectResult = await msalApp.handleRedirectPromise();
  } catch (e) {
    setStatus("登录失败：" + (e.message || e), "error");
  }
  if (redirectResult && redirectResult.account) {
    account = redirectResult.account;
    msalApp.setActiveAccount(account);
  } else {
    const accounts = msalApp.getAllAccounts();
    if (accounts.length > 0) {
      account = accounts[0];
      msalApp.setActiveAccount(account);
    }
  }
  if (account) {
    try {
      await onSignedIn();
    } catch (e) {
      setStatus("自动登录失败，请手动登录。", "warn");
    }
  }
})();

/* ========================================================================= *
 *                            MEDICAL  MODULE                                *
 *   看病 tracker. Records: {id,title,date,personal,insurance,total,note,     *
 *   createdBy,modified}. Title is free-text with a <datalist> autocomplete   *
 *   built from existing records. Stored in medical-records.json (same        *
 *   shared OneDrive folder). No meta file / no hidden-category management.    *
 * ========================================================================= */
let medicalRecords = [];
let medEtag = null;
let medicalLoaded = false;
let medDriveBase = null;
let medShowAll = false;
let medFilterOn = false;
let medTab = "list";
let medSearchText = "";
let medChartYearVal = null;

/* ------------------------- Medical Graph I/O ----------------------------- */
async function medResolveFolder(token) {
  if (medDriveBase) return;
  const sid = encodeShareUrl(MEDICAL_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问看病文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  medDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function medFileUrls(name) {
  return {
    content: `${medDriveBase}:/${name}:/content`,
    meta: `${medDriveBase}:/${name}?$select=id,eTag`,
  };
}
async function medReadETag(token, name) {
  const { meta } = medFileUrls(name);
  const res = await fetch(meta, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.eTag || null;
}
async function medReadJson(token, name) {
  const { content } = medFileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { data: null, etag: null, exists: false };
  if (!res.ok) throw new Error("载入失败(" + name + ")：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const etag = res.headers.get("ETag") || (await medReadETag(token, name));
  return { data, etag, exists: true };
}
async function medWriteJson(token, name, getData, etag, applyOnConflict) {
  const { content } = medFileUrls(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (etag) headers["If-Match"] = etag;
    const data = getData();
    const body = JSON.stringify(data);
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      return item.eTag || (await medReadETag(token, name));
    }
    if (res.status === 412 && applyOnConflict) {
      setStatus("有人同时更新了看病数据，正在合并…", "warn");
      const fresh = await medReadJson(token, name);
      applyOnConflict(fresh.data);
      etag = fresh.etag;
      medRender();
      continue;
    }
    throw new Error("保存失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存冲突，重试多次仍失败(" + name + ")。");
}

/* --------------------------- Medical load -------------------------------- */
async function medLoad() {
  if (medicalLoaded) return;
  setStatus("正在载入看病数据…");
  const token = await getToken();
  await medResolveFolder(token);
  const r = await medReadJson(token, MEDICAL_RECORDS_FILE);
  medicalRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  medEtag = r.etag;
  medicalLoaded = true;
  medRebuildDatalist();
  medRender();
  setStatus("已载入 " + medicalRecords.length + " 条看病记录。", "ok", 2000);
}

function medApplyOp(list, op) {
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

async function medPersist(op) {
  setStatus("正在保存看病记录…");
  const token = await getToken();
  medEtag = await medWriteJson(
    token, MEDICAL_RECORDS_FILE, () => ({ records: medicalRecords }), medEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      medicalRecords = medApplyOp(list, op);
    }
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- Medical form -------------------------------- */
function medNum(el) { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }

// 总计 = 个人支付 + 医保统筹支付 (read-only).
function medRecalc() {
  const t = medNum(els.medPersonal) + medNum(els.medInsurance);
  els.medTotal.value = t ? round2(t) : "";
}

// Distinct existing titles -> datalist autocomplete options.
function medRebuildDatalist() {
  const seen = new Set();
  const titles = [];
  for (const r of medicalRecords) {
    const t = (r.title || "").trim();
    if (t && !seen.has(t)) { seen.add(t); titles.push(t); }
  }
  titles.sort((a, b) => a.localeCompare(b, "zh"));
  els.medTitleList.innerHTML = "";
  for (const t of titles) {
    const o = document.createElement("option");
    o.value = t;
    els.medTitleList.appendChild(o);
  }
  // Distinct 看病人 -> rebuild the <select> (preserving current selection).
  medRebuildPersonOptions();
}

const MED_PERSON_CUSTOM = "__custom__";

// Rebuild the 看病人 dropdown: placeholder + distinct names + 自定义…
// Pass a value to force-select it (e.g. when editing).
function medRebuildPersonOptions(selected) {
  const cur = selected != null ? selected : els.medPerson.value;
  const pseen = new Set();
  const persons = [];
  for (const r of medicalRecords) {
    const p = (r.person || "").trim();
    if (p && !pseen.has(p)) { pseen.add(p); persons.push(p); }
  }
  persons.sort((a, b) => a.localeCompare(b, "zh"));

  els.medPerson.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择看病人"; ph.disabled = true;
  els.medPerson.appendChild(ph);
  for (const p of persons) {
    const o = document.createElement("option");
    o.value = p; o.textContent = p;
    els.medPerson.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = MED_PERSON_CUSTOM; custom.textContent = "＋ 自定义…";
  els.medPerson.appendChild(custom);

  // Restore selection when possible.
  if (cur && persons.includes(cur)) els.medPerson.value = cur;
  else if (cur === MED_PERSON_CUSTOM) els.medPerson.value = MED_PERSON_CUSTOM;
  else els.medPerson.value = "";
  medPersonOnChange();
}

// Effective 看病人 value (custom text when 自定义… is picked).
function medPersonValue() {
  return els.medPerson.value === MED_PERSON_CUSTOM
    ? els.medPersonCustom.value.trim()
    : els.medPerson.value.trim();
}

// Toggle the custom-name text box based on the dropdown selection.
function medPersonOnChange() {
  const on = els.medPerson.value === MED_PERSON_CUSTOM;
  els.medPersonCustom.classList.toggle("hidden", !on);
  if (on) els.medPersonCustom.focus();
  else els.medPersonCustom.value = "";
}

function medResetForm() {
  els.medForm.reset();
  els.medEditId.value = "";
  els.medPerson.value = "";
  els.medPersonCustom.value = "";
  els.medPersonCustom.classList.add("hidden");
  els.medDate.value = todayStr();
  els.medFormTitle.textContent = "添加看病记录";
  els.medAddBtn.textContent = "添加并保存";
  hide(els.medCancelBtn);
}

async function medOnSubmit(e) {
  e.preventDefault();
  const isEdit = !!els.medEditId.value;
  const personal = round2(medNum(els.medPersonal));
  const insurance = round2(medNum(els.medInsurance));
  const rec = {
     id: els.medEditId.value || uuid(),
      person: medPersonValue(),
     title: els.medTitle.value.trim(),
     date: els.medDate.value,
     personal: personal,
     insurance: insurance,
     total: round2(personal + insurance),
     note: els.medNote.value.trim(),
     createdBy: (account && (account.name || account.username)) || "",
     modified: new Date().toISOString(),
   };
   if (!rec.person) { setStatus("请填写看病人。", "warn"); return; }
   if (!rec.title) { setStatus("请填写事项。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = medicalRecords.slice();
  if (isEdit) {
    const i = medicalRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = medicalRecords[i].createdBy || rec.createdBy; medicalRecords[i] = rec; }
    else medicalRecords.push(rec);
  } else {
    medicalRecords.push(rec);
  }
  els.medAddBtn.disabled = true;
  medRebuildDatalist();
  medRender();
  try {
    await medPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    const synced = await medSyncSpending(rec, isEdit ? "edit" : "add");
    medResetForm();
    if (synced) setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
    else setStatus("看病已保存，但同步支出记录失败，请检查支出数据。", "warn", 6000);
  } catch (err) {
    medicalRecords = snap; medRebuildDatalist(); medRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.medAddBtn.disabled = false;
  }
}

function medStartEdit(id) {
  const r = medicalRecords.find((x) => x.id === id);
  if (!r) return;
   els.medEditId.value = r.id;
   medRebuildPersonOptions(r.person || "");
   els.medTitle.value = r.title || "";
  els.medDate.value = r.date;
  els.medPersonal.value = r.personal || "";
  els.medInsurance.value = r.insurance || "";
  els.medTotal.value = r.total || "";
  els.medNote.value = r.note || "";
  els.medFormTitle.textContent = "编辑看病记录";
  els.medAddBtn.textContent = "保存修改";
  show(els.medCancelBtn);
  medSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function medDelete(id) {
  const r = medicalRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条看病记录吗？\n${r.date} ${r.title} ${fmtAmount(r.total)}`)) return;
  const snap = medicalRecords.slice();
  medicalRecords = medicalRecords.filter((x) => x.id !== id);
  medRebuildDatalist();
  medRender();
  try {
    await medPersist({ type: "delete", id });
    await medSyncSpending(r, "delete");
  } catch (err) {
    medicalRecords = snap; medRebuildDatalist(); medRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* ------------- Medical -> Spending linkage (日常生活/看病/看病) ------------- */
// Each medical record mirrors ONE spending record: note = 看病人：事项,
// amount = 个人支付. Kept in sync on add/edit/delete. personal<=0 => no spend.
const MED_SPEND_CAT = { i: "日常生活", ii: "看病", iii: "看病" };
const medSpendId = (medId) => "med-" + medId;
const medSpendNote = (r) =>
  ((r.person || "").trim() ? (r.person || "").trim() + "：" : "") + (r.title || "").trim();

// Locate the linked spending record across both buckets.
function findSpendRecord(id) {
  let i = currentRecords.findIndex((x) => x.id === id);
  if (i >= 0) return { rec: currentRecords[i], hot: true };
  i = archiveRecords.findIndex((x) => x.id === id);
  if (i >= 0) return { rec: archiveRecords[i], hot: false };
  return null;
}

// Upsert / delete the spending record mirroring a medical record.
// Returns true on success (or no-op), false if the OneDrive save failed.
async function medSyncSpending(medRec, mode) {
  const id = medSpendId(medRec.id);
  const personal = Number(medRec.personal) || 0;
  const found = findSpendRecord(id);
  const cutoff = monthCutoff();

  const snapHot = currentRecords.slice();
  const snapCold = archiveRecords.slice();

  const rollback = () => { currentRecords = snapHot; archiveRecords = snapCold; syncRecords(); render(); };

  // Delete branch: explicit delete, or an edit that dropped 个人支付 to 0.
  if (mode === "delete" || personal <= 0) {
    if (!found) return true;
    if (found.hot) currentRecords = currentRecords.filter((x) => x.id !== id);
    else archiveRecords = archiveRecords.filter((x) => x.id !== id);
    syncRecords(); render();
    const ok = await persist({ type: "delete", id, wasHot: found.hot });
    if (!ok) rollback();
    return ok;
  }

  // Upsert branch (add / edit with 个人支付 > 0).
  const spendRec = {
    id: id,
    i_cat: MED_SPEND_CAT.i,
    ii_cat: MED_SPEND_CAT.ii,
    iii_cat: MED_SPEND_CAT.iii,
    amount: round2(personal),
    date: medRec.date,
    note: medSpendNote(medRec),
    createdBy: (found && found.rec.createdBy) || medRec.createdBy ||
               (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };

  let op;
  if (found) {
    if (found.hot) currentRecords = currentRecords.filter((x) => x.id !== id);
    else archiveRecords = archiveRecords.filter((x) => x.id !== id);
    op = { type: "edit", rec: spendRec, wasHot: found.hot };
  } else {
    op = { type: "add", rec: spendRec };
  }
  (isHotDate(spendRec.date, cutoff) ? currentRecords : archiveRecords).push(spendRec);
  syncRecords(); render();
  const ok = await persist(op);
  if (!ok) rollback();
  return ok;
}

/* --------------------------- Medical table ------------------------------- */
function medRender() {
  const monthFilter = medFilterOn && els.medFilterDate ? els.medFilterDate.value.slice(0, 7) : "";
  const q = medSearchText.trim().toLowerCase();
  let sorted = [...medicalRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.person || "").toLowerCase().includes(q) ||
      (r.title || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (medShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.medBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.person || "")}</td>
      <td>${escapeHtml(r.title)}</td>
      <td class="num">${fmtAmount(r.personal)}</td>
      <td class="num">${fmtAmount(r.insurance)}</td>
      <td class="num strong">${fmtAmount(r.total)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => medStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => medDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.medBody.appendChild(tr);
  }

  const total = medicalRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.medRecordCount.textContent = `${view.length} 条，总计合计 ${fmtAmount(sum)}`;
  else if (medShowAll) els.medRecordCount.textContent = `显示全部 ${total} 条`;
  else els.medRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.medClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.medShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !medShowAll));
  els.medShowAllBtn.textContent = medShowAll ? "显示50条" : "显示全部";
  els.medEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- Medical charts ------------------------------ */
// Fixed two-series stacked chart: 个人支付 / 医保统筹.
const MED_SERIES = [
  { key: "personal", name: "个人支付", color: "#E66C37" },
  { key: "insurance", name: "医保统筹", color: "#118DFF" },
];
// Palette for per-person bars (cycled by descending total).
const MED_PERSON_COLORS = [
  "#118DFF", "#E66C37", "#12B76A", "#9B51E0", "#F2994A",
  "#EB5757", "#2D9CDB", "#6FCF97", "#BB6BD9", "#F2C94C",
];
function medYears() {
  const s = new Set();
  for (const r of medicalRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

function medRenderChart() {
  const years = medYears();
  const cur = String(new Date().getFullYear());
  if (!medChartYearVal) medChartYearVal = years.includes(cur) ? cur : (years[0] || cur);
  els.medChartYear.innerHTML = "";
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === medChartYearVal) o.selected = true;
    els.medChartYear.appendChild(o);
  }

  const year = medChartYearVal;
  const rows = medicalRecords.filter((r) => r.date && r.date.slice(0, 4) === year);
  const monthTotals = new Array(12).fill(0);
  const seriesTotals = { personal: 0, insurance: 0 };
  const monthSeries = Array.from({ length: 12 }, () => ({ personal: 0, insurance: 0 }));
  const personTotals = new Map();
  for (const r of rows) {
    const mi = parseInt(r.date.slice(5, 7), 10) - 1;
    if (mi < 0 || mi > 11) continue;
    const p = Number(r.personal) || 0;
    const ins = Number(r.insurance) || 0;
    monthTotals[mi] += p + ins;
    seriesTotals.personal += p;
    seriesTotals.insurance += ins;
    monthSeries[mi].personal += p;
    monthSeries[mi].insurance += ins;
    const who = (r.person || "").trim() || "未填写";
    personTotals.set(who, (personTotals.get(who) || 0) + p + ins);
  }
  const grand = monthTotals.reduce((a, b) => a + b, 0);
  els.medChartTitle.textContent = year + " 年度看病支出";
  els.medChartTotal.textContent = fmtAmount(grand);

  const has = grand > 0;
  els.medChartEmpty.classList.toggle("hidden", has);
  if (!has) {
    els.medWaterfall.innerHTML = ""; els.medMonthBars.innerHTML = "";
    els.medCatLegend.innerHTML = ""; els.medPersonBars.innerHTML = ""; els.medPersonLegend.innerHTML = "";
    return;
  }

  medBuildWaterfall(monthTotals, grand);
  medBuildMonthBars(monthTotals, monthSeries);
  medBuildLegend(seriesTotals);
  medBuildPersonBars(personTotals, grand);
}

function medBuildWaterfall(monthTotals, grand) {
  const max = grand || 1;
  els.medWaterfall.innerHTML = "";
  let run = 0;
  for (let m = 0; m < 12; m++) {
    const v = monthTotals[m];
    const basePct = (run / max) * 100;
    const fillPct = (v / max) * 100;
    const topPct = basePct + fillPct;
    const col = document.createElement("div");
    col.className = "wf-col";
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
    els.medWaterfall.appendChild(col);
  }
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  tot.innerHTML =
    `<div class="wf-track">` +
      `<div class="wf-fill total" style="bottom:0;height:100%"></div>` +
      `<div class="wf-val" style="bottom:100%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  els.medWaterfall.appendChild(tot);
}

function medBuildMonthBars(monthTotals, monthSeries) {
  const max = Math.max(...monthTotals, 1);
  const TRACK_PX = 190;
  els.medMonthBars.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    const total = monthTotals[m];
    const col = document.createElement("div");
    col.className = "mb-col";
    let inner = "";
    for (const s of MED_SERIES) {
      const val = monthSeries[m][s.key];
      if (!val) continue;
      const h = (val / max) * 100;
      const px = (val / max) * TRACK_PX;
      const label = px >= 16 ? `<span class="mb-seg-label">${fmtInt(val)}</span>` : "";
      inner += `<div class="mb-seg" style="height:${h}%;background:${s.color}" title="${escapeHtml(s.name)}：${fmtInt(val)}">${label}</div>`;
    }
    col.innerHTML =
      `<div class="mb-val">${total ? fmtInt(total) : ""}</div>` +
      `<div class="mb-track">${inner}</div>` +
      `<div class="mb-name">${MONTH_LABELS[m]}</div>`;
    els.medMonthBars.appendChild(col);
  }
}

function medBuildLegend(seriesTotals) {
  els.medCatLegend.innerHTML = "";
  for (const s of MED_SERIES) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="legend-dot" style="background:${s.color}"></span>` +
      `<span class="legend-name">${escapeHtml(s.name)}</span>` +
      `<span class="legend-val">${fmtInt(seriesTotals[s.key])}</span>`;
    els.medCatLegend.appendChild(row);
  }
}

function medBuildPersonBars(personTotals, grand) {
  const list = [...personTotals.entries()].sort((a, b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 1;
  els.medPersonBars.innerHTML = "";
  els.medPersonLegend.innerHTML = "";
  list.forEach(([name, val], i) => {
    const color = MED_PERSON_COLORS[i % MED_PERSON_COLORS.length];
    const pct = grand > 0 ? (val / grand) * 100 : 0;
    const w = max > 0 ? (val / max) * 100 : 0;
    const row = document.createElement("div");
    row.className = "pb-row";
    row.innerHTML =
      `<div class="pb-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>` +
      `<div class="pb-track"><div class="pb-fill" style="width:${w}%;background:${color}"></div></div>` +
      `<div class="pb-val">${fmtInt(val)}<span class="pb-pct">${pct.toFixed(1)}%</span></div>`;
    els.medPersonBars.appendChild(row);
    const lg = document.createElement("div");
    lg.className = "legend-row";
    lg.innerHTML =
      `<span class="legend-dot" style="background:${color}"></span>` +
      `<span class="legend-name">${escapeHtml(name)}</span>` +
      `<span class="legend-val">${fmtInt(val)}</span>`;
    els.medPersonLegend.appendChild(lg);
  });
}

/* --------------------------- Medical tabs -------------------------------- */
function medSwitchTab(name) {
  medTab = name;
  const tabs = {
    add: { panel: els.medTabAdd, btn: els.medTabAddBtn },
    list: { panel: els.medTabList, btn: els.medTabListBtn },
    chart: { panel: els.medTabChart, btn: els.medTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") medRenderChart();
}

function medWireEvents() {
  els.medTabAddBtn.onclick = () => medSwitchTab("add");
  els.medTabListBtn.onclick = () => medSwitchTab("list");
  els.medTabChartBtn.onclick = () => medSwitchTab("chart");

  els.medForm.addEventListener("submit", medOnSubmit);
  els.medCancelBtn.onclick = medResetForm;

   ["medPersonal", "medInsurance"].forEach((k) => els[k].addEventListener("input", medRecalc));
   els.medPerson.addEventListener("change", medPersonOnChange);

  els.medFilterDate.addEventListener("change", () => {
    medFilterOn = true; medShowAll = false;
    medRender();
    els.medFilterDate.blur();
  });
  els.medSearchInput.addEventListener("input", () => { medSearchText = els.medSearchInput.value; medRender(); });
  els.medClearFilterBtn.onclick = () => {
    medFilterOn = false; medSearchText = ""; els.medSearchInput.value = "";
    els.medFilterDate.value = todayStr(); medRender();
  };
  els.medShowAllBtn.onclick = () => { medShowAll = !medShowAll; medRender(); };
  els.medChartYear.onchange = () => { medChartYearVal = els.medChartYear.value; medRenderChart(); };
}

/* ========================================================================= *
 *              GENERIC EXTRA-FOLDER GRAPH I/O (xt*)                          *
 *   Reusable Graph read/write helpers keyed by filename, backed by the      *
 *   single shared "extra modules" folder. Reused by all new modules.        *
 * ========================================================================= */
let xtDriveBase = "";

async function xtResolveFolder(token) {
  if (xtDriveBase) return;
  const sid = encodeShareUrl(EXTRA_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问数据文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  xtDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function xtFileUrls(name) {
  return {
    content: `${xtDriveBase}:/${name}:/content`,
    meta: `${xtDriveBase}:/${name}?$select=id,eTag`,
  };
}
async function xtReadETag(token, name) {
  const { meta } = xtFileUrls(name);
  const res = await fetch(meta, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.eTag || null;
}
async function xtReadJson(token, name) {
  const { content } = xtFileUrls(name);
  const res = await fetch(content, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { data: null, etag: null, exists: false };
  if (!res.ok) throw new Error("载入失败(" + name + ")：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const etag = res.headers.get("ETag") || (await xtReadETag(token, name));
  return { data, etag, exists: true };
}
async function xtWriteJson(token, name, getData, etag, applyOnConflict, onMerge) {
  const { content } = xtFileUrls(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (etag) headers["If-Match"] = etag;
    const body = JSON.stringify(getData());
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      return item.eTag || (await xtReadETag(token, name));
    }
    if (res.status === 412 && applyOnConflict) {
      setStatus("有人同时更新了数据，正在合并…", "warn");
      const fresh = await xtReadJson(token, name);
      applyOnConflict(fresh.data);
      etag = fresh.etag;
      if (onMerge) onMerge();
      continue;
    }
    throw new Error("保存失败(" + name + ")：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存冲突，重试多次仍失败(" + name + ")。");
}

/* ========================================================================= *
 *                       CELINE 收入 MODULE (cel*)                            *
 *   Simple signed CRUD+chart. Record: {id,date,amount,note,createdBy,       *
 *   modified}. amount>0 = 收入, amount<0 = 支出. celine-income.json.         *
 * ========================================================================= */
let celineRecords = [];
let celEtag = null;
let celineLoaded = false;
let celShowAll = false;
let celFilterOn = false;
let celTab = "list";
let celSearchText = "";
let celChartYearVal = null;

async function celLoad() {
  if (celineLoaded) return;
  setStatus("正在载入 Celine 收入数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const r = await xtReadJson(token, CELINE_INCOME_FILE);
  celineRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  celEtag = r.etag;
  celineLoaded = true;
  celRender();
  setStatus("已载入 " + celineRecords.length + " 条记录。", "ok", 2000);
}

function celApplyOp(list, op) {
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

async function celPersist(op) {
  setStatus("正在保存记录…");
  const token = await getToken();
  celEtag = await xtWriteJson(
    token, CELINE_INCOME_FILE, () => ({ records: celineRecords }), celEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      celineRecords = celApplyOp(list, op);
    },
    () => celRender()
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- Celine form --------------------------------- */
function celResetForm() {
  els.celForm.reset();
  els.celEditId.value = "";
  els.celType.value = "income";
  els.celDate.value = todayStr();
  els.celFormTitle.textContent = "添加记录";
  els.celAddBtn.textContent = "添加并保存";
  hide(els.celCancelBtn);
}

async function celOnSubmit(e) {
  e.preventDefault();
  const isEdit = !!els.celEditId.value;
  const mag = Math.abs(parseFloat(els.celAmount.value));
  if (isNaN(mag) || mag === 0) { setStatus("请输入金额。", "warn"); return; }
  const signed = els.celType.value === "spend" ? -mag : mag;
  const rec = {
    id: els.celEditId.value || uuid(),
    date: els.celDate.value,
    amount: round2(signed),
    note: els.celNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = celineRecords.slice();
  if (isEdit) {
    const i = celineRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = celineRecords[i].createdBy || rec.createdBy; celineRecords[i] = rec; }
    else celineRecords.push(rec);
  } else {
    celineRecords.push(rec);
  }
  els.celAddBtn.disabled = true;
  celRender();
  try {
    await celPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    celResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    celineRecords = snap; celRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.celAddBtn.disabled = false;
  }
}

function celStartEdit(id) {
  const r = celineRecords.find((x) => x.id === id);
  if (!r) return;
  const amt = Number(r.amount) || 0;
  els.celEditId.value = r.id;
  els.celDate.value = r.date;
  els.celType.value = amt < 0 ? "spend" : "income";
  els.celAmount.value = Math.abs(amt);
  els.celNote.value = r.note || "";
  els.celFormTitle.textContent = "编辑记录";
  els.celAddBtn.textContent = "保存修改";
  show(els.celCancelBtn);
  celSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function celDelete(id) {
  const r = celineRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条记录吗？\n${r.date} ${fmtAmount(r.amount)}`)) return;
  const snap = celineRecords.slice();
  celineRecords = celineRecords.filter((x) => x.id !== id);
  celRender();
  try {
    await celPersist({ type: "delete", id });
  } catch (err) {
    celineRecords = snap; celRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* --------------------------- Celine table -------------------------------- */
function celRender() {
  const monthFilter = celFilterOn && els.celFilterDate ? els.celFilterDate.value.slice(0, 7) : "";
  const q = celSearchText.trim().toLowerCase();
  let sorted = [...celineRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) sorted = sorted.filter((r) => (r.note || "").toLowerCase().includes(q));
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (celShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.celBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const amt = Number(r.amount) || 0;
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td class="num strong${amt < 0 ? " neg" : " pos"}">${fmtAmount(amt)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => celStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => celDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.celBody.appendChild(tr);
  }

  const total = celineRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.celRecordCount.textContent = `${view.length} 条，净额 ${fmtAmount(sum)}`;
  else if (celShowAll) els.celRecordCount.textContent = `显示全部 ${total} 条`;
  else els.celRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.celClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.celShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !celShowAll));
  els.celShowAllBtn.textContent = celShowAll ? "显示50条" : "显示全部";
  els.celEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- Celine charts ------------------------------- */
const CEL_SERIES = [
  { key: "income", name: "收入", color: "#12B76A" },
  { key: "spend", name: "支出", color: "#D64550" },
];
function celYears() {
  const s = new Set();
  for (const r of celineRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

function celRenderChart() {
  const years = celYears();
  if (!celChartYearVal) celChartYearVal = "all";
  els.celChartYear.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all"; optAll.textContent = "全部年度";
  if (celChartYearVal === "all") optAll.selected = true;
  els.celChartYear.appendChild(optAll);
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === celChartYearVal) o.selected = true;
    els.celChartYear.appendChild(o);
  }

  const year = celChartYearVal;
  // Build ordered buckets. Single year => 12 months (1..12). "all" => one
  // bucket per (year, month) across the full span of the data, so different
  // years' months are shown side by side (NOT summed into 12 months).
  let buckets; // [{label, net, income, spend}]
  const index = new Map(); // key -> bucket
  if (year === "all") {
    const keys = new Set();
    for (const r of celineRecords) if (r.date && r.date.length >= 7) keys.add(r.date.slice(0, 7));
    const ordered = [...keys].sort();
    if (ordered.length) {
      // Fill the continuous span so the cumulative waterfall stays contiguous.
      const [y0, m0] = ordered[0].split("-").map(Number);
      const [y1, m1] = ordered[ordered.length - 1].split("-").map(Number);
      buckets = [];
      let yy = y0, mm = m0;
      while (yy < y1 || (yy === y1 && mm <= m1)) {
        const key = `${yy}-${String(mm).padStart(2, "0")}`;
        const b = { label: `${String(yy).slice(2)}/${mm}`, net: 0, income: 0, spend: 0 };
        index.set(key, b); buckets.push(b);
        mm++; if (mm > 12) { mm = 1; yy++; }
      }
    } else {
      buckets = [];
    }
  } else {
    buckets = [];
    for (let m = 1; m <= 12; m++) {
      const b = { label: MONTH_LABELS[m - 1], net: 0, income: 0, spend: 0 };
      index.set(`${year}-${String(m).padStart(2, "0")}`, b);
      buckets.push(b);
    }
  }

  const seriesTotals = { income: 0, spend: 0 };
  for (const r of celineRecords) {
    if (!r.date || r.date.length < 7) continue;
    if (year !== "all" && r.date.slice(0, 4) !== year) continue;
    const b = index.get(r.date.slice(0, 7));
    if (!b) continue;
    const a = Number(r.amount) || 0;
    b.net += a;
    if (a >= 0) { b.income += a; seriesTotals.income += a; }
    else { b.spend += -a; seriesTotals.spend += -a; }
  }
  const grand = buckets.reduce((s, b) => s + b.net, 0);
  els.celChartTitle.textContent = (year === "all" ? "全部年度" : year + " 年度") + "收支";
  els.celChartTotal.textContent = fmtAmount(grand);
  els.celChartTotal.classList.toggle("neg", grand < 0);

  const has = seriesTotals.income + seriesTotals.spend > 0;
  els.celChartEmpty.classList.toggle("hidden", has);
  if (!has) {
    els.celWaterfall.innerHTML = ""; els.celMonthBars.innerHTML = ""; els.celCatLegend.innerHTML = "";
    return;
  }

  celBuildWaterfall(buckets, grand);
  celBuildMonthBars(buckets);
  celBuildLegend(seriesTotals);
}

// Signed cumulative-net waterfall over arbitrary buckets (handles negatives).
function celBuildWaterfall(buckets, grand) {
  const runs = [];
  let run = 0;
  for (const b of buckets) { run += b.net; runs.push(run); }
  const lo = Math.min(0, grand, ...runs);
  const hi = Math.max(0, grand, ...runs);
  const range = (hi - lo) || 1;
  const y = (v) => ((v - lo) / range) * 100; // % from bottom for value v
  els.celWaterfall.innerHTML = "";
  let prev = 0;
  buckets.forEach((b, i) => {
    const v = b.net;
    const cur = runs[i];
    const lowY = y(Math.min(prev, cur));
    const highY = y(Math.max(prev, cur));
    const col = document.createElement("div");
    col.className = "wf-col";
    const cls = v < 0 ? "wf-fill neg" : "wf-fill";
    col.innerHTML =
      `<div class="wf-track">` +
        `<div class="wf-zero" style="bottom:${y(0)}%"></div>` +
        (v ? `<div class="${cls}" style="bottom:${lowY}%;height:${highY - lowY}%"></div>` : "") +
        (v ? `<div class="wf-val" style="bottom:${highY}%">${fmtInt(v)}</div>` : "") +
      `</div>` +
      `<div class="wf-name">${b.label}</div>`;
    prev = cur;
    els.celWaterfall.appendChild(col);
  });
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  const tlo = y(Math.min(0, grand)), thi = y(Math.max(0, grand));
  tot.innerHTML =
    `<div class="wf-track">` +
      `<div class="wf-zero" style="bottom:${y(0)}%"></div>` +
      `<div class="wf-fill total${grand < 0 ? " neg" : ""}" style="bottom:${tlo}%;height:${thi - tlo}%"></div>` +
      `<div class="wf-val" style="bottom:${thi}%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  els.celWaterfall.appendChild(tot);
}

function celBuildMonthBars(buckets) {
  let max = 1;
  for (const b of buckets) max = Math.max(max, b.income, b.spend);
  const TRACK_PX = 190;
  els.celMonthBars.innerHTML = "";
  for (const b of buckets) {
    const col = document.createElement("div");
    col.className = "mb-col";
    let inner = "";
    for (const s of CEL_SERIES) {
      const val = b[s.key];
      if (!val) continue;
      const h = (val / max) * 100;
      const px = (val / max) * TRACK_PX;
      const label = px >= 16 ? `<span class="mb-seg-label">${fmtInt(val)}</span>` : "";
      inner += `<div class="mb-seg" style="height:${h}%;background:${s.color}" title="${escapeHtml(s.name)}：${fmtInt(val)}">${label}</div>`;
    }
    const net = b.income - b.spend;
    col.innerHTML =
      `<div class="mb-val">${net ? fmtInt(net) : ""}</div>` +
      `<div class="mb-track">${inner}</div>` +
      `<div class="mb-name">${b.label}</div>`;
    els.celMonthBars.appendChild(col);
  }
}

function celBuildLegend(seriesTotals) {
  els.celCatLegend.innerHTML = "";
  for (const s of CEL_SERIES) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="legend-dot" style="background:${s.color}"></span>` +
      `<span class="legend-name">${escapeHtml(s.name)}</span>` +
      `<span class="legend-val">${fmtInt(seriesTotals[s.key])}</span>`;
    els.celCatLegend.appendChild(row);
  }
}

/* --------------------------- Celine tabs --------------------------------- */
function celSwitchTab(name) {
  celTab = name;
  const tabs = {
    add: { panel: els.celTabAdd, btn: els.celTabAddBtn },
    list: { panel: els.celTabList, btn: els.celTabListBtn },
    chart: { panel: els.celTabChart, btn: els.celTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") celRenderChart();
}

function celWireEvents() {
  els.celTabAddBtn.onclick = () => celSwitchTab("add");
  els.celTabListBtn.onclick = () => celSwitchTab("list");
  els.celTabChartBtn.onclick = () => celSwitchTab("chart");

  els.celForm.addEventListener("submit", celOnSubmit);
  els.celCancelBtn.onclick = celResetForm;

  els.celFilterDate.addEventListener("change", () => {
    celFilterOn = true; celShowAll = false;
    celRender();
    els.celFilterDate.blur();
  });
  els.celSearchInput.addEventListener("input", () => { celSearchText = els.celSearchInput.value; celRender(); });
  els.celClearFilterBtn.onclick = () => {
    celFilterOn = false; celSearchText = ""; els.celSearchInput.value = "";
    els.celFilterDate.value = todayStr(); celRender();
  };
  els.celShowAllBtn.onclick = () => { celShowAll = !celShowAll; celRender(); };
  els.celChartYear.onchange = () => { celChartYearVal = els.celChartYear.value; celRenderChart(); };
}
