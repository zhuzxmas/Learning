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
// Adding an income of this title auto-deposits half of 实际收入 into Celine's
// piggy bank (celine-income.json). One-time on add only; see maybeAddCelineSubsidy.
const NANJING_SUBSIDY_TITLE = "南京人才安居";

/* --------------------------- STOCK CONFIG -------------------------------- */
// Stock files live in a dedicated folder. By default we reuse the income
// folder's share URL (files are separately named, so data stays independent).
// Replace with a dedicated folder's 1drv.ms share URL if you want them apart.
const STOCK_FOLDER_SHARE_URL = INCOME_FOLDER_SHARE_URL;
const STOCK_RECORDS_FILE = "stock-records.json";
const STOCK_META_FILE = "stock-meta.json"; // {codes:{custom,hidden}, accounts:{custom,hidden}, fees}
const STOCK_CSV_FILE = "stock-records.csv"; // human-readable mirror of stock-records.json, for viewing in Excel

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
const BORROW_REPAY_FILE = "borrow-repay.json";
const INVEST_FILE = "invest.json";
const STORED_CARD_FILE = "stored-value-cards.json";
const VEHICLE_FILE = "vehicle-maintenance.json";
const HEALTH_WEIGHT_FILE = "health-weight.json";
const HEALTH_BP_FILE = "health-bp.json";

/* --------------------------- TRAVEL CONFIG ------------------------------- */
// Travel records live in the shared "OtherTracker" folder (the same one that
// holds Celine income, 借还款, 理财, 储值卡, 车辆保养, 健康). File: travel.json
const TRAVEL_FOLDER_SHARE_URL = EXTRA_FOLDER_SHARE_URL;
const TRAVEL_RECORDS_FILE = "travel.json";
// Tencent Map (GL JS API) key — a public client-side key, protected by the
// domain whitelist (a.cnmas.top) set in the Tencent LBS console (lbs.qq.com).
const TENCENT_MAP_KEY = "X4DBZ-ZKUCQ-UCE5T-4ARHR-2DF67-BZBKL";
const TENCENT_MAP_LIB_URL = "https://map.qq.com/api/gljs?v=1.exp&libraries=geometry,service&key=";

/* --------------------------- BLOG CONFIG -------------------------------- */
// The blog/life-journal lives in its OWN dedicated OneDrive shared folder.
// Structure inside it:  blog-index.json  +  posts/<id>.md  +  images/<file>
const BLOG_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgD_C9X6ML7pSIzB8ZAu2f_4AcwVLgqme1RgJDphTWTghrM";
const BLOG_INDEX_FILE = "blog-index.json";
const BLOG_TAGS_FILE = "blog-tags.json";
const SUMMARY_SETTINGS_FILE = "summary-settings.json";
const SUMMARY_MODEL_DEFAULT = "deepseek-v4-flash";
// 贴吧 (forum) lives in the SAME OneDrive folder as the blog (family members
// already have edit access). Structure: forum-index.json + forum/<id>.json
const FORUM_INDEX_FILE = "forum-index.json";

/* --------------------------- AI 对话 (chat) CONFIG ---------------------- */
// DeepSeek is reached through our own Cloudflare Worker (keeps the API key
// secret + restricts use to the allowed Microsoft accounts). Set this to the
// Worker's custom domain.
const CHAT_API_URL = "https://api.cnmas.top";
// Conversations are stored in their OWN dedicated OneDrive shared folder.
// Structure inside it:  chat-index.json  +  chats/<id>.json
// PASTE the 1drv.ms share link of that folder here (create a folder named e.g.
// "Chats" in OneDrive, share it, and drop the link below):
const CHAT_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgB5autcGzJOSKCznhJ1X0n3AVgMO_Xx2FjWRhpgk4vP1ag?email=celine_mas%40outlook.com&e=Lsf6a0";
const CHAT_INDEX_FILE = "chat-index.json";
// User-defined custom model names are synced across devices in this file
// (stored in the same Chats folder). Shape: { "custom": ["Qwen-xxx", ...] }.
const CHAT_MODELS_FILE = "chat-models.json";
// Model choices shown in the dropdown. Default is the first.
// A "Qwen-" prefix marks an Aliyun Bailian (DashScope) model; the front-end
// strips the prefix to get the real model name and tells the Worker to route to
// Bailian (see chatSend). Non-prefixed entries go to DeepSeek official.
const CHAT_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "Qwen-deepseek-v4-flash-0731",
  "Qwen-deepseek-v4-pro",
];

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
let secretExpiry = null;   // {createdDate, validityDays, modified}, stored with categories
let secretExpiryLoaded = false;
// Blog form setup runs during boot, before the blog module's lazy-load block.
let blogTagCandidates = [];
let blogSelectedTags = new Set();
let blogTagsEtag = null;
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
  commentReminderWrap: $("commentReminderWrap"), commentReminderBtn: $("commentReminderBtn"), commentReminderCount: $("commentReminderCount"), commentReminderPanel: $("commentReminderPanel"),
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
  secretExpiryForm: $("secretExpiryForm"),
  secretCreatedDate: $("secretCreatedDate"),
  secretValidityDays: $("secretValidityDays"),
  secretExpirySaveBtn: $("secretExpirySaveBtn"),
  secretExpirySummary: $("secretExpirySummary"),
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
  modeStocksBtn: $("modeStocksBtn"),
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
  incFilterYear: $("incFilterYear"),
  incFilterCat: $("incFilterCat"),
  incFilterPayee: $("incFilterPayee"),
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
  modeBlogBtn: $("modeBlogBtn"),
  stockApp: $("stockApp"),
  // --- 股票基本面 (StockBatchTracker) mode ---
  stocksApp: $("stocksApp"),
  sbtSelect: $("sbtSelect"),
  sbtReloadBtn: $("sbtReloadBtn"),
  sbtTabDetailBtn: $("sbtTabDetailBtn"),
  sbtTabChipBtn: $("sbtTabChipBtn"),
  sbtTabSettingsBtn: $("sbtTabSettingsBtn"),
  sbtTabDetail: $("sbtTabDetail"),
  sbtTabChip: $("sbtTabChip"),
  sbtTabSettings: $("sbtTabSettings"),
  sbtChipCard: $("sbtChipCard"),
  sbtChipHidden: $("sbtChipHidden"),
  sbtChipTitle: $("sbtChipTitle"),
  sbtChipActions: $("sbtChipActions"), sbtChipUpdateBtn: $("sbtChipUpdateBtn"),
  sbtChipForceBtn: $("sbtChipForceBtn"), sbtChipDeleteBtn: $("sbtChipDeleteBtn"),
  sbtChipMeta: $("sbtChipMeta"),
  sbtChipMetrics: $("sbtChipMetrics"),
  sbtChipSvg: $("sbtChipSvg"),
  sbtChipEmpty: $("sbtChipEmpty"),
  sbtChipRankTable: $("sbtChipRankTable"),
  sbtChipRankBody: $("sbtChipRankBody"),
  sbtChipRankMeta: $("sbtChipRankMeta"),
  sbtChipRankEmpty: $("sbtChipRankEmpty"),
  sbtChipRankPriceTh: $("sbtChipRankPriceTh"),
  sbtAddBtn: $("sbtAddBtn"),
  sbtCodeList: $("sbtCodeList"),
  sbtRecordCount: $("sbtRecordCount"),
  sbtDetailCard: $("sbtDetailCard"),
  sbtDetailTitle: $("sbtDetailTitle"),
  sbtChecks: $("sbtChecks"),
  sbtGenerated: $("sbtGenerated"),
  sbtLast7: $("sbtLast7"),
  sbtCombinedTable: $("sbtCombinedTable"),
  sbtDividendTable: $("sbtDividendTable"),
  sbtValuationCard: $("sbtValuationCard"), sbtValuationMeta: $("sbtValuationMeta"),
  sbtValuationMessage: $("sbtValuationMessage"), sbtValuationSummary: $("sbtValuationSummary"),
  sbtValuationDetails: $("sbtValuationDetails"), sbtValuationAudit: $("sbtValuationAudit"),
  sbtValSensitivity: $("sbtValSensitivity"), sbtValReceivables: $("sbtValReceivables"),
  sbtValInventory: $("sbtValInventory"), sbtValFixed: $("sbtValFixed"),
  sbtValOther: $("sbtValOther"), sbtValCapRate: $("sbtValCapRate"),
  sbtValTax: $("sbtValTax"), sbtValSaveBtn: $("sbtValSaveBtn"), sbtValResetBtn: $("sbtValResetBtn"),
  // --- 聊天 (chat) mode ---
  modeChatBtn: $("modeChatBtn"),
  aiApp: $("aiApp"),
  aiConvList: $("aiConvList"),
  aiConvSearch: $("aiConvSearch"),
  aiConvMenu: $("aiConvMenu"),
  aiNewChatBtn: $("aiNewChatBtn"),
  aiMessages: $("aiMessages"),
  aiStreamStatus: $("aiStreamStatus"),
  aiInput: $("aiInput"),
  aiSendBtn: $("aiSendBtn"),
  aiModel: $("aiModel"),
  aiThinking: $("aiThinking"),
  aiTitle: $("aiTitle"),
  aiSidebar: $("aiSidebar"),
  aiToggleSidebar: $("aiToggleSidebar"),
  aiBackdrop: $("aiBackdrop"),
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
  // --- borrow-repay mode ---
  borrowApp: $("borrowApp"),
  brwTabAddBtn: $("brwTabAddBtn"),
  brwTabListBtn: $("brwTabListBtn"),
  brwTabChartBtn: $("brwTabChartBtn"),
  brwTabAdd: $("brwTabAdd"),
  brwTabList: $("brwTabList"),
  brwTabChart: $("brwTabChart"),
  brwForm: $("brwForm"),
  brwEditId: $("brwEditId"),
  brwPerson: $("brwPerson"),
  brwPersonCustom: $("brwPersonCustom"),
  brwDate: $("brwDate"),
  brwType: $("brwType"),
  brwAmount: $("brwAmount"),
  brwNote: $("brwNote"),
  brwAddBtn: $("brwAddBtn"),
  brwCancelBtn: $("brwCancelBtn"),
  brwFormTitle: $("brwFormTitle"),
  brwBody: $("brwBody"),
  brwRecordCount: $("brwRecordCount"),
  brwEmptyHint: $("brwEmptyHint"),
  brwFilterDate: $("brwFilterDate"),
  brwSearchInput: $("brwSearchInput"),
  brwClearFilterBtn: $("brwClearFilterBtn"),
  brwShowAllBtn: $("brwShowAllBtn"),
  brwChartTitle: $("brwChartTitle"),
  brwChartTotal: $("brwChartTotal"),
  brwPersonBars: $("brwPersonBars"),
  brwPersonLegend: $("brwPersonLegend"),
  brwChartEmpty: $("brwChartEmpty"),
  // --- invest mode ---
  investApp: $("investApp"),
  invTabAddBtn: $("invTabAddBtn"),
  invTabListBtn: $("invTabListBtn"),
  invTabChartBtn: $("invTabChartBtn"),
  invTabAdd: $("invTabAdd"),
  invTabList: $("invTabList"),
  invTabChart: $("invTabChart"),
  invForm: $("invForm"),
  invEditId: $("invEditId"),
  invName: $("invName"),
  invNameList: $("invNameList"),
  invDate: $("invDate"),
  invAmount: $("invAmount"),
  invRate: $("invRate"),
  invTerm: $("invTerm"),
  invEarn: $("invEarn"),
  invNote: $("invNote"),
  invAddBtn: $("invAddBtn"),
  invCancelBtn: $("invCancelBtn"),
  invFormTitle: $("invFormTitle"),
  invBody: $("invBody"),
  invRecordCount: $("invRecordCount"),
  invEmptyHint: $("invEmptyHint"),
  invFilterDate: $("invFilterDate"),
  invSearchInput: $("invSearchInput"),
  invClearFilterBtn: $("invClearFilterBtn"),
  invShowAllBtn: $("invShowAllBtn"),
  invChartTitle: $("invChartTitle"),
  invChartTotal: $("invChartTotal"),
  invChartYear: $("invChartYear"),
  invWaterfall: $("invWaterfall"),
  invMonthBars: $("invMonthBars"),
  invChartEmpty: $("invChartEmpty"),
  // --- stored-value cards mode ---
  cardsApp: $("cardsApp"),
  svcTabAddBtn: $("svcTabAddBtn"),
  svcTabListBtn: $("svcTabListBtn"),
  svcTabChartBtn: $("svcTabChartBtn"),
  svcTabAdd: $("svcTabAdd"),
  svcTabList: $("svcTabList"),
  svcTabChart: $("svcTabChart"),
  svcForm: $("svcForm"),
  svcEditId: $("svcEditId"),
  svcCard: $("svcCard"),
  svcCardCustom: $("svcCardCustom"),
  svcDate: $("svcDate"),
  svcType: $("svcType"),
  svcAmount: $("svcAmount"),
  svcAccount: $("svcAccount"),
  svcExpiry: $("svcExpiry"),
  svcNote: $("svcNote"),
  svcAddBtn: $("svcAddBtn"),
  svcCancelBtn: $("svcCancelBtn"),
  svcFormTitle: $("svcFormTitle"),
  svcBody: $("svcBody"),
  svcRecordCount: $("svcRecordCount"),
  svcEmptyHint: $("svcEmptyHint"),
  svcFilterDate: $("svcFilterDate"),
  svcSearchInput: $("svcSearchInput"),
  svcClearFilterBtn: $("svcClearFilterBtn"),
  svcShowAllBtn: $("svcShowAllBtn"),
  svcChartTotal: $("svcChartTotal"),
  svcSummaryBody: $("svcSummaryBody"),
  svcChartEmpty: $("svcChartEmpty"),

  // 车辆保养 (veh*)
  vehicleApp: $("vehicleApp"),
  vehTabAddBtn: $("vehTabAddBtn"),
  vehTabListBtn: $("vehTabListBtn"),
  vehTabChartBtn: $("vehTabChartBtn"),
  vehTabAdd: $("vehTabAdd"),
  vehTabList: $("vehTabList"),
  vehTabChart: $("vehTabChart"),
  vehForm: $("vehForm"),
  vehEditId: $("vehEditId"),
  vehVehicle: $("vehVehicle"),
  vehVehicleCustom: $("vehVehicleCustom"),
  vehCategory: $("vehCategory"),
  vehCategoryCustom: $("vehCategoryCustom"),
  vehDate: $("vehDate"),
  vehCost: $("vehCost"),
  vehOdometer: $("vehOdometer"),
  vehNote: $("vehNote"),
  vehAddBtn: $("vehAddBtn"),
  vehCancelBtn: $("vehCancelBtn"),
  vehFormTitle: $("vehFormTitle"),
  vehBody: $("vehBody"),
  vehRecordCount: $("vehRecordCount"),
  vehEmptyHint: $("vehEmptyHint"),
  vehFilterDate: $("vehFilterDate"),
  vehSearchInput: $("vehSearchInput"),
  vehClearFilterBtn: $("vehClearFilterBtn"),
  vehShowAllBtn: $("vehShowAllBtn"),
  vehChartTitle: $("vehChartTitle"),
  vehChartTotal: $("vehChartTotal"),
  vehChartYear: $("vehChartYear"),
  vehWaterfall: $("vehWaterfall"),
  vehMonthBars: $("vehMonthBars"),
  vehChartEmpty: $("vehChartEmpty"),

  // 健康 (hea / hw 体重 / hb 血压)
  healthApp: $("healthApp"),
  heaSubWeightBtn: $("heaSubWeightBtn"),
  heaSubBpBtn: $("heaSubBpBtn"),
  hwSub: $("hwSub"),
  hbSub: $("hbSub"),
  // 体重 hw*
  hwTabAddBtn: $("hwTabAddBtn"),
  hwTabListBtn: $("hwTabListBtn"),
  hwTabChartBtn: $("hwTabChartBtn"),
  hwTabAdd: $("hwTabAdd"),
  hwTabList: $("hwTabList"),
  hwTabChart: $("hwTabChart"),
  hwForm: $("hwForm"),
  hwEditId: $("hwEditId"),
  hwPerson: $("hwPerson"),
  hwPersonCustom: $("hwPersonCustom"),
  hwDate: $("hwDate"),
  hwWeight: $("hwWeight"),
  hwHeight: $("hwHeight"),
  hwNote: $("hwNote"),
  hwBmiHint: $("hwBmiHint"),
  hwAddBtn: $("hwAddBtn"),
  hwCancelBtn: $("hwCancelBtn"),
  hwFormTitle: $("hwFormTitle"),
  hwBody: $("hwBody"),
  hwRecordCount: $("hwRecordCount"),
  hwEmptyHint: $("hwEmptyHint"),
  hwFilterDate: $("hwFilterDate"),
  hwSearchInput: $("hwSearchInput"),
  hwClearFilterBtn: $("hwClearFilterBtn"),
  hwShowAllBtn: $("hwShowAllBtn"),
  hwChartPerson: $("hwChartPerson"),
  hwChartSvg: $("hwChartSvg"),
  hwChartLegend: $("hwChartLegend"),
  hwChartEmpty: $("hwChartEmpty"),
  hwTabCurveBtn: $("hwTabCurveBtn"),
  hwTabCurve: $("hwTabCurve"),
  hwcAwSvg: $("hwcAwSvg"),
  hwcAwLegend: $("hwcAwLegend"),
  hwcAwEmpty: $("hwcAwEmpty"),
  hwcAhSvg: $("hwcAhSvg"),
  hwcAhLegend: $("hwcAhLegend"),
  hwcAhEmpty: $("hwcAhEmpty"),
  hwcHwSvg: $("hwcHwSvg"),
  hwcHwLegend: $("hwcHwLegend"),
  hwcHwEmpty: $("hwcHwEmpty"),
  // 血压 hb*
  hbTabAddBtn: $("hbTabAddBtn"),
  hbTabListBtn: $("hbTabListBtn"),
  hbTabChartBtn: $("hbTabChartBtn"),
  hbTabAdd: $("hbTabAdd"),
  hbTabList: $("hbTabList"),
  hbTabChart: $("hbTabChart"),
  hbForm: $("hbForm"),
  hbEditId: $("hbEditId"),
  hbPerson: $("hbPerson"),
  hbPersonCustom: $("hbPersonCustom"),
  hbDate: $("hbDate"),
  hbSystolic: $("hbSystolic"),
  hbDiastolic: $("hbDiastolic"),
  hbPulse: $("hbPulse"),
  hbNote: $("hbNote"),
  hbAddBtn: $("hbAddBtn"),
  hbCancelBtn: $("hbCancelBtn"),
  hbFormTitle: $("hbFormTitle"),
  hbBody: $("hbBody"),
  hbRecordCount: $("hbRecordCount"),
  hbEmptyHint: $("hbEmptyHint"),
  hbFilterDate: $("hbFilterDate"),
  hbSearchInput: $("hbSearchInput"),
  hbClearFilterBtn: $("hbClearFilterBtn"),
  hbShowAllBtn: $("hbShowAllBtn"),
  hbChartPerson: $("hbChartPerson"),
  hbChartSvg: $("hbChartSvg"),
  hbChartLegend: $("hbChartLegend"),
  hbChartEmpty: $("hbChartEmpty"),
  // 生活博客 (blog*)
  blogApp: $("blogApp"),
  blogTabListBtn: $("blogTabListBtn"),
  blogTabViewBtn: $("blogTabViewBtn"),
  blogTabEditBtn: $("blogTabEditBtn"),
  blogClearFilterBtn: $("blogClearFilterBtn"),
  blogListPager: $("blogListPager"), blogListFirst: $("blogListFirst"), blogListPrev: $("blogListPrev"), blogListNext: $("blogListNext"), blogListLast: $("blogListLast"), blogListPageInfo: $("blogListPageInfo"), blogListPageInput: $("blogListPageInput"), blogListGo: $("blogListGo"),
  blogLightbox: $("blogLightbox"),
  blogLightboxImg: $("blogLightboxImg"),
  blogTabList: $("blogTabList"),
  blogTabView: $("blogTabView"),
  blogTabEdit: $("blogTabEdit"),
  blogSearch: $("blogSearch"),
  blogTagFilterBar: $("blogTagFilterBar"), blogTagFilterValue: $("blogTagFilterValue"), blogTagFilterClear: $("blogTagFilterClear"),
  blogCount: $("blogCount"),
  blogList: $("blogList"),
  blogEmpty: $("blogEmpty"),
  blogBackBtn: $("blogBackBtn"),
  blogShareBtn: $("blogShareBtn"),
  blogEditThisBtn: $("blogEditThisBtn"),
  blogDeleteThisBtn: $("blogDeleteThisBtn"),
  blogViewTitle: $("blogViewTitle"),
  blogViewDate: $("blogViewDate"),
  blogViewTags: $("blogViewTags"),
  blogTopBtn: $("blogTopBtn"),
  blogFloatingActions: $("blogFloatingActions"), blogCommentBtn: $("blogCommentBtn"),
  blogSummarySources: $("blogSummarySources"),
  summaryModelInput: $("summaryModelInput"),
  summaryModelSaveBtn: $("summaryModelSaveBtn"),
  summaryModelHint: $("summaryModelHint"),
  blogViewBody: $("blogViewBody"),
  blogComments: $("blogComments"), blogCommentCount: $("blogCommentCount"), blogCommentList: $("blogCommentList"), blogCommentEmpty: $("blogCommentEmpty"),
  blogCommentLabel: $("blogCommentLabel"), blogEditCommentId: $("blogEditCommentId"), blogCommentInput: $("blogCommentInput"), blogCommentSubmitBtn: $("blogCommentSubmitBtn"), blogCommentCancelBtn: $("blogCommentCancelBtn"),
  blogCommentImageInput: $("blogCommentImageInput"), blogCommentPickImageBtn: $("blogCommentPickImageBtn"), blogCommentImageHint: $("blogCommentImageHint"),
  blogCommentAudioInput: $("blogCommentAudioInput"), blogCommentPickAudioBtn: $("blogCommentPickAudioBtn"), blogCommentAudioHint: $("blogCommentAudioHint"),
  blogCommentVideoInput: $("blogCommentVideoInput"), blogCommentPickVideoBtn: $("blogCommentPickVideoBtn"), blogCommentVideoHint: $("blogCommentVideoHint"),
  blogEditFormTitle: $("blogEditFormTitle"),
  blogEditId: $("blogEditId"),
  blogTitleInput: $("blogTitleInput"),
  blogDateInput: $("blogDateInput"),
  blogTagSelect: $("blogTagSelect"), blogTagToggle: $("blogTagToggle"), blogTagPanel: $("blogTagPanel"), blogTagNewInput: $("blogTagNewInput"), blogTagAddBtn: $("blogTagAddBtn"), blogTagOptions: $("blogTagOptions"),
  blogBodyInput: $("blogBodyInput"),
  blogMdToolbar: $("blogMdToolbar"),
  blogImageInput: $("blogImageInput"),
  blogImageHint: $("blogImageHint"),
  blogAudioInput: $("blogAudioInput"), blogAudioHint: $("blogAudioHint"), blogPickAudioBtn: $("blogPickAudioBtn"),
  blogVideoInput: $("blogVideoInput"), blogVideoHint: $("blogVideoHint"), blogPickVideoBtn: $("blogPickVideoBtn"),
  blogPickExistingBtn: $("blogPickExistingBtn"),
  blogImgPicker: $("blogImgPicker"),
  blogImgPickerGrid: $("blogImgPickerGrid"),
  blogImgPickerCount: $("blogImgPickerCount"),
  blogImgPickerClose: $("blogImgPickerClose"),
  blogImgPickerPager: $("blogImgPickerPager"),
  blogImgPickerPrev: $("blogImgPickerPrev"),
  blogImgPickerNext: $("blogImgPickerNext"),
  blogImgPickerPageInfo: $("blogImgPickerPageInfo"),
blogSaveBtn: $("blogSaveBtn"),
  blogCancelBtn: $("blogCancelBtn"),
  // 贴吧 (forum*)
  blogTabForumBtn: $("blogTabForumBtn"),
  blogTabForum: $("blogTabForum"),
  forumTopicList: $("forumTopicList"),
  forumTopicEdit: $("forumTopicEdit"),
  forumTopicView: $("forumTopicView"),
  forumEditTitle: $("forumEditTitle"),
  forumEditTopicId: $("forumEditTopicId"),
  forumNewTopicBtn: $("forumNewTopicBtn"),
  forumSearch: $("forumSearch"),
  forumClearFilterBtn: $("forumClearFilterBtn"),
  forumCount: $("forumCount"),
  forumListPager: $("forumListPager"), forumListFirst: $("forumListFirst"), forumListPrev: $("forumListPrev"), forumListNext: $("forumListNext"), forumListLast: $("forumListLast"), forumListPageInfo: $("forumListPageInfo"), forumListPageInput: $("forumListPageInput"), forumListGo: $("forumListGo"),
  forumList: $("forumList"),
  forumEmpty: $("forumEmpty"),
  forumTitleInput: $("forumTitleInput"),
  forumBodyInput: $("forumBodyInput"),
  forumSaveBtn: $("forumSaveBtn"),
  forumCancelBtn: $("forumCancelBtn"),
  forumBackBtn: $("forumBackBtn"),
  forumShareBtn: $("forumShareBtn"),
  forumEditBtn: $("forumEditBtn"),
  forumDeleteBtn: $("forumDeleteBtn"),
  forumViewTitle: $("forumViewTitle"),
  forumViewMeta: $("forumViewMeta"),
  forumPosts: $("forumPosts"),
  forumPostPager: $("forumPostPager"), forumPostFirst: $("forumPostFirst"), forumPostPrev: $("forumPostPrev"), forumPostNext: $("forumPostNext"), forumPostLast: $("forumPostLast"), forumPostPageInfo: $("forumPostPageInfo"), forumPostPageInput: $("forumPostPageInput"), forumPostGo: $("forumPostGo"),
  forumReplyBox: $("forumReplyBox"),
  forumReplyInput: $("forumReplyInput"),
  forumReplyLabel: $("forumReplyLabel"),
  forumEditPostId: $("forumEditPostId"),
  forumReplyBtn: $("forumReplyBtn"),
  forumReplyCancelBtn: $("forumReplyCancelBtn"),
  forumTopicImageInput: $("forumTopicImageInput"), forumTopicPickBtn: $("forumTopicPickBtn"), forumTopicImageHint: $("forumTopicImageHint"),
  forumReplyImageInput: $("forumReplyImageInput"), forumReplyPickBtn: $("forumReplyPickBtn"), forumReplyImageHint: $("forumReplyImageHint"),
  forumTopicAudioInput: $("forumTopicAudioInput"), forumTopicAudioPickBtn: $("forumTopicAudioPickBtn"), forumTopicAudioHint: $("forumTopicAudioHint"),
  forumReplyAudioInput: $("forumReplyAudioInput"), forumReplyAudioPickBtn: $("forumReplyAudioPickBtn"), forumReplyAudioHint: $("forumReplyAudioHint"),
  forumTopicVideoInput: $("forumTopicVideoInput"), forumTopicVideoPickBtn: $("forumTopicVideoPickBtn"), forumTopicVideoHint: $("forumTopicVideoHint"),
  forumReplyVideoInput: $("forumReplyVideoInput"), forumReplyVideoPickBtn: $("forumReplyVideoPickBtn"), forumReplyVideoHint: $("forumReplyVideoHint"),
  audioPicker: $("audioPicker"), audioPickerCount: $("audioPickerCount"), audioPickerList: $("audioPickerList"), audioPickerClose: $("audioPickerClose"),
  videoPicker: $("videoPicker"), videoPickerCount: $("videoPickerCount"), videoPickerList: $("videoPickerList"), videoPickerClose: $("videoPickerClose"),
  forumImgPicker: $("forumImgPicker"), forumImgPickerCount: $("forumImgPickerCount"), forumImgPickerGrid: $("forumImgPickerGrid"), forumImgPickerClose: $("forumImgPickerClose"), forumImgPickerPager: $("forumImgPickerPager"), forumImgPickerPrev: $("forumImgPickerPrev"), forumImgPickerNext: $("forumImgPickerNext"), forumImgPickerPageInfo: $("forumImgPickerPageInfo"),
  // 旅行地图 (travel*)
  travelApp: $("travelApp"),
  travelTabMapBtn: $("travelTabMapBtn"),
  travelTabListBtn: $("travelTabListBtn"),
  travelTabMap: $("travelTabMap"),
  travelTabList: $("travelTabList"),
  travelTabEdit: $("travelTabEdit"),
  travelPersonFilter: $("travelPersonFilter"),
  travelMapCount: $("travelMapCount"),
  travelMap: $("travelMap"),
  travelMapEmpty: $("travelMapEmpty"),
  travelRefreshBtn: $("travelRefreshBtn"),
  travelPlaceSearch: $("travelPlaceSearch"), travelPlaceSearchBtn: $("travelPlaceSearchBtn"),
  travelPlaceClearBtn: $("travelPlaceClearBtn"), travelPlaceStatus: $("travelPlaceStatus"),
  travelPlaceResults: $("travelPlaceResults"),
  travelCoordPanel: $("travelCoordPanel"),
  travelCoordPlaceRow: $("travelCoordPlaceRow"), travelCoordPlace: $("travelCoordPlace"),
  travelCoordLng: $("travelCoordLng"),
  travelCoordLat: $("travelCoordLat"),
  travelCopyLngBtn: $("travelCopyLngBtn"),
  travelCopyLatBtn: $("travelCopyLatBtn"),
  travelCoordFillBtn: $("travelCoordFillBtn"),
  travelNewBtn: $("travelNewBtn"),
  travelSearch: $("travelSearch"),
  travelListCount: $("travelListCount"),
  travelTableBody: $("travelTableBody"),
  travelListEmpty: $("travelListEmpty"),
  travelEditTitle: $("travelEditTitle"),
  travelEditId: $("travelEditId"),
  travelTitleInput: $("travelTitleInput"),
  travelDateInput: $("travelDateInput"),
  travelLngInput: $("travelLngInput"),
  travelLatInput: $("travelLatInput"),
  travelRemarkInput: $("travelRemarkInput"),
  travelPeopleBox: $("travelPeopleBox"),
  travelPeopleExtra: $("travelPeopleExtra"),
  travelPeopleAddBtn: $("travelPeopleAddBtn"),
  travelPeopleList: $("travelPeopleList"),
  travelSaveBtn: $("travelSaveBtn"),
  travelCancelBtn: $("travelCancelBtn"),
};

/* --------------------------- Helpers ------------------------------------- */
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
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

function syncStickyNavOffsets() {
  const topbar = document.querySelector(".topbar");
  const modebar = document.querySelector(".mode-bar");
  if (topbar) document.documentElement.style.setProperty("--topbar-height", topbar.offsetHeight + "px");
  if (modebar) document.documentElement.style.setProperty("--modebar-height", modebar.offsetHeight + "px");
}

const DEEP_LINK_KEY = "familyTrackerDeepLink";
function readDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view"), id = params.get("id");
  if ((view === "blog" || view === "forum") && id) {
    const link = { view, id };
    try { sessionStorage.setItem(DEEP_LINK_KEY, JSON.stringify(link)); } catch {}
    return link;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(DEEP_LINK_KEY) || "null");
    return saved && (saved.view === "blog" || saved.view === "forum") && saved.id ? saved : null;
  } catch { return null; }
}
function clearDeepLink() {
  try { sessionStorage.removeItem(DEEP_LINK_KEY); } catch {}
  const url = new URL(window.location.href);
  url.searchParams.delete("view"); url.searchParams.delete("id");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function deepLinkUrl(view, id) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("view", view); url.searchParams.set("id", id);
  return url.toString();
}
async function sharePrivateLink(view, id, title) {
  const url = deepLinkUrl(view, id);
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); setStatus("链接已复制。", "ok", 1800); }
  catch { prompt("复制此链接：", url); }
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
  readDeepLink(); // preserve a shared article/topic target across the redirect
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
  secretExpiryLoaded = false;
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
  els.commentReminderWrap.classList.add("hidden");
  els.commentReminderPanel.classList.add("hidden");
}

async function onSignedIn() {
  els.userName.textContent = account.name || account.username || "";
  hide(els.loginView);
  show(els.appView);
  hide(els.loginBtn);
  show(els.logoutBtn);
  setStatus("正在载入数据…");
  // Lazily load whichever mode is active (defaults to 支出). Each mode's data
  // is fetched once and cached; switching modes never reloads.
  const deepLink = readDeepLink();
  await setMode(deepLink ? "blog" : mode, { skipLoad: !!deepLink, preserveDeepLink: !!deepLink });
  // Reminders are independent from the visible mode. Load them silently in the
  // background so opening 支出 never waits for or shows blog loading status.
  if (!deepLink) blogLoadCommentRemindersSilently();
  if (deepLink) await openDeepLink(deepLink);
}

async function openDeepLink(link) {
  showDeepLinkSkeleton(link);
  try {
    const token = await getToken();
    if (link.view === "blog") {
      await blogResolveFolder(token);
      await loadBlogDeepLink(token, link.id);
    } else {
      await forumResolveFolder(token);
      await loadForumDeepLink(token, link.id);
    }
  } catch (e) {
    const message = e.message || String(e);
    if (link.view === "blog") els.blogViewBody.innerHTML = '<p class="ai-error">' + escapeHtml(message) + "</p>";
    else els.forumPosts.innerHTML = '<p class="ai-error">' + escapeHtml(message) + "</p>";
    setStatus(message, "warn", 5000);
  }
}

function showDeepLinkSkeleton(link) {
  window.scrollTo({ top: 0, behavior: "auto" });
  if (link.view === "blog") {
    blogViewId = link.id;
    blogSwitchTab("view");
    history.replaceState(null, "", deepLinkUrl("blog", link.id));
    const isSummary = link.id.startsWith("summary::");
    const name = isSummary ? link.id.slice("summary::".length) : "";
    const match = name.match(/(\d{4}-\d{2}-\d{2})/);
    els.blogViewTitle.textContent = isSummary ? "定期总结 · " + (match ? match[1] : "") : "正在载入文章…";
    els.blogViewDate.textContent = "";
    els.blogViewTags.innerHTML = "";
    els.blogEditThisBtn.classList.toggle("hidden", isSummary);
    els.blogDeleteThisBtn.classList.toggle("hidden", isSummary);
    els.blogSummarySources.classList.toggle("hidden", !isSummary);
    els.blogSummarySources.open = false;
    els.blogViewBody.innerHTML = '<p class="muted">正在载入正文…</p>';
    els.blogCommentList.innerHTML = '<p class="muted">正在载入评论…</p>';
    els.blogCommentCount.textContent = "";
    els.blogCommentEmpty.classList.add("hidden");
  } else {
    blogSwitchTab("forum");
    forumCurTopicId = link.id;
    forumSwitchTab("view");
    history.replaceState(null, "", deepLinkUrl("forum", link.id));
    els.forumViewTitle.textContent = "正在载入主题…";
    els.forumViewMeta.textContent = "";
    els.forumEditBtn.classList.add("hidden");
    els.forumDeleteBtn.classList.add("hidden");
    els.forumPosts.innerHTML = '<p class="muted">正在载入正文…</p>';
    els.forumPostPager.classList.add("hidden");
    forumResetReplyEditor();
  }
}

async function blogLoadDeepLinkTarget(token, id) {
  let post = null;
  if (id.startsWith("summary::")) {
    const name = id.slice("summary::".length);
    const match = name.match(/(\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : "";
    post = {
      id, title: "定期总结 · " + date, date,
      excerpt: "自动生成的双周回顾", isSummary: true,
      summaryPath: "summaries/" + name,
    };
    if (!blogSummaries.some((p) => p.id === id)) blogSummaries.push(post);
  } else {
    const idx = await blogReadIndex(token);
    post = idx.posts.find((p) => p.id === id) || null;
    if (!post) throw new Error("文章不存在或已删除。");
    blogIndexEtag = idx.etag;
    blogPosts = idx.posts.slice().sort(blogCmp);
  }
  return post;
}

async function loadBlogDeepLink(token, id) {
  const targetPromise = blogLoadDeepLinkTarget(token, id);
  const commentPromise = blogReadComments(token, id);
  const bodyPath = id.startsWith("summary::")
    ? "summaries/" + id.slice("summary::".length)
    : "posts/" + id + ".md";
  const bodyPromise = blogReadText(token, bodyPath);
  const post = await targetPromise;
  blogViewId = id;
  els.blogViewTitle.textContent = post.title || "(无标题)";
  blogRenderViewMeta(post, 0);
  blogRenderTagChips(els.blogViewTags, post.tags, true);
  els.blogEditThisBtn.classList.toggle("hidden", !!post.isSummary);
  els.blogDeleteThisBtn.classList.toggle("hidden", !!post.isSummary);
  els.blogSummarySources.classList.toggle("hidden", !post.isSummary);
  const md = await bodyPromise;
  if (md == null) throw new Error("文章不存在或已删除。");
  els.blogViewBody.innerHTML = blogRenderMarkdown(md);
  blogResolveImages(token, els.blogViewBody).catch((e) => console.warn("article media:", e));
  commentPromise.then(async (data) => {
    blogCommentsData = data.comments; blogCommentsEtag = data.etag;
    blogRenderViewMeta(post, blogCommentsData.length);
    blogResetCommentEditor();
    await blogRenderComments(token);
  }).catch((e) => {
    els.blogCommentList.innerHTML = '<p class="muted">评论载入失败：' + escapeHtml(e.message || String(e)) + "</p>";
  });
  loadSummarySettings(token).catch((e) => console.warn("summary settings:", e));
}

async function loadForumDeepLink(token, id) {
  const requestId = ++forumOpenRequestId;
  let [idx, data] = await Promise.all([forumReadIndex(token), forumReadTopic(token, id)]);
  if (requestId !== forumOpenRequestId) return;
  let topic = forumFindDeepLinkTopic(idx.topics, data.topic, id);
  if (!topic || !data.topic || data.notFound) {
    [idx, data] = await Promise.all([forumReadIndex(token), forumReadTopic(token, id)]);
    if (requestId !== forumOpenRequestId) return;
    topic = forumFindDeepLinkTopic(idx.topics, data.topic, id);
  }
  forumTopics = idx.topics.slice().sort(forumCmp);
  forumIndexEtag = idx.etag;
  if (data.notFound) throw new Error("贴吧主题不存在或已删除。");
  if (!topic) {
    throw new Error("主题文件缺少主题信息，请稍后下拉刷新重试。");
  }
  if (!forumTopics.some((t) => t.id === id)) forumTopics.push(topic);
  forumLoaded = true;
  forumCurTopicId = id;
  forumPostPage = 0;
  forumCurPosts = data.posts;
  forumCurEtag = data.etag;
  els.forumViewTitle.textContent = topic.title || "(无标题)";
  els.forumViewMeta.textContent = (topic.author || "匿名") + " 发起 · " + formatBeijingTime(topic.created) + " · " + (topic.postCount || data.posts.length || 0) + " 楼";
  els.forumEditBtn.classList.toggle("hidden", forumIsProtectedTopic(topic) || !forumIsAuthor(topic.author));
  els.forumDeleteBtn.classList.toggle("hidden", forumCannotDeleteTopic(topic) || !forumIsAuthor(topic.author));
  await forumRenderPosts(token);
}

function forumFindDeepLinkTopic(topics, fileTopic, id) {
  return topics.find((t) => t.id === id) || (fileTopic && fileTopic.id === id ? fileTopic : null);
}

async function forumReturnToList() {
  forumOpenRequestId++;
  if (!forumLoaded) {
    setStatus("正在载入主题列表…");
    try { await forumLoad(); }
    catch (e) {
      forumSwitchTab("view");
      setStatus("主题列表载入失败：" + (e.message || e), "error", 6000);
      return;
    }
  }
  clearDeepLink();
  forumSwitchTab("list");
  forumRenderList();
  blogRestorePosition("forum");
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

// Hot/cold cutoff = the 1st of the month, with a grace window: during days
// 1..CUTOFF_GRACE_DAY-1 we fall back to the PREVIOUS month's 1st so last
// month's tail stays visible by default; from the 7th on we use the current
// month's 1st. Returns "YYYY-MM-01".
const CUTOFF_GRACE_DAY = 7;
function monthCutoff() {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth();            // 0-based current month
  if (d.getDate() < CUTOFF_GRACE_DAY) {  // grace window -> previous month
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return y + "-" + String(m + 1).padStart(2, "0") + "-01";
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

function normalizeSecretExpiry(value) {
  const secret = (value && typeof value === "object") ? value : null;
  const createdDate = secret && /^\d{4}-\d{2}-\d{2}$/.test(secret.createdDate || "")
    ? secret.createdDate : "";
  const validityDays = secret ? Math.floor(Number(secret.validityDays)) : 0;
  return createdDate && validityDays > 0
    ? { createdDate, validityDays, modified: secret.modified || "" }
    : null;
}

// Interpret the stored file: {custom, hidden, secretExpiry} or legacy bare tree.
function parseCatsFile(data) {
  const d = (data && typeof data === "object") ? data : {};
  if ("custom" in d || "hidden" in d || "secretExpiry" in d) {
    customCats = (d.custom && typeof d.custom === "object") ? d.custom : {};
    hiddenCats = normalizeHidden(d.hidden);
    secretExpiry = normalizeSecretExpiry(d.secretExpiry);
  } else {
    customCats = d;                     // legacy: whole file was the add-tree
    hiddenCats = normalizeHidden(null);
    secretExpiry = null;
  }
}

async function loadCustomCats(token) {
  const r = await readJson(token, CATS_FILE);
  parseCatsFile(r.data);
  etagCats = r.etag;
  secretExpiryLoaded = true;
  applyCustomCats();
  fillCatFilters();
  renderSecretExpiry();
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
    const body = JSON.stringify({ custom: customCats, hidden: hiddenCats, secretExpiry });
    const res = await fetch(content, { method: "PUT", headers, body });
    if (res.ok) {
      const item = await res.json();
      etagCats = item.eTag || (await readETag(token, CATS_FILE));
      return true;
    }
    if (res.status === 412) {
      const fresh = await readJson(token, CATS_FILE);
      const d = (fresh.data && typeof fresh.data === "object") ? fresh.data : {};
      const structured = "custom" in d || "hidden" in d || "secretExpiry" in d;
      const otherCustom = structured ? (d.custom || {}) : d;
      const otherHidden = structured ? d.hidden : null;
      const otherSecret = structured ? normalizeSecretExpiry(d.secretExpiry) : null;
      deepMergeCats(customCats, otherCustom);
      mergeHidden(hiddenCats, otherHidden);
      if (otherSecret && (!secretExpiry ||
          String(otherSecret.modified) > String(secretExpiry.modified))) {
        secretExpiry = otherSecret;
      }
      applyCustomCats();
      etagCats = fresh.etag;
      continue;
    }
    throw new Error("保存分类失败：" + res.status);
  }
  throw new Error("保存分类冲突，重试多次仍失败。");
}

function localDateFromYmd(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !isFinite(x))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getFullYear() === parts[0] && d.getMonth() === parts[1] - 1 &&
    d.getDate() === parts[2] ? d : null;
}

function formatLocalYmd(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function updateSecretExpirySaveState() {
  if (!els.secretExpirySaveBtn) return;
  const createdDate = els.secretCreatedDate.value;
  const validityDays = Math.floor(Number(els.secretValidityDays.value));
  const savedDate = secretExpiry ? secretExpiry.createdDate : "";
  const savedDays = secretExpiry ? secretExpiry.validityDays : 0;
  els.secretExpirySaveBtn.disabled = !secretExpiryLoaded ||
    (createdDate === savedDate && validityDays === savedDays);
}

function renderSecretExpiry() {
  if (!els.secretExpirySummary) return;
  const secret = secretExpiry;
  els.secretCreatedDate.value = secret ? secret.createdDate : "";
  els.secretValidityDays.value = secret ? secret.validityDays : "";
  updateSecretExpirySaveState();
  els.secretExpirySummary.className = "secret-expiry-summary muted";
  if (!secret) {
    els.secretExpirySummary.textContent = "尚未设置客户端密码有效期。";
    return;
  }
  const created = localDateFromYmd(secret.createdDate);
  if (!created) {
    els.secretExpirySummary.textContent = "保存的创建日期无效，请重新设置。";
    els.secretExpirySummary.classList.add("error");
    return;
  }
  const expires = new Date(created);
  expires.setDate(expires.getDate() + secret.validityDays);
  const today = localDateFromYmd(todayStr());
  const remaining = Math.ceil((expires - today) / 86400000);
  const status = remaining < 0 ? `已到期 ${Math.abs(remaining)} 天`
    : remaining === 0 ? "今天到期" : `剩余 ${remaining} 天`;
  els.secretExpirySummary.textContent =
    `创建日期：${secret.createdDate}　到期日期：${formatLocalYmd(expires)}　${status}`;
  els.secretExpirySummary.classList.add(remaining > 30 ? "ok" : remaining >= 0 ? "warn" : "error");
}

async function saveSecretExpiry(e) {
  e.preventDefault();
  const createdDate = els.secretCreatedDate.value;
  const validityDays = Math.floor(Number(els.secretValidityDays.value));
  if (!localDateFromYmd(createdDate) || !isFinite(validityDays) || validityDays < 1) {
    setStatus("请填写有效的创建日期和有效期天数。", "warn", 5000);
    return;
  }
  const previous = secretExpiry;
  secretExpiry = { createdDate, validityDays, modified: new Date().toISOString() };
  els.secretExpirySaveBtn.disabled = true;
  try {
    await saveCustomCats();
    renderSecretExpiry();
    setStatus("客户端密码有效期已保存。", "ok", 3000);
  } catch (err) {
    secretExpiry = previous;
    renderSecretExpiry();
    setStatus(err.message || String(err), "error", 7000);
  } finally {
    updateSecretExpirySaveState();
  }
}


async function loadRecords() {
  setStatus("正在从 OneDrive 载入…");
  const token = await getToken();
  await resolveFolder(token);
  await loadCustomCats(token);
  rebuildLevel1();
  // Recompute visible defaults now that hiddenCats is loaded — but ONLY when the
  // form is still pristine. Records load asynchronously, so the user may already
  // be typing a record; resetForm() would wipe their in-progress input (e.g. a
  // just-entered amount). Category dropdowns are already repopulated by
  // rebuildLevel1() above, so skipping the reset keeps their selections intact.
  if (!els.editId.value && !els.amount.value && !els.note.value.trim()) {
    resetForm();
  }
  updateAddBtnLoadingState();   // show "载入中…" / disable submit until loaded
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
  updateAddBtnLoadingState();   // re-enable submit now that data is loaded
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
        // Safeguard: if we have no eTag for the hot file, this session never
        // successfully read it. Writing currentRecords now (possibly empty)
        // with no If-Match would blow away the server's month data. Re-read
        // first and merge our op onto the real server list before writing.
        if (etagHot === null) {
          const cur = await readFile(token, HOT_FILE);
          if (cur.exists) {
            currentRecords = applyOpToBucket(cur.list, op, "hot", cutoff);
            etagHot = cur.etag;
            syncRecords();
          }
        }
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
  els.addBtn.disabled = locked || !spendingLoaded;
  els.medCatHint.classList.toggle("hidden", !locked);
}

// Reflect the "data not loaded yet" state on the add button so a user can still
// type early (per the pristine-guard) but can't submit before load finishes.
// The label is left unchanged to avoid a flicker; only the disabled (greyed)
// state signals loading.
function updateAddBtnLoadingState() {
  els.addBtn.title = spendingLoaded ? "" : "数据载入中…";
  updateMedCatLock(); // disabled state accounts for !spendingLoaded
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
  // Time-based smart default (local time): 8:00–10:00 -> 早饭, otherwise 买菜.
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const morning = mins >= 8 * 60 && mins < 10 * 60;
  const want = { i: "日常生活", ii: "餐饮", iii: morning ? "早饭" : "买菜" };
  if (visL1().includes(want.i) &&
      visL2(want.i).includes(want.ii) &&
      visL3(want.i, want.ii).includes(want.iii)) {
    return want;
  }
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
  // Guard: never save before OneDrive data has finished loading. Otherwise the
  // in-memory buckets are still empty and persist() would overwrite the hot
  // file (this month) with just this one record. See loadRecords/persist.
  if (!spendingLoaded) {
    setStatus("数据尚未载入完成，请稍候再保存。", "warn");
    return;
  }
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
  if (!spendingLoaded) {
    setStatus("数据尚未载入完成，请稍候再操作。", "warn");
    return false;
  }
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
  if (name === "settings") { renderHiddenList(); renderSecretExpiry(); }
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
  if (els.secretExpiryForm) els.secretExpiryForm.addEventListener("submit", saveSecretExpiry);
  if (els.secretCreatedDate) els.secretCreatedDate.addEventListener("change", updateSecretExpirySaveState);
  if (els.secretValidityDays) els.secretValidityDays.addEventListener("input", updateSecretExpirySaveState);
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
// Multi-select filter state (OR within each, AND across the three).
let incSelYears = new Set();
let incSelCats = new Set();
let incSelPayees = new Set();
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

// Build one custom checkbox-dropdown into `container`. `selected` is a live Set
// mutated on toggle; `onChange` re-renders the table. Selection persists across
// rebuilds (the Set is owned by the caller). Panels are mutually exclusive and
// close on outside-click (handled by a single document listener installed once).
function buildMultiDropdown(container, values, selected, placeholder, noun, onChange) {
  container.innerHTML = "";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ms-toggle";
  const panel = document.createElement("div");
  panel.className = "ms-panel hidden";

  const refreshLabel = () => {
    const n = selected.size;
    if (n === 0) toggle.textContent = placeholder;
    else if (n === 1) toggle.textContent = [...selected][0];
    else toggle.textContent = `${noun}(${n})`;
  };
  refreshLabel();

  for (const v of values) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(v);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(v); else selected.delete(v);
      refreshLabel();
      onChange();
    });
    const span = document.createElement("span");
    span.textContent = v;
    lab.appendChild(cb); lab.appendChild(span);
    panel.appendChild(lab);
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.classList.contains("hidden");
    // Close any other open panel first.
    document.querySelectorAll(".ms-panel").forEach((p) => p.classList.add("hidden"));
    panel.classList.toggle("hidden", !willOpen);
  });

  container.appendChild(toggle);
  container.appendChild(panel);
}

// Install the one-time outside-click handler that closes any open ms-panel.
let incMsOutsideBound = false;
function incBindMsOutsideClose() {
  if (incMsOutsideBound) return;
  incMsOutsideBound = true;
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".ms-dd")) {
      document.querySelectorAll(".ms-panel").forEach((p) => p.classList.add("hidden"));
    }
  });
}

// (Re)build the 年 / 分类 / 收款人 multi-select filter dropdowns on the income
// list. Option lists = visible options ∪ values actually present in records
// (year uses incYears()). Prune selections whose value no longer exists.
function incFillFilterSelects() {
  if (!els.incFilterCat || !els.incFilterPayee || !els.incFilterYear) return;
  incBindMsOutsideClose();
  const union = (visible, field) => {
    const set = new Set(visible);
    for (const r of incomeRecords) { const v = r[field]; if (v) set.add(v); }
    return [...set].sort((a, b) => String(a).localeCompare(String(b), "zh"));
  };
  const years = incYears();
  const cats = union(incVisTitles(), "title");
  const payees = union(incVisPayees(), "payee");
  const prune = (sel, valid) => { for (const v of [...sel]) if (!valid.includes(v)) sel.delete(v); };
  prune(incSelYears, years);
  prune(incSelCats, cats);
  prune(incSelPayees, payees);
  buildMultiDropdown(els.incFilterYear, years, incSelYears, "全部年份", "年份", incRenderTable);
  buildMultiDropdown(els.incFilterCat, cats, incSelCats, "全部分类", "分类", incRenderTable);
  buildMultiDropdown(els.incFilterPayee, payees, incSelPayees, "全部收款人", "收款人", incRenderTable);
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
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

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
  if (!incomeLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
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
    if (!isEdit) await maybeAddCelineSubsidy(rec);
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
  if (stkIsGeneratedIncome(r)) {
    setStatus("该收入由股票已实现收益自动同步，只能在股票交易中修改。", "warn", 5000);
    return;
  }
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
  incSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function incDelete(id) {
  if (!incomeLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = incomeRecords.find((x) => x.id === id);
  if (!r) return;
  if (stkIsGeneratedIncome(r)) {
    setStatus("该收入由股票已实现收益自动同步，只能在股票交易中删除或调整。", "warn", 5000);
    return;
  }
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
// Full render: (re)build the filter dropdowns, then the table. Called on data
// load / tab switch / clear. Checkbox toggles call incRenderTable() directly so
// the open panel isn't torn down mid-interaction.
function incRender() {
  incFillFilterSelects();
  incRenderTable();
}

function incRenderTable() {
  const monthFilter = incFilterOn && els.incFilterDate ? els.incFilterDate.value.slice(0, 7) : "";
  const attrFilter = !!(incSelYears.size || incSelCats.size || incSelPayees.size);
  const sorted = [...incomeRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (incShowAll || attrFilter) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }
  if (incSelYears.size) view = view.filter((r) => incSelYears.has((r.date || "").slice(0, 4)));
  if (incSelCats.size) view = view.filter((r) => incSelCats.has(r.title));
  if (incSelPayees.size) view = view.filter((r) => incSelPayees.has(r.payee));

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
    if (stkIsGeneratedIncome(r)) {
      actions.innerHTML = '<span class="inc-generated-label">自动同步·只读</span>';
    } else {
      const editB = document.createElement("button");
      editB.className = "btn btn-mini"; editB.textContent = "编辑";
      editB.onclick = () => incStartEdit(r.id);
      const delB = document.createElement("button");
      delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
      delB.onclick = () => incDelete(r.id);
      actions.appendChild(editB); actions.appendChild(delB);
    }
    els.incBody.appendChild(tr);
  }

  const total = incomeRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.netAmount) || 0), 0);
  if (monthFilter || attrFilter) els.incRecordCount.textContent = `${view.length} 条，实际合计 ${fmtAmount(sum)}`;
  else if (incShowAll) els.incRecordCount.textContent = `显示全部 ${total} 条`;
  else els.incRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.incClearFilterBtn.classList.toggle("hidden", !(monthFilter || attrFilter));
  els.incShowAllBtn.classList.toggle("hidden", !!monthFilter || attrFilter || (!limited && !incShowAll));
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
  els.incChartTotal.classList.toggle("neg", grand < 0);

  const has = rows.length > 0;
  els.incChartEmpty.classList.toggle("hidden", has);
  if (!has) { els.incWaterfall.innerHTML = ""; els.incMonthBars.innerHTML = ""; els.incCatLegend.innerHTML = ""; return; }

  // Stable color map ordered by descending total.
  const catOrder = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const colorOf = new Map();
  catOrder.forEach((name, i) => colorOf.set(name, incCatColor(name, i)));

  stkBuildWaterfall(els.incWaterfall,
    monthTotals.map((val, i) => ({ name: MONTH_LABELS[i], val })),
    { labelSuffix: "" });
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
  let maxSide = 1;
  for (const m of monthCat) {
    let pos = 0, neg = 0;
    for (const v of m.values()) { if (v >= 0) pos += v; else neg += -v; }
    maxSide = Math.max(maxSide, pos, neg);
  }
  const TRACK_PX = 190; // approx track pixel height for label-fit estimation
  els.incMonthBars.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    const total = monthTotals[m];
    const col = document.createElement("div");
    col.className = "mb-col";
    const segs = [...monthCat[m].entries()].sort((a, b) => b[1] - a[1]);
    let inner = "";
    let posCum = 0, negCum = 0;
    for (const [name, val] of segs.filter((x) => x[1] >= 0)) {
      const h = (val / maxSide) * 50;
      const bottom = 50 + (posCum / maxSide) * 50;
      const px = (val / maxSide) * (TRACK_PX / 2);
      const label = px >= 16 ? `<span class="mb-seg-label">${fmtInt(val)}</span>` : "";
      inner += `<div class="mb-seg" style="position:absolute;left:0;bottom:${bottom}%;height:${h}%;background:${colorOf.get(name) || "#118DFF"}" title="${escapeHtml(name)}：${fmtInt(val)}">${label}</div>`;
      posCum += val;
    }
    for (const [name, val] of segs.filter((x) => x[1] < 0)) {
      const mag = -val;
      const h = (mag / maxSide) * 50;
      const bottom = 50 - ((negCum + mag) / maxSide) * 50;
      const px = (mag / maxSide) * (TRACK_PX / 2);
      const label = px >= 16 ? `<span class="mb-seg-label">${fmtInt(val)}</span>` : "";
      inner += `<div class="mb-seg" style="position:absolute;left:0;bottom:${bottom}%;height:${h}%;background:${colorOf.get(name) || "#D64550"}" title="${escapeHtml(name)}：${fmtInt(val)}">${label}</div>`;
      negCum += mag;
    }
    col.innerHTML =
      `<div class="mb-val">${total ? fmtInt(total) : ""}</div>` +
      `<div class="mb-track"><div class="stk-zero" style="bottom:50%"></div>${inner}</div>` +
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

/* ------------------- 股票基本面 (StockBatchTracker) ---------------------- */
/* Read-only viewer for the quarterly fundamentals batch. Reads
   /me/drive/root:/Apps/StockBatchTracker/output/*.json (written by
   finance_batch_personal.py) via Graph, using the signed-in account's own
   OneDrive (same account that owns the folder). */
 const SBT_FOLDER_PATH = "/Apps/StockBatchTracker";
 // SHARED-FOLDER MODE: paste the OneDrive share link of the owner's
 // /Apps/StockBatchTracker folder here so OTHER accounts (e.g. Celine) can
 // read the batch fundamentals. Leave "" to fall back to the signed-in user's
 // own OneDrive (owner mode). Write actions (edit list / delete / trigger) stay
 // owner-only and are hidden for non-owners regardless of this URL.
 const SBT_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgDnmqAG8melSIHDcgh7oDNMAfcU0DzrmSjQJ61eX5dFJp8?email=celine_mas%40outlook.com&e=2eMl0h";
 const SBT_TRIGGER_URL = CHAT_API_URL + "/trigger-stock";  // Worker endpoint -> GitHub dispatch
 let sbtLoaded = false;         // one-time load guard
 let sbtSummary = [];           // parsed _summary.json (list of records)
 let sbtStocks = {};            // code -> parsed output/{code}.json (in-memory cache)
 let sbtFiles = {};             // code -> { name, lastModified } from output listing
 let sbtCodes = [];             // raw codes from stock_list.csv (settings editor)
 let sbtNames = {};             // numeric-code -> Chinese name, parsed from _summary.json
 let sbtDriveBase = "";         // resolved /drives/{id}/items/{id} base (shared mode)
 let sbtOwnRootBase = "";       // resolved /me/drive/root:/... base (owner mode)
 let sbtChipRanking = null;     // cached parsed output/_chip_ranking.json
 let sbtRankSort = { col: "profit_ratio", dir: 1 };  // 1 asc, -1 desc; default 获利比例升序
 let sbtChipExpandCode = "";    // stock_cn of the currently expanded/highlighted row ("" = none)
 const SBT_VALUATION_SETTINGS_FILE = "valuation-settings.json";
 let sbtValuationSettings = { version: 1, defaults: {}, stocks: {} };
 let sbtValuationEtag = null;
 let sbtValuationSettingsError = "";
 
 // True only for the folder owner — gates all write actions (add/delete/trigger).
 function sbtCanEdit() {
   return userEmail() === "zhuzx2006@outlook.com";
 }
 
 // Resolve the folder base once. In shared mode we address children with the
 // drive-item form `${base}:/child`; in owner mode with `${base}/child` (base
 // already ends in `root:/Apps/StockBatchTracker`). sbtChildUrl() hides the
 // difference so every caller uses one relative-path form.
 async function sbtResolveFolder(token) {
   if (sbtDriveBase || sbtOwnRootBase) return;
   if (!SBT_FOLDER_SHARE_URL) {
     const p = SBT_FOLDER_PATH.replace(/^\/+/, "");
     sbtOwnRootBase = `${GRAPH}/me/drive/root:/${encodeURI(p)}`;
     return;
   }
   const sid = encodeShareUrl(SBT_FOLDER_SHARE_URL);
   const res = await fetch(
     `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
     { headers: { Authorization: "Bearer " + token } }
   );
   if (!res.ok) throw new Error("无法访问股票基本面文件夹：" + res.status + " " + (await res.text()));
   const item = await res.json();
   const driveId = item.parentReference && item.parentReference.driveId;
   sbtDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
 }
 
 // Build a Graph URL for a child path (e.g. "output/_summary.json") + optional
 // action suffix (e.g. ":/content", ":/children?...", or "" for the item).
 function sbtChildUrl(rel, suffix) {
   suffix = suffix || "";
   const r = rel.replace(/^\/+/, "");
   if (sbtDriveBase) return `${sbtDriveBase}:/${r}${suffix}`;
   // owner mode: base ends in `root:/folder`; child join needs a leading `/`.
   return `${sbtOwnRootBase}/${r}${suffix}`;
 }
 
 // List *.json under the output/ subfolder.
 async function sbtListOutputs(token) {
   await sbtResolveFolder(token);
   const url = sbtChildUrl("output", ":/children?$select=name,lastModifiedDateTime&$top=200");
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("无法列出 output 文件夹：" + res.status + " " + (await res.text()));
  const j = await res.json();
  return (j.value || []).filter((f) => /\.json$/i.test(f.name || ""));
}

// Read + parse one JSON file (path relative to the StockBatchTracker folder).
 async function sbtReadJson(token, relPath) {
   await sbtResolveFolder(token);
   const url = sbtChildUrl(relPath, ":/content");
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("读取失败 " + relPath + "：" + res.status);
  try { return await res.json(); } catch { return null; }
}

async function sbtReadValuationSettings(token) {
  await sbtResolveFolder(token);
  const res = await fetch(sbtChildUrl(SBT_VALUATION_SETTINGS_FILE, ":/content"), {
    cache: "no-store", headers: { Authorization: "Bearer " + token },
  });
  if (res.status === 404) return { data: { version: 1, defaults: {}, stocks: {} }, etag: null };
  if (!res.ok) throw new Error("读取估值参数失败：" + res.status);
   let data = null; try { data = await res.json(); }
   catch { throw new Error("估值参数文件不是有效 JSON。"); }
  data = data && typeof data === "object" ? data : {};
   if (!data.defaults || typeof data.defaults !== "object" || Array.isArray(data.defaults) ||
       !data.stocks || typeof data.stocks !== "object" || Array.isArray(data.stocks)) {
     throw new Error("估值参数文件结构无效。");
   }
  data.version = 1;
  let etag = res.headers.get("ETag");
  if (!etag) {
    const meta = await fetch(sbtChildUrl(SBT_VALUATION_SETTINGS_FILE, "?$select=eTag"), {
      cache: "no-store", headers: { Authorization: "Bearer " + token },
    });
    if (meta.ok) { const item = await meta.json(); etag = item.eTag || null; }
  }
  if (!etag) throw new Error("无法读取估值参数文件版本，请稍后重试。");
  return { data, etag };
}

async function sbtLoadValuationSettings(token) {
  try {
    const result = await sbtReadValuationSettings(token);
    sbtValuationSettings = result.data; sbtValuationEtag = result.etag; sbtValuationSettingsError = "";
  } catch (e) {
    sbtValuationSettings = { version: 1, defaults: {}, stocks: {} };
    sbtValuationEtag = null;
    sbtValuationSettingsError = e.message || String(e);
    console.warn("valuation settings:", e);
  }
}

async function sbtWriteValuationPatch(code, value) {
  const token = await getToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = JSON.parse(JSON.stringify(sbtValuationSettings));
    next.version = 1; next.defaults = next.defaults || {}; next.stocks = next.stocks || {};
    if (value == null) delete next.stocks[code]; else next.stocks[code] = value;
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (sbtValuationEtag) headers["If-Match"] = sbtValuationEtag;
    else headers["If-None-Match"] = "*";
    const res = await fetch(sbtChildUrl(SBT_VALUATION_SETTINGS_FILE, ":/content"), {
      method: "PUT", headers, body: JSON.stringify(next),
    });
    if (res.ok) {
      const item = await res.json(); sbtValuationSettings = next; sbtValuationEtag = item.eTag || null; return;
    }
    if (res.status === 409 || res.status === 412) {
      const fresh = await sbtReadValuationSettings(token);
      sbtValuationSettings = fresh.data; sbtValuationEtag = fresh.etag; continue;
    }
    throw new Error("保存估值参数失败：" + res.status);
  }
  throw new Error("估值参数发生并发冲突，请重试。");
}

 async function sbtLoad(force) {
   sbtApplyPerms();
   if (sbtLoaded && !force) { return; }
  setStatus("正在载入股票基本面数据…", "info");
  const token = await getToken();
  await sbtLoadValuationSettings(token);
  const configuredCodes = new Set((await sbtReadStockList(token)).map(sbtCodeToCn).filter(Boolean));

   // Summary (optional; the per-stock files are the source of truth).
   sbtSummary = (await sbtReadJson(token, "output/_summary.json")) || [];
   sbtBuildNames();

  // List per-stock output files, but DON'T download them all — we lazy-load
  // each stock's JSON only when it's selected, and cache it locally.
  const files = await sbtListOutputs(token);
  sbtFiles = {};
  for (const f of files) {
    if (/^_/.test(f.name)) continue;             // skip _summary.json etc.
    const cn = f.name.replace(/\.json$/i, "");
    if (!configuredCodes.has(cn)) continue;
    sbtFiles[cn] = { name: f.name, lastModified: f.lastModifiedDateTime || "" };
  }
  if (force) sbtStocks = {};                      // drop in-memory cache on manual refresh
  if (force) sbtChipRanking = null;               // re-read the ranking file on refresh

  sbtLoaded = true;
  sbtPopulateSelect();                            // lazy-loads the selected stock only
  // If the 筹码排行 tab is currently visible, refresh it.
  if (els.sbtTabChip && !els.sbtTabChip.classList.contains("hidden")) {
    sbtRenderChipRank().catch(() => {});
  }
  const n = Object.keys(sbtFiles).length;
  if (els.sbtRecordCount) els.sbtRecordCount.textContent = n ? `${n} 只股票` : "";
  setStatus(n ? `已载入 ${n} 只股票（按需加载明细）。` : "未找到 output/*.json。", n ? "success" : "error", 4000);
}

// Lazy-load one stock's JSON, using a localStorage cache keyed by the file's
// lastModified (so a re-run of the batch auto-invalidates the stale copy).
async function sbtLoadStock(code) {
  if (sbtStocks[code]) return sbtStocks[code];
  const meta = sbtFiles[code];
  if (!meta) return null;
  const cacheKey = "sbt:" + meta.name;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.lm === meta.lastModified && obj.data) {
        sbtStocks[code] = obj.data;
        return obj.data;
      }
    }
  } catch { /* ignore cache read errors */ }
  setStatus(`正在载入 ${code} 明细…`, "info");
  const token = await getToken();
  const data = await sbtReadJson(token, "output/" + meta.name);
  if (data) {
    sbtStocks[code] = data;
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ lm: meta.lastModified, data }));
    } catch { /* quota/full — cache is best-effort */ }
    setStatus(`${code} 明细已载入。`, "success", 2000);
  }
  return data;
}

 // Parse the Chinese names out of _summary.json. Each row's "Stock Number"
 // looks like "{seq}--{stock}-{中文名}", e.g. "1--600519.ss-贵州茅台" or
 // "34--01548.HK-金斯瑞". We key by the leading numeric code (before the dot) so
 // it matches the dropdown's file code regardless of .ss/.SH suffix casing.
 function sbtBuildNames() {
   sbtNames = {};
   for (const r of (Array.isArray(sbtSummary) ? sbtSummary : [])) {
     const sn = String((r && r["Stock Number"]) || "");
     const rest = sn.split("--").slice(1).join("--");   // drop the "{seq}--" prefix
     if (!rest) continue;
     const dash = rest.indexOf("-");
     if (dash < 0) continue;
     const stock = rest.slice(0, dash);
     const name = rest.slice(dash + 1).trim();
     const numeric = stock.split(".")[0].trim();
     if (numeric && name) sbtNames[numeric] = name;
   }
 }

 // Chinese name for a dropdown code: prefer the summary map (available upfront
 // for all stocks), fall back to a loaded stock's own stock_name.
 function sbtNameFor(code) {
   const numeric = String(code).split(".")[0].trim();
   return sbtNames[numeric] || (sbtStocks[code] && sbtStocks[code].stock_name) || "";
 }

 function sbtPopulateSelect() {
   const codes = Object.keys(sbtFiles).sort();
   const prev = els.sbtSelect.value;
   els.sbtSelect.innerHTML = "";
   for (const code of codes) {
     const opt = document.createElement("option");
     const nm = sbtNameFor(code);
     opt.value = code;
     opt.textContent = nm ? `${code} ${nm}` : code;
     els.sbtSelect.appendChild(opt);
   }
  if (codes.length) {
    els.sbtSelect.value = codes.includes(prev) ? prev : codes[0];
    sbtRenderDetail(els.sbtSelect.value).catch((e) =>
      setStatus("载入明细失败：" + (e.message || e), "error"));
  } else {
    els.sbtDetailCard.classList.add("hidden");
  }
}

// Load the pre-aggregated ranking file (output/_chip_ranking.json). Cached in
// memory; re-read on demand. Returns [] if absent.
async function sbtLoadChipRanking() {
  if (sbtChipRanking) return sbtChipRanking;
  const token = await getToken();
  sbtChipRanking = (await sbtReadJson(token, "output/_chip_ranking.json")) || [];
  return sbtChipRanking;
}

// Build a numeric-code -> {profit, liab, div} bool map from _summary.json,
// so the 3 汇总 flags can be joined onto each ranking row.
function sbtSummaryFlags() {
  const map = {};
  const truthy = (v) => (String(v) === "True" || v === true);
  for (const r of (Array.isArray(sbtSummary) ? sbtSummary : [])) {
    const sn = String((r && r["Stock Number"]) || "");
    const rest = sn.split("--").slice(1).join("--");     // drop "{seq}--"
    const stock = rest.split("-")[0] || "";              // e.g. 600519.ss / 01548.HK
    const numeric = stock.split(".")[0].trim();
    if (!numeric) continue;
    map[numeric] = {
      b_profit: truthy(r["利润表现好"]),
      b_liab: truthy(r["流动负债不高"]),
      b_div: truthy(r["分红多"]),
    };
  }
  return map;
}

// Collapse the inline chip chart (move the reusable block back to its hidden
// home). keepHighlight=true leaves the clicked row highlighted.
function sbtChipCollapse(keepHighlight) {
  const expandTr = els.sbtChipRankBody && els.sbtChipRankBody.querySelector("tr.sbt-chip-expand");
  if (els.sbtChipCard && els.sbtChipHidden && els.sbtChipCard.parentElement !== els.sbtChipHidden) {
    els.sbtChipHidden.appendChild(els.sbtChipCard);
  }
  if (els.sbtChipHidden) els.sbtChipHidden.classList.add("hidden");
  if (els.sbtChipActions) els.sbtChipActions.classList.add("hidden");
  if (expandTr) expandTr.remove();
  if (!keepHighlight) {
    sbtChipExpandCode = "";
    if (els.sbtChipRankBody) els.sbtChipRankBody.querySelectorAll("tr.sbt-rank-active")
      .forEach((tr) => tr.classList.remove("sbt-rank-active"));
  }
}

// Expand the chip chart for `code` directly below its ranking row `tr`.
function sbtChipExpandRow(tr, code) {
  // Toggle off only when this exact row is genuinely expanded. A highlighted
  // row may remain after blank-area collapse, so the code alone is insufficient.
  const openRow = els.sbtChipRankBody &&
    els.sbtChipRankBody.querySelector("tr.sbt-chip-expand");
  if (sbtChipExpandCode === code && openRow) {
    sbtChipCollapse(false);
    return;
  }
  sbtChipCollapse(false);
  sbtChipExpandCode = code;
  tr.classList.add("sbt-rank-active");
  const ncols = tr.children.length;
  const exTr = document.createElement("tr");
  exTr.className = "sbt-chip-expand";
  const td = document.createElement("td");
  td.colSpan = ncols;
  exTr.appendChild(td);
  tr.after(exTr);
  els.sbtChipHidden.classList.remove("hidden");
  td.appendChild(els.sbtChipCard);           // move the reusable block here
  // Clear the previous stock's chart/metrics immediately so it doesn't flash
  // while the new stock's data loads (sbtRenderChip is async).
  if (els.sbtChipSvg) els.sbtChipSvg.innerHTML = "";
  if (els.sbtChipMeta) els.sbtChipMeta.textContent = "";
  if (els.sbtChipMetrics) els.sbtChipMetrics.innerHTML = "";
  if (els.sbtChipTitle) els.sbtChipTitle.textContent = "载入中…";
  if (els.sbtChipEmpty) els.sbtChipEmpty.classList.add("hidden");
  sbtRenderChip(code).catch((e) =>
    setStatus("载入筹码分布失败：" + (e.message || e), "error"));
}

// Sort the ranking list per sbtRankSort. Nulls always sink to the bottom for
// numeric columns; bool columns put True first on asc.
function sbtSortRanking(list) {
  const { col, dir } = sbtRankSort;
  const arr = list.slice();
  if (col === "stock") {
    arr.sort((a, b) => {
      const ak = `${a.stock_cn || ""} ${a.stock_name || ""}`;
      const bk = `${b.stock_cn || ""} ${b.stock_name || ""}`;
      return dir * ak.localeCompare(bk, "zh");
    });
  } else if (col === "b_profit" || col === "b_liab" || col === "b_div") {
    arr.sort((a, b) => {
      const av = a[col] ? 1 : 0, bv = b[col] ? 1 : 0;
      return dir * (bv - av);   // dir=1 (asc) => True first
    });
  } else {
    arr.sort((a, b) => {
      const av = (a && a[col] != null) ? a[col] : null;
      const bv = (b && b[col] != null) ? b[col] : null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;    // nulls last regardless of dir
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }
  return arr;
}

// Render the merged 筹码排行 table (ranking + summary flags), with sortable
// headers and inline chip-chart expansion on row click.
async function sbtRenderChipRank() {
  const rows = await sbtLoadChipRanking();
  const flags = sbtSummaryFlags();
  let list = (Array.isArray(rows) ? rows : [])
    // Only show stocks whose output/{code}.json still exists (deleted stocks
    // stay in the aggregate file until the next full batch, but must not show).
    .filter((r) => r && r.stock_cn && Object.prototype.hasOwnProperty.call(sbtFiles, r.stock_cn))
    .map((r) => {
      const numeric = String(r.stock_cn || "").split(".")[0].trim();
      const f = flags[numeric] || {};
      return Object.assign({}, r, {
        b_profit: !!f.b_profit, b_liab: !!f.b_liab, b_div: !!f.b_div,
      });
    });
  sbtChipCollapse(false);           // reset any open chart before re-render
  list = sbtSortRanking(list);

  const has = list.length > 0;
  if (els.sbtChipRankEmpty) els.sbtChipRankEmpty.classList.toggle("hidden", has);
  if (els.sbtChipRankMeta) els.sbtChipRankMeta.textContent = has ? `共 ${list.length} 只` : "";
  if (els.sbtChipRankPriceTh) {
    let repDate = "";
    for (const r of list) { if (r && r.as_of && String(r.as_of) > repDate) repDate = String(r.as_of); }
    els.sbtChipRankPriceTh.textContent = repDate ? `${repDate}当前股价` : "当前股价";
  }
  // header sort arrows
  if (els.sbtChipRankTable) {
    els.sbtChipRankTable.querySelectorAll("th.sbt-sortable").forEach((th) => {
      const c = th.getAttribute("data-sort");
      const base = th.getAttribute("data-label") || th.textContent.replace(/[▲▼]\s*$/, "").trim();
      th.setAttribute("data-label", base);
      th.textContent = base + (c === sbtRankSort.col ? (sbtRankSort.dir === 1 ? " ▲" : " ▼") : "");
    });
    // dynamic 收盘价 header keeps its date; re-apply arrow if it's the sort col
    if (els.sbtChipRankPriceTh) {
      const c = "latest_close";
      let repDate = "";
      for (const r of list) { if (r && r.as_of && String(r.as_of) > repDate) repDate = String(r.as_of); }
      const base = (repDate ? `${repDate}当前股价` : "当前股价");
      els.sbtChipRankPriceTh.setAttribute("data-label", base);
      els.sbtChipRankPriceTh.textContent = base + (c === sbtRankSort.col ? (sbtRankSort.dir === 1 ? " ▲" : " ▼") : "");
    }
  }
  if (!els.sbtChipRankBody) return;
  els.sbtChipRankBody.innerHTML = "";
  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const num = (v) => (v == null ? "—" : Number(v).toFixed(2));
  const rng = (lo, hi) => (lo == null || hi == null) ? "—" : `${lo} ~ ${hi}`;
  const yn = (v) => v ? "✔" : "✘";
  for (const r of list) {
    const code = r.stock_cn || "";
    const nm = r.stock_name || sbtNameFor(code) || "";
    const tr = document.createElement("tr");
    tr.className = "sbt-rank-row" + (code === sbtChipExpandCode ? " sbt-rank-active" : "");
    tr.dataset.stockCode = code;
    tr.innerHTML =
      `<td>${escapeHtml(nm ? `${code} ${nm}` : code)}</td>` +
      `<td class="num strong">${pct(r.profit_ratio)}</td>` +
      `<td class="num">${escapeHtml(String(num(r.latest_close)))}</td>` +
      `<td class="num">${escapeHtml(String(num(r.avg_cost)))}</td>` +
      `<td class="num">${escapeHtml(rng(r.cost_90_low, r.cost_90_high))}</td>` +
      `<td class="num">${escapeHtml(rng(r.cost_70_low, r.cost_70_high))}</td>` +
      `<td class="sbt-c">${yn(r.b_profit)}</td>` +
      `<td class="sbt-c">${yn(r.b_liab)}</td>` +
      `<td class="sbt-c">${yn(r.b_div)}</td>` +
      `<td class="num">${escapeHtml(String(num(r.asset_value_per_share)))}</td>` +
      `<td class="num">${escapeHtml(String(num(r.epv_per_share)))}</td>` +
      `<td class="num">${escapeHtml(String(num(r.epv_minus_asset_value)))}</td>` +
      `<td class="num">${escapeHtml(String(num(r.latest_close)))}</td>` +
      `<td class="num strong">${pct(r.epv_margin_of_safety)}</td>`;
    tr.onclick = () => sbtChipExpandRow(tr, code);
    els.sbtChipRankBody.appendChild(tr);
  }
}

// Render the 筹码分布 (chip distribution) tab: a horizontal histogram of chip
// weight by price level, plus summary metrics (获利比例 / 平均成本 / 90-70 成本区间
// / 集中度). Data comes from d.chip_distribution written by the batch.
async function sbtRenderChip(code) {
  if (!els.sbtChipCard) return;
  if (!code) { els.sbtChipCard.classList.add("hidden"); return; }
  const d = await sbtLoadStock(code);
  if (!d) { els.sbtChipCard.classList.add("hidden"); return; }
  els.sbtChipCard.classList.remove("hidden");
  els.sbtChipTitle.innerHTML = "";
  const stockLink = document.createElement("button");
  stockLink.type = "button";
  stockLink.className = "sbt-chip-title-link";
  stockLink.textContent = d.stock_cn || code;
  stockLink.title = "查看该股票详情";
  stockLink.onclick = async (e) => {
    e.stopPropagation();
    if (els.sbtSelect && Array.from(els.sbtSelect.options).some((o) => o.value === code)) {
      els.sbtSelect.value = code;
    }
    sbtSwitchTab("detail");
    try {
      await sbtRenderDetail(code);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setStatus("载入详情失败：" + (err.message || err), "error");
    }
  };
  els.sbtChipTitle.appendChild(stockLink);
  if (els.sbtChipActions) {
    els.sbtChipActions.dataset.stockCode = code;
    els.sbtChipActions.classList.toggle("hidden", !sbtCanEdit());
  }

  const cyq = d.chip_distribution;
  const hasData = cyq && Array.isArray(cyq.prices) && Array.isArray(cyq.weights)
    && cyq.prices.length === cyq.weights.length && cyq.prices.length > 1;
  els.sbtChipEmpty.classList.toggle("hidden", !!hasData);
  if (!hasData) {
    els.sbtChipSvg.innerHTML = "";
    els.sbtChipMeta.textContent = "";
    els.sbtChipMetrics.innerHTML = "";
    return;
  }

  els.sbtChipMeta.textContent = (cyq.as_of ? "数据日期: " + cyq.as_of : "")
    + (cyq.latest_close != null ? "　收盘价: " + cyq.latest_close : "");

  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const num = (v) => (v == null ? "—" : v);
  const metric = (label, val) =>
    `<div class="sbt-chip-metric"><span class="sbt-chip-mlabel">${label}</span>` +
    `<span class="sbt-chip-mval">${val}</span></div>`;
  els.sbtChipMetrics.innerHTML =
    metric("获利比例", pct(cyq.profit_ratio)) +
    metric("平均成本", num(cyq.avg_cost)) +
    metric("90%成本区间", `${num(cyq.cost_90_low)} ~ ${num(cyq.cost_90_high)}`) +
    '<div class="sbt-chip-break"></div>' +
    metric("90%集中度", pct(cyq.concentration_90)) +
    metric("70%成本区间", `${num(cyq.cost_70_low)} ~ ${num(cyq.cost_70_high)}`) +
    metric("70%集中度", pct(cyq.concentration_70));

  // --- horizontal histogram SVG (Y = price high->low, X = chip weight) ---
  const prices = cyq.prices, weights = cyq.weights;
  const W = 460, H = 360, padL = 46, padR = 14, padT = 10, padB = 22;
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const wMax = Math.max(...weights, 1e-9);
  const plotH = H - padT - padB, plotW = W - padL - padR;
  const yOf = (p) => padT + (pMax - p) / (pMax - pMin || 1) * plotH; // high at top
  const xOf = (w) => padL + (w / wMax) * plotW;
  const band = plotH / prices.length;
  const barH = Math.max(1, band * 0.9);

  els.sbtChipSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let svg = "";
  // bars
  for (let i = 0; i < prices.length; i++) {
    if (weights[i] <= 0) continue;
    const y = yOf(prices[i]) - barH / 2;
    const w = xOf(weights[i]) - padL;
    const profit = cyq.latest_close != null && prices[i] <= cyq.latest_close;
    svg += `<rect class="sbt-chip-bar ${profit ? "sbt-chip-profit" : "sbt-chip-loss"}" ` +
      `x="${padL}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${barH.toFixed(1)}"></rect>`;
  }
  // Y axis price labels (~6 ticks)
  const ticks = 6;
  for (let t = 0; t <= ticks; t++) {
    const p = pMin + (pMax - pMin) * t / ticks;
    const y = yOf(p);
    svg += `<text class="lc-ylabel" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${p.toFixed(2)}</text>`;
    svg += `<line class="lc-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>`;
  }
  // current price line
  if (cyq.latest_close != null && cyq.latest_close >= pMin && cyq.latest_close <= pMax) {
    const y = yOf(cyq.latest_close);
    svg += `<line class="sbt-chip-cur" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>`;
    svg += `<text class="sbt-chip-curlbl" x="${W - padR}" y="${(y - 3).toFixed(1)}" text-anchor="end">现价 ${cyq.latest_close}</text>`;
  }
  // avg cost line
  if (cyq.avg_cost != null && cyq.avg_cost >= pMin && cyq.avg_cost <= pMax) {
    const y = yOf(cyq.avg_cost);
    svg += `<line class="sbt-chip-avg" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>`;
    svg += `<text class="sbt-chip-avglbl" x="${W - padR}" y="${(y + 12).toFixed(1)}" text-anchor="end">均价 ${cyq.avg_cost}</text>`;
  }
  els.sbtChipSvg.innerHTML = svg;
}


 // Strip the tax parenthetical from a dividend-plan string, e.g.
 // "10派3.00元(含税,扣税后2.70元)" -> "10派3.00元". Handles full/half-width
 // parens and multiple occurrences.
 function sbtStripTax(s) {
   return String(s).replace(/[（(]\s*含税[^）)]*[）)]/g, "").replace(/元/g, "").trim();
 }

 // Show only the date part (YYYY-MM-DD) of a dividend date value. Handles
 // "2024-03-15 00:00:00" strings and epoch-millisecond timestamps.
 function sbtDateOnly(v) {
   if (v === null || v === undefined || v === "") return "";
   const s = String(v).trim();
   const m = s.match(/^\d{4}-\d{2}-\d{2}/);
   if (m) return m[0];
   if (/^\d+$/.test(s)) {
     const d = new Date(Number(s));
     if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
   }
   return s.slice(0, 10);
 }

 function sbtValuationAssumptions(code) {
   return Object.assign({}, ValueInvesting.defaults,
     sbtValuationSettings.defaults || {},
     (sbtValuationSettings.stocks || {})[code] || {});
 }

 function sbtValuationInputAssumptions() {
   const pct = (element, min, max) => {
     const value = Number(element.value);
     if (element.value.trim() === "" || !isFinite(value) || value < min || value > max) {
       throw new Error(`估值参数必须在 ${min}% 到 ${max}% 之间。`);
     }
     return value / 100;
   };
   return {
     receivables: pct(els.sbtValReceivables, 0, 150), inventory: pct(els.sbtValInventory, 0, 150),
     fixed_assets: pct(els.sbtValFixed, 0, 150), other_assets: pct(els.sbtValOther, 0, 150),
     capitalization_rate: pct(els.sbtValCapRate, 1, 50), fallback_tax_rate: pct(els.sbtValTax, 0, 60),
   };
 }

 function sbtSetValuationInputs(settings) {
   els.sbtValReceivables.value = (settings.receivables * 100).toFixed(0);
   els.sbtValInventory.value = (settings.inventory * 100).toFixed(0);
   els.sbtValFixed.value = (settings.fixed_assets * 100).toFixed(0);
   els.sbtValOther.value = (settings.other_assets * 100).toFixed(0);
   els.sbtValCapRate.value = (settings.capitalization_rate * 100).toFixed(1);
   els.sbtValTax.value = (settings.fallback_tax_rate * 100).toFixed(0);
 }

 function sbtValMoney(value, currency) {
   if (value == null || !isFinite(value)) return "—";
   return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "CNY",
     minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
 }

 function sbtRenderValuationCalculation(code, valuation, assumptions) {
   const result = ValueInvesting.calculate(valuation.raw_periods, assumptions, valuation.snapshot);
   const effectiveSnapshot = valuation.snapshot || (valuation.raw_periods && valuation.raw_periods[0]) || {};
   const currency = valuation.currency || (valuation.quote && valuation.quote.currency) || "CNY";
   const rawPrice = valuation.quote && valuation.quote.current_price;
   const price = rawPrice === null || rawPrice === undefined || rawPrice === "" ? null : Number(rawPrice);
   const av = result.asset_value && result.asset_value.per_share;
   const epv = result.epv && result.epv.per_share;
   const metric = (label, value, detail) => `<div class="sbt-val-metric"><span>${label}</span>` +
     `<strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`;
   const margin = (value) => price > 0 && value > 0 ? ((1 - price / value) * 100).toFixed(1) + "%" : "—";
   els.sbtValuationSummary.innerHTML =
     metric("每股资产价值 AV", sbtValMoney(av, currency), "安全边际 " + margin(av)) +
     metric("每股盈利能力价值 EPV", sbtValMoney(epv, currency), "安全边际 " + margin(epv)) +
     metric("当前股价", sbtValMoney(price, currency), valuation.quote && valuation.quote.as_of ? sbtDateOnly(valuation.quote.as_of) : "") +
     metric("EPV - AV", sbtValMoney(epv != null && av != null ? epv - av : null, currency),
       epv != null && av != null ? (epv > av ? "可能存在竞争优势" : "资产盈利能力偏弱") : "");
   const missing = result.missing || [];
   const negativeAv = av != null && av < 0
     ? "当前 AV 为负：调整后资产小于总负债与少数股东权益之和；可在明细中核对资产系数。" : "";
   const warning = sbtValuationSettingsError ? "共享参数读取失败，当前显示默认值且禁止保存：" + sbtValuationSettingsError
     : (missing.length ? "数据不完整，暂不能计算全部估值：" + missing.join("、") : negativeAv);
   els.sbtValuationMessage.classList.toggle("hidden", !warning);
   els.sbtValuationMessage.textContent = warning;
   const epvRow = result.epv || {};
   const avRow = result.asset_value || {};
   els.sbtValuationAudit.innerHTML = `<dl>` +
     `<dt>资产快照</dt><dd>${escapeHtml(String(effectiveSnapshot.date || valuation.as_of || "—"))}（${valuation.snapshot_type === "interim" ? "半年报" : "年报"}）</dd>` +
     `<dt>盈利基准年报</dt><dd>${escapeHtml(String(valuation.as_of || "—"))}</dd>` +
     `<dt>正常化 EBIT 率</dt><dd>${epvRow.normalized_ebit_margin == null ? "—" : (epvRow.normalized_ebit_margin * 100).toFixed(2) + "%"}</dd>` +
     `<dt>有效税率</dt><dd>${epvRow.effective_tax_rate == null ? "—" : (epvRow.effective_tax_rate * 100).toFixed(2) + "%"}</dd>` +
     `<dt>正常化经营收益</dt><dd>${sbtValMoney(epvRow.normalized_operating_earnings, currency)}</dd>` +
     `<dt>维持性资本开支</dt><dd>${sbtValMoney(epvRow.maintenance_capex, currency)}（等于正常化折旧摊销）</dd>` +
     `<dt>账面总资产</dt><dd>${sbtValMoney(effectiveSnapshot.total_assets, currency)}</dd>` +
     `<dt>调整后资产</dt><dd>${sbtValMoney(avRow.adjusted_assets, currency)}</dd>` +
     `<dt>总负债</dt><dd>${sbtValMoney(effectiveSnapshot.total_liabilities, currency)}</dd>` +
     `<dt>少数股东权益</dt><dd>${sbtValMoney(effectiveSnapshot.minority_interest, currency)}</dd>` +
     `<dt>股东资产价值 AV</dt><dd>${sbtValMoney(avRow.equity_value, currency)}</dd>` +
     `<dt>资本成本</dt><dd>${(assumptions.capitalization_rate * 100).toFixed(1)}%</dd></dl>`;
   const assetScenarios = [
     ["清算情景", { receivables: .75, inventory: .50, fixed_assets: .35, other_assets: .25 }],
     ["当前 AV 参数", assumptions],
     ["调整净资产情景", { receivables: 1, inventory: 1, fixed_assets: 1, other_assets: 1 }],
   ];
   const rates = [...new Set([.08, assumptions.capitalization_rate, .10, .12])].sort((a, b) => a - b);
   els.sbtValSensitivity.innerHTML = `<thead><tr><th>情景</th><th>每股价值</th><th>安全边际</th></tr></thead><tbody>` +
     assetScenarios.map(([label, scenario]) => {
       const row = ValueInvesting.calculate(valuation.raw_periods, Object.assign({}, assumptions, scenario), valuation.snapshot);
       const value = row.asset_value && row.asset_value.per_share;
       return `<tr class="${label === "当前 AV 参数" ? "sbt-val-base" : ""}"><td>${label}</td><td>${sbtValMoney(value, currency)}</td><td>${margin(value)}</td></tr>`;
     }).join("") + rates.map((rate) => {
       const row = ValueInvesting.calculate(valuation.raw_periods, Object.assign({}, assumptions, { capitalization_rate: rate }), valuation.snapshot);
       const value = row.epv && row.epv.per_share;
       return `<tr class="${Math.abs(rate - assumptions.capitalization_rate) < .0001 ? "sbt-val-base" : ""}"><td>EPV ${(rate * 100).toFixed(1)}%</td><td>${sbtValMoney(value, currency)}</td><td>${margin(value)}</td></tr>`;
     }).join("") + `</tbody>`;
   const quoteDate = valuation.quote && valuation.quote.as_of ? sbtDateOnly(valuation.quote.as_of) : "—";
   const snapshotDate = (valuation.snapshot && valuation.snapshot.date) || valuation.as_of || "—";
   els.sbtValuationMeta.textContent = `资产截至 ${snapshotDate}（${valuation.snapshot_type === "interim" ? "半年报" : "年报"}） · 股价截至 ${quoteDate} · 盈利使用 ${valuation.periods_used || 0} 年年报`;
 }

 function sbtRenderValuation(code, data) {
   const valuation = data && data.valuation;
   els.sbtValuationCard.classList.toggle("hidden", !valuation);
   if (!valuation) return;
   if (valuation.applicable === false) {
     els.sbtValuationSummary.innerHTML = ""; els.sbtValSensitivity.innerHTML = "";
     els.sbtValuationMessage.classList.remove("hidden");
     els.sbtValuationMessage.textContent = valuation.reason || "当前模型不适用于该公司。";
     els.sbtValuationDetails.classList.add("hidden"); return;
   }
   els.sbtValuationDetails.classList.remove("hidden");
   const assumptions = sbtValuationAssumptions(code);
   sbtSetValuationInputs(assumptions);
   [els.sbtValReceivables, els.sbtValInventory, els.sbtValFixed, els.sbtValOther,
     els.sbtValCapRate, els.sbtValTax].forEach((input) => { input.disabled = !sbtCanEdit(); });
   els.sbtValSaveBtn.disabled = !sbtCanEdit() || !!sbtValuationSettingsError;
   els.sbtValResetBtn.disabled = !sbtCanEdit() || !!sbtValuationSettingsError;
   sbtRenderValuationCalculation(code, valuation, assumptions);
 }

 async function sbtSaveValuationAssumptions(reset) {
   const code = els.sbtSelect.value, data = sbtStocks[code];
   if (!code || !data || !data.valuation || !sbtCanEdit()) return;
   const value = reset ? null : Object.assign(sbtValuationInputAssumptions(), {
     updated_at: new Date().toISOString(), updated_by: userEmail(),
   });
   await sbtWriteValuationPatch(code, value);
   if (els.sbtSelect.value === code) sbtRenderValuation(code, data);
   setStatus(reset ? "已恢复默认估值参数。" : "估值参数已保存。", "success", 2500);
 }

 async function sbtRenderDetail(code) {
   if (!code) { els.sbtDetailCard.classList.add("hidden"); return; }
   const d = await sbtLoadStock(code);
   if (els.sbtSelect.value !== code) return;
  if (!d) { els.sbtDetailCard.classList.add("hidden"); return; }
  els.sbtDetailCard.classList.remove("hidden");
  els.sbtDetailTitle.textContent = `${d.stock_cn || code} ${d.stock_name || ""}`;
  els.sbtGenerated.textContent = d.generated ? "生成时间: " + d.generated : "";
  sbtRenderValuation(code, d);

  // Now that the name is known, enrich the dropdown option label.
  if (d.stock_name) {
    const opt = Array.from(els.sbtSelect.options).find((o) => o.value === code);
    if (opt && !/\s/.test(opt.textContent.trim())) opt.textContent = `${code} ${d.stock_name}`;
  }

  // Price source error: Tencent quote fetch failed on the last run, so
  // price-related metrics were NOT refreshed (they show the previous values).
  const priceErrBanner = d.price_source_error
    ? `<div class="sbt-gap-banner">⚠️ 股价数据获取失败（腾讯行情源暂时不可用），本次未更新股价相关指标，显示为上次数据。</div>`
    : "";

  // Price-range data gaps: years whose 后一年股价范围 is genuinely missing
  // because the auto-fetched daily history doesn't cover that window.
  const gaps = Array.isArray(d.price_range_gaps) ? d.price_range_gaps : [];
  const gapBanner = gaps.length
    ? `<div class="sbt-gap-banner">⚠️ 以下年份的「后一年股价范围」缺失（行情源未覆盖该时段）：` +
      `${gaps.map((g) => escapeHtml(String(g))).join("、")}。</div>`
    : "";

  // Checks.
  const checks = d.checks || {};
  const order = ["profit", "liabilities", "dividends"];
  els.sbtChecks.innerHTML = priceErrBanner + gapBanner + order.filter((k) => checks[k]).map((k) => {
    const c = checks[k];
    const cls = c.pass ? "sbt-pass" : "sbt-fail";
    return `<div class="sbt-check ${cls}">${escapeHtml(c.text || "")}</div>`;
  }).join("");

  // Last N days high/low.
  const l7 = d.last_7_days_high_low;
  els.sbtLast7.textContent = (l7 !== null && l7 !== undefined && l7 !== "")
    ? "近期高/低: " + (typeof l7 === "object" ? JSON.stringify(l7) : l7) : "";

  // Combined fundamentals table (pandas orient='split': columns/index/data).
  const cb = d.combined;
  const cbHead = els.sbtCombinedTable.querySelector("thead");
  const cbBody = els.sbtCombinedTable.querySelector("tbody");
   if (cb && cb.columns && cb.index && cb.data) {
     // Hide fully-empty columns: a report-period column with no value in ANY
     // row (e.g. an HK quarter the issuer never disclosed) is dropped entirely.
     const isEmptyCell = (v) =>
       v === null || v === undefined || String(v).trim() === "";
      const visibleCols = cb.columns
        .map((_, j) => j)
        .filter((j) => cb.index.some((_, i) =>
          !isEmptyCell((cb.data[i] || [])[j])));
      // Quarterly/interim report columns (Q1/H1/Q3) get a distinct background;
      // annual 12-31 columns retain the normal table background.
      const isQuarterCol = (j) => /-(03-31|06-30|09-30)$/.test(String(cb.columns[j]));
      cbHead.innerHTML = "<tr><th>指标</th>" +
        visibleCols.map((j) => `<th class="${isQuarterCol(j) ? "sbt-quarter-col" : ""}">${escapeHtml(String(cb.columns[j]))}</th>`).join("") + "</tr>";
     cbBody.innerHTML = cb.index.map((label, i) => {
       // 每股派发股息 carries long plan text like "10派3.00元(含税,扣税后2.70元)";
       // drop the tax parenthetical for display and let the cell wrap (.sbt-plan)
       // so it doesn't force the whole column wide.
       const isPlan = String(label) === "每股派发股息";
       const cls = isPlan ? "sbt-c sbt-plan" : "sbt-c";
       // Emphasise the two decision rows (EPS and the 15x-PE fair price).
       const hl = label === "稀释后 每年/季度每股收益 元"
         || label === "市盈率15对应股价 元";
       return `<tr class="${hl ? "sbt-hl" : ""}"><td class="sbt-rowlabel">${escapeHtml(String(label))}</td>` +
         visibleCols.map((j) => {
           let s = isEmptyCell((cb.data[i] || [])[j]) ? "" : String((cb.data[i] || [])[j]);
           if (isPlan) s = sbtStripTax(s);
            const colCls = isQuarterCol(j) ? " sbt-quarter-col" : "";
            return `<td class="${cls}${colCls}">${escapeHtml(s)}</td>`;
         }).join("") + "</tr>";
     }).join("");
   } else {
    cbHead.innerHTML = "";
    cbBody.innerHTML = "<tr><td class='muted'>无财务指标数据</td></tr>";
  }

  // Dividends.
  const divs = Array.isArray(d.dividends) ? d.dividends : [];
  const dHead = els.sbtDividendTable.querySelector("thead");
  const dBody = els.sbtDividendTable.querySelector("tbody");
  if (divs.length) {
     dHead.innerHTML = "<tr><th>公告日期</th><th>股权登记日</th><th>分红方案</th></tr>";
     dBody.innerHTML = divs.map((r) =>
       `<tr><td>${escapeHtml(sbtDateOnly(r.REPORT_DATE))}</td>` +
       `<td>${escapeHtml(sbtDateOnly(r.EQUITY_RECORD_DATE))}</td>` +
       `<td>${escapeHtml(r.IMPL_PLAN_PROFILE || "")}</td></tr>`
     ).join("");
  } else {
    dHead.innerHTML = "";
    dBody.innerHTML = "<tr><td class='muted'>无分红记录</td></tr>";
  }
}

 function sbtSwitchTab(name) {
   if (name === "settings" && !sbtCanEdit()) name = "detail";
   const tabs = {
    detail: { panel: els.sbtTabDetail, btn: els.sbtTabDetailBtn },
    chip: { panel: els.sbtTabChip, btn: els.sbtTabChipBtn },
    settings: { panel: els.sbtTabSettings, btn: els.sbtTabSettingsBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chip") {
    const activeRow = els.sbtChipRankBody && sbtChipExpandCode
      ? Array.from(els.sbtChipRankBody.querySelectorAll("tr.sbt-rank-row"))
        .find((tr) => tr.dataset.stockCode === sbtChipExpandCode)
      : null;
    if (activeRow) {
      requestAnimationFrame(() => activeRow.scrollIntoView({
        behavior: "smooth", block: "center", inline: "nearest",
      }));
    } else {
      sbtRenderChipRank().catch((e) =>
        setStatus("载入筹码排行失败：" + (e.message || e), "error"));
    }
  }
  if (name === "settings") {
    sbtLoadStockList().catch((e) =>
      setStatus("载入股票清单失败：" + (e.message || e), "error"));
  }
}

function sbtWireEvents() {
  els.sbtSelect.onchange = () => sbtRenderDetail(els.sbtSelect.value).catch((e) =>
    setStatus("载入明细失败：" + (e.message || e), "error"));
  els.sbtReloadBtn.onclick = async () => {
    try { await sbtLoad(true); }
    catch (e) { setStatus("刷新失败：" + (e.message || e), "error"); }
  };
   els.sbtTabDetailBtn.onclick = () => sbtSwitchTab("detail");
   els.sbtTabSettingsBtn.onclick = () => sbtSwitchTab("settings");
   if (els.sbtTabChipBtn) els.sbtTabChipBtn.onclick = () => sbtSwitchTab("chip");
   // Sortable headers on the ranking table.
   if (els.sbtChipRankTable) {
     els.sbtChipRankTable.querySelectorAll("th.sbt-sortable").forEach((th) => {
       th.onclick = () => {
         const col = th.getAttribute("data-sort");
         if (!col) return;
         if (sbtRankSort.col === col) sbtRankSort.dir *= -1;
         else sbtRankSort = { col, dir: 1 };
         sbtRenderChipRank().catch((e) =>
           setStatus("排序失败：" + (e.message || e), "error"));
       };
     });
   }
   // Click on blank area (outside a ranking row / the expanded chart) collapses
   // the chart but keeps the row highlight.
   document.addEventListener("click", (e) => {
     if (!sbtChipExpandCode) return;
     if (els.sbtTabChip && els.sbtTabChip.classList.contains("hidden")) return;
     // Returning via the 筹码排行 tab must preserve the existing expanded row.
     if (els.sbtTabChipBtn &&
         (e.target === els.sbtTabChipBtn || els.sbtTabChipBtn.contains(e.target))) return;
     if (e.target.closest && e.target.closest(".sbt-rank-row, .sbt-chip-expand")) return;
     sbtChipCollapse(true);   // keep highlight
   });
   els.sbtAddBtn.onclick = sbtAddStock;
   els.sbtChipUpdateBtn.onclick = (e) => { e.stopPropagation(); sbtRunChipAction("update").catch((err) => setStatus(err.message || String(err), "error")); };
   els.sbtChipForceBtn.onclick = (e) => { e.stopPropagation(); sbtRunChipAction("force").catch((err) => setStatus(err.message || String(err), "error")); };
   els.sbtChipDeleteBtn.onclick = (e) => { e.stopPropagation(); sbtRunChipAction("delete").catch((err) => setStatus(err.message || String(err), "error")); };
   [els.sbtValReceivables, els.sbtValInventory, els.sbtValFixed, els.sbtValOther,
     els.sbtValCapRate, els.sbtValTax].forEach((input) => input.addEventListener("input", () => {
       const code = els.sbtSelect.value, data = sbtStocks[code];
     if (data && data.valuation) {
       try { sbtRenderValuationCalculation(code, data.valuation, sbtValuationInputAssumptions()); }
       catch (e) { els.sbtValuationMessage.classList.remove("hidden"); els.sbtValuationMessage.textContent = e.message || String(e); }
     }
     }));
   els.sbtValSaveBtn.onclick = () => sbtSaveValuationAssumptions(false).catch((e) => setStatus(e.message || String(e), "error"));
   els.sbtValResetBtn.onclick = () => sbtSaveValuationAssumptions(true).catch((e) => setStatus(e.message || String(e), "error"));
 }
 
 // Read-only vs. owner: hide the write-oriented 设置 tab for non-owners (add /
 // update-trigger / delete all live there; their /me/drive has no folder anyway).
 // Called from sbtLoad(), i.e. AFTER sign-in — at boot `account` is still null.
 function sbtApplyPerms() {
   if (!els.sbtTabSettingsBtn) return;
   els.sbtTabSettingsBtn.classList.toggle("hidden", !sbtCanEdit());
 }

/* ---- settings: read/write stock_list.csv + trigger single-stock action --- */

// Normalize a raw 6-digit code to the {code}.SH/.SZ form used for files.
function sbtCodeToCn(raw) {
  const s = String(raw).trim();
  // Hong Kong: 'H01548' -> '01548.HK' (mirrors normalize_stock in Python).
  if (/^[Hh]\d+$/.test(s)) return s.slice(1).padStart(5, "0") + ".HK";
  const code = s.replace(/\D/g, "").padStart(6, "0");
  if (code.length !== 6) return null;
  return code[0] === "6" ? code + ".SH" : code + ".SZ";
}

// Build the EastMoney kline download URL for a 6-digit code (mirrors
// kline_manifest.build_kline_url). Open in a browser, then Save Page As
// {code}.SH/.SZ.txt into the kline/ folder. push2his is unreachable from the
// cloud, so this download stays manual — but the link needs no Python now.
function sbtKlineUrl(raw) {
  const s = String(raw).trim();
  let mkt, code;
  if (/^[Hh]\d+$/.test(s)) {
    // Hong Kong: 'H01548' -> secid 116.01548 (mirrors get_stock_price_..._HK).
    code = s.slice(1).padStart(5, "0");
    mkt = 116;
  } else {
    code = s.replace(/\D/g, "").padStart(6, "0");
    if (code.length !== 6) return null;
    mkt = code[0] === "6" ? 1 : 0;
  }
  const d = new Date();
  const end = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
    `?secid=${mkt}.${code}` +
    "&fields1=f1,f2,f3,f4,f5,f6" +
    "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" +
    `&klt=101&fqt=1&end=${end}&lmt=1800&cb=quote_jp4`;
}

// Read stock_list.csv -> array of raw code strings (BOM/header tolerant).
async function sbtReadStockList(token) {
   await sbtResolveFolder(token);
   const url = sbtChildUrl("stock_list.csv", ":/content");
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("读取 stock_list.csv 失败：" + res.status);
  let text = await res.text();
  text = text.replace(/^\ufeff/, "");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const codes = [];
  for (const line of lines) {
    // first CSV column, strip quotes/spaces
    let first = line.split(",")[0].replace(/^"|"$/g, "").trim();
    if (!first) continue;
    if (/^title$/i.test(first)) continue;          // header row
    codes.push(first.replace(/\s/g, ""));
  }
  return codes;
}

async function sbtReadStockListState(token) {
  await sbtResolveFolder(token);
  const url = sbtChildUrl("stock_list.csv", ":/content");
  const res = await fetch(url, { cache: "no-store", headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { codes: [], etag: null };
  if (!res.ok) throw new Error("读取 stock_list.csv 失败：" + res.status);
  let text = (await res.text()).replace(/^\ufeff/, "");
  const codes = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split(",")[0].replace(/^"|"$/g, "").trim())
    .filter((value) => value && !/^title$/i.test(value))
    .map((value) => value.replace(/\s/g, ""));
  let etag = res.headers.get("ETag");
  if (!etag) {
    const meta = await fetch(sbtChildUrl("stock_list.csv", "?$select=eTag"), {
      cache: "no-store", headers: { Authorization: "Bearer " + token },
    });
    if (meta.ok) { const item = await meta.json(); etag = item.eTag || null; }
  }
  if (!etag) throw new Error("无法读取股票清单版本，请稍后重试。");
  return { codes, etag };
}

// Write the code array back as CSV (header + one code per line).
async function sbtWriteStockList(token, codes) {
   await sbtResolveFolder(token);
   const url = sbtChildUrl("stock_list.csv", ":/content");
  const body = '"Title","Modified"\n' + codes.map((c) => `${c},`).join("\n") + "\n";
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body,
  });
  if (!res.ok) throw new Error("写入 stock_list.csv 失败：" + res.status + " " + (await res.text()));
}

async function sbtMutateStockList(token, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await sbtReadStockListState(token);
    const next = mutate(state.codes.slice());
    const body = '"Title","Modified"\n' + next.map((code) => `${code},`).join("\n") + "\n";
    const res = await fetch(sbtChildUrl("stock_list.csv", ":/content"), {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv", "If-Match": state.etag },
      body,
    });
    if (res.ok) return next;
    if (res.status === 409 || res.status === 412) continue;
    throw new Error("写入 stock_list.csv 失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("股票清单发生并发冲突，请重试。");
}

// Delete a file under the StockBatchTracker folder (ignore 404).
 async function sbtDeleteFile(token, relPath) {
   await sbtResolveFolder(token);
   const url = sbtChildUrl(relPath, "");
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error("删除 " + relPath + " 失败：" + res.status);
  }
}

async function sbtLoadStockList() {
  const token = await getToken();
  sbtCodes = await sbtReadStockList(token);
  sbtRenderSettings();
}

function sbtRenderSettings() {
  const c = els.sbtCodeList;
  c.innerHTML = "";
  if (!sbtCodes.length) {
    c.innerHTML = '<p class="muted">清单为空。</p>';
    return;
  }
  for (const code of sbtCodes) {
     const cn = sbtCodeToCn(code) || code;
     const nm = sbtNames[String(code).replace(/\D/g, "")]
       || (sbtStocks[cn] && sbtStocks[cn].stock_name) || "";
    const row = document.createElement("div");
    row.className = "sbt-code-row";
    const span = document.createElement("span");
    span.className = "sbt-code-label";
    span.textContent = nm ? `${code}  ${nm}` : code;
    row.appendChild(span);
    if (!Object.prototype.hasOwnProperty.call(sbtFiles, cn)) {
      const firstUpdate = document.createElement("button");
      firstUpdate.type = "button"; firstUpdate.className = "btn btn-mini";
      firstUpdate.textContent = "首次更新";
      firstUpdate.title = "生成该股票的首份详情与筹码数据";
      firstUpdate.onclick = () => sbtUpdateStock(code, false);
      row.appendChild(firstUpdate);
    }
    c.appendChild(row);
  }
}

async function sbtRawCodeFor(canonicalCode) {
  if (!sbtCodes.length) {
    const token = await getToken();
    sbtCodes = await sbtReadStockList(token);
  }
  return sbtCodes.find((code) => sbtCodeToCn(code) === canonicalCode) || canonicalCode;
}

async function sbtRunChipAction(action) {
  const canonicalCode = els.sbtChipActions && els.sbtChipActions.dataset.stockCode;
  if (!canonicalCode || !sbtCanEdit()) return;
  const code = await sbtRawCodeFor(canonicalCode);
  if (action === "delete") await sbtRemoveStock(code);
  else await sbtUpdateStock(code, action === "force");
}

// Copy a target kline filename to the clipboard (mobile-friendly).
async function sbtCopyFilename(name) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(name);
    } else {
      const ta = document.createElement("textarea");
      ta.value = name;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setStatus(`已复制文件名：${name}`, "success", 2000);
  } catch (e) {
    setStatus("复制失败，请长按选择：" + name, "error", 4000);
  }
}

async function sbtAddStock() {
  const raw = (prompt("输入股票代码（A股6位如 600519；港股加 H 前缀如 H02018）：") || "").trim();
  if (!raw) return;
  let code;
  if (/^[Hh]\d+$/.test(raw)) {
    code = "H" + raw.slice(1).padStart(5, "0");         // 港股：H02018
  } else if (/\.HK$/i.test(raw)) {
    code = "H" + raw.replace(/\D/g, "").padStart(5, "0");
  } else {
    code = raw.replace(/\D/g, "").padStart(6, "0");
    if (code.length !== 6) { setStatus("代码格式不对，应为 6 位数字或 H+港股代码。", "error"); return; }
  }
  if (sbtCodes.includes(code)) { setStatus("该股票已在清单中。", "warn"); return; }
  try {
    const token = await getToken();
    const next = await sbtMutateStockList(token, (remote) =>
      remote.some((item) => sbtCodeToCn(item) === sbtCodeToCn(code))
        ? remote : remote.concat([code]));
    sbtCodes = next;
    sbtRenderSettings();
    setStatus(`已加入清单：${code}。点该行「更新」即可触发个股批处理（股价自动获取）。`, "success", 8000);
  } catch (e) {
    setStatus("添加失败：" + (e.message || e), "error");
  }
}

async function sbtUpdateStock(code, force) {
  const name = sbtNameFor(sbtCodeToCn(code) || code);
  const label = name ? `${code} ${name}` : code;
  const detail = force
    ? "将绕过财报与分红缓存，完整重新抓取财报、分红、股价与筹码；耗时较长。"
    : "将更新股价与筹码；财报按 14/28 天探测规则、分红按 21 天缓存规则检查。";
  if (!confirm(`触发${force ? "强制" : "普通"}更新 ${label}？\n\n${detail}`)) return;
  try {
    const token = await getToken();
    const res = await fetch(SBT_TRIGGER_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        stock: code,
        force_reports: !!force,
        force_dividends: !!force,
      }),
    });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).error || ""; } catch {}
      throw new Error(res.status + (d ? "：" + d : ""));
    }
    setStatus(`已提交 ${code} 的${force ? "强制" : "普通"}更新任务，几分钟后点「刷新」查看。`, "success", 8000);
  } catch (e) {
    setStatus("触发更新失败：" + (e.message || e), "error");
  }
}

async function sbtRemoveStock(code) {
  if (!confirm(`确定删除 ${code}？将从清单移除，并删除其展示数据。`)) return;
  try {
    const token = await getToken();
    const canonical = sbtCodeToCn(code);
    const next = await sbtMutateStockList(token, (remote) =>
      remote.filter((item) => sbtCodeToCn(item) !== canonical));
    sbtCodes = next;
    const cn = sbtCodeToCn(code);
    if (cn) {
      await sbtDeleteFile(token, "output/" + cn + ".json");
      delete sbtStocks[cn];
      delete sbtFiles[cn];
      try { localStorage.removeItem("sbt:" + cn + ".json"); } catch { /* ignore */ }
      // Drop it from the in-memory 筹码排行 too so it disappears immediately.
      if (Array.isArray(sbtChipRanking)) {
        sbtChipRanking = sbtChipRanking.filter((r) => r && r.stock_cn !== cn);
      }
    }
    sbtRenderSettings();
    sbtPopulateSelect();
    sbtRenderChipRank().catch(() => {});
    setStatus(`已删除 ${code}。`, "success", 5000);
  } catch (e) {
    setStatus("删除失败：" + (e.message || e), "error");
  }
}

/* --------------------------- Mode switch --------------------------------- */
async function setMode(next, options) {
  options = options || {};
  if (!options.preserveDeepLink && next !== "blog") clearDeepLink();
  mode = next;
  const isInc = next === "income";
  const isStk = next === "stock";
  const isMed = next === "medical";
  const isSpend = next === "spending";
  const isCel = next === "celine";
  els.modeSpendingBtn.classList.toggle("active", isSpend);
  els.modeIncomeBtn.classList.toggle("active", isInc);
  els.modeChatBtn.classList.toggle("active", next === "ai");
  els.modeBlogBtn.classList.toggle("active", next === "blog");
  if (els.modeStocksBtn) els.modeStocksBtn.classList.toggle("active", next === "stocks");
els.modeMoreBtn.classList.toggle("active", isCel || next === "borrow" || next === "invest" || next === "cards" || next === "vehicle" || next === "health" || next === "medical" || isStk || next === "travel");
  els.modeMoreMenu.querySelectorAll(".mode-more-item").forEach((it) =>
    it.classList.toggle("active", it.dataset.mode === next));
  els.spendingApp.classList.toggle("hidden", !isSpend);
  els.incomeApp.classList.toggle("hidden", !isInc);
  els.stockApp.classList.toggle("hidden", !isStk);
   els.stocksApp.classList.toggle("hidden", next !== "stocks");
   document.querySelector("main")?.classList.toggle("sbt-wide", next === "stocks");
   els.medicalApp.classList.toggle("hidden", !isMed);
  els.celineApp.classList.toggle("hidden", !isCel);
  els.borrowApp.classList.toggle("hidden", next !== "borrow");
  els.investApp.classList.toggle("hidden", next !== "invest");
  els.cardsApp.classList.toggle("hidden", next !== "cards");
  els.vehicleApp.classList.toggle("hidden", next !== "vehicle");
  els.healthApp.classList.toggle("hidden", next !== "health");
  els.blogApp.classList.toggle("hidden", next !== "blog");
  els.aiApp.classList.toggle("hidden", next !== "ai");
  els.travelApp.classList.toggle("hidden", next !== "travel");
  els.modeMoreMenu.classList.add("hidden");
  requestAnimationFrame(blogUpdateTopButton);
  if (!account) return;
  if (isInc) {
    // Load income once; clicking 收入 never triggers a 支出 (re)load.
    try { await incLoad(); }
    catch (e) { setStatus("收入数据载入失败：" + (e.message || e), "error"); }
  } else if (isStk) {
    try { await stkLoad(); }
    catch (e) { setStatus("股票数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "stocks") {
    try { await sbtLoad(); }
    catch (e) { setStatus("选股数据载入失败：" + (e.message || e), "error"); }
  } else if (isMed) {
    try { await medLoad(); }
    catch (e) { setStatus("看病数据载入失败：" + (e.message || e), "error"); }
  } else if (isCel) {
    try { await celLoad(); }
    catch (e) { setStatus("Celine 存钱罐数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "borrow") {
    try { await brwLoad(); brwSwitchTab("chart"); }
    catch (e) { setStatus("借还款数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "invest") {
    try { await invLoad(); }
    catch (e) { setStatus("理财数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "cards") {
    try { await svcLoad(); }
    catch (e) { setStatus("储值卡数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "vehicle") {
    try { await vehLoad(); }
    catch (e) { setStatus("车辆保养数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "health") {
    try { await heaLoad(); }
    catch (e) { setStatus("健康数据载入失败：" + (e.message || e), "error"); }
  } else if (next === "blog" && !options.skipLoad) {
    try { await blogLoad(); }
    catch (e) { setStatus("博客数据载入失败：" + (e.message || e), "error"); }
} else if (next === "ai") {
    try { await chatLoad(); }
    catch (e) { setStatus("聊天载入失败：" + (e.message || e), "error"); }
  } else if (next === "travel") {
    try { await travelLoad(); travelSwitchTab("map"); }
    catch (e) { setStatus("旅行数据载入失败：" + (e.message || e), "error"); }
  } else if (!spendingLoaded) {
    // Load spending only if it hasn't been fetched yet this session.
    try { await loadRecords(); }
    catch (e) { setStatus("支出数据载入失败：" + (e.message || e), "error"); }
  }
}

function incWireEvents() {
  els.modeSpendingBtn.onclick = () => setMode("spending");
  els.modeIncomeBtn.onclick = () => setMode("income");
  if (els.modeStocksBtn) els.modeStocksBtn.onclick = () => setMode("stocks");
  els.modeChatBtn.onclick = () => setMode("ai");
  els.modeBlogBtn.onclick = () => setMode("blog");

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
  els.incClearFilterBtn.onclick = () => {
    incFilterOn = false; els.incFilterDate.value = todayStr();
    incSelYears.clear(); incSelCats.clear(); incSelPayees.clear();
    incRender();
  };
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

const STK_INCOME_SOURCE_TYPE = "closed-cycle";
const STK_INCOME_ID_PREFIX = "generated:stock-close:v1:";
const STK_REALIZED_SOURCE_TYPE = "realized-transaction";
const STK_REALIZED_ID_PREFIX = "generated:stock-realized:v2:";
const STK_FORUM_TOPIC_TITLE = "股票投资收益记录";
const STK_FORUM_TOPIC_ID = "generated-stock-investment-income";
const STK_FORUM_POST_PREFIX = "generated:stock-close:v1:";
const STK_REALIZED_FORUM_POST_PREFIX = "generated:stock-realized:v2:";
const STK_FORUM_INTRO_POST_ID = "generated:stock-topic:intro:v1";
const STK_FORUM_INTRO_CONTENT = "本主题由股票模块自动维护。历史收益沿用清仓口径；新交易按每笔卖出和股息统计已实现收益。系统会自动新增、更新或删除对应记录，数据没有变化时不会重复写入。";
const CLOUD_GROWTH_TOPIC_ID = "2026-08-21-01";

function stkIncomePayee(accountName) {
  const s = String(accountName || "").trim();
  if (/^8/.test(s)) return "Nathan Zhu";
  if (/^15/.test(s) && /教|教育/.test(s)) return "Cloud Zhu";
  return "";
}

function stkSortTrades(records) {
  return records.map((r, i) => ({ r, i })).sort((a, b) => {
    const byDate = String(a.r.date || "").localeCompare(String(b.r.date || ""));
    if (byDate) return byDate;
    const ao = Number(a.r.tradeOrder), bo = Number(b.r.tradeOrder);
    if (isFinite(ao) && isFinite(bo) && ao !== bo) return ao - bo;
    return a.i - b.i;
  }).map((x) => x.r);
}

function stkDeriveClosedCycles(records) {
  const groups = new Map();
  for (const r of records) {
    const key = (r.code || "") + "\u0000" + (r.account || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const cycles = [];
  const unmatchedDividends = [];
  for (const [key, unsorted] of groups) {
    const trades = stkSortTrades(unsorted);
    const split = key.indexOf("\u0000");
    const code = key.slice(0, split), accountName = key.slice(split + 1);
    const completed = [];
    let net = 0, sum = 0, startDate = "", txIds = [], hasV2Sale = false;
    let buyShares = 0, buyAmount = 0, buyCost = 0;
    for (const r of trades) {
      const sh = Number(r.shares) || 0;
      const total = stkRecordTotal(r);
      hasV2Sale = hasV2Sale || (sh > 0 && Number(r.realizationVersion) >= 2);
      if (sh === 0) {
        if (Number(r.realizationVersion) >= 2) continue;
        if (Math.abs(net) >= 0.5) {
          sum += total; txIds.push(r.id);
        } else if (completed.length) {
          const last = completed[completed.length - 1];
          last.pnl = round2(last.pnl + total);
          last.transactionIds.push(r.id);
          if (!last.eligible) unmatchedDividends.push(r);
          if (String(r.modified || r.createdAt || "") > String(last.modified || "")) {
            last.modified = r.modified || r.createdAt || last.modified;
          }
        } else {
          unmatchedDividends.push(r);
        }
        continue;
      }
      if (!startDate) startDate = String(r.date || "");
      net += sh;
      sum += total;
      txIds.push(r.id);
      if (sh < 0) {
        buyShares += -sh;
        buyAmount += Math.abs(Number(r.amount) || 0);
        buyCost += -total;
      }
      if (Math.abs(net) < 0.5) {
        const cycle = {
          code, account: accountName, startDate,
          endDate: String(r.date || ""), closingTransactionId: r.id,
          realizationOrder: Number(r.tradeOrder) || 0,
          transactionIds: txIds.slice(), pnl: round2(sum),
          buyShares, buyAmount: round2(buyAmount), buyCost: round2(buyCost),
          averageBuyPrice: buyShares ? round2(buyAmount / buyShares) : 0,
          eligible: r.incomeSyncEligible === true,
          modified: r.modified || r.createdAt || "",
        };
        completed.push(cycle); if (!hasV2Sale) cycles.push(cycle);
        net = 0; sum = 0; startDate = ""; txIds = [];
        hasV2Sale = false;
        buyShares = 0; buyAmount = 0; buyCost = 0;
      }
    }
  }
  return { cycles, unmatchedDividends };
}

function stkDeriveRealizedEvents(records) {
  return StockRealization.derive(records);
}

function stkRecordTotal(record) {
  return Number(record && record.shares) === 0
    ? StockRealization.cashEventTotal(record)
    : (Number(record && record.total) || 0);
}

function stkForumAccountLabel(accountName) {
  return /^15/.test(String(accountName || "")) && /教|教育/.test(String(accountName || ""))
    ? "教育账户" : "主账户";
}

function stkForumMoney(value) {
  return Math.round(Number(value) || 0).toLocaleString("zh-CN") + "元";
}

function stkForumCompactMoney(value) {
  const n = Number(value) || 0;
  return Math.abs(n) >= 10000 ? (n / 10000).toFixed(2) + "w元" : stkForumMoney(n);
}

function stkForumDate(value) {
  return String(value || "").replace(/-/g, "/");
}

function stkRealizedSortKey(row) {
  const date = String(row.date || row.endDate || "");
  const order = String(Math.max(0, Number(row.realizationOrder) || 0)).padStart(16, "0");
  return date + "\u0000" + order + "\u0000" + String(row.transactionId || row.closingTransactionId || "");
}

function stkRealizedYear(row) {
  return String(row.kind === "legacy" ? row.startDate : (row.date || row.endDate) || "").slice(0, 4);
}

function stkRealizedTotals(target, allRows) {
  const completed = allRows.filter((row) => stkRealizedSortKey(row) <= stkRealizedSortKey(target));
  const year = stkRealizedYear(target);
  const yearRows = completed.filter((row) => stkRealizedYear(row) === year);
  const sumFor = (rows, educational) => round2(rows.filter((row) =>
    stkForumAccountLabel(row.account) === (educational ? "教育账户" : "主账户"))
    .reduce((sum, row) => sum + Number(row.pnl || 0), 0));
  return {
    year, yearEdu: sumFor(yearRows, true), yearMain: sumFor(yearRows, false),
    totalEdu: sumFor(completed, true), totalMain: sumFor(completed, false),
  };
}

function stkForumPostContent(cycle, allRows) {
  const totals = stkRealizedTotals(cycle, allRows);
  const { year, yearEdu, yearMain, totalEdu, totalMain } = totals;
  const codeName = String(cycle.code || "").replace(/^H?\d+/, "") || cycle.code;
  const accountLabel = stkForumAccountLabel(cycle.account);
  return `本轮投资${codeName}（${accountLabel}），收益${stkForumMoney(cycle.pnl)}，` +
    `成本${stkForumCompactMoney(cycle.buyCost)}；${stkForumDate(cycle.startDate)}买入，` +
    `${stkForumDate(cycle.endDate)}全部卖出；平均买入价格${Number(cycle.averageBuyPrice || 0).toFixed(2)}元。\n\n` +
    `${stkForumDate(cycle.endDate)}，${year}年度收益 ${stkForumMoney(yearEdu + yearMain)}` +
    `（教育账户${stkForumCompactMoney(yearEdu)}，主账户${stkForumCompactMoney(yearMain)}）；` +
    `截至该日，总收益 ${stkForumCompactMoney(totalEdu + totalMain)}` +
    `（教育账户${stkForumCompactMoney(totalEdu)}，主账户${stkForumCompactMoney(totalMain)}）。`;
}

function stkFindOversell(records, onlyCode, onlyAccount) {
  const groups = new Map();
  for (const r of records) {
    const key = (r.code || "") + "\u0000" + (r.account || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [key, rows] of groups) {
    const [groupCode, groupAccount] = key.split("\u0000");
    if (onlyCode && (groupCode !== onlyCode || groupAccount !== onlyAccount)) continue;
    let net = 0;
    for (const r of stkSortTrades(rows)) {
      const sh = Number(r.shares) || 0;
      if (sh === 0) continue;
      if (sh > 0 && net + sh > 0.5) {
        return { code: groupCode, account: groupAccount, date: r.date,
          available: Math.max(0, -net), selling: sh };
      }
      net += sh;
      if (Math.abs(net) < 0.5) net = 0;
    }
  }
  return null;
}

function stkIsGeneratedIncome(r) {
  return !!(r && r.generated === true && r.source &&
    r.source.module === "stock" &&
    (r.source.type === STK_INCOME_SOURCE_TYPE || r.source.type === STK_REALIZED_SOURCE_TYPE));
}

function stkBuildGeneratedIncome(cycle) {
  const payee = stkIncomePayee(cycle.account);
  if (!payee || !cycle.eligible) return null;
  const pnl = round2(cycle.pnl);
  return {
    id: STK_INCOME_ID_PREFIX + cycle.closingTransactionId,
    title: "股票投资收入", payee,
    date: cycle.endDate,
    baseSalary: 0, overtime: 0, bonus: 0, otherIncome: pnl,
    grossTotal: pnl, socialSecurity: 0, housingFund: 0,
    incomeTax: 0, netAmount: pnl,
    note: `${cycle.code} / ${cycle.account}；周期 ${cycle.startDate} 至 ${cycle.endDate}`,
    createdBy: "股票模块自动同步", modified: cycle.modified,
    generated: true,
    source: {
      module: "stock", type: STK_INCOME_SOURCE_TYPE, version: 1,
      sourceKey: cycle.code + "\u0000" + cycle.account,
      closingTransactionId: cycle.closingTransactionId,
      transactionIds: cycle.transactionIds.slice(),
    },
  };
}
function stkBuildRealizedIncome(event) {
  const payee = stkIncomePayee(event.account);
  if (!payee || !event.eligible) return null;
  const pnl = round2(event.pnl);
  const kind = event.kind === "dividend" ? "股息" : `卖出 ${fmtInt(event.shares)} 股`;
  return {
    id: STK_REALIZED_ID_PREFIX + event.transactionId,
    title: "股票投资收入", payee, date: event.date,
    baseSalary: 0, overtime: 0, bonus: 0, otherIncome: pnl,
    grossTotal: pnl, socialSecurity: 0, housingFund: 0,
    incomeTax: 0, netAmount: pnl,
    note: `${event.code} / ${event.account}；${kind}已实现收益`,
    createdBy: "股票模块自动同步", modified: event.modified,
    generated: true,
    source: {
      module: "stock", type: STK_REALIZED_SOURCE_TYPE, version: 2,
      sourceKey: event.code + "\u0000" + event.account,
      transactionId: event.transactionId, kind: event.kind,
    },
  };
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
  try {
    const sync = await stkReconcileIncome();
    if (sync.unmappedCycles) {
      setStatus("股票已载入；存在未配置家庭成员的账户，已实现收益同步待处理。", "warn", 7000);
    } else if (sync.unmatchedDividends) {
      setStatus("股票已载入；有红利未匹配到上线后的自动清仓周期。", "warn", 7000);
    }
  } catch (e) {
    setStatus("股票已载入，家庭收入同步待重试：" + (e.message || e), "warn", 7000);
  }
  try {
    await stkReconcileForum();
  } catch (e) {
    setStatus("股票已载入，投资收益贴吧同步待重试：" + (e.message || e), "warn", 7000);
  }
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
      const merged = stkApplyOp(list, op);
      const oversell = stkFindOversell(merged);
      if (oversell) {
        throw new Error(`合并最新交易后会超卖：${oversell.code} / ${oversell.account}`);
      }
      stockRecords = merged;
    }
  );
  setStatus("已保存。", "ok", 3000);
  // Best-effort: refresh the Excel-friendly CSV mirror. Never let an export
  // failure surface as a save failure — the JSON above is the source of truth.
  try {
    await stkWriteExport(token);
  } catch (e) {
    setStatus("交易已保存，但 Excel(CSV) 同步失败：" + (e.message || e), "warn", 6000);
  }
}

async function stkReconcileIncome() {
  const token = await getToken();
  await incResolveFolder(token);
  const derived = stkDeriveClosedCycles(stockRecords);
  const desired = derived.cycles
    .map(stkBuildGeneratedIncome).concat(stkDeriveRealizedEvents(stockRecords)
      .map(stkBuildRealizedIncome)).filter(Boolean);
  const unmappedCycles = derived.cycles.concat(stkDeriveRealizedEvents(stockRecords))
    .filter((row) => row.eligible && !stkIncomePayee(row.account)).length;
  const unmatchedDividends = derived.unmatchedDividends.length;
  let current = await incReadJson(token, INCOME_RECORDS_FILE);
  for (let attempt = 0; attempt < 4; attempt++) {
    const all = (current.data && Array.isArray(current.data.records))
      ? current.data.records : [];
    const manual = all.filter((r) => !stkIsGeneratedIncome(r));
    const existingGenerated = all.filter(stkIsGeneratedIncome)
      .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const desiredSorted = desired.slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (JSON.stringify(existingGenerated) === JSON.stringify(desiredSorted)) {
      return {
        generatedCount: desired.length,
        unmappedCycles,
        unmatchedDividends,
      };
    }
    const merged = manual.concat(desired);
    const { content } = incFileUrls(INCOME_RECORDS_FILE);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (current.etag) headers["If-Match"] = current.etag;
    const res = await fetch(content, {
      method: "PUT", headers, body: JSON.stringify({ records: merged }),
    });
    if (res.ok) {
      const item = await res.json();
      const newEtag = item.eTag || (await incReadETag(token, INCOME_RECORDS_FILE));
      await idbSet(INCOME_RECORDS_FILE, newEtag, merged);
      if (incomeLoaded) {
        incomeRecords = merged;
        incEtag = newEtag;
        incRender();
      }
      return {
        generatedCount: desired.length,
        unmappedCycles,
        unmatchedDividends,
      };
    }
    if (res.status === 412) {
      current = await incReadJson(token, INCOME_RECORDS_FILE);
      continue;
    }
    throw new Error("家庭收入同步失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("家庭收入同步冲突，重试多次仍失败。");
}

function stkForumPostCreated(cycle) {
  const d = String(cycle.endDate || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(d + "T00:00:00+08:00").toISOString()
    : (cycle.modified || new Date().toISOString());
}

function stkRealizedForumPostContent(event, allRows) {
  const { year, yearEdu, yearMain, totalEdu, totalMain } = stkRealizedTotals(event, allRows);
  const codeName = String(event.code || "").replace(/^H?\d+/, "") || event.code;
  const accountLabel = stkForumAccountLabel(event.account);
  const detail = event.kind === "dividend"
    ? `收到股息${stkForumMoney(event.proceeds)}`
    : `卖出${fmtInt(event.shares)}股，净到账${stkForumMoney(event.proceeds)}，` +
      `平均成本${Number(event.averageCost || 0).toFixed(2)}元，成本${stkForumMoney(event.costBasis)}，` +
      `剩余持仓${fmtInt(event.remainingShares)}股`;
  return `${stkForumDate(event.date)}，${codeName}（${accountLabel}）${detail}；` +
    `本笔收益${stkForumMoney(event.pnl)}。\n\n` +
    `${year}年度已实现收益 ${stkForumMoney(yearEdu + yearMain)}` +
    `（教育账户${stkForumCompactMoney(yearEdu)}，主账户${stkForumCompactMoney(yearMain)}）；` +
    `截至该日，总收益 ${stkForumCompactMoney(totalEdu + totalMain)}` +
    `（教育账户${stkForumCompactMoney(totalEdu)}，主账户${stkForumCompactMoney(totalMain)}）。`;
}

async function stkReconcileForum() {
  const token = await getToken();
  await forumResolveFolder(token);
  const cycles = stkDeriveClosedCycles(stockRecords).cycles
    .slice().sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)) ||
      String(a.account).localeCompare(String(b.account)));
  const events = stkDeriveRealizedEvents(stockRecords);
  const allRealized = cycles.map((cycle) => Object.assign({ kind: "legacy", date: cycle.endDate }, cycle)).concat(events)
    .sort((a, b) => stkRealizedSortKey(a).localeCompare(stkRealizedSortKey(b)));
  const desired = [{
    id: STK_FORUM_INTRO_POST_ID,
    author: "股票模块自动同步",
    content: STK_FORUM_INTRO_CONTENT,
    created: "2000-01-01T00:00:00.000Z",
    generated: true, protected: true,
    source: { module: "stock", type: "topic-intro", version: 1 },
  }].concat(cycles.map((cycle) => ({
    id: STK_FORUM_POST_PREFIX + cycle.closingTransactionId,
    author: "股票模块自动同步",
    content: stkForumPostContent(Object.assign({ kind: "legacy", date: cycle.endDate }, cycle), allRealized),
    created: stkForumPostCreated(cycle),
    generated: true,
    source: {
      module: "stock", type: STK_INCOME_SOURCE_TYPE, version: 1,
      closingTransactionId: cycle.closingTransactionId,
      transactionIds: cycle.transactionIds.slice(),
    },
  }))).concat(events.map((event) => ({
    id: STK_REALIZED_FORUM_POST_PREFIX + event.transactionId,
    author: "股票模块自动同步",
    content: stkRealizedForumPostContent(event, allRealized),
    created: stkForumPostCreated({ endDate: event.date, modified: event.modified }),
    generated: true,
    source: {
      module: "stock", type: STK_REALIZED_SOURCE_TYPE, version: 2,
      transactionId: event.transactionId, kind: event.kind,
    },
  })));

  const topicId = STK_FORUM_TOPIC_ID;
  let topic = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const idx = await forumReadIndex(token);
    topic = idx.topics.find((t) => t.id === topicId) || null;
    const created = topic ? topic.created : new Date().toISOString();
    const topicData = await forumReadTopic(token, topicId);
    const manual = topicData.posts.filter((p) => !(p.generated === true && p.source && p.source.module === "stock"));
    const existingGenerated = topicData.posts.filter((p) => p.generated === true && p.source && p.source.module === "stock")
      .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const desiredSorted = desired.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const posts = manual.concat(desired).sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
    const lastUpdated = posts.reduce((max, p) => String(p.created || "") > max ? String(p.created || "") : max, created);
    const nextTopic = {
      id: topicId, title: STK_FORUM_TOPIC_TITLE,
      author: (topic && topic.author) || "股票模块自动同步",
      created, postCount: posts.length, lastUpdated,
      generated: true, pinned: true, protected: true,
    };
    if (topic && JSON.stringify(existingGenerated) === JSON.stringify(desiredSorted) &&
        ["id", "title", "author", "created", "postCount", "lastUpdated", "generated", "pinned", "protected"]
          .every((key) => topic[key] === nextTopic[key])) {
      return { postCount: desired.length, topicId };
    }
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (topicData.etag) headers["If-Match"] = topicData.etag;
    const writeTopic = await fetch(forumContentUrl("forum/" + topicId + ".json"), {
      method: "PUT", headers, body: JSON.stringify({ topic: nextTopic, posts }),
    });
    if (writeTopic.status === 412) continue;
    if (!writeTopic.ok) throw new Error("同步股票收益主题失败：" + writeTopic.status + " " + (await writeTopic.text()));
    const writeTopicItem = await writeTopic.json();

    const freshIdx = await forumReadIndex(token);
    const topics = freshIdx.topics.filter((t) => t.id !== topicId);
    topics.push(nextTopic);
    topics.sort(forumCmp);
    const idxHeaders = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (freshIdx.etag) idxHeaders["If-Match"] = freshIdx.etag;
    const writeIndex = await fetch(forumContentUrl(FORUM_INDEX_FILE), {
      method: "PUT", headers: idxHeaders, body: JSON.stringify({ topics }),
    });
    if (writeIndex.status === 412) continue;
    if (!writeIndex.ok) throw new Error("同步股票收益索引失败：" + writeIndex.status + " " + (await writeIndex.text()));

    if (forumLoaded) {
      forumTopics = topics;
      forumIndexEtag = (await writeIndex.json()).eTag || null;
      forumRenderList();
      if (forumCurTopicId === topicId && !els.forumTopicView.classList.contains("hidden")) {
        forumCurPosts = posts;
        forumCurEtag = writeTopicItem.eTag || null;
        await forumRenderPosts(token);
      }
    }
    return { postCount: desired.length, topicId };
  }
  throw new Error("同步股票收益主题冲突，重试多次仍失败。");
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

// Toggle cash-event inputs between read-only and editable. Total is always
// calculated from amount minus absolute fees.
// (manual, dividend mode), and update the section title/note accordingly.
const STK_DERIVED_FIELDS = ["stkAmount", "stkCommission", "stkStamp", "stkTransfer"];
function stkSetDerivedEditable(editable) {
  for (const k of STK_DERIVED_FIELDS) {
    const el = els[k];
    el.readOnly = !editable;
    if (editable) el.removeAttribute("tabindex"); else el.setAttribute("tabindex", "-1");
    el.classList.toggle("editable", editable);
  }
  els.stkTotal.readOnly = true;
  els.stkTotal.setAttribute("tabindex", "-1");
  els.stkTotal.classList.remove("editable");
  if (editable) {
    els.stkDerivedTitle.textContent = "手动填写（股息/红利）";
    els.stkDerivedNote.textContent = "填写成交金额和费用，总金额（实际到账）自动计算。";
  } else {
    els.stkDerivedTitle.textContent = "自动计算（只读）";
    els.stkDerivedNote.textContent = "成交金额/佣金/印花税/过户费/总金额 按交易规则自动算出，无需填写。";
  }
}

// Live-preview the derived (read-only) fields from the current inputs.
function stkRecalc() {
  if (stkIsDividend()) {
    stkSetDerivedEditable(true);
    els.stkTotal.value = StockRealization.cashEventTotal({
      amount: stkNum(els.stkAmount), commission: stkNum(els.stkCommission),
      stampTax: stkNum(els.stkStamp), transferFee: stkNum(els.stkTransfer), total: 0,
    });
    return;
  }
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
  if (!stockLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
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
        total: StockRealization.cashEventTotal({
          amount: stkNum(els.stkAmount), commission: stkNum(els.stkCommission),
          stampTax: stkNum(els.stkStamp), transferFee: stkNum(els.stkTransfer), total: 0,
        }),
      }
    : stkComputeDerived(code, price, shares, fx);
  const oldRec = isEdit ? stockRecords.find((r) => r.id === els.stkEditId.value) : null;
  const nowIso = new Date().toISOString();
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
    createdAt: (oldRec && oldRec.createdAt) || nowIso,
    tradeOrder: oldRec ? oldRec.tradeOrder : Date.now(),
    incomeSyncEligible: oldRec ? oldRec.incomeSyncEligible === true : true,
    realizationVersion: oldRec ? oldRec.realizationVersion : 2,
    modified: nowIso,
  };

  const snap = stockRecords.slice();
  if (isEdit) {
    const i = stockRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = stockRecords[i].createdBy || rec.createdBy; stockRecords[i] = rec; }
    else stockRecords.push(rec);
  } else {
    stockRecords.push(rec);
  }
  let oversell = stkFindOversell(stockRecords, code, els.stkAccount.value);
  if (!oversell && oldRec && (oldRec.code !== code || oldRec.account !== els.stkAccount.value)) {
    oversell = stkFindOversell(stockRecords, oldRec.code, oldRec.account);
  }
  if (oversell) {
    stockRecords = snap;
    setStatus(`卖出股数超过当前持仓，不能保存：${oversell.code} / ${oversell.account}，可卖 ${fmtInt(oversell.available)}，本次卖出 ${fmtInt(oversell.selling)}。`, "warn", 8000);
    return;
  }
  const isNewRealization = !isEdit && rec.realizationVersion === 2 && shares >= 0;
  els.stkAddBtn.disabled = true;
  stkFillFilters();
  stkRender();
  try {
    await stkPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    stkResetForm();
    try {
      const sync = await stkReconcileIncome();
      if (sync.unmappedCycles) {
        setStatus("股票已保存；存在未配置家庭成员的账户，已实现收益同步待处理。", "warn", 8000);
      } else if (sync.unmatchedDividends) {
        setStatus("股票已保存；红利未匹配到上线后的自动清仓周期，请手工调整家庭收入。", "warn", 8000);
      } else {
        setStatus(isNewRealization
          ? "已添加并保存；本笔已实现收益已自动添加到家庭收入。"
          : (isEdit ? "已保存修改；家庭收入已同步。" : "已添加并保存。"), "ok", 5000);
      }
    } catch (syncErr) {
      setStatus("股票已保存，家庭收入同步待重试：" + (syncErr.message || syncErr), "warn", 8000);
    }
    try {
      await stkReconcileForum();
    } catch (forumErr) {
      setStatus("股票已保存，投资收益贴吧同步待重试：" + (forumErr.message || forumErr), "warn", 8000);
    }
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
  els.stkTotal.value = stkRecordTotal(r);
  stkUpdateFxVisibility();
  stkRecalc();
  els.stkFormTitle.textContent = "编辑交易";
  els.stkAddBtn.textContent = "保存修改";
  show(els.stkCancelBtn);
  stkSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function stkDelete(id) {
  if (!stockLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = stockRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条交易记录吗？\n${r.date} ${r.code} ${r.account} ${fmtAmount(stkRecordTotal(r))}`)) return;
  const snap = stockRecords.slice();
  stockRecords = stockRecords.filter((x) => x.id !== id);
  const oversell = stkFindOversell(stockRecords, r.code, r.account);
  if (oversell) {
    stockRecords = snap;
    setStatus(`删除后会导致卖出股数超过持仓，不能删除：${oversell.code} / ${oversell.account}，可卖 ${fmtInt(oversell.available)}，已有卖出 ${fmtInt(oversell.selling)}。`, "warn", 8000);
    return;
  }
  stkRender();
  try {
    await stkPersist({ type: "delete", id });
    try {
      await stkReconcileIncome();
      setStatus("交易已删除，家庭收入已同步。", "ok", 4000);
    } catch (syncErr) {
      setStatus("交易已删除，家庭收入同步待重试：" + (syncErr.message || syncErr), "warn", 8000);
    }
    try {
      await stkReconcileForum();
    } catch (forumErr) {
      setStatus("交易已删除，投资收益贴吧同步待重试：" + (forumErr.message || forumErr), "warn", 8000);
    }
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
      <td class="num strong">${fmtAmount(stkRecordTotal(r))}</td>
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
  const sum = view.reduce((s, r) => s + stkRecordTotal(r), 0);
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

// Realized P&L per (realization-year, account), combining legacy closed cycles
// with v2 per-sale and dividend events. Returns byYearAcct: year -> (account -> pnl),
// the sorted account list, and yearTotals: year -> net pnl.
function stkRealizedByYearAccount() {
  const byYearAcct = new Map();
  const accounts = new Set();
  const rows = stkDeriveClosedCycles(stockRecords).cycles.map((cycle) => ({
    date: cycle.endDate, account: cycle.account, pnl: cycle.pnl,
  })).concat(stkDeriveRealizedEvents(stockRecords));
  for (const row of rows) {
    const year = String(row.date || "").slice(0, 4);
    const acct = row.account || "(未知)";
    if (!year) continue;
    if (!byYearAcct.has(year)) byYearAcct.set(year, new Map());
    const am = byYearAcct.get(year);
    am.set(acct, round2((am.get(acct) || 0) + Number(row.pnl || 0)));
    accounts.add(acct);
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
  const labelSuffix = opts.labelSuffix === undefined ? " 年" : opts.labelSuffix;
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
      `<div class="wf-name">${r.name}${labelSuffix}</div>`;
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
    els.stkChartTotalLabel.textContent = "已实现盈亏合计";
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
  els.stkChartTotalLabel.textContent = (yr === "ALL" ? "全部年度" : yr + " 年") + "已实现盈亏";

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
  ["stkPrice", "stkShares", "stkFx", "stkAmount", "stkCommission", "stkStamp", "stkTransfer"]
    .forEach((k) => els[k].addEventListener("input", stkRecalc));

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
  syncStickyNavOffsets();
  window.addEventListener("resize", syncStickyNavOffsets);
  if (els.secretExpirySaveBtn) els.secretExpirySaveBtn.disabled = true;
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

  // 股票基本面 (StockBatchTracker) viewer — read-only, loads lazily.
  sbtWireEvents();


  // Medical module UI (data loads lazily when switching to 看病 mode).
  medWireEvents();
  medResetForm();
  els.medFilterDate.value = todayStr();

  // Celine 收入 module UI (data loads lazily when switching to that mode).
  celWireEvents();
  celResetForm();
  els.celFilterDate.value = todayStr();

  // 借还款 module UI (data loads lazily when switching to that mode).
  brwWireEvents();
  brwResetForm();
  els.brwFilterDate.value = todayStr();

  // 理财 module UI (data loads lazily when switching to that mode).
  invWireEvents();
  invResetForm();
  els.invFilterDate.value = todayStr();

  // 储值卡 module UI (data loads lazily when switching to that mode).
  svcWireEvents();
  svcResetForm();
  els.svcFilterDate.value = todayStr();

  // 车辆保养 module UI (data loads lazily when switching to that mode).
  vehWireEvents();
  vehResetForm();
  els.vehFilterDate.value = todayStr();

  // 健康 module UI (data loads lazily when switching to that mode).
  heaWireEvents();
  hwResetForm();
  hbResetForm();
  els.hwFilterDate.value = todayStr();
  els.hbFilterDate.value = todayStr();

// 生活博客 module UI (data loads lazily when switching to that mode).
  blogWireEvents();
  blogResetForm();

  // 贴吧 (forum) module UI (data loads lazily when the 贴吧 tab is opened).
  forumWireEvents();

  // 旅行地图 (travel) module UI (data loads lazily when switching to 旅行 mode).
  // Wrapped so a failure here can never abort boot() before MSAL init/login
  // (which would also break the global error handlers registered below).
  try { travelWireEvents(); }
  catch (e) { console.warn("travelWireEvents failed:", e); }


  // AI 对话 module UI (data loads lazily when switching to that mode).
  // Wrapped so a failure here can never abort boot() before MSAL init/login.
  try { chatWireEvents(); }
  catch (e) { console.warn("chatWireEvents failed:", e); }


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
  if (!medicalLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
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
  if (!medicalLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
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

/* -------- Excel-friendly CSV mirror of stock-records.json --------------- */
// Every save (add/edit/delete) also rewrites stock-records.csv so the data can
// be opened directly in Excel. It's a derived file: always fully regenerated
// from stockRecords and overwritten (no If-Match — only this writer touches it).
function stkCsvCell(v) {
  const s = (v === null || v === undefined) ? "" : String(v);
  // Quote fields containing comma, quote, CR or LF; escape embedded quotes.
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function stkBuildCsv() {
  const headers = [
    "日期", "代码名称", "账户", "价格", "股数", "汇率",
    "成交金额", "佣金", "印花税", "过户费", "总金额", "收益规则版本", "记录人", "修改时间",
  ];
  const rows = stockRecords.slice().sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || "")));
  const lines = [headers.map(stkCsvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.date, r.code, r.account, r.price, r.shares, r.fx,
      r.amount, r.commission, r.stampTax, r.transferFee, stkRecordTotal(r),
      r.realizationVersion || 1, r.createdBy, r.modified,
    ].map(stkCsvCell).join(","));
  }
  // Leading BOM so Excel reads the UTF-8 Chinese correctly.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
async function stkWriteExport(token) {
  const { content } = stkFileUrls(STOCK_CSV_FILE);
  const res = await fetch(content, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body: stkBuildCsv(),
  });
  if (!res.ok) {
    throw new Error("导出 CSV 失败：" + res.status + " " + (await res.text()));
  }
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
  setStatus("正在载入 Celine 存钱罐数据…");
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
  if (!celineLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
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

// Auto-deposit half of a 南京人才安居 subsidy's 实际收入 into the piggy bank.
// One-time on income add (not linked to later edits/deletes). Loads Celine data
// first so the write carries the real eTag + full record set (a null-eTag PUT
// would overwrite existing records).
async function maybeAddCelineSubsidy(incRec) {
  if (!incRec || incRec.title !== NANJING_SUBSIDY_TITLE) return;
  const half = round2((Number(incRec.netAmount) || 0) / 2);
  if (half <= 0) return;
  try {
    if (!celineLoaded) await celLoad();
    const ym = (incRec.date || todayStr()).slice(0, 7);
    const rec = {
      id: uuid(),
      date: incRec.date || todayStr(),
      amount: half,
      note: `南京人才安居补贴 一半 (${ym})`,
      createdBy: (account && (account.name || account.username)) || "",
      modified: new Date().toISOString(),
    };
    celineRecords.push(rec);
    celRender();
    await celPersist({ type: "add", rec });
    setStatus(`已将 ${fmtAmount(half)} 存入 Celine 存钱罐。`, "ok", 4000);
  } catch (err) {
    setStatus("存钱罐自动记账失败：" + (err.message || err), "warn");
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
  if (!celineLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
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
    tr.className = (dateBand ? "date-band-b" : "date-band-a") +
      (stkIsGeneratedIncome(r) ? " inc-generated" : "");
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

/* ========================================================================= *
 *                       借还款 MODULE (brw*)                                 *
 *   Per-person loans/repayments. Record: {id,person,date,amount,note,       *
 *   createdBy,modified}. amount<0 = 借出, amount>0 = 还款. Net per person:   *
 *   <0 => 对方欠你, >0 => 你欠对方. borrow-repay.json.                        *
 * ========================================================================= */
let borrowRecords = [];
let brwEtag = null;
let borrowLoaded = false;
let brwShowAll = false;
let brwFilterOn = false;
let brwTab = "chart";
let brwSearchText = "";

const BRW_PERSON_CUSTOM = "__custom__";
const BRW_PERSON_COLORS = [
  "#118DFF", "#E66C37", "#12B76A", "#9B51E0", "#F2994A",
  "#EB5757", "#2D9CDB", "#6FCF97", "#BB6BD9", "#F2C94C",
];

async function brwLoad() {
  if (borrowLoaded) return;
  setStatus("正在载入借还款数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const r = await xtReadJson(token, BORROW_REPAY_FILE);
  borrowRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  brwEtag = r.etag;
  borrowLoaded = true;
  brwRebuildPersonOptions();
  brwRender();
  setStatus("已载入 " + borrowRecords.length + " 条借还款记录。", "ok", 2000);
}

function brwApplyOp(list, op) {
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

async function brwPersist(op) {
  setStatus("正在保存借还款记录…");
  const token = await getToken();
  brwEtag = await xtWriteJson(
    token, BORROW_REPAY_FILE, () => ({ records: borrowRecords }), brwEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      borrowRecords = brwApplyOp(list, op);
    },
    () => brwRender()
  );
  setStatus("已保存。", "ok", 3000);
}

/* ------------------------- 借还款 person dropdown ------------------------- */
function brwRebuildPersonOptions(selected) {
  const cur = selected != null ? selected : els.brwPerson.value;
  const seen = new Set();
  const persons = [];
  for (const r of borrowRecords) {
    const p = (r.person || "").trim();
    if (p && !seen.has(p)) { seen.add(p); persons.push(p); }
  }
  persons.sort((a, b) => a.localeCompare(b, "zh"));

  els.brwPerson.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择对方"; ph.disabled = true;
  els.brwPerson.appendChild(ph);
  for (const p of persons) {
    const o = document.createElement("option");
    o.value = p; o.textContent = p;
    els.brwPerson.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = BRW_PERSON_CUSTOM; custom.textContent = "＋ 自定义…";
  els.brwPerson.appendChild(custom);

  if (cur && persons.includes(cur)) els.brwPerson.value = cur;
  else if (cur === BRW_PERSON_CUSTOM) els.brwPerson.value = BRW_PERSON_CUSTOM;
  else els.brwPerson.value = "";
  brwPersonOnChange();
}

function brwPersonValue() {
  return els.brwPerson.value === BRW_PERSON_CUSTOM
    ? els.brwPersonCustom.value.trim()
    : els.brwPerson.value.trim();
}

function brwPersonOnChange() {
  const on = els.brwPerson.value === BRW_PERSON_CUSTOM;
  els.brwPersonCustom.classList.toggle("hidden", !on);
  if (on) els.brwPersonCustom.focus();
  else els.brwPersonCustom.value = "";
}

/* --------------------------- 借还款 form --------------------------------- */
function brwResetForm() {
  els.brwForm.reset();
  els.brwEditId.value = "";
  els.brwPerson.value = "";
  els.brwPersonCustom.value = "";
  els.brwPersonCustom.classList.add("hidden");
  els.brwType.value = "lend";
  els.brwDate.value = todayStr();
  els.brwFormTitle.textContent = "添加借还款记录";
  els.brwAddBtn.textContent = "添加并保存";
  hide(els.brwCancelBtn);
}

async function brwOnSubmit(e) {
  e.preventDefault();
  if (!borrowLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.brwEditId.value;
  const mag = Math.abs(parseFloat(els.brwAmount.value));
  if (isNaN(mag) || mag === 0) { setStatus("请输入金额。", "warn"); return; }
  const signed = els.brwType.value === "lend" ? -mag : mag;
  const rec = {
    id: els.brwEditId.value || uuid(),
    person: brwPersonValue(),
    date: els.brwDate.value,
    amount: round2(signed),
    note: els.brwNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.person) { setStatus("请填写对方。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = borrowRecords.slice();
  if (isEdit) {
    const i = borrowRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = borrowRecords[i].createdBy || rec.createdBy; borrowRecords[i] = rec; }
    else borrowRecords.push(rec);
  } else {
    borrowRecords.push(rec);
  }
  els.brwAddBtn.disabled = true;
  brwRebuildPersonOptions();
  brwRender();
  try {
    await brwPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    brwResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    borrowRecords = snap; brwRebuildPersonOptions(); brwRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.brwAddBtn.disabled = false;
  }
}

function brwStartEdit(id) {
  const r = borrowRecords.find((x) => x.id === id);
  if (!r) return;
  const amt = Number(r.amount) || 0;
  els.brwEditId.value = r.id;
  brwRebuildPersonOptions(r.person || "");
  els.brwDate.value = r.date;
  els.brwType.value = amt < 0 ? "lend" : "repay";
  els.brwAmount.value = Math.abs(amt);
  els.brwNote.value = r.note || "";
  els.brwFormTitle.textContent = "编辑借还款记录";
  els.brwAddBtn.textContent = "保存修改";
  show(els.brwCancelBtn);
  brwSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function brwDelete(id) {
  if (!borrowLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = borrowRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条借还款记录吗？\n${r.date} ${r.person} ${fmtAmount(r.amount)}`)) return;
  const snap = borrowRecords.slice();
  borrowRecords = borrowRecords.filter((x) => x.id !== id);
  brwRebuildPersonOptions();
  brwRender();
  try {
    await brwPersist({ type: "delete", id });
  } catch (err) {
    borrowRecords = snap; brwRebuildPersonOptions(); brwRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* --------------------------- 借还款 table -------------------------------- */
function brwRender() {
  const monthFilter = brwFilterOn && els.brwFilterDate ? els.brwFilterDate.value.slice(0, 7) : "";
  const q = brwSearchText.trim().toLowerCase();
  let sorted = [...borrowRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.person || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (brwShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.brwBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const amt = Number(r.amount) || 0;
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.person || "")}</td>
      <td class="num strong${amt < 0 ? " neg" : " pos"}">${fmtAmount(amt)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => brwStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => brwDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.brwBody.appendChild(tr);
  }

  const total = borrowRecords.length;
  const sum = view.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.brwRecordCount.textContent = `${view.length} 条，净额 ${fmtAmount(sum)}`;
  else if (brwShowAll) els.brwRecordCount.textContent = `显示全部 ${total} 条`;
  else els.brwRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.brwClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.brwShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !brwShowAll));
  els.brwShowAllBtn.textContent = brwShowAll ? "显示50条" : "显示全部";
  els.brwEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- 借还款 chart -------------------------------- */
// Per-person net balance. net<0 => 对方欠你 (receivable); net>0 => 你欠对方.
function brwRenderChart() {
  const netByPerson = new Map();
  for (const r of borrowRecords) {
    const who = (r.person || "").trim() || "未填写";
    netByPerson.set(who, (netByPerson.get(who) || 0) + (Number(r.amount) || 0));
  }
  // Drop settled (net === 0) people; sort by outstanding magnitude desc.
  const list = [...netByPerson.entries()]
    .filter(([, v]) => round2(v) !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const grand = [...netByPerson.values()].reduce((a, b) => a + b, 0);

  els.brwChartTotal.textContent = fmtAmount(grand);
  els.brwChartTotal.classList.toggle("neg", grand < 0);

  const has = list.length > 0;
  els.brwChartEmpty.classList.toggle("hidden", has);
  els.brwChartEmpty.textContent = borrowRecords.length ? "已全部结清。" : "暂无借还款数据。";
  if (!has) {
    els.brwPersonBars.innerHTML = ""; els.brwPersonLegend.innerHTML = "";
    return;
  }

  const max = Math.abs(list[0][1]) || 1;
  els.brwPersonBars.innerHTML = "";
  els.brwPersonLegend.innerHTML = "";
  list.forEach(([name, net], i) => {
    const owedToYou = net < 0;           // 对方欠你
    const color = owedToYou ? "#12B76A" : "#D64550";
    const w = (Math.abs(net) / max) * 100;
    const tag = owedToYou ? "对方欠你" : "你欠对方";
    const row = document.createElement("div");
    row.className = "pb-row";
    row.innerHTML =
      `<div class="pb-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>` +
      `<div class="pb-track"><div class="pb-fill" style="width:${w}%;background:${color}"></div></div>` +
      `<div class="pb-val">${fmtInt(Math.abs(net))}<span class="pb-pct">${tag}</span></div>`;
    els.brwPersonBars.appendChild(row);
    const lg = document.createElement("div");
    lg.className = "legend-row";
    lg.innerHTML =
      `<span class="legend-dot" style="background:${color}"></span>` +
      `<span class="legend-name">${escapeHtml(name)}（${tag}）</span>` +
      `<span class="legend-val">${fmtInt(Math.abs(net))}</span>`;
    els.brwPersonLegend.appendChild(lg);
  });
}

/* --------------------------- 借还款 tabs --------------------------------- */
function brwSwitchTab(name) {
  brwTab = name;
  const tabs = {
    add: { panel: els.brwTabAdd, btn: els.brwTabAddBtn },
    list: { panel: els.brwTabList, btn: els.brwTabListBtn },
    chart: { panel: els.brwTabChart, btn: els.brwTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") brwRenderChart();
}

function brwWireEvents() {
  els.brwTabAddBtn.onclick = () => brwSwitchTab("add");
  els.brwTabListBtn.onclick = () => brwSwitchTab("list");
  els.brwTabChartBtn.onclick = () => brwSwitchTab("chart");

  els.brwForm.addEventListener("submit", brwOnSubmit);
  els.brwCancelBtn.onclick = brwResetForm;
  els.brwPerson.addEventListener("change", brwPersonOnChange);

  els.brwFilterDate.addEventListener("change", () => {
    brwFilterOn = true; brwShowAll = false;
    brwRender();
    els.brwFilterDate.blur();
  });
  els.brwSearchInput.addEventListener("input", () => { brwSearchText = els.brwSearchInput.value; brwRender(); });
  els.brwClearFilterBtn.onclick = () => {
    brwFilterOn = false; brwSearchText = ""; els.brwSearchInput.value = "";
    els.brwFilterDate.value = todayStr(); brwRender();
  };
  els.brwShowAllBtn.onclick = () => { brwShowAll = !brwShowAll; brwRender(); };
}

/* ========================================================================= *
 *                          理财 MODULE (inv*)                                *
 *   Wealth-management product ledger. Record: {id,name,date,amount,rate,    *
 *   term,earn,note,createdBy,modified}. amount=本金, earn=到期收益.          *
 *   Chart: 到期收益走势 (by 购买时间). invest.json.                          *
 * ========================================================================= */
let investRecords = [];
let invEtag = null;
let investLoaded = false;
let invShowAll = false;
let invFilterOn = false;
let invTab = "list";
let invSearchText = "";
let invChartYearVal = null;

async function invLoad() {
  if (investLoaded) return;
  setStatus("正在载入理财数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const r = await xtReadJson(token, INVEST_FILE);
  investRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  invEtag = r.etag;
  investLoaded = true;
  invRebuildDatalist();
  invRender();
  setStatus("已载入 " + investRecords.length + " 条理财记录。", "ok", 2000);
}

function invApplyOp(list, op) {
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

async function invPersist(op) {
  setStatus("正在保存理财记录…");
  const token = await getToken();
  invEtag = await xtWriteJson(
    token, INVEST_FILE, () => ({ records: investRecords }), invEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      investRecords = invApplyOp(list, op);
    },
    () => invRender()
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- 理财 form ----------------------------------- */
function invNum(el) { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }
function invOptNum(el) { const v = parseFloat(el.value); return (el.value.trim() === "" || isNaN(v)) ? null : v; }

function invRebuildDatalist() {
  const seen = new Set();
  const names = [];
  for (const r of investRecords) {
    const n = (r.name || "").trim();
    if (n && !seen.has(n)) { seen.add(n); names.push(n); }
  }
  names.sort((a, b) => a.localeCompare(b, "zh"));
  els.invNameList.innerHTML = "";
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n;
    els.invNameList.appendChild(o);
  }
}

function invResetForm() {
  els.invForm.reset();
  els.invEditId.value = "";
  els.invDate.value = todayStr();
  els.invFormTitle.textContent = "添加理财记录";
  els.invAddBtn.textContent = "添加并保存";
  hide(els.invCancelBtn);
}

async function invOnSubmit(e) {
  e.preventDefault();
  if (!investLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.invEditId.value;
  const term = invOptNum(els.invTerm);
  const rec = {
    id: els.invEditId.value || uuid(),
    name: els.invName.value.trim(),
    date: els.invDate.value,
    amount: round2(invNum(els.invAmount)),
    rate: invOptNum(els.invRate),
    term: term == null ? null : Math.round(term),
    earn: round2(invNum(els.invEarn)),
    note: els.invNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.name) { setStatus("请填写产品名称。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = investRecords.slice();
  if (isEdit) {
    const i = investRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = investRecords[i].createdBy || rec.createdBy; investRecords[i] = rec; }
    else investRecords.push(rec);
  } else {
    investRecords.push(rec);
  }
  els.invAddBtn.disabled = true;
  invRebuildDatalist();
  invRender();
  try {
    await invPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    invResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    investRecords = snap; invRebuildDatalist(); invRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.invAddBtn.disabled = false;
  }
}

function invStartEdit(id) {
  const r = investRecords.find((x) => x.id === id);
  if (!r) return;
  els.invEditId.value = r.id;
  els.invName.value = r.name || "";
  els.invDate.value = r.date;
  els.invAmount.value = r.amount || "";
  els.invRate.value = (r.rate == null ? "" : r.rate);
  els.invTerm.value = (r.term == null ? "" : r.term);
  els.invEarn.value = (r.earn || r.earn === 0) ? r.earn : "";
  els.invNote.value = r.note || "";
  els.invFormTitle.textContent = "编辑理财记录";
  els.invAddBtn.textContent = "保存修改";
  show(els.invCancelBtn);
  invSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function invDelete(id) {
  if (!investLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = investRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条理财记录吗？\n${r.date} ${r.name} ${fmtAmount(r.amount)}`)) return;
  const snap = investRecords.slice();
  investRecords = investRecords.filter((x) => x.id !== id);
  invRebuildDatalist();
  invRender();
  try {
    await invPersist({ type: "delete", id });
  } catch (err) {
    investRecords = snap; invRebuildDatalist(); invRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* --------------------------- 理财 table ---------------------------------- */
function invRender() {
  const monthFilter = invFilterOn && els.invFilterDate ? els.invFilterDate.value.slice(0, 7) : "";
  const q = invSearchText.trim().toLowerCase();
  let sorted = [...investRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.name || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (invShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.invBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    const rate = (r.rate == null || r.rate === "") ? "" : r.rate + "%";
    const term = (r.term == null || r.term === "") ? "" : r.term + "天";
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name || "")}</td>
      <td class="num">${fmtAmount(r.amount)}</td>
      <td class="num">${escapeHtml(rate)}</td>
      <td class="num">${escapeHtml(term)}</td>
      <td class="num strong pos">${fmtAmount(r.earn)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => invStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => invDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.invBody.appendChild(tr);
  }

  const total = investRecords.length;
  const amtSum = view.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const earnSum = view.reduce((s, r) => s + (Number(r.earn) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.invRecordCount.textContent = `${view.length} 条，金额 ${fmtAmount(amtSum)}，收益 ${fmtAmount(earnSum)}`;
  else if (invShowAll) els.invRecordCount.textContent = `显示全部 ${total} 条`;
  else els.invRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.invClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.invShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !invShowAll));
  els.invShowAllBtn.textContent = invShowAll ? "显示50条" : "显示全部";
  els.invEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- 理财 chart ---------------------------------- */
function invYears() {
  const s = new Set();
  for (const r of investRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

function invRenderChart() {
  const years = invYears();
  if (!invChartYearVal) invChartYearVal = "all";
  els.invChartYear.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all"; optAll.textContent = "全部年度";
  if (invChartYearVal === "all") optAll.selected = true;
  els.invChartYear.appendChild(optAll);
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === invChartYearVal) o.selected = true;
    els.invChartYear.appendChild(o);
  }

  const year = invChartYearVal;
  let buckets = []; // {label, earn}
  const index = new Map();
  if (year === "all") {
    const keys = new Set();
    for (const r of investRecords) if (r.date && r.date.length >= 7) keys.add(r.date.slice(0, 7));
    const ordered = [...keys].sort();
    if (ordered.length) {
      const [y0, m0] = ordered[0].split("-").map(Number);
      const [y1, m1] = ordered[ordered.length - 1].split("-").map(Number);
      let yy = y0, mm = m0;
      while (yy < y1 || (yy === y1 && mm <= m1)) {
        const key = `${yy}-${String(mm).padStart(2, "0")}`;
        const b = { label: `${String(yy).slice(2)}/${mm}`, earn: 0 };
        index.set(key, b); buckets.push(b);
        mm++; if (mm > 12) { mm = 1; yy++; }
      }
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      const b = { label: MONTH_LABELS[m - 1], earn: 0 };
      index.set(`${year}-${String(m).padStart(2, "0")}`, b);
      buckets.push(b);
    }
  }

  for (const r of investRecords) {
    if (!r.date || r.date.length < 7) continue;
    if (year !== "all" && r.date.slice(0, 4) !== year) continue;
    const b = index.get(r.date.slice(0, 7));
    if (b) b.earn += Number(r.earn) || 0;
  }
  const grand = buckets.reduce((s, b) => s + b.earn, 0);
  els.invChartTitle.textContent = (year === "all" ? "全部年度" : year + " 年度") + "到期收益";
  els.invChartTotal.textContent = fmtAmount(grand);

  const has = grand > 0;
  els.invChartEmpty.classList.toggle("hidden", has);
  if (!has) {
    els.invWaterfall.innerHTML = ""; els.invMonthBars.innerHTML = "";
    return;
  }

  invBuildWaterfall(buckets, grand);
  invBuildMonthBars(buckets);
}

function invBuildWaterfall(buckets, grand) {
  const max = grand || 1;
  els.invWaterfall.innerHTML = "";
  let run = 0;
  buckets.forEach((b, i) => {
    const v = b.earn;
    const basePct = (run / max) * 100;
    const fillPct = (v / max) * 100;
    const topPct = basePct + fillPct;
    const col = document.createElement("div");
    col.className = "wf-col";
    const connector = (i > 0 && v)
      ? `<div class="wf-connector" style="bottom:${basePct}%"></div>` : "";
    col.innerHTML =
      `<div class="wf-track">` +
        connector +
        (v ? `<div class="wf-fill" style="bottom:${basePct}%;height:${fillPct}%"></div>` : "") +
        (v ? `<div class="wf-val" style="bottom:${topPct}%">${fmtInt(v)}</div>` : "") +
      `</div>` +
      `<div class="wf-name">${b.label}</div>`;
    run += v;
    els.invWaterfall.appendChild(col);
  });
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  tot.innerHTML =
    `<div class="wf-track">` +
      `<div class="wf-fill total" style="bottom:0;height:100%"></div>` +
      `<div class="wf-val" style="bottom:100%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  els.invWaterfall.appendChild(tot);
}

function invBuildMonthBars(buckets) {
  let max = 1;
  for (const b of buckets) max = Math.max(max, b.earn);
  els.invMonthBars.innerHTML = "";
  for (const b of buckets) {
    const v = b.earn;
    const col = document.createElement("div");
    col.className = "mb-col";
    const h = (v / max) * 100;
    const inner = v ? `<div class="mb-seg" style="height:${h}%;background:#12B76A" title="${fmtInt(v)}"></div>` : "";
    col.innerHTML =
      `<div class="mb-val">${v ? fmtInt(v) : ""}</div>` +
      `<div class="mb-track">${inner}</div>` +
      `<div class="mb-name">${b.label}</div>`;
    els.invMonthBars.appendChild(col);
  }
}

/* --------------------------- 理财 tabs ----------------------------------- */
function invSwitchTab(name) {
  invTab = name;
  const tabs = {
    add: { panel: els.invTabAdd, btn: els.invTabAddBtn },
    list: { panel: els.invTabList, btn: els.invTabListBtn },
    chart: { panel: els.invTabChart, btn: els.invTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") invRenderChart();
}

function invWireEvents() {
  els.invTabAddBtn.onclick = () => invSwitchTab("add");
  els.invTabListBtn.onclick = () => invSwitchTab("list");
  els.invTabChartBtn.onclick = () => invSwitchTab("chart");

  els.invForm.addEventListener("submit", invOnSubmit);
  els.invCancelBtn.onclick = invResetForm;

  els.invFilterDate.addEventListener("change", () => {
    invFilterOn = true; invShowAll = false;
    invRender();
    els.invFilterDate.blur();
  });
  els.invSearchInput.addEventListener("input", () => { invSearchText = els.invSearchInput.value; invRender(); });
  els.invClearFilterBtn.onclick = () => {
    invFilterOn = false; invSearchText = ""; els.invSearchInput.value = "";
    els.invFilterDate.value = todayStr(); invRender();
  };
  els.invShowAllBtn.onclick = () => { invShowAll = !invShowAll; invRender(); };
  els.invChartYear.onchange = () => { invChartYearVal = els.invChartYear.value; invRenderChart(); };
}

/* ========================================================================= *
 *                          储值卡 MODULE (svc*)                              *
 *   Stored-value cards ledger. Transaction record:                          *
 *   {id,card,account,date,amount(signed 充值+/使用-),expiry,note,            *
 *    createdBy,modified}. A card's balance = sum of its amounts.             *
 *   Chart tab = per-card balance summary. stored-value-cards.json.          *
 * ========================================================================= */
let storedCards = [];
let svcEtag = null;
let storedLoaded = false;
let svcShowAll = false;
let svcFilterOn = false;
let svcTab = "list";
let svcSearchText = "";
const SVC_CARD_CUSTOM = "__custom__";

async function svcLoad() {
  if (storedLoaded) return;
  setStatus("正在载入储值卡数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const r = await xtReadJson(token, STORED_CARD_FILE);
  storedCards = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  svcEtag = r.etag;
  storedLoaded = true;
  svcRebuildCardOptions();
  svcRender();
  setStatus("已载入 " + storedCards.length + " 条储值卡记录。", "ok", 2000);
}

function svcApplyOp(list, op) {
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

async function svcPersist(op) {
  setStatus("正在保存储值卡记录…");
  const token = await getToken();
  svcEtag = await xtWriteJson(
    token, STORED_CARD_FILE, () => ({ records: storedCards }), svcEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      storedCards = svcApplyOp(list, op);
    },
    () => svcRender()
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- 储值卡 card dropdown ------------------------- */
function svcRebuildCardOptions(selected) {
  const cur = selected != null ? selected : els.svcCard.value;
  const seen = new Set();
  const cards = [];
  for (const r of storedCards) {
    const c = (r.card || "").trim();
    if (c && !seen.has(c)) { seen.add(c); cards.push(c); }
  }
  cards.sort((a, b) => a.localeCompare(b, "zh"));

  els.svcCard.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择卡片"; ph.disabled = true;
  els.svcCard.appendChild(ph);
  for (const c of cards) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    els.svcCard.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = SVC_CARD_CUSTOM; custom.textContent = "＋ 自定义…";
  els.svcCard.appendChild(custom);

  if (cur && cards.includes(cur)) els.svcCard.value = cur;
  else if (cur === SVC_CARD_CUSTOM) els.svcCard.value = SVC_CARD_CUSTOM;
  else els.svcCard.value = "";
  svcCardOnChange();
}

function svcCardValue() {
  return els.svcCard.value === SVC_CARD_CUSTOM
    ? els.svcCardCustom.value.trim()
    : els.svcCard.value.trim();
}

function svcCardOnChange() {
  const on = els.svcCard.value === SVC_CARD_CUSTOM;
  els.svcCardCustom.classList.toggle("hidden", !on);
  if (on) els.svcCardCustom.focus();
  else els.svcCardCustom.value = "";
}

/* --------------------------- 储值卡 form --------------------------------- */
function svcResetForm() {
  els.svcForm.reset();
  els.svcEditId.value = "";
  els.svcCard.value = "";
  els.svcCardCustom.value = "";
  els.svcCardCustom.classList.add("hidden");
  els.svcType.value = "topup";
  els.svcDate.value = todayStr();
  els.svcFormTitle.textContent = "添加储值卡记录";
  els.svcAddBtn.textContent = "添加并保存";
  hide(els.svcCancelBtn);
}

async function svcOnSubmit(e) {
  e.preventDefault();
  if (!storedLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.svcEditId.value;
  const mag = Math.abs(parseFloat(els.svcAmount.value));
  if (isNaN(mag)) { setStatus("请输入金额变动。", "warn"); return; }
  const signed = els.svcType.value === "use" ? -mag : mag;
  const rec = {
    id: els.svcEditId.value || uuid(),
    card: svcCardValue(),
    account: els.svcAccount.value.trim(),
    date: els.svcDate.value,
    amount: round2(signed),
    expiry: els.svcExpiry.value.trim(),
    note: els.svcNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.card) { setStatus("请填写卡名。", "warn"); return; }

  const snap = storedCards.slice();
  if (isEdit) {
    const i = storedCards.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = storedCards[i].createdBy || rec.createdBy; storedCards[i] = rec; }
    else storedCards.push(rec);
  } else {
    storedCards.push(rec);
  }
  els.svcAddBtn.disabled = true;
  svcRebuildCardOptions();
  svcRender();
  try {
    await svcPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    svcResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    storedCards = snap; svcRebuildCardOptions(); svcRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.svcAddBtn.disabled = false;
  }
}

function svcStartEdit(id) {
  const r = storedCards.find((x) => x.id === id);
  if (!r) return;
  const amt = Number(r.amount) || 0;
  els.svcEditId.value = r.id;
  svcRebuildCardOptions(r.card || "");
  els.svcType.value = amt < 0 ? "use" : "topup";
  els.svcAmount.value = Math.abs(amt);
  els.svcDate.value = r.date || "";
  els.svcAccount.value = r.account || "";
  els.svcExpiry.value = r.expiry || "";
  els.svcNote.value = r.note || "";
  els.svcFormTitle.textContent = "编辑储值卡记录";
  els.svcAddBtn.textContent = "保存修改";
  show(els.svcCancelBtn);
  svcSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function svcDelete(id) {
  if (!storedLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = storedCards.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条储值卡记录吗？\n${r.date || ""} ${r.card} ${fmtAmount(r.amount)}`)) return;
  const snap = storedCards.slice();
  storedCards = storedCards.filter((x) => x.id !== id);
  svcRebuildCardOptions();
  svcRender();
  try {
    await svcPersist({ type: "delete", id });
  } catch (err) {
    storedCards = snap; svcRebuildCardOptions(); svcRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* --------------------------- 储值卡 table -------------------------------- */
function svcRender() {
  const monthFilter = svcFilterOn && els.svcFilterDate ? els.svcFilterDate.value.slice(0, 7) : "";
  const q = svcSearchText.trim().toLowerCase();
  let sorted = [...storedCards].sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : (a.date || "") > (b.date || "") ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.card || "").toLowerCase().includes(q) ||
      (r.account || "").toLowerCase().includes(q) ||
      (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (svcShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.svcBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    const dk = r.date || "";
    if (dk !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = dk; }
    const amt = Number(r.amount) || 0;
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = dk;
    tr.innerHTML = `
      <td>${escapeHtml(r.date || "")}</td>
      <td>${escapeHtml(r.card || "")}</td>
      <td class="num strong ${amt < 0 ? "neg" : "pos"}">${fmtAmount(amt)}</td>
      <td>${escapeHtml(r.account || "")}</td>
      <td>${escapeHtml(r.expiry || "")}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => svcStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => svcDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.svcBody.appendChild(tr);
  }

  const total = storedCards.length;
  const amtSum = view.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.svcRecordCount.textContent = `${view.length} 条，合计 ${fmtAmount(amtSum)}`;
  else if (svcShowAll) els.svcRecordCount.textContent = `显示全部 ${total} 条`;
  else els.svcRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.svcClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.svcShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !svcShowAll));
  els.svcShowAllBtn.textContent = svcShowAll ? "显示50条" : "显示全部";
  els.svcEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- 储值卡 balances ----------------------------- */
function svcRenderChart() {
  // Aggregate per card: balance = Σamount; account/expiry = most-recent non-empty.
  const map = new Map(); // card -> {balance, account, expiry, akey, ekey}
  for (const r of storedCards) {
    const card = (r.card || "").trim();
    if (!card) continue;
    let e = map.get(card);
    if (!e) { e = { balance: 0, account: "", expiry: "", akey: "", ekey: "" }; map.set(card, e); }
    e.balance += Number(r.amount) || 0;
    const rk = (r.date || "") + "|" + (r.modified || "");
    if ((r.account || "").trim() && rk >= e.akey) { e.account = r.account.trim(); e.akey = rk; }
    if ((r.expiry || "").trim() && rk >= e.ekey) { e.expiry = r.expiry.trim(); e.ekey = rk; }
  }
  const list = [...map.entries()].sort((a, b) => b[1].balance - a[1].balance);
  const grand = list.reduce((s, [, v]) => s + v.balance, 0);
  els.svcChartTotal.textContent = fmtAmount(grand);

  const has = list.length > 0;
  els.svcChartEmpty.classList.toggle("hidden", has);
  els.svcSummaryBody.innerHTML = "";
  if (!has) return;

  for (const [card, v] of list) {
    const bal = round2(v.balance);
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(card)}</td>` +
      `<td>${escapeHtml(v.account)}</td>` +
      `<td class="num strong ${bal < 0 ? "neg" : "pos"}">${fmtAmount(bal)}</td>` +
      `<td>${escapeHtml(v.expiry)}</td>`;
    els.svcSummaryBody.appendChild(tr);
  }
}

/* --------------------------- 储值卡 tabs --------------------------------- */
function svcSwitchTab(name) {
  svcTab = name;
  const tabs = {
    add: { panel: els.svcTabAdd, btn: els.svcTabAddBtn },
    list: { panel: els.svcTabList, btn: els.svcTabListBtn },
    chart: { panel: els.svcTabChart, btn: els.svcTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") svcRenderChart();
}

function svcWireEvents() {
  els.svcTabAddBtn.onclick = () => svcSwitchTab("add");
  els.svcTabListBtn.onclick = () => svcSwitchTab("list");
  els.svcTabChartBtn.onclick = () => svcSwitchTab("chart");

  els.svcForm.addEventListener("submit", svcOnSubmit);
  els.svcCancelBtn.onclick = svcResetForm;
  els.svcCard.addEventListener("change", svcCardOnChange);

  els.svcFilterDate.addEventListener("change", () => {
    svcFilterOn = true; svcShowAll = false;
    svcRender();
    els.svcFilterDate.blur();
  });
  els.svcSearchInput.addEventListener("input", () => { svcSearchText = els.svcSearchInput.value; svcRender(); });
  els.svcClearFilterBtn.onclick = () => {
    svcFilterOn = false; svcSearchText = ""; els.svcSearchInput.value = "";
    els.svcFilterDate.value = todayStr(); svcRender();
  };
  els.svcShowAllBtn.onclick = () => { svcShowAll = !svcShowAll; svcRender(); };
}

/* ========================================================================= *
 *                          车辆保养 MODULE (veh*)                            *
 *   Vehicle maintenance ledger. Record:                                     *
 *   {id,vehicle,date,cost,category,odometer(int|null),note,                 *
 *    createdBy,modified}. Chart: 保养费用走势 (by 日期).                     *
 *   vehicle-maintenance.json.                                               *
 * ========================================================================= */
let vehicleRecords = [];
let vehEtag = null;
let vehicleLoaded = false;
let vehShowAll = false;
let vehFilterOn = false;
let vehTab = "list";
let vehSearchText = "";
let vehChartYearVal = null;
const VEH_VEHICLE_CUSTOM = "__custom__";
const VEH_CATEGORY_CUSTOM = "__custom__";

async function vehLoad() {
  if (vehicleLoaded) return;
  setStatus("正在载入车辆保养数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const r = await xtReadJson(token, VEHICLE_FILE);
  vehicleRecords = (r.data && Array.isArray(r.data.records)) ? r.data.records : [];
  vehEtag = r.etag;
  vehicleLoaded = true;
  vehRebuildVehicleOptions();
  vehRebuildCategoryOptions();
  vehRender();
  setStatus("已载入 " + vehicleRecords.length + " 条保养记录。", "ok", 2000);
}

function vehApplyOp(list, op) {
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

async function vehPersist(op) {
  setStatus("正在保存保养记录…");
  const token = await getToken();
  vehEtag = await xtWriteJson(
    token, VEHICLE_FILE, () => ({ records: vehicleRecords }), vehEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      vehicleRecords = vehApplyOp(list, op);
    },
    () => vehRender()
  );
  setStatus("已保存。", "ok", 3000);
}

/* --------------------------- 车辆保养 dropdowns -------------------------- */
function vehRebuildVehicleOptions(selected) {
  const cur = selected != null ? selected : els.vehVehicle.value;
  const seen = new Set();
  const items = [];
  for (const r of vehicleRecords) {
    const v = (r.vehicle || "").trim();
    if (v && !seen.has(v)) { seen.add(v); items.push(v); }
  }
  items.sort((a, b) => a.localeCompare(b, "zh"));

  els.vehVehicle.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择车辆"; ph.disabled = true;
  els.vehVehicle.appendChild(ph);
  for (const v of items) {
    const o = document.createElement("option");
    o.value = v; o.textContent = v;
    els.vehVehicle.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = VEH_VEHICLE_CUSTOM; custom.textContent = "＋ 自定义…";
  els.vehVehicle.appendChild(custom);

  if (cur && items.includes(cur)) els.vehVehicle.value = cur;
  else if (cur === VEH_VEHICLE_CUSTOM) els.vehVehicle.value = VEH_VEHICLE_CUSTOM;
  else els.vehVehicle.value = "";
  vehVehicleOnChange();
}

function vehVehicleValue() {
  return els.vehVehicle.value === VEH_VEHICLE_CUSTOM
    ? els.vehVehicleCustom.value.trim()
    : els.vehVehicle.value.trim();
}

function vehVehicleOnChange() {
  const on = els.vehVehicle.value === VEH_VEHICLE_CUSTOM;
  els.vehVehicleCustom.classList.toggle("hidden", !on);
  if (on) els.vehVehicleCustom.focus();
  else els.vehVehicleCustom.value = "";
}

function vehRebuildCategoryOptions(selected) {
  const cur = selected != null ? selected : els.vehCategory.value;
  const seen = new Set();
  const items = [];
  for (const r of vehicleRecords) {
    const c = (r.category || "").trim();
    if (c && !seen.has(c)) { seen.add(c); items.push(c); }
  }
  items.sort((a, b) => a.localeCompare(b, "zh"));

  els.vehCategory.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择类型"; ph.disabled = true;
  els.vehCategory.appendChild(ph);
  for (const c of items) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    els.vehCategory.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = VEH_CATEGORY_CUSTOM; custom.textContent = "＋ 自定义…";
  els.vehCategory.appendChild(custom);

  if (cur && items.includes(cur)) els.vehCategory.value = cur;
  else if (cur === VEH_CATEGORY_CUSTOM) els.vehCategory.value = VEH_CATEGORY_CUSTOM;
  else els.vehCategory.value = "";
  vehCategoryOnChange();
}

function vehCategoryValue() {
  return els.vehCategory.value === VEH_CATEGORY_CUSTOM
    ? els.vehCategoryCustom.value.trim()
    : els.vehCategory.value.trim();
}

function vehCategoryOnChange() {
  const on = els.vehCategory.value === VEH_CATEGORY_CUSTOM;
  els.vehCategoryCustom.classList.toggle("hidden", !on);
  if (on) els.vehCategoryCustom.focus();
  else els.vehCategoryCustom.value = "";
}

/* --------------------------- 车辆保养 form ------------------------------- */
function vehNum(el) { const v = parseFloat(el.value); return isNaN(v) ? 0 : v; }
function vehOptInt(el) {
  const v = parseFloat(el.value);
  return (el.value.trim() === "" || isNaN(v)) ? null : Math.round(v);
}

function vehResetForm() {
  els.vehForm.reset();
  els.vehEditId.value = "";
  els.vehVehicle.value = "";
  els.vehVehicleCustom.value = "";
  els.vehVehicleCustom.classList.add("hidden");
  els.vehCategory.value = "";
  els.vehCategoryCustom.value = "";
  els.vehCategoryCustom.classList.add("hidden");
  els.vehDate.value = todayStr();
  els.vehFormTitle.textContent = "添加保养记录";
  els.vehAddBtn.textContent = "添加并保存";
  hide(els.vehCancelBtn);
}

async function vehOnSubmit(e) {
  e.preventDefault();
  if (!vehicleLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.vehEditId.value;
  const rec = {
    id: els.vehEditId.value || uuid(),
    vehicle: vehVehicleValue(),
    date: els.vehDate.value,
    cost: round2(vehNum(els.vehCost)),
    category: vehCategoryValue(),
    odometer: vehOptInt(els.vehOdometer),
    note: els.vehNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.vehicle) { setStatus("请填写车辆。", "warn"); return; }
  if (!rec.category) { setStatus("请填写保养类型。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = vehicleRecords.slice();
  if (isEdit) {
    const i = vehicleRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = vehicleRecords[i].createdBy || rec.createdBy; vehicleRecords[i] = rec; }
    else vehicleRecords.push(rec);
  } else {
    vehicleRecords.push(rec);
  }
  els.vehAddBtn.disabled = true;
  vehRebuildVehicleOptions();
  vehRebuildCategoryOptions();
  vehRender();
  try {
    await vehPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    vehResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    vehicleRecords = snap; vehRebuildVehicleOptions(); vehRebuildCategoryOptions(); vehRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.vehAddBtn.disabled = false;
  }
}

function vehStartEdit(id) {
  const r = vehicleRecords.find((x) => x.id === id);
  if (!r) return;
  els.vehEditId.value = r.id;
  vehRebuildVehicleOptions(r.vehicle || "");
  vehRebuildCategoryOptions(r.category || "");
  els.vehDate.value = r.date;
  els.vehCost.value = r.cost || "";
  els.vehOdometer.value = (r.odometer == null ? "" : r.odometer);
  els.vehNote.value = r.note || "";
  els.vehFormTitle.textContent = "编辑保养记录";
  els.vehAddBtn.textContent = "保存修改";
  show(els.vehCancelBtn);
  vehSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function vehDelete(id) {
  if (!vehicleLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = vehicleRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条保养记录吗？\n${r.date} ${r.vehicle} ${fmtAmount(r.cost)}`)) return;
  const snap = vehicleRecords.slice();
  vehicleRecords = vehicleRecords.filter((x) => x.id !== id);
  vehRebuildVehicleOptions();
  vehRebuildCategoryOptions();
  vehRender();
  try {
    await vehPersist({ type: "delete", id });
  } catch (err) {
    vehicleRecords = snap; vehRebuildVehicleOptions(); vehRebuildCategoryOptions(); vehRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

/* --------------------------- 车辆保养 table ------------------------------ */
function vehRender() {
  const monthFilter = vehFilterOn && els.vehFilterDate ? els.vehFilterDate.value.slice(0, 7) : "";
  const q = vehSearchText.trim().toLowerCase();
  let sorted = [...vehicleRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.vehicle || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q) ||
      (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (vehShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.vehBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    const odo = (r.odometer == null || r.odometer === "") ? "" : fmtInt(r.odometer);
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.vehicle || "")}</td>
      <td>${escapeHtml(r.category || "")}</td>
      <td class="num">${fmtAmount(r.cost)}</td>
      <td class="num">${escapeHtml(odo)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => vehStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => vehDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.vehBody.appendChild(tr);
  }

  const total = vehicleRecords.length;
  const costSum = view.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.vehRecordCount.textContent = `${view.length} 条，费用 ${fmtAmount(costSum)}`;
  else if (vehShowAll) els.vehRecordCount.textContent = `显示全部 ${total} 条`;
  else els.vehRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.vehClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.vehShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !vehShowAll));
  els.vehShowAllBtn.textContent = vehShowAll ? "显示50条" : "显示全部";
  els.vehEmptyHint.classList.toggle("hidden", view.length !== 0);
}

/* --------------------------- 车辆保养 chart ------------------------------ */
function vehYears() {
  const s = new Set();
  for (const r of vehicleRecords) if (r.date && r.date.length >= 4) s.add(r.date.slice(0, 4));
  return [...s].sort().reverse();
}

function vehRenderChart() {
  const years = vehYears();
  if (!vehChartYearVal) vehChartYearVal = "all";
  els.vehChartYear.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all"; optAll.textContent = "全部年度";
  if (vehChartYearVal === "all") optAll.selected = true;
  els.vehChartYear.appendChild(optAll);
  for (const y of years) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y + " 年"; if (y === vehChartYearVal) o.selected = true;
    els.vehChartYear.appendChild(o);
  }

  const year = vehChartYearVal;
  let buckets = []; // {label, cost}
  const index = new Map();
  if (year === "all") {
    const keys = new Set();
    for (const r of vehicleRecords) if (r.date && r.date.length >= 7) keys.add(r.date.slice(0, 7));
    const ordered = [...keys].sort();
    if (ordered.length) {
      const [y0, m0] = ordered[0].split("-").map(Number);
      const [y1, m1] = ordered[ordered.length - 1].split("-").map(Number);
      let yy = y0, mm = m0;
      while (yy < y1 || (yy === y1 && mm <= m1)) {
        const key = `${yy}-${String(mm).padStart(2, "0")}`;
        const b = { label: `${String(yy).slice(2)}/${mm}`, cost: 0 };
        index.set(key, b); buckets.push(b);
        mm++; if (mm > 12) { mm = 1; yy++; }
      }
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      const b = { label: MONTH_LABELS[m - 1], cost: 0 };
      index.set(`${year}-${String(m).padStart(2, "0")}`, b);
      buckets.push(b);
    }
  }

  for (const r of vehicleRecords) {
    if (!r.date || r.date.length < 7) continue;
    if (year !== "all" && r.date.slice(0, 4) !== year) continue;
    const b = index.get(r.date.slice(0, 7));
    if (b) b.cost += Number(r.cost) || 0;
  }
  const grand = buckets.reduce((s, b) => s + b.cost, 0);
  els.vehChartTitle.textContent = (year === "all" ? "全部年度" : year + " 年度") + "保养费用";
  els.vehChartTotal.textContent = fmtAmount(grand);

  // Only show months that actually have maintenance spending.
  buckets = buckets.filter((b) => b.cost !== 0);

  const has = grand > 0;
  els.vehChartEmpty.classList.toggle("hidden", has);
  if (!has) {
    els.vehWaterfall.innerHTML = ""; els.vehMonthBars.innerHTML = "";
    return;
  }

  vehBuildWaterfall(buckets, grand);
  vehBuildMonthBars(buckets);
}

function vehBuildWaterfall(buckets, grand) {
  const max = grand || 1;
  els.vehWaterfall.innerHTML = "";
  let run = 0;
  buckets.forEach((b, i) => {
    const v = b.cost;
    const basePct = (run / max) * 100;
    const fillPct = (v / max) * 100;
    const topPct = basePct + fillPct;
    const col = document.createElement("div");
    col.className = "wf-col";
    const connector = (i > 0 && v)
      ? `<div class="wf-connector" style="bottom:${basePct}%"></div>` : "";
    col.innerHTML =
      `<div class="wf-track">` +
        connector +
        (v ? `<div class="wf-fill" style="bottom:${basePct}%;height:${fillPct}%"></div>` : "") +
        (v ? `<div class="wf-val" style="bottom:${topPct}%">${fmtInt(v)}</div>` : "") +
      `</div>` +
      `<div class="wf-name">${b.label}</div>`;
    run += v;
    els.vehWaterfall.appendChild(col);
  });
  const tot = document.createElement("div");
  tot.className = "wf-col wf-total";
  tot.innerHTML =
    `<div class="wf-track">` +
      `<div class="wf-fill total" style="bottom:0;height:100%"></div>` +
      `<div class="wf-val" style="bottom:100%">${fmtInt(grand)}</div>` +
    `</div>` +
    `<div class="wf-name">合计</div>`;
  els.vehWaterfall.appendChild(tot);
}

function vehBuildMonthBars(buckets) {
  let max = 1;
  for (const b of buckets) max = Math.max(max, b.cost);
  els.vehMonthBars.innerHTML = "";
  for (const b of buckets) {
    const v = b.cost;
    const col = document.createElement("div");
    col.className = "mb-col";
    const h = (v / max) * 100;
    const inner = v ? `<div class="mb-seg" style="height:${h}%;background:#118DFF" title="${fmtInt(v)}"></div>` : "";
    col.innerHTML =
      `<div class="mb-val">${v ? fmtInt(v) : ""}</div>` +
      `<div class="mb-track">${inner}</div>` +
      `<div class="mb-name">${b.label}</div>`;
    els.vehMonthBars.appendChild(col);
  }
}

/* --------------------------- 车辆保养 tabs ------------------------------- */
function vehSwitchTab(name) {
  vehTab = name;
  const tabs = {
    add: { panel: els.vehTabAdd, btn: els.vehTabAddBtn },
    list: { panel: els.vehTabList, btn: els.vehTabListBtn },
    chart: { panel: els.vehTabChart, btn: els.vehTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") vehRenderChart();
}

function vehWireEvents() {
  els.vehTabAddBtn.onclick = () => vehSwitchTab("add");
  els.vehTabListBtn.onclick = () => vehSwitchTab("list");
  els.vehTabChartBtn.onclick = () => vehSwitchTab("chart");

  els.vehForm.addEventListener("submit", vehOnSubmit);
  els.vehCancelBtn.onclick = vehResetForm;
  els.vehVehicle.addEventListener("change", vehVehicleOnChange);
  els.vehCategory.addEventListener("change", vehCategoryOnChange);

  els.vehFilterDate.addEventListener("change", () => {
    vehFilterOn = true; vehShowAll = false;
    vehRender();
    els.vehFilterDate.blur();
  });
  els.vehSearchInput.addEventListener("input", () => { vehSearchText = els.vehSearchInput.value; vehRender(); });
  els.vehClearFilterBtn.onclick = () => {
    vehFilterOn = false; vehSearchText = ""; els.vehSearchInput.value = "";
    els.vehFilterDate.value = todayStr(); vehRender();
  };
  els.vehShowAllBtn.onclick = () => { vehShowAll = !vehShowAll; vehRender(); };
  els.vehChartYear.onchange = () => { vehChartYearVal = els.vehChartYear.value; vehRenderChart(); };
}

/* ========================================================================= *
 *                          健康 MODULE (hw 体重 / hb 血压)                    *
 *   Two datasets under one mode with a 体重/血压 sub-switch.                 *
 *   Weight record: {id,person,date,weight,height(int|null),bmi(num|null),   *
 *                   note,createdBy,modified}  -> health-weight.json          *
 *   BP record: {id,person,date,systolic,diastolic,pulse(int|null),note,     *
 *               createdBy,modified}           -> health-bp.json              *
 *   Charts: per-person time-series line charts (shared SVG helper).         *
 * ========================================================================= */
let weightRecords = [];
let bpRecords = [];
let hwEtag = null;
let hbEtag = null;
let healthLoaded = false;
let heaSub = "weight";
// 体重 state
let hwShowAll = false, hwFilterOn = false, hwTab = "list", hwSearchText = "", hwChartPersonVal = null;
// 血压 state
let hbShowAll = false, hbFilterOn = false, hbTab = "list", hbSearchText = "", hbChartPersonVal = null;
const HW_PERSON_CUSTOM = "__custom__";
const HB_PERSON_CUSTOM = "__custom__";

async function heaLoad() {
  if (healthLoaded) return;
  setStatus("正在载入健康数据…");
  const token = await getToken();
  await xtResolveFolder(token);
  const rw = await xtReadJson(token, HEALTH_WEIGHT_FILE);
  weightRecords = (rw.data && Array.isArray(rw.data.records)) ? rw.data.records : [];
  hwEtag = rw.etag;
  const rb = await xtReadJson(token, HEALTH_BP_FILE);
  bpRecords = (rb.data && Array.isArray(rb.data.records)) ? rb.data.records : [];
  hbEtag = rb.etag;
  healthLoaded = true;
  hwRebuildPersonOptions(); hwRender();
  hbRebuildPersonOptions(); hbRender();
  setStatus("已载入 体重 " + weightRecords.length + " 条、血压 " + bpRecords.length + " 条。", "ok", 2500);
}

/* --------------------------- 健康 sub-switch ----------------------------- */
function heaSwitchSub(name) {
  heaSub = name;
  const isW = name === "weight";
  els.heaSubWeightBtn.classList.toggle("active", isW);
  els.heaSubBpBtn.classList.toggle("active", !isW);
  els.hwSub.classList.toggle("hidden", !isW);
  els.hbSub.classList.toggle("hidden", isW);
}

/* --------------------------- shared op helper ---------------------------- */
function healthApplyOp(list, op) {
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

/* --------------------------- shared line chart --------------------------- */
// series: [{ name, color, points:[{t:ms, v:number}] }]. fmtV formats a value.
function heaRenderLine(svgEl, legendEl, emptyEl, series, fmtV) {
  const clean = series
    .map((s) => ({
      name: s.name, color: s.color,
      points: s.points
        .filter((p) => p.v != null && !isNaN(p.v) && p.t)
        .sort((a, b) => a.t - b.t),
    }))
    .filter((s) => s.points.length);
  const any = clean.length > 0;
  emptyEl.classList.toggle("hidden", any);
  legendEl.innerHTML = "";
  if (!any) { svgEl.innerHTML = ""; return; }

  const W = 760, H = 320, padL = 46, padR = 14, padT = 14, padB = 38;
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let allT = [], allV = [];
  for (const s of clean) for (const p of s.points) { allT.push(p.t); allV.push(p.v); }
  let tMin = Math.min(...allT), tMax = Math.max(...allT);
  let vMin = Math.min(...allV), vMax = Math.max(...allV);
  if (tMin === tMax) { tMin -= 86400000; tMax += 86400000; }
  let vPad = (vMax - vMin) * 0.12 || Math.max(1, Math.abs(vMax) * 0.1);
  vMin -= vPad; vMax += vPad;
  const xOf = (t) => padL + (t - tMin) / (tMax - tMin) * (W - padL - padR);
  const yOf = (v) => H - padB - (v - vMin) / (vMax - vMin) * (H - padT - padB);
  const fmtDate = (t) => {
    const d = new Date(t);
    return `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  let svg = "";
  // horizontal gridlines + y labels
  for (let i = 0; i <= 4; i++) {
    const v = vMin + (i / 4) * (vMax - vMin);
    const y = yOf(v);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="lc-grid"/>`;
    svg += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="lc-ylabel">${fmtV(v)}</text>`;
  }
  // x date labels
  for (let i = 0; i <= 4; i++) {
    const t = tMin + (i / 4) * (tMax - tMin);
    const x = xOf(t);
    svg += `<text x="${x.toFixed(1)}" y="${H - padB + 16}" class="lc-xlabel">${fmtDate(t)}</text>`;
  }
  // series polylines + dots
  for (const s of clean) {
    const pts = s.points.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
    svg += `<polyline class="lc-line" points="${pts}" style="stroke:${s.color}"/>`;
    for (const p of s.points) {
      svg += `<circle cx="${xOf(p.t).toFixed(1)}" cy="${yOf(p.v).toFixed(1)}" r="2.6" style="fill:${s.color}"/>`;
    }
  }
  svgEl.innerHTML = svg;

  for (const s of clean) {
    const last = s.points[s.points.length - 1];
    legendEl.insertAdjacentHTML("beforeend",
      `<span class="ll-item"><span class="ll-dot" style="background:${s.color}"></span>` +
      `${escapeHtml(s.name)} <b>${fmtV(last.v)}</b></span>`);
  }
}

function heaPersons(records) {
  const seen = new Set(), out = [];
  for (const r of records) {
    const p = (r.person || "").trim();
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out.sort((a, b) => a.localeCompare(b, "zh"));
}

// Person with the most records (default chart selection).
function heaTopPerson(records) {
  const cnt = new Map();
  for (const r of records) {
    const p = (r.person || "").trim();
    if (p) cnt.set(p, (cnt.get(p) || 0) + 1);
  }
  let best = "", bestN = -1;
  for (const [p, n] of cnt) if (n > bestN) { best = p; bestN = n; }
  return best;
}

function dateMs(s) {
  if (!s || s.length < 10) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

/* ======================= 体重 (hw*) ====================================== */
async function hwPersist(op) {
  setStatus("正在保存体重记录…");
  const token = await getToken();
  hwEtag = await xtWriteJson(
    token, HEALTH_WEIGHT_FILE, () => ({ records: weightRecords }), hwEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      weightRecords = healthApplyOp(list, op);
    },
    () => hwRender()
  );
  setStatus("已保存。", "ok", 3000);
}

function hwRebuildPersonOptions(selected) {
  const cur = selected != null ? selected : els.hwPerson.value;
  const persons = heaPersons(weightRecords);
  els.hwPerson.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择姓名"; ph.disabled = true;
  els.hwPerson.appendChild(ph);
  for (const p of persons) {
    const o = document.createElement("option"); o.value = p; o.textContent = p;
    els.hwPerson.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = HW_PERSON_CUSTOM; custom.textContent = "＋ 自定义…";
  els.hwPerson.appendChild(custom);
  if (cur && persons.includes(cur)) els.hwPerson.value = cur;
  else if (cur === HW_PERSON_CUSTOM) els.hwPerson.value = HW_PERSON_CUSTOM;
  else els.hwPerson.value = "";
  hwPersonOnChange();
}

function hwPersonValue() {
  return els.hwPerson.value === HW_PERSON_CUSTOM
    ? els.hwPersonCustom.value.trim() : els.hwPerson.value.trim();
}

function hwPersonOnChange() {
  const on = els.hwPerson.value === HW_PERSON_CUSTOM;
  els.hwPersonCustom.classList.toggle("hidden", !on);
  if (on) els.hwPersonCustom.focus();
  else els.hwPersonCustom.value = "";
}

function hwComputeBmi(weight, height) {
  if (weight == null || !height) return null;
  const m = height / 100;
  if (m <= 0) return null;
  return round1(weight / (m * m));
}

function hwUpdateBmiHint() {
  const w = parseFloat(els.hwWeight.value);
  const h = parseFloat(els.hwHeight.value);
  const bmi = hwComputeBmi(isNaN(w) ? null : w, isNaN(h) ? null : Math.round(h));
  els.hwBmiHint.textContent = bmi != null ? "自动计算 BMI：" + bmi : "";
}

function hwResetForm() {
  els.hwForm.reset();
  els.hwEditId.value = "";
  els.hwPerson.value = "";
  els.hwPersonCustom.value = "";
  els.hwPersonCustom.classList.add("hidden");
  els.hwDate.value = todayStr();
  els.hwBmiHint.textContent = "";
  els.hwFormTitle.textContent = "添加体重记录";
  els.hwAddBtn.textContent = "添加并保存";
  hide(els.hwCancelBtn);
}

async function hwOnSubmit(e) {
  e.preventDefault();
  if (!healthLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.hwEditId.value;
  const w = parseFloat(els.hwWeight.value);
  if (isNaN(w)) { setStatus("请输入体重。", "warn"); return; }
  const hv = parseFloat(els.hwHeight.value);
  const height = (els.hwHeight.value.trim() === "" || isNaN(hv)) ? null : Math.round(hv);
  const weight = round1(w);
  const rec = {
    id: els.hwEditId.value || uuid(),
    person: hwPersonValue(),
    date: els.hwDate.value,
    weight: weight,
    height: height,
    bmi: hwComputeBmi(weight, height),
    note: els.hwNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.person) { setStatus("请填写姓名。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = weightRecords.slice();
  if (isEdit) {
    const i = weightRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = weightRecords[i].createdBy || rec.createdBy; weightRecords[i] = rec; }
    else weightRecords.push(rec);
  } else {
    weightRecords.push(rec);
  }
  els.hwAddBtn.disabled = true;
  hwRebuildPersonOptions();
  hwRender();
  try {
    await hwPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    hwResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    weightRecords = snap; hwRebuildPersonOptions(); hwRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.hwAddBtn.disabled = false;
  }
}

function hwStartEdit(id) {
  const r = weightRecords.find((x) => x.id === id);
  if (!r) return;
  els.hwEditId.value = r.id;
  hwRebuildPersonOptions(r.person || "");
  els.hwDate.value = r.date;
  els.hwWeight.value = (r.weight == null ? "" : r.weight);
  els.hwHeight.value = (r.height == null ? "" : r.height);
  els.hwNote.value = r.note || "";
  hwUpdateBmiHint();
  els.hwFormTitle.textContent = "编辑体重记录";
  els.hwAddBtn.textContent = "保存修改";
  show(els.hwCancelBtn);
  hwSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function hwDelete(id) {
  if (!healthLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = weightRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条体重记录吗？\n${r.date} ${r.person} ${r.weight}kg`)) return;
  const snap = weightRecords.slice();
  weightRecords = weightRecords.filter((x) => x.id !== id);
  hwRebuildPersonOptions();
  hwRender();
  try {
    await hwPersist({ type: "delete", id });
  } catch (err) {
    weightRecords = snap; hwRebuildPersonOptions(); hwRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

function hwRender() {
  hwUpdateCurveTabVisibility();
  const monthFilter = hwFilterOn && els.hwFilterDate ? els.hwFilterDate.value.slice(0, 7) : "";
  const q = hwSearchText.trim().toLowerCase();
  let sorted = [...weightRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.person || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (hwShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.hwBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    const wt = (r.weight == null ? "" : r.weight);
    const ht = (r.height == null || r.height === "") ? "" : fmtInt(r.height);
    const bmi = (r.bmi == null || r.bmi === "") ? "" : r.bmi;
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.person || "")}</td>
      <td class="num">${escapeHtml(String(wt))}</td>
      <td class="num">${escapeHtml(ht)}</td>
      <td class="num">${escapeHtml(String(bmi))}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => hwStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => hwDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.hwBody.appendChild(tr);
  }

  const total = weightRecords.length;
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.hwRecordCount.textContent = `${view.length} 条`;
  else if (hwShowAll) els.hwRecordCount.textContent = `显示全部 ${total} 条`;
  else els.hwRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.hwClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.hwShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !hwShowAll));
  els.hwShowAllBtn.textContent = hwShowAll ? "显示50条" : "显示全部";
  els.hwEmptyHint.classList.toggle("hidden", view.length !== 0);
}

function hwRenderChart() {
  const persons = heaPersons(weightRecords);
  if (!hwChartPersonVal || !persons.includes(hwChartPersonVal)) hwChartPersonVal = heaTopPerson(weightRecords);
  els.hwChartPerson.innerHTML = "";
  for (const p of persons) {
    const o = document.createElement("option");
    o.value = p; o.textContent = p; if (p === hwChartPersonVal) o.selected = true;
    els.hwChartPerson.appendChild(o);
  }
  const person = hwChartPersonVal;
  const points = weightRecords
    .filter((r) => (r.person || "").trim() === person)
    .map((r) => ({ t: dateMs(r.date), v: (r.weight == null ? null : Number(r.weight)) }));
  heaRenderLine(
    els.hwChartSvg, els.hwChartLegend, els.hwChartEmpty,
    [{ name: (person || "") + " 体重(kg)", color: "#118DFF", points }],
    (v) => (Math.round(v * 10) / 10).toFixed(1)
  );
}

function hwSwitchTab(name) {
  hwTab = name;
  const tabs = {
    add: { panel: els.hwTabAdd, btn: els.hwTabAddBtn },
    list: { panel: els.hwTabList, btn: els.hwTabListBtn },
    chart: { panel: els.hwTabChart, btn: els.hwTabChartBtn },
    curve: { panel: els.hwTabCurve, btn: els.hwTabCurveBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") hwRenderChart();
  if (name === "curve") hwRenderCurves();
}

/* 2023 版中国女童生长标准 [x, P3, 中位数, P97]（完整 0–7 岁，横轴自动裁剪） */
const GROWTH_STD = {
  ageWeight: [[0,2.7,3.3,4.1],[1,3.5,4.3,5.3],[2,4.4,5.4,6.6],[3,5.1,6.2,7.6],[4,5.6,6.9,8.4],[5,6,7.4,9.1],[6,6.4,7.8,9.6],[7,6.7,8.1,10],[8,6.9,8.4,10.4],[9,7.2,8.7,10.8],[10,7.4,9,11.1],[11,7.6,9.2,11.4],[12,7.7,9.4,11.6],[13,7.9,9.6,11.9],[14,8.1,9.8,12.2],[15,8.3,10,12.4],[16,8.4,10.3,12.7],[17,8.6,10.5,12.9],[18,8.8,10.7,13.2],[19,9,10.9,13.5],[20,9.1,11.1,13.8],[21,9.3,11.3,14],[22,9.5,11.5,14.3],[23,9.7,11.7,14.6],[24,9.8,11.9,14.8],[27,10.3,12.5,15.5],[30,10.7,13,16.2],[33,11.1,13.6,16.9],[36,11.5,14.1,17.7],[39,12,14.7,18.4],[42,12.4,15.2,19.1],[45,12.8,15.7,19.8],[48,13.1,16.2,20.5],[51,13.5,16.7,21.1],[54,13.9,17.2,21.9],[57,14.3,17.8,22.6],[60,14.7,18.4,23.4],[63,15.1,19,24.3],[66,15.5,19.6,25.1],[69,15.9,20.2,26],[72,16.3,20.7,26.8],[75,16.7,21.3,27.6],[78,17,21.8,28.5],[81,17.4,22.4,29.3]],
  ageHeight: [[0,46.8,50.3,53.8],[1,50.4,54.1,57.8],[2,53.8,57.7,61.6],[3,56.7,60.8,64.8],[4,59.1,63.3,67.4],[5,61,65.3,69.6],[6,62.7,67.1,71.5],[7,64.2,68.7,73.1],[8,65.6,70.1,74.7],[9,66.8,71.5,76.1],[10,68.1,72.8,77.5],[11,69.2,74,78.8],[12,70.4,75.2,80.1],[13,71.4,76.4,81.4],[14,72.5,77.5,82.6],[15,73.5,78.6,83.8],[16,74.6,79.7,84.9],[17,75.5,80.8,86.1],[18,76.5,81.9,87.2],[19,77.5,82.9,88.3],[20,78.4,83.9,89.4],[21,79.3,84.9,90.4],[22,80.2,85.8,91.5],[23,81.1,86.8,92.5],[24,81.2,87,92.8],[27,83.6,89.5,95.5],[30,85.7,91.9,98.1],[33,87.7,94.1,100.5],[36,89.7,96.2,102.7],[39,91.5,98.2,104.9],[42,93.2,100.1,106.9],[45,94.9,101.9,108.9],[48,96.5,103.7,110.9],[51,98.1,105.4,112.8],[54,99.7,107.2,114.7],[57,101.3,109,116.7],[60,103,110.8,118.6],[63,104.6,112.6,120.6],[66,106.1,114.3,122.4],[69,107.6,115.9,124.2],[72,109,117.5,126],[75,110.4,119.1,127.7],[78,111.8,120.6,129.4],[81,113.2,122.1,131]],
  htWeight02: [[45,2,2.3,2.8],[46,2.1,2.5,3],[47,2.3,2.7,3.2],[48,2.5,2.9,3.4],[49,2.6,3.1,3.6],[50,2.8,3.3,3.9],[51,3,3.5,4.2],[52,3.2,3.8,4.5],[53,3.4,4,4.8],[54,3.7,4.3,5.1],[55,3.9,4.6,5.4],[56,4.2,4.9,5.8],[57,4.4,5.1,6.1],[58,4.6,5.4,6.4],[59,4.9,5.7,6.8],[60,5.1,6,7.1],[61,5.3,6.2,7.4],[62,5.6,6.5,7.7],[63,5.8,6.8,8],[64,6,7,8.3],[65,6.2,7.3,8.6],[66,6.5,7.5,8.9],[67,6.7,7.7,9.2],[68,6.9,8,9.4],[69,7.1,8.2,9.7],[70,7.2,8.4,9.9],[71,7.4,8.6,10.2],[72,7.6,8.8,10.4],[73,7.8,9,10.6],[74,8,9.2,10.9],[75,8.1,9.4,11.1],[76,8.3,9.6,11.3],[77,8.5,9.8,11.5],[78,8.6,9.9,11.7],[79,8.8,10.1,11.9],[80,9,10.3,12.2],[81,9.2,10.5,12.4],[82,9.3,10.7,12.6],[83,9.5,10.9,12.8],[84,9.7,11.1,13.1],[85,9.9,11.3,13.3],[86,10.1,11.6,13.6],[87,10.3,11.8,13.8],[88,10.5,12,14.1],[89,10.7,12.2,14.3],[90,10.9,12.4,14.6],[91,11.1,12.7,14.8],[92,11.3,12.9,15.1],[93,11.5,13.1,15.4],[94,11.7,13.4,15.7],[95,11.9,13.6,16],[96,12.1,13.9,16.3],[97,12.4,14.1,16.6],[98,12.6,14.4,16.9],[99,12.8,14.7,17.2],[100,13.1,14.9,17.5]],
  htWeight27: [[75,8.3,9.5,11.2],[76,8.4,9.7,11.4],[77,8.6,9.9,11.7],[78,8.8,10.1,11.9],[79,8.9,10.3,12.1],[80,9.1,10.5,12.3],[81,9.3,10.7,12.5],[82,9.5,10.9,12.8],[83,9.7,11.1,13],[84,9.8,11.3,13.2],[85,10,11.5,13.5],[86,10.2,11.7,13.7],[87,10.4,11.9,14],[88,10.6,12.1,14.2],[89,10.8,12.4,14.5],[90,11,12.6,14.8],[91,11.2,12.8,15],[92,11.4,13.1,15.3],[93,11.6,13.3,15.6],[94,11.8,13.5,15.9],[95,12.1,13.8,16.2],[96,12.3,14.1,16.5],[97,12.5,14.3,16.8],[98,12.8,14.6,17.1],[99,13,14.9,17.4],[100,13.2,15.1,17.8],[101,13.5,15.4,18.1],[102,13.7,15.7,18.4],[103,13.9,16,18.8],[104,14.2,16.3,19.1],[105,14.4,16.5,19.5],[106,14.7,16.8,19.8],[107,14.9,17.1,20.2],[108,15.1,17.4,20.6],[109,15.4,17.8,21],[110,15.7,18.1,21.4],[111,15.9,18.4,21.8],[112,16.2,18.8,22.3],[113,16.5,19.1,22.8],[114,16.7,19.5,23.3],[115,17,19.9,23.8],[116,17.3,20.3,24.4],[117,17.6,20.7,24.9],[118,17.9,21.1,25.5],[119,18.2,21.5,26.1],[120,18.5,22,26.8],[121,18.9,22.4,27.4],[122,19.2,22.9,28.1],[123,19.5,23.4,28.8],[124,19.9,23.8,29.5],[125,20.2,24.3,30.2],[126,20.5,24.8,30.9],[127,20.9,25.3,31.7],[128,21.2,25.8,32.4],[129,21.5,26.3,33.1],[130,21.8,26.8,33.9]],
};
const CLOUD_BIRTH_MS = Date.UTC(2025, 6, 3); // 2025-07-03

// 通用数值 XY 折线图：series=[{name,color,points:[{x,y}],dashed,thin,showDots}]
function heaRenderXY(svgEl, legendEl, emptyEl, series, opts) {
  opts = opts || {};
  const fmtX = opts.fmtX || ((x) => String(Math.round(x)));
  const fmtY = opts.fmtY || ((y) => (Math.round(y * 10) / 10).toFixed(1));
  const clean = series
    .map((s) => ({
      name: s.name, color: s.color, dashed: !!s.dashed, thin: !!s.thin,
      showDots: s.showDots !== false,
      points: (s.points || [])
        .filter((p) => p.x != null && p.y != null && !isNaN(p.x) && !isNaN(p.y))
        .sort((a, b) => a.x - b.x),
    }))
    .filter((s) => s.points.length);
  const dataSeries = clean.filter((s) => !s.thin);
  const any = dataSeries.length > 0;
  if (emptyEl) emptyEl.classList.toggle("hidden", any);
  if (legendEl) legendEl.innerHTML = "";
  if (!any) { svgEl.innerHTML = ""; return; }

  const W = 760, H = 320, padL = 46, padR = 14, padT = 14, padB = 38;
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let xs = [], ys = [];
  for (const s of clean) for (const p of s.points) { xs.push(p.x); ys.push(p.y); }
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  const yPad = (yMax - yMin) * 0.12 || Math.max(1, Math.abs(yMax) * 0.1);
  yMin -= yPad; yMax += yPad;
  const xOf = (x) => padL + (x - xMin) / (xMax - xMin) * (W - padL - padR);
  const yOf = (y) => H - padB - (y - yMin) / (yMax - yMin) * (H - padT - padB);

  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const y = yMin + (i / 4) * (yMax - yMin);
    const yy = yOf(y);
    svg += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="lc-grid"/>`;
    svg += `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" class="lc-ylabel">${fmtY(y)}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const x = xMin + (i / 4) * (xMax - xMin);
    const xx = xOf(x);
    svg += `<text x="${xx.toFixed(1)}" y="${H - padB + 16}" class="lc-xlabel">${fmtX(x)}</text>`;
  }
  if (opts.xLabel) {
    svg += `<text x="${((padL + W - padR) / 2).toFixed(1)}" y="${H - 4}" class="lc-xlabel">${escapeHtml(opts.xLabel)}</text>`;
  }
  for (const s of clean) {
    const pts = s.points.map((p) => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(" ");
    const cls = s.thin ? "lc-line lc-ref" : "lc-line";
    const dash = s.dashed ? ' stroke-dasharray="4 3"' : "";
    const sw = s.thin ? ' stroke-width="1"' : ' stroke-width="2.4"';
    svg += `<polyline class="${cls}" points="${pts}" style="stroke:${s.color}"${dash}${sw}/>`;
    if (s.showDots) {
      for (const p of s.points) {
        svg += `<circle cx="${xOf(p.x).toFixed(1)}" cy="${yOf(p.y).toFixed(1)}" r="2.6" style="fill:${s.color}"/>`;
      }
    }
  }
  svgEl.innerHTML = svg;

  if (legendEl) {
    for (const s of clean) {
      legendEl.insertAdjacentHTML("beforeend",
        `<span class="ll-item"><span class="ll-dot" style="background:${s.color}"></span>` +
        `${escapeHtml(s.name)}</span>`);
    }
  }
}

function hwRefSeries(rows) {
  return [
    { name: "P3", color: "#9aa0a6", thin: true, dashed: true, showDots: false,
      points: rows.map((r) => ({ x: r[0], y: r[1] })) },
    { name: "中位数", color: "#5f6368", thin: true, showDots: false,
      points: rows.map((r) => ({ x: r[0], y: r[2] })) },
    { name: "P97", color: "#9aa0a6", thin: true, dashed: true, showDots: false,
      points: rows.map((r) => ({ x: r[0], y: r[3] })) },
  ];
}

// 只保留 [lo, hi] 窗口内的标准行，并各向外多带一行让参考线延伸到边缘
function hwClipRows(rows, lo, hi) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i][0];
    if (x >= lo && x <= hi) out.push(rows[i]);
    else if (x < lo && i + 1 < rows.length && rows[i + 1][0] >= lo) out.push(rows[i]);
    else if (x > hi && i > 0 && rows[i - 1][0] <= hi) out.push(rows[i]);
  }
  return out;
}

function hwRenderCurves() {
  const recs = weightRecords.filter((r) => (r.person || "").trim() === "Cloud");
  const ageOf = (r) => (dateMs(r.date) - CLOUD_BIRTH_MS) / (30.4375 * 86400000);
  const awPts = recs
    .filter((r) => r.weight != null)
    .map((r) => ({ x: ageOf(r), y: Number(r.weight) }))
    .filter((p) => p.x >= 0);
  const ahPts = recs
    .filter((r) => r.height != null)
    .map((r) => ({ x: ageOf(r), y: Number(r.height) }))
    .filter((p) => p.x >= 0);
  const hwPts = recs
    .filter((r) => r.height != null && r.weight != null)
    .map((r) => ({ x: Number(r.height), y: Number(r.weight) }));

  // 年龄横轴窗口：随云朵成长自动扩展（24→81 月），下限 0
  const ages = awPts.concat(ahPts).map((p) => p.x);
  const maxAge = ages.length ? Math.max(...ages) : 0;
  const ageWin = Math.min(81, Math.max(24, Math.ceil(maxAge) + 3));

  heaRenderXY(els.hwcAwSvg, els.hwcAwLegend, els.hwcAwEmpty,
    hwRefSeries(hwClipRows(GROWTH_STD.ageWeight, 0, ageWin)).concat([
      { name: "云朵 体重(kg)", color: "#118DFF", points: awPts }]),
    { fmtX: (x) => Math.round(x) + "月", fmtY: (y) => y.toFixed(1), xLabel: "月龄" });

  heaRenderXY(els.hwcAhSvg, els.hwcAhLegend, els.hwcAhEmpty,
    hwRefSeries(hwClipRows(GROWTH_STD.ageHeight, 0, ageWin)).concat([
      { name: "云朵 身高(cm)", color: "#118DFF", points: ahPts }]),
    { fmtX: (x) => Math.round(x) + "月", fmtY: (y) => y.toFixed(0), xLabel: "月龄" });

  // 体重–身高：按月龄 24 月切换标准块，再按云朵身高范围裁剪
  const htRows = maxAge < 24 ? GROWTH_STD.htWeight02 : GROWTH_STD.htWeight27;
  const hs = hwPts.map((p) => p.x);
  const htLo = hs.length ? Math.min(...hs) - 3 : -Infinity;
  const htHi = hs.length ? Math.max(...hs) + 3 : Infinity;
  heaRenderXY(els.hwcHwSvg, els.hwcHwLegend, els.hwcHwEmpty,
    hwRefSeries(hwClipRows(htRows, htLo, htHi)).concat([
      { name: "云朵 体重(kg)", color: "#118DFF", points: hwPts }]),
    { fmtX: (x) => Math.round(x) + "cm", fmtY: (y) => y.toFixed(1), xLabel: "身高(cm)" });
}

function hwUpdateCurveTabVisibility() {
  const show = hwChartPersonVal === "Cloud" || heaPersons(weightRecords).includes("Cloud");
  if (els.hwTabCurveBtn) els.hwTabCurveBtn.classList.toggle("hidden", !show);
  if (!show && hwTab === "curve") hwSwitchTab("list");
}


/* ======================= 血压 (hb*) ====================================== */
async function hbPersist(op) {
  setStatus("正在保存血压记录…");
  const token = await getToken();
  hbEtag = await xtWriteJson(
    token, HEALTH_BP_FILE, () => ({ records: bpRecords }), hbEtag,
    (fresh) => {
      const list = (fresh && Array.isArray(fresh.records)) ? fresh.records : [];
      bpRecords = healthApplyOp(list, op);
    },
    () => hbRender()
  );
  setStatus("已保存。", "ok", 3000);
}

function hbRebuildPersonOptions(selected) {
  const cur = selected != null ? selected : els.hbPerson.value;
  const persons = heaPersons(bpRecords);
  els.hbPerson.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "请选择姓名"; ph.disabled = true;
  els.hbPerson.appendChild(ph);
  for (const p of persons) {
    const o = document.createElement("option"); o.value = p; o.textContent = p;
    els.hbPerson.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = HB_PERSON_CUSTOM; custom.textContent = "＋ 自定义…";
  els.hbPerson.appendChild(custom);
  if (cur && persons.includes(cur)) els.hbPerson.value = cur;
  else if (cur === HB_PERSON_CUSTOM) els.hbPerson.value = HB_PERSON_CUSTOM;
  else els.hbPerson.value = "";
  hbPersonOnChange();
}

function hbPersonValue() {
  return els.hbPerson.value === HB_PERSON_CUSTOM
    ? els.hbPersonCustom.value.trim() : els.hbPerson.value.trim();
}

function hbPersonOnChange() {
  const on = els.hbPerson.value === HB_PERSON_CUSTOM;
  els.hbPersonCustom.classList.toggle("hidden", !on);
  if (on) els.hbPersonCustom.focus();
  else els.hbPersonCustom.value = "";
}

function hbResetForm() {
  els.hbForm.reset();
  els.hbEditId.value = "";
  els.hbPerson.value = "";
  els.hbPersonCustom.value = "";
  els.hbPersonCustom.classList.add("hidden");
  els.hbDate.value = todayStr();
  els.hbFormTitle.textContent = "添加血压记录";
  els.hbAddBtn.textContent = "添加并保存";
  hide(els.hbCancelBtn);
}

function hbOptInt(el) {
  const v = parseFloat(el.value);
  return (el.value.trim() === "" || isNaN(v)) ? null : Math.round(v);
}

async function hbOnSubmit(e) {
  e.preventDefault();
  if (!healthLoaded) { setStatus("数据尚未载入完成，请稍候再保存。", "warn"); return; }
  const isEdit = !!els.hbEditId.value;
  const sys = parseFloat(els.hbSystolic.value);
  const dia = parseFloat(els.hbDiastolic.value);
  if (isNaN(sys) || isNaN(dia)) { setStatus("请输入收缩压和舒张压。", "warn"); return; }
  const rec = {
    id: els.hbEditId.value || uuid(),
    person: hbPersonValue(),
    date: els.hbDate.value,
    systolic: Math.round(sys),
    diastolic: Math.round(dia),
    pulse: hbOptInt(els.hbPulse),
    note: els.hbNote.value.trim(),
    createdBy: (account && (account.name || account.username)) || "",
    modified: new Date().toISOString(),
  };
  if (!rec.person) { setStatus("请填写姓名。", "warn"); return; }
  if (!rec.date) { setStatus("请选择日期。", "warn"); return; }

  const snap = bpRecords.slice();
  if (isEdit) {
    const i = bpRecords.findIndex((r) => r.id === rec.id);
    if (i >= 0) { rec.createdBy = bpRecords[i].createdBy || rec.createdBy; bpRecords[i] = rec; }
    else bpRecords.push(rec);
  } else {
    bpRecords.push(rec);
  }
  els.hbAddBtn.disabled = true;
  hbRebuildPersonOptions();
  hbRender();
  try {
    await hbPersist(isEdit ? { type: "edit", rec } : { type: "add", rec });
    hbResetForm();
    setStatus(isEdit ? "已保存修改。" : "已添加并保存。", "ok", 3000);
  } catch (err) {
    bpRecords = snap; hbRebuildPersonOptions(); hbRender();
    setStatus("保存出错：" + (err.message || err), "error");
  } finally {
    els.hbAddBtn.disabled = false;
  }
}

function hbStartEdit(id) {
  const r = bpRecords.find((x) => x.id === id);
  if (!r) return;
  els.hbEditId.value = r.id;
  hbRebuildPersonOptions(r.person || "");
  els.hbDate.value = r.date;
  els.hbSystolic.value = (r.systolic == null ? "" : r.systolic);
  els.hbDiastolic.value = (r.diastolic == null ? "" : r.diastolic);
  els.hbPulse.value = (r.pulse == null ? "" : r.pulse);
  els.hbNote.value = r.note || "";
  els.hbFormTitle.textContent = "编辑血压记录";
  els.hbAddBtn.textContent = "保存修改";
  show(els.hbCancelBtn);
  hbSwitchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function hbDelete(id) {
  if (!healthLoaded) { setStatus("数据尚未载入完成，请稍候再操作。", "warn"); return; }
  const r = bpRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除这条血压记录吗？\n${r.date} ${r.person} ${r.systolic}/${r.diastolic}`)) return;
  const snap = bpRecords.slice();
  bpRecords = bpRecords.filter((x) => x.id !== id);
  hbRebuildPersonOptions();
  hbRender();
  try {
    await hbPersist({ type: "delete", id });
  } catch (err) {
    bpRecords = snap; hbRebuildPersonOptions(); hbRender();
    setStatus("删除失败：" + (err.message || err), "error");
  }
}

function hbRender() {
  const monthFilter = hbFilterOn && els.hbFilterDate ? els.hbFilterDate.value.slice(0, 7) : "";
  const q = hbSearchText.trim().toLowerCase();
  let sorted = [...bpRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (q) {
    sorted = sorted.filter((r) =>
      (r.person || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q));
  }
  let view, limited = false;
  if (monthFilter) view = sorted.filter((r) => (r.date || "").slice(0, 7) === monthFilter);
  else if (hbShowAll || q) view = sorted;
  else { view = sorted.slice(0, PAGE_LIMIT); limited = sorted.length > PAGE_LIMIT; }

  els.hbBody.innerHTML = "";
  let prevDate = null, dateBand = 0;
  for (const r of view) {
    if (r.date !== prevDate) { if (prevDate !== null) dateBand ^= 1; prevDate = r.date; }
    const tr = document.createElement("tr");
    tr.className = dateBand ? "date-band-b" : "date-band-a";
    tr.dataset.date = r.date || "";
    const pulse = (r.pulse == null || r.pulse === "") ? "" : fmtInt(r.pulse);
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.person || "")}</td>
      <td class="num">${escapeHtml(String(r.systolic == null ? "" : r.systolic))}</td>
      <td class="num">${escapeHtml(String(r.diastolic == null ? "" : r.diastolic))}</td>
      <td class="num">${escapeHtml(pulse)}</td>
      <td>${escapeHtml(r.note || "")}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector(".actions");
    const editB = document.createElement("button");
    editB.className = "btn btn-mini"; editB.textContent = "编辑";
    editB.onclick = () => hbStartEdit(r.id);
    const delB = document.createElement("button");
    delB.className = "btn btn-mini btn-danger"; delB.textContent = "删除";
    delB.onclick = () => hbDelete(r.id);
    actions.appendChild(editB); actions.appendChild(delB);
    els.hbBody.appendChild(tr);
  }

  const total = bpRecords.length;
  const anyFilter = !!monthFilter || !!q;
  if (anyFilter) els.hbRecordCount.textContent = `${view.length} 条`;
  else if (hbShowAll) els.hbRecordCount.textContent = `显示全部 ${total} 条`;
  else els.hbRecordCount.textContent = limited ? `显示最近 ${view.length} 条（共 ${total} 条）` : `共 ${total} 条`;

  els.hbClearFilterBtn.classList.toggle("hidden", !anyFilter);
  els.hbShowAllBtn.classList.toggle("hidden", anyFilter || (!limited && !hbShowAll));
  els.hbShowAllBtn.textContent = hbShowAll ? "显示50条" : "显示全部";
  els.hbEmptyHint.classList.toggle("hidden", view.length !== 0);
}

function hbRenderChart() {
  const persons = heaPersons(bpRecords);
  if (!hbChartPersonVal || !persons.includes(hbChartPersonVal)) hbChartPersonVal = heaTopPerson(bpRecords);
  els.hbChartPerson.innerHTML = "";
  for (const p of persons) {
    const o = document.createElement("option");
    o.value = p; o.textContent = p; if (p === hbChartPersonVal) o.selected = true;
    els.hbChartPerson.appendChild(o);
  }
  const person = hbChartPersonVal;
  const mine = bpRecords.filter((r) => (r.person || "").trim() === person);
  const sysPts = mine.map((r) => ({ t: dateMs(r.date), v: (r.systolic == null ? null : Number(r.systolic)) }));
  const diaPts = mine.map((r) => ({ t: dateMs(r.date), v: (r.diastolic == null ? null : Number(r.diastolic)) }));
  const pulPts = mine.map((r) => ({ t: dateMs(r.date), v: (r.pulse == null ? null : Number(r.pulse)) }));
  heaRenderLine(
    els.hbChartSvg, els.hbChartLegend, els.hbChartEmpty,
    [
      { name: "收缩压", color: "#D64550", points: sysPts },
      { name: "舒张压", color: "#118DFF", points: diaPts },
      { name: "脉搏", color: "#12B76A", points: pulPts },
    ],
    (v) => String(Math.round(v))
  );
}

function hbSwitchTab(name) {
  hbTab = name;
  const tabs = {
    add: { panel: els.hbTabAdd, btn: els.hbTabAddBtn },
    list: { panel: els.hbTabList, btn: els.hbTabListBtn },
    chart: { panel: els.hbTabChart, btn: els.hbTabChartBtn },
  };
  for (const k in tabs) {
    const active = k === name;
    if (tabs[k].panel) tabs[k].panel.classList.toggle("hidden", !active);
    if (tabs[k].btn) tabs[k].btn.classList.toggle("active", active);
  }
  if (name === "chart") hbRenderChart();
}

/* --------------------------- 健康 wiring --------------------------------- */
function heaWireEvents() {
  els.heaSubWeightBtn.onclick = () => heaSwitchSub("weight");
  els.heaSubBpBtn.onclick = () => heaSwitchSub("bp");

  // 体重
  els.hwTabAddBtn.onclick = () => hwSwitchTab("add");
  els.hwTabListBtn.onclick = () => hwSwitchTab("list");
  els.hwTabChartBtn.onclick = () => hwSwitchTab("chart");
  els.hwTabCurveBtn.onclick = () => hwSwitchTab("curve");
  els.hwForm.addEventListener("submit", hwOnSubmit);
  els.hwCancelBtn.onclick = hwResetForm;
  els.hwPerson.addEventListener("change", hwPersonOnChange);
  els.hwWeight.addEventListener("input", hwUpdateBmiHint);
  els.hwHeight.addEventListener("input", hwUpdateBmiHint);
  els.hwFilterDate.addEventListener("change", () => {
    hwFilterOn = true; hwShowAll = false; hwRender(); els.hwFilterDate.blur();
  });
  els.hwSearchInput.addEventListener("input", () => { hwSearchText = els.hwSearchInput.value; hwRender(); });
  els.hwClearFilterBtn.onclick = () => {
    hwFilterOn = false; hwSearchText = ""; els.hwSearchInput.value = "";
    els.hwFilterDate.value = todayStr(); hwRender();
  };
  els.hwShowAllBtn.onclick = () => { hwShowAll = !hwShowAll; hwRender(); };
  els.hwChartPerson.onchange = () => { hwChartPersonVal = els.hwChartPerson.value; hwRenderChart(); };

  // 血压
  els.hbTabAddBtn.onclick = () => hbSwitchTab("add");
  els.hbTabListBtn.onclick = () => hbSwitchTab("list");
  els.hbTabChartBtn.onclick = () => hbSwitchTab("chart");
  els.hbForm.addEventListener("submit", hbOnSubmit);
  els.hbCancelBtn.onclick = hbResetForm;
  els.hbPerson.addEventListener("change", hbPersonOnChange);
  els.hbFilterDate.addEventListener("change", () => {
    hbFilterOn = true; hbShowAll = false; hbRender(); els.hbFilterDate.blur();
  });
  els.hbSearchInput.addEventListener("input", () => { hbSearchText = els.hbSearchInput.value; hbRender(); });
  els.hbClearFilterBtn.onclick = () => {
    hbFilterOn = false; hbSearchText = ""; els.hbSearchInput.value = "";
    els.hbFilterDate.value = todayStr(); hbRender();
  };
  els.hbShowAllBtn.onclick = () => { hbShowAll = !hbShowAll; hbRender(); };
  els.hbChartPerson.onchange = () => { hbChartPersonVal = els.hbChartPerson.value; hbRenderChart(); };
}

/* ========================================================================= *
 *                       生活博客 (blog*)                                     *
 *   Private Markdown journal stored in its own OneDrive folder:             *
 *     blog-index.json  +  posts/<id>.md  +  images/<file>                    *
 * ========================================================================= */
let blogDriveBase = "";
let blogPosts = [];          // index entries [{id,title,date,excerpt,searchText,images}]
let blogIndexEtag = null;
let blogLoaded = false;
let blogLoadPromise = null;
 let blogViewId = null;       // id currently open in 阅读
let blogSearchText = "";
let blogTagFilter = "";
let blogSummaries = [];      // read-only virtual entries from summaries/ folder
const blogImgCache = {};     // "images/x.jpg" -> object URL
let blogCommentsData = [];
let blogCommentsEtag = null;
let blogCommentsFolderReady = false;
let blogCommentSaving = false;
let blogCommentOriginalContent = "";
let blogListReturnState = null;
let blogUnreadComments = [];
let blogReadCommentIds = new Set();
let blogReadReceiptEtag = null;
let blogReminderTitles = new Map();
let blogCommentObserver = null;
const BLOG_POSITION_KEY = "familyTrackerBlogPositions";
function blogLoadPositions() { try { return JSON.parse(sessionStorage.getItem(BLOG_POSITION_KEY) || "{}") || {}; } catch { return {}; } }
function blogSavePositions(state) { try { sessionStorage.setItem(BLOG_POSITION_KEY, JSON.stringify(state)); } catch {} }
function blogCapturePosition(section) {
  const state = blogLoadPositions();
  if (section === "list") state.list = { scrollY: window.scrollY, page: blogListPage, search: blogSearchText, tag: blogTagFilter };
  else if (section === "view" && blogViewId) { state.views = state.views || {}; state.views[blogViewId] = window.scrollY; }
  else if (section === "forum") state.forum = { scrollY: window.scrollY, page: forumListPage, search: forumSearchText, topicId: forumCurTopicId, subview: els.forumTopicView.classList.contains("hidden") ? "list" : "view" };
  blogSavePositions(state);
}
function blogRestorePosition(section) {
  const state = blogLoadPositions();
  let pos = null;
  if (section === "list" && state.list) { blogListPage = state.list.page || 0; blogSearchText = state.list.search || ""; blogTagFilter = state.list.tag || ""; els.blogSearch.value = blogSearchText; blogRenderList(); pos = state.list.scrollY; }
  else if (section === "view" && blogViewId && state.views) pos = state.views[blogViewId];
  else if (section === "forum" && state.forum) { forumListPage = state.forum.page || 0; forumSearchText = state.forum.search || ""; els.forumSearch.value = forumSearchText; forumRenderList(); pos = state.forum.scrollY; }
  if (pos != null) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: pos, behavior: "auto" })));
}
function blogActiveSection() {
  if (!els.blogTabList.classList.contains("hidden")) return "list";
  if (!els.blogTabView.classList.contains("hidden")) return "view";
  if (!els.blogTabForum.classList.contains("hidden")) return "forum";
  return "edit";
}
let summaryModel = SUMMARY_MODEL_DEFAULT;
let summarySettingsEtag = null;
let summarySettingsLoaded = false;
const BLOG_LIST_PAGE_SIZE = 20;
let blogListPage = 0;

function formatBeijingTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(/\//g, "-");
}

// All list entries = editable posts + read-only auto summaries.
function blogAllEntries() { return blogPosts.concat(blogSummaries); }
function blogNormalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,;，；]/);
  return values.map((tag) => String(tag).trim()).filter((tag, i, arr) => tag && arr.indexOf(tag) === i);
}
async function blogLoadTagCandidates(token) {
  const res = await fetch(blogContentUrl(BLOG_TAGS_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) {
    blogTagCandidates = [...new Set(blogPosts.flatMap((p) => blogNormalizeTags(p.tags)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    blogTagsEtag = null; return;
  }
  if (!res.ok) throw new Error("载入标签失败：" + res.status);
  let data = null; try { data = await res.json(); } catch {}
  blogTagCandidates = blogNormalizeTags(data && data.tags).sort((a, b) => a.localeCompare(b, "zh-CN"));
  blogTagsEtag = res.headers.get("ETag");
}
async function blogSaveTagCandidates() {
  const token = await getToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (blogTagsEtag) headers["If-Match"] = blogTagsEtag;
    const res = await fetch(blogContentUrl(BLOG_TAGS_FILE), { method: "PUT", headers, body: JSON.stringify({ tags: blogTagCandidates }) });
    if (res.ok) { blogTagsEtag = (await res.json()).eTag || null; return; }
    if (res.status === 412) {
      const fresh = await fetch(blogContentUrl(BLOG_TAGS_FILE), { headers: { Authorization: "Bearer " + token } });
      let data = null; try { data = await fresh.json(); } catch {}
      const remote = blogNormalizeTags(data && data.tags);
      blogTagCandidates = [...new Set(remote.concat(blogTagCandidates))].sort((a, b) => a.localeCompare(b, "zh-CN"));
      blogTagsEtag = fresh.headers.get("ETag"); continue;
    }
    throw new Error("保存标签失败：" + res.status);
  }
}
async function blogDeleteTagCandidate(tag) {
  const token = await getToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(blogContentUrl(BLOG_TAGS_FILE), { headers: { Authorization: "Bearer " + token } });
    let remote = [];
    if (res.ok) { let data = null; try { data = await res.json(); } catch {} remote = blogNormalizeTags(data && data.tags); }
    else if (res.status !== 404) throw new Error("载入标签失败：" + res.status);
    const next = remote.filter((x) => x !== tag);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const etag = res.headers.get("ETag"); if (etag) headers["If-Match"] = etag;
    const put = await fetch(blogContentUrl(BLOG_TAGS_FILE), { method: "PUT", headers, body: JSON.stringify({ tags: next }) });
    if (put.ok) { blogTagCandidates = next; blogTagsEtag = (await put.json()).eTag || null; blogRenderTagOptions(); return; }
    if (put.status === 409 || put.status === 412) continue;
    throw new Error("删除标签失败：" + put.status);
  }
  throw new Error("删除标签冲突，重试多次仍失败。");
}
function blogRenderTagChips(container, tags, clickable) {
  container.innerHTML = "";
  blogNormalizeTags(tags).forEach((tag) => {
    const chip = document.createElement(clickable ? "button" : "span");
    if (clickable) chip.type = "button";
    chip.className = "blog-tag"; chip.textContent = tag;
    if (clickable) chip.onclick = (e) => { e.stopPropagation(); blogSetTagFilter(tag); };
    container.appendChild(chip);
  });
}
function blogSetTagFilter(tag) {
  blogTagFilter = tag || ""; blogListPage = 0;
  clearDeepLink();
  blogSwitchTab("list"); blogRenderList(); window.scrollTo({ top: 0, behavior: "auto" });
}
function blogRenderTagOptions() {
  const options = [...new Set(blogTagCandidates.concat([...blogSelectedTags]))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.blogTagOptions.innerHTML = "";
  options.forEach((tag) => {
    const row = document.createElement("div"); row.className = "blog-tag-option";
    const label = document.createElement("label");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = blogSelectedTags.has(tag);
    cb.onchange = () => { if (cb.checked) blogSelectedTags.add(tag); else blogSelectedTags.delete(tag); blogUpdateTagToggle(); };
    label.appendChild(cb); label.appendChild(document.createTextNode(tag)); row.appendChild(label);
    if (blogTagCandidates.includes(tag)) {
      const del = document.createElement("button"); del.type = "button"; del.className = "blog-tag-option-delete"; del.textContent = "×"; del.title = "删除候选标签";
      del.onclick = async () => { try { await blogDeleteTagCandidate(tag); } catch (e) { setStatus(e.message || String(e), "error"); } };
      row.appendChild(del);
    }
    els.blogTagOptions.appendChild(row);
  });
  blogUpdateTagToggle();
}
function blogUpdateTagToggle() {
  const tags = [...blogSelectedTags];
  els.blogTagToggle.textContent = tags.length === 0 ? "选择标签" : tags.length <= 2 ? tags.join("、") : "已选 " + tags.length + " 个标签";
}
async function blogAddTagCandidate() {
  const tag = els.blogTagNewInput.value.trim(); if (!tag) return;
  if (!blogTagCandidates.includes(tag)) blogTagCandidates.push(tag);
  blogTagCandidates.sort((a, b) => a.localeCompare(b, "zh-CN")); blogSelectedTags.add(tag);
  els.blogTagNewInput.value = ""; blogRenderTagOptions();
  try { await blogSaveTagCandidates(); } catch (e) { setStatus(e.message || String(e), "error"); }
}

// ---- folder + file addressing (own driveBase from BLOG_FOLDER_SHARE_URL) --
async function blogResolveFolder(token) {
  if (blogDriveBase) return;
  const sid = encodeShareUrl(BLOG_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问博客文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  blogDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function blogEncPath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}
function blogContentUrl(path) {
  return `${blogDriveBase}:/${blogEncPath(path)}:/content`;
}

// ---- raw text (Markdown) read/write --------------------------------------
async function blogReadText(token, path) {
  const res = await fetch(blogContentUrl(path), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("载入失败(" + path + ")：" + res.status);
  return await res.text();
}
async function blogWriteText(token, path, text) {
  const res = await fetch(blogContentUrl(path), {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/plain; charset=utf-8" },
    body: text,
  });
  if (!res.ok) throw new Error("保存失败(" + path + ")：" + res.status + " " + (await res.text()));
}

async function loadSummarySettings(token) {
  const res = await fetch(blogContentUrl(SUMMARY_SETTINGS_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) {
    summaryModel = SUMMARY_MODEL_DEFAULT; summarySettingsEtag = null; summarySettingsLoaded = true;
  } else if (res.ok) {
    let data = null; try { data = await res.json(); } catch {}
    summaryModel = String(data && data.model || SUMMARY_MODEL_DEFAULT).trim() || SUMMARY_MODEL_DEFAULT;
    summarySettingsEtag = res.headers.get("ETag"); summarySettingsLoaded = true;
  } else {
    summaryModel = SUMMARY_MODEL_DEFAULT; summarySettingsLoaded = true;
    throw new Error("载入总结模型失败：" + res.status);
  }
  renderSummaryModelSetting();
}

function renderSummaryModelSetting() {
  if (!els.summaryModelInput) return;
  els.summaryModelInput.value = summaryModel;
  els.summaryModelHint.textContent = "当前模型：" + summaryModel;
  updateSummaryModelSaveState();
}

function updateSummaryModelSaveState() {
  if (!els.summaryModelSaveBtn) return;
  const value = els.summaryModelInput.value.trim();
  els.summaryModelSaveBtn.disabled = !summarySettingsLoaded || !value || value === summaryModel;
}

async function saveSummaryModel() {
  const model = els.summaryModelInput.value.trim();
  if (!model) return;
  els.summaryModelSaveBtn.disabled = true;
  try {
    const token = await getToken(); await blogResolveFolder(token);
    let etag = summarySettingsEtag;
    for (let attempt = 0; attempt < 4; attempt++) {
      const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
      if (etag) headers["If-Match"] = etag;
      const res = await fetch(blogContentUrl(SUMMARY_SETTINGS_FILE), {
        method: "PUT", headers,
        body: JSON.stringify({ model, modified: new Date().toISOString() }),
      });
      if (res.ok) {
        const item = await res.json();
        summaryModel = model; summarySettingsEtag = item.eTag || null;
        renderSummaryModelSetting(); setStatus("总结模型已保存。", "ok", 2500); return;
      }
      if (res.status === 412) {
        const fresh = await fetch(blogContentUrl(SUMMARY_SETTINGS_FILE), { headers: { Authorization: "Bearer " + token } });
        etag = fresh.headers.get("ETag"); continue;
      }
      throw new Error("保存总结模型失败：" + res.status + " " + (await res.text()));
    }
    throw new Error("保存总结模型冲突，重试多次仍失败。");
  } catch (e) { setStatus(e.message || String(e), "error", 6000); }
  finally { updateSummaryModelSaveState(); }
}
async function blogDeleteFile(token, path) {
  const res = await fetch(`${blogDriveBase}:/${blogEncPath(path)}`, {
    method: "DELETE", headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok && res.status !== 404) throw new Error("删除失败(" + path + ")：" + res.status);
}

function blogCommentFileName(articleId) {
  return encodeURIComponent(String(articleId || "")).replace(/%/g, "_") + ".json";
}
function blogCommentPath(articleId) { return "comments/" + blogCommentFileName(articleId); }
function blogReceiptFileName() {
  const id = String((account && account.username) || "unknown").toLowerCase();
  return encodeURIComponent(id).replace(/%/g, "_") + ".json";
}
async function blogReadReceipt(token) {
  const path = "comment-read/" + blogReceiptFileName();
  const res = await fetch(blogContentUrl(path), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) { blogReadCommentIds = new Set(); blogReadReceiptEtag = null; return; }
  if (!res.ok) throw new Error("载入评论已读状态失败：" + res.status);
  let data = null; try { data = await res.json(); } catch {}
  blogReadCommentIds = new Set(data && Array.isArray(data.seenCommentIds) ? data.seenCommentIds : []);
  blogReadReceiptEtag = res.headers.get("ETag");
}
async function blogSaveReceipt(token, ids) {
  if (!ids.length) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    await ensureBlogReadFolder(token);
    const path = "comment-read/" + blogReceiptFileName();
    const res = await fetch(blogContentUrl(path), { headers: { Authorization: "Bearer " + token } });
    let remote = [];
    if (res.ok) { let data = null; try { data = await res.json(); } catch {} remote = data && data.seenCommentIds || []; }
    else if (res.status !== 404) throw new Error("载入评论已读状态失败：" + res.status);
    const seen = [...new Set(remote.concat(ids))];
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const etag = res.headers.get("ETag"); if (etag) headers["If-Match"] = etag; else headers["If-None-Match"] = "*";
    const put = await fetch(blogContentUrl(path), { method: "PUT", headers, body: JSON.stringify({ seenCommentIds: seen, modified: new Date().toISOString() }) });
    if (put.ok) { blogReadCommentIds = new Set(seen); blogReadReceiptEtag = (await put.json()).eTag || null; return; }
    if (put.status === 409 || put.status === 412) continue;
    throw new Error("保存评论已读状态失败：" + put.status);
  }
}
let blogReadFolderReady = false;
async function ensureBlogReadFolder(token) {
  if (blogReadFolderReady) return;
  const check = await fetch(`${blogDriveBase}:/comment-read`, { headers: { Authorization: "Bearer " + token } });
  if (check.ok) { blogReadFolderReady = true; return; }
  if (check.status !== 404) throw new Error("检查评论已读目录失败：" + check.status);
  const create = await fetch(`${blogDriveBase}/children`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ name: "comment-read", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) });
  if (!create.ok && create.status !== 409) throw new Error("创建评论已读目录失败：" + create.status);
  blogReadFolderReady = true;
}
async function blogLoadUnreadComments(token) {
  await blogReadReceipt(token);
  const list = await fetch(`${blogDriveBase}:/comments:/children?$select=name,file&$top=200`, { headers: { Authorization: "Bearer " + token } });
  if (list.status === 404) { blogUnreadComments = []; blogRenderCommentReminder(); return; }
  if (!list.ok) throw new Error("载入评论提醒失败：" + list.status);
  const files = (await list.json()).value || [];
  const actor = blogCurrentActor(); const unread = [];
  for (const file of files.filter((f) => f.file && /\.json$/i.test(f.name || ""))) {
    const raw = await fetch(blogContentUrl("comments/" + file.name), { headers: { Authorization: "Bearer " + token } });
    if (!raw.ok) continue;
    const data = await raw.json(); const articleId = data.articleId;
    const post = blogAllEntries().find((p) => p.id === articleId);
    let title = post ? post.title : blogReminderTitles.get(articleId);
    if (!title && String(articleId || "").startsWith("summary::")) {
      const date = String(articleId).split("summary-").pop().split(".md")[0];
      title = "定期总结 · " + date;
    }
    (data.comments || []).forEach((c) => {
      if (c.authorId === actor.id || blogReadCommentIds.has(c.id)) return;
      unread.push({ articleId, commentId: c.id, title: title || articleId, author: c.author || "匿名", created: c.created, excerpt: String(c.content || "").replace(/\s+/g, " ").slice(0, 70) });
    });
  }
  blogUnreadComments = unread.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  blogRenderCommentReminder();
}
async function blogLoadCommentRemindersSilently() {
  els.commentReminderWrap.classList.remove("hidden");
  els.commentReminderBtn.disabled = true;
  els.commentReminderBtn.firstChild.textContent = "评论检查中 ";
  els.commentReminderCount.textContent = "…";
  try {
    const token = await getToken();
    await blogResolveFolder(token);
    const idx = await blogReadIndex(token);
    blogReminderTitles = new Map(idx.posts.map((post) => [post.id, post.title || post.id]));
    await blogLoadUnreadComments(token);
  } catch (e) {
    console.warn("comment reminder load:", e);
    els.commentReminderWrap.classList.add("hidden");
  } finally {
    els.commentReminderBtn.disabled = false;
    els.commentReminderBtn.firstChild.textContent = "评论 ";
  }
}
function blogRenderCommentReminder() {
  const n = blogUnreadComments.length;
  els.commentReminderWrap.classList.toggle("hidden", !account || n === 0);
  els.commentReminderCount.textContent = n;
  els.commentReminderPanel.innerHTML = "";
  blogUnreadComments.forEach((item) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "comment-reminder-item";
    btn.innerHTML = `<div class="comment-reminder-title">${escapeHtml(item.title)}</div><div class="comment-reminder-meta">${escapeHtml(item.author)} · ${escapeHtml(formatBeijingTime(item.created))}<br>${escapeHtml(item.excerpt)}</div>`;
    btn.onclick = async () => { els.commentReminderPanel.classList.add("hidden"); await setMode("blog"); await blogOpen(item.articleId, true); requestAnimationFrame(() => { const el = document.querySelector(`[data-comment-id="${CSS.escape(item.commentId)}"]`); if (el) el.scrollIntoView({ block: "center" }); }); };
    els.commentReminderPanel.appendChild(btn);
  });
}
async function ensureBlogCommentsFolder(token) {
  if (blogCommentsFolderReady) return;
  const check = await fetch(`${blogDriveBase}:/comments`, { headers: { Authorization: "Bearer " + token } });
  if (check.ok) { blogCommentsFolderReady = true; return; }
  if (check.status !== 404) throw new Error("检查评论文件夹失败：" + check.status);
  const create = await fetch(`${blogDriveBase}/children`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "comments", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (!create.ok && create.status !== 409) throw new Error("创建评论文件夹失败：" + create.status);
  blogCommentsFolderReady = true;
}
function blogCurrentActor() {
  return {
    id: String((account && account.username) || "").trim().toLowerCase(),
    name: String((account && (account.name || account.username)) || "").trim(),
  };
}
function blogOwnComment(comment) {
  const actor = blogCurrentActor();
  return comment && ((comment.authorId && comment.authorId === actor.id) ||
    (!comment.authorId && String(comment.author || "").toLowerCase() === actor.name.toLowerCase()));
}
async function blogReadComments(token, articleId) {
  const res = await fetch(blogContentUrl(blogCommentPath(articleId)), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { comments: [], etag: null };
  if (!res.ok) throw new Error("载入评论失败：" + res.status);
  let data = null; try { data = await res.json(); } catch {}
  return { comments: data && Array.isArray(data.comments) ? data.comments : [], etag: res.headers.get("ETag") };
}
async function blogMutateComments(token, articleId, mutate) {
  await ensureBlogCommentsFolder(token);
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await blogReadComments(token, articleId);
    const comments = mutate(fresh.comments.slice());
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (fresh.etag) headers["If-Match"] = fresh.etag;
    else headers["If-None-Match"] = "*";
    const res = await fetch(blogContentUrl(blogCommentPath(articleId)), {
      method: "PUT", headers, body: JSON.stringify({ articleId, comments }),
    });
    if (res.ok) { blogCommentsData = comments; blogCommentsEtag = (await res.json()).eTag || null; return; }
    if (res.status === 409 || res.status === 412) continue;
    throw new Error("保存评论失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存评论冲突，重试多次仍失败。");
}

// ---- index JSON read/write (eTag optimistic concurrency) -----------------
async function blogReadIndex(token) {
  const res = await fetch(blogContentUrl(BLOG_INDEX_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { posts: [], etag: null };
  if (!res.ok) throw new Error("载入博客索引失败：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const posts = (data && Array.isArray(data.posts)) ? data.posts : [];
  return { posts, etag: res.headers.get("ETag") };
}
async function blogWriteIndex(token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (blogIndexEtag) headers["If-Match"] = blogIndexEtag;
    const res = await fetch(blogContentUrl(BLOG_INDEX_FILE), {
      method: "PUT", headers, body: JSON.stringify({ posts: blogPosts }),
    });
    if (res.ok) { const it = await res.json(); blogIndexEtag = it.eTag; return; }
    if (res.status === 412) { // someone else changed it — reload & keep our edits by id
      const fresh = await blogReadIndex(token);
      const byId = {}; fresh.posts.forEach((p) => { byId[p.id] = p; });
      blogPosts.forEach((p) => { byId[p.id] = p; });
      blogPosts = Object.values(byId).sort(blogCmp);
      blogIndexEtag = fresh.etag;
      continue;
    }
    throw new Error("保存博客索引失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存博客索引冲突，重试多次仍失败。");
}

// ---- list summaries/ folder (read-only auto-generated digests) -----------
async function blogListSummaries(token) {
  try {
    const url = `${blogDriveBase}:/summaries:/children?$select=name,lastModifiedDateTime&$top=200`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) return [];          // 404 = folder not created yet
    const j = await res.json();
    const files = (j.value || []).filter((f) => /\.md$/i.test(f.name || ""));
    return files.map((f) => {
      const m = (f.name || "").match(/(\d{4}-\d{2}-\d{2})/);
      const date = m ? m[1] : (f.lastModifiedDateTime || "").slice(0, 10);
      return {
        id: "summary::" + f.name,
        title: "定期总结 · " + date,
        date: date,
        excerpt: "自动生成的双周回顾",
        searchText: "定期总结 summary 回顾 " + date,
        isSummary: true,
        summaryPath: "summaries/" + f.name,
      };
    });
  } catch { return []; }
}

// Creation-time key: post ids are "YYYY-MM-DD-NN" (creation date + sequence),
// so they sort chronologically. Summaries fall back to their date.
function blogCreatedKey(p) {
  const id = p.id || "";
  if (/^\d{4}-\d{2}-\d{2}-\d+$/.test(id)) return id;
  return (p.date || "") + "-99"; // summaries: order by date, after same-day posts
}
function blogCmp(a, b) {
  const ka = blogCreatedKey(a), kb = blogCreatedKey(b);
  if (ka !== kb) return kb < ka ? -1 : 1;   // creation time desc (newest first)
  return (b.id || "") < (a.id || "") ? -1 : 1;
}

// ---- load ----------------------------------------------------------------
async function blogLoad() {
  if (blogLoaded) return;
  if (blogLoadPromise) return blogLoadPromise;
  blogLoadPromise = blogLoadFull();
  try { await blogLoadPromise; }
  finally { blogLoadPromise = null; }
}

async function blogLoadFull() {
  setStatus("正在载入博客…");
  const token = await getToken();
  await blogResolveFolder(token);
  try { await loadSummarySettings(token); }
  catch (e) { renderSummaryModelSetting(); setStatus(e.message || String(e), "warn", 4000); }
  const idx = await blogReadIndex(token);
  blogPosts = idx.posts.slice().sort(blogCmp);
  blogIndexEtag = idx.etag;
  try { await blogLoadTagCandidates(token); } catch (e) {
    blogTagCandidates = [...new Set(blogPosts.flatMap((p) => blogNormalizeTags(p.tags)))];
    setStatus(e.message || String(e), "warn", 3000);
  }
  blogSummaries = await blogListSummaries(token);
  blogLoaded = true;
  blogRenderTagOptions();
  blogRenderList();
  try { await blogLoadUnreadComments(token); } catch (e) { console.warn("comment reminders:", e); }
  setStatus("已载入 " + blogPosts.length + " 篇文章、" + blogSummaries.length + " 篇总结。", "ok", 2000);
}

// ---- list rendering ------------------------------------------------------
function blogRenderList() {
  const q = blogSearchText.trim().toLowerCase();
  const list = blogAllEntries().slice().sort(blogCmp).filter((p) => {
    if (blogTagFilter && !blogNormalizeTags(p.tags).includes(blogTagFilter)) return false;
    if (!q) return true;
    return ((p.title || "") + " " + (p.searchText || p.excerpt || "") + " " + (p.date || "") + " " + blogNormalizeTags(p.tags).join(" "))
      .toLowerCase().includes(q);
  });
  els.blogTagFilterBar.classList.toggle("hidden", !blogTagFilter);
  els.blogTagFilterValue.textContent = blogTagFilter;
  const pages = Math.max(1, Math.ceil(list.length / BLOG_LIST_PAGE_SIZE));
  blogListPage = Math.min(blogListPage, pages - 1);
  const pageRows = list.slice(blogListPage * BLOG_LIST_PAGE_SIZE, (blogListPage + 1) * BLOG_LIST_PAGE_SIZE);
  els.blogCount.textContent = "共 " + list.length + " 篇";
  els.blogListPageInput.value = blogListPage + 1;
  els.blogListPageInput.max = pages;
  els.blogListPageInfo.textContent = "/ " + pages + " 页";
  els.blogListFirst.disabled = blogListPage === 0;
  els.blogListPrev.disabled = blogListPage === 0;
  els.blogListNext.disabled = blogListPage >= pages - 1;
  els.blogListLast.disabled = blogListPage >= pages - 1;
  els.blogListPager.classList.toggle("hidden", pages <= 1);
  els.blogClearFilterBtn.classList.toggle("hidden", !q);
  els.blogList.innerHTML = "";
  els.blogEmpty.classList.toggle("hidden", list.length > 0);
  pageRows.forEach((p) => {
    const item = document.createElement("div");
    item.className = "blog-item" + (p.isSummary ? " blog-item-summary" : "");
    item.dataset.blogId = p.id;
    item.tabIndex = 0;
    const h = document.createElement("div");
    h.className = "blog-item-title";
    h.textContent = p.title || "(无标题)";
    if (p.isSummary) {
      const badge = document.createElement("span");
      badge.className = "blog-badge";
      badge.textContent = "总结";
      h.appendChild(document.createTextNode(" "));
      h.appendChild(badge);
    }
    const meta = document.createElement("div");
    meta.className = "blog-item-meta";
    meta.textContent = (p.created ? "发表于 " + formatBeijingTime(p.created) : (p.date || "")) +
      (p.images ? "　·　" + p.images + " 图" : "");
    const ex = document.createElement("div");
    ex.className = "blog-item-excerpt";
    ex.textContent = p.excerpt || "";
    item.appendChild(h); item.appendChild(meta);
    const tags = document.createElement("div"); tags.className = "blog-tags";
    blogRenderTagChips(tags, p.tags, true); if (tags.children.length) item.appendChild(tags);
    item.appendChild(ex);
    item.onclick = () => blogOpen(p.id);
    item.onkeydown = (e) => { if (e.key === "Enter") blogOpen(p.id); };
    els.blogList.appendChild(item);
  });
}

// ---- open / view ---------------------------------------------------------
async function blogOpen(id, fromDeepLink) {
  const post = blogAllEntries().find((p) => p.id === id);
  if (!post) return;
  if (!fromDeepLink && !els.blogTabList.classList.contains("hidden")) {
    blogListReturnState = {
      id,
      page: blogListPage,
      search: blogSearchText,
      input: els.blogSearch.value,
      scrollY: window.scrollY,
    };
  }
  blogViewId = id;
  history.replaceState(null, "", deepLinkUrl("blog", id));
  blogSwitchTab("view");
  window.scrollTo({ top: 0, behavior: "auto" });
  // Summaries are read-only: hide edit/delete controls.
  els.blogEditThisBtn.classList.toggle("hidden", !!post.isSummary);
  els.blogDeleteThisBtn.classList.toggle("hidden", !!post.isSummary);
  els.blogSummarySources.classList.toggle("hidden", !post.isSummary);
  els.blogSummarySources.open = false;
  els.blogViewTitle.textContent = post.title || "(无标题)";
  blogRenderViewMeta(post, 0);
  blogRenderTagChips(els.blogViewTags, post.tags, true);
  els.blogViewBody.innerHTML = "<p class='muted'>正在载入…</p>";
  const token = await getToken();
  await blogResolveFolder(token);
  try {
    const path = post.isSummary ? post.summaryPath : "posts/" + id + ".md";
    const md = await blogReadText(token, path);
    els.blogViewBody.innerHTML = blogRenderMarkdown(md || "");
    await blogResolveImages(token, els.blogViewBody);
  } catch (e) {
    els.blogViewBody.innerHTML = "";
    setStatus("打开文章失败：" + (e.message || e), "error");
    return;
  }
  try {
    await blogLoadComments(token, id);
  } catch (e) {
    blogCommentsData = [];
    els.blogCommentList.innerHTML = '<p class="muted">评论载入失败：' + escapeHtml(e.message || String(e)) + "</p>";
    els.blogCommentCount.textContent = "";
    els.blogCommentEmpty.classList.add("hidden");
    blogResetCommentEditor();
    setStatus("评论载入失败：" + (e.message || e), "warn", 5000);
  }
}

async function blogReturnToList() {
  const state = blogListReturnState;
  if (!blogLoaded) {
    setStatus("正在载入文章列表…");
    try { await blogLoad(); }
    catch (e) {
      blogSwitchTab("view");
      setStatus("文章列表载入失败：" + (e.message || e), "error", 6000);
      return;
    }
  }
  if (state) {
    blogListPage = state.page;
    blogSearchText = state.search;
    els.blogSearch.value = state.input;
  }
  clearDeepLink(); blogSwitchTab("list");
  blogRenderList();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!state) return;
    window.scrollTo({ top: state.scrollY, behavior: "auto" });
    requestAnimationFrame(() => {
    const target = Array.from(els.blogList.querySelectorAll(".blog-item"))
      .find((el) => el.dataset.blogId === state.id);
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) target.scrollIntoView({ block: "center", behavior: "auto" });
    }
    });
  }));
}

async function blogOpenListTab() {
  const previous = blogActiveSection();
  blogCapturePosition(previous);
  if (!blogLoaded) {
    setStatus("正在载入文章列表…");
    try { await blogLoad(); }
    catch (e) {
      setStatus("文章列表载入失败：" + (e.message || e), "error", 6000);
      return;
    }
  }
  clearDeepLink();
  blogSwitchTab("list");
  blogRestorePosition("list");
}

async function blogLoadComments(token, articleId) {
  const data = await blogReadComments(token, articleId);
  blogCommentsData = data.comments; blogCommentsEtag = data.etag;
  const post = blogAllEntries().find((p) => p.id === articleId);
  if (post) blogRenderViewMeta(post, blogCommentsData.length);
  blogResetCommentEditor();
  await blogRenderComments(token);
}

function blogRenderViewMeta(post, commentCount) {
  const base = post.created ? "发表于 " + formatBeijingTime(post.created) : (post.date || "");
  els.blogViewDate.textContent = base + (commentCount > 0 ? "　·　" + commentCount + " 条评论" : "");
}

async function blogRenderComments(token) {
  const rows = blogCommentsData.slice().sort((a, b) =>
    String(b.created || "").localeCompare(String(a.created || "")));
  els.blogCommentCount.textContent = "共 " + rows.length + " 条";
  els.blogCommentEmpty.classList.toggle("hidden", rows.length > 0);
  els.blogCommentList.innerHTML = "";
  rows.forEach((comment) => {
    const div = document.createElement("div"); div.className = "forum-post";
    div.dataset.commentId = comment.id;
    const meta = document.createElement("div"); meta.className = "forum-post-meta";
    meta.textContent = (comment.author || "匿名") + " · " + formatBeijingTime(comment.created) +
      (comment.modified ? "（已编辑）" : "");
    const body = document.createElement("div"); body.className = "blog-body forum-post-body";
    body.innerHTML = blogRenderMarkdown(comment.content || "");
    div.appendChild(meta); div.appendChild(body);
    if (blogOwnComment(comment)) {
      const actions = document.createElement("div"); actions.className = "forum-post-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn btn-ghost btn-mini"; edit.textContent = "编辑"; edit.onclick = () => blogStartEditComment(comment.id);
      const del = document.createElement("button"); del.type = "button"; del.className = "btn btn-danger btn-mini"; del.textContent = "删除"; del.onclick = () => blogDeleteComment(comment.id);
      actions.appendChild(edit); actions.appendChild(del); div.appendChild(actions);
    }
    els.blogCommentList.appendChild(div);
  });
  if (token) await blogResolveImages(token, els.blogCommentList);
  if (blogCommentObserver) blogCommentObserver.disconnect();
  blogCommentObserver = new IntersectionObserver((entries) => {
    const ids = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target.dataset.commentId).filter(Boolean);
    if (!ids.length) return;
    blogSaveReceipt(token, ids).then(() => {
      blogUnreadComments = blogUnreadComments.filter((item) => !ids.includes(item.commentId));
      blogRenderCommentReminder();
    }).catch((e) => console.warn("mark comments read:", e));
  }, { threshold: 0.35 });
  els.blogCommentList.querySelectorAll("[data-comment-id]").forEach((el) => blogCommentObserver.observe(el));
}

function blogResetCommentEditor() {
  els.blogEditCommentId.value = ""; els.blogCommentInput.value = "";
  blogCommentOriginalContent = ""; blogCommentSaving = false;
  els.blogCommentLabel.textContent = "发表评论（Markdown）"; els.blogCommentSubmitBtn.textContent = "发表评论";
  els.blogCommentCancelBtn.classList.add("hidden"); forumAutoGrowEditor(els.blogCommentInput);
  updateBlogCommentSubmitState();
}
function blogStartEditComment(id) {
  const c = blogCommentsData.find((x) => x.id === id);
  if (!c || !blogOwnComment(c)) return;
  els.blogEditCommentId.value = id; els.blogCommentInput.value = c.content || "";
  blogCommentOriginalContent = c.content || ""; blogCommentSaving = false;
  els.blogCommentLabel.textContent = "编辑评论（Markdown）"; els.blogCommentSubmitBtn.textContent = "保存修改";
  els.blogCommentCancelBtn.classList.remove("hidden"); forumAutoGrowEditor(els.blogCommentInput);
  updateBlogCommentSubmitState(); els.blogCommentInput.focus();
}
function updateBlogCommentSubmitState() {
  const content = els.blogCommentInput.value.trim();
  const editId = els.blogEditCommentId.value;
  const unchanged = !!editId && content === blogCommentOriginalContent.trim();
  els.blogCommentSubmitBtn.disabled = blogCommentSaving || !content || unchanged;
}
async function blogSaveComment() {
  const content = els.blogCommentInput.value.trim(), editId = els.blogEditCommentId.value;
  if (!content || !blogViewId) return;
  const actor = blogCurrentActor(), now = new Date().toISOString();
  const targetId = editId || uuid();
  blogCommentSaving = true; updateBlogCommentSubmitState();
  try {
    const token = await getToken(); await blogResolveFolder(token);
    await blogMutateComments(token, blogViewId, (comments) => {
      if (editId) return comments.map((c) => c.id === editId && blogOwnComment(c) ? Object.assign({}, c, { content, modified: now }) : c);
      comments.push({ id: targetId, authorId: actor.id, author: actor.name, content, created: now }); return comments;
    });
    blogResetCommentEditor(); await blogRenderComments(token);
    scrollToRenderedItem(`[data-comment-id="${CSS.escape(targetId)}"]`);
    await blogLoadUnreadComments(token); setStatus(editId ? "评论已更新。" : "评论已发表。", "ok", 2000);
  } catch (e) {
    blogCommentSaving = false; updateBlogCommentSubmitState();
    setStatus("保存评论失败：" + (e.message || e), "error");
  }
}
async function blogDeleteComment(id) {
  const c = blogCommentsData.find((x) => x.id === id);
  if (!c || !blogOwnComment(c) || !blogConfirmDeleteComment()) return;
  try {
    const token = await getToken(); await blogMutateComments(token, blogViewId, (comments) => comments.filter((x) => x.id !== id || !blogOwnComment(x)));
    await blogRenderComments(token); setStatus("评论已删除。", "ok", 2000);
  } catch (e) { setStatus("删除评论失败：" + (e.message || e), "error"); }
}
function blogConfirmDeleteComment() {
  return confirm("确定删除这条评论吗？");
}

// Fetch the full-resolution image as a blob URL (cached per session).
async function blogFullImageUrl(token, path) {
  if (blogImgCache[path]) return blogImgCache[path];
  const res = await fetch(blogContentUrl(path), { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  blogImgCache[path] = url;
  return url;
}
// Resolve <img data-src="images/x"> to a Graph thumbnail (small download);
// clicking the image loads the full-resolution original on demand.
async function blogResolveImages(token, container) {
  const imgs = Array.from(container.querySelectorAll("img[data-src]"));
  for (const img of imgs) {
    const path = img.getAttribute("data-src");
    img.removeAttribute("data-src");
    img.style.cursor = "pointer";
    img.title = "点击查看原图";
    // Click opens a full-screen lightbox with the full-resolution original.
    // Use onclick property (not addEventListener) so iOS Safari fires the tap.
    img.onclick = () => blogOpenLightbox(token, path, img.src);
    try {
      const turl = `${blogDriveBase}:/${blogEncPath(path)}:/thumbnails/0/large`;
      const res = await fetch(turl, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (j && j.url) { img.src = j.url; continue; }
      throw new Error("no-thumb");
    } catch {
      // Fallback: some sources (CDN/system) have no thumbnail — load full blob.
      try {
        img.src = await blogFullImageUrl(token, path);
        img.style.cursor = "pointer";
        img.title = "点击查看原图";
      } catch {
        img.alt = "(图片无法加载: " + path + ")";
      }
    }
  }
  const media = Array.from(container.querySelectorAll("audio[data-src],video[data-src]"));
  await Promise.all(media.map((el) => blogResolveMedia(token, el)));
}

async function blogMediaDownloadUrl(token, path) {
  const res = await fetch(`${blogDriveBase}:/${blogEncPath(path)}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  return data["@microsoft.graph.downloadUrl"] || "";
}

async function blogResolveMedia(token, media) {
  const path = media.getAttribute("data-src");
  media.removeAttribute("data-src");
  media.preload = "metadata";
  media.dataset.mediaPath = path;
  try {
    const url = await blogMediaDownloadUrl(token, path);
    if (!url) throw new Error("missing downloadUrl");
    media.src = url;
    media.load();
    let refreshed = false;
    media.addEventListener("error", async () => {
      if (refreshed) return;
      refreshed = true;
      try { media.src = await blogMediaDownloadUrl(token, path); media.load(); }
      catch { setStatus((media.tagName === "AUDIO" ? "音频" : "视频") + "加载失败：" + path, "error", 3000); }
    });
  } catch {
    setStatus((media.tagName === "AUDIO" ? "音频" : "视频") + "加载失败：" + path, "error", 3000);
  }
}

// Full-screen lightbox: show thumbnail immediately, then swap in full-res.
async function blogOpenLightbox(token, path, previewSrc) {
  els.blogLightboxImg.src = previewSrc || "";
  els.blogLightbox.classList.remove("hidden");
  try {
    els.blogLightboxImg.src = await blogFullImageUrl(token, path);
  } catch { /* keep preview */ }
}
function blogCloseLightbox() {
  els.blogLightbox.classList.add("hidden");
  els.blogLightboxImg.src = "";
}

// ---- minimal Markdown renderer (ASCII-safe, private content) -------------
function blogEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function blogInline(s) {
  s = s.replace(/@\[video\]\(([^)]+)\)/g,
    (m, u) => '<video controls playsinline preload="metadata" data-src="' + u + '"></video>');
  s = s.replace(/@\[audio\]\(([^)]+)\)/g,
    (m, u) => '<audio controls preload="metadata" data-src="' + u + '"></audio>');
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    (m, a, u) => '<img alt="' + a + '" data-src="' + u + '" loading="lazy" />');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>');
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
    (m, u) => '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/&lt;u&gt;/g, "<u>").replace(/&lt;\/u&gt;/g, "</u>");
  return s;
}
function blogRenderMarkdown(md) {
  const lines = blogEsc(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  const isBlock = (l) => /^(#{1,6}\s|```|&gt;\s?|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(l);
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; out.push("<pre><code>" + buf.join("\n") + "</code></pre>"); continue;
    }
    if (line.trim() === "") { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = h[1].length; out.push("<h" + n + ">" + blogInline(h[2]) + "</h" + n + ">"); i++; continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr />"); i++; continue; }
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) { buf.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
      out.push("<blockquote>" + blogInline(buf.join(" ")) + "</blockquote>"); continue;
    }
    // table: header row with | then a separator row of ---
    if (line.indexOf("|") >= 0 && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf("-") >= 0) {
      const rows = [];
      const cells = (l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = cells(line); i += 2;
      while (i < lines.length && lines[i].indexOf("|") >= 0 && lines[i].trim() !== "") { rows.push(cells(lines[i])); i++; }
      let t = "<table><thead><tr>" + header.map((c) => "<th>" + blogInline(c) + "</th>").join("") + "</tr></thead><tbody>";
      rows.forEach((r) => { t += "<tr>" + r.map((c) => "<td>" + blogInline(c) + "</td>").join("") + "</tr>"; });
      t += "</tbody></table>"; out.push(t); continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push("<ul>" + buf.map((x) => "<li>" + blogInline(x) + "</li>").join("") + "</ul>"); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push("<ol>" + buf.map((x) => "<li>" + blogInline(x) + "</li>").join("") + "</ol>"); continue;
    }
    // paragraph
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() !== "" && !isBlock(lines[i])) { buf.push(lines[i]); i++; }
    out.push("<p>" + blogInline(buf.join("<br>")) + "</p>");
  }
  return out.join("\n");
}

// ---- tabs ----------------------------------------------------------------
function blogSwitchTab(tab) {
  els.blogTabListBtn.classList.toggle("active", tab === "list");
  els.blogTabViewBtn.classList.toggle("active", tab === "view");
  els.blogTabEditBtn.classList.toggle("active", tab === "edit");
  els.blogTabForumBtn.classList.toggle("active", tab === "forum");
  els.blogTabList.classList.toggle("hidden", tab !== "list");
  els.blogTabView.classList.toggle("hidden", tab !== "view");
  els.blogTabEdit.classList.toggle("hidden", tab !== "edit");
  els.blogTabForum.classList.toggle("hidden", tab !== "forum");
  els.blogTabViewBtn.classList.toggle("hidden", !blogViewId || tab === "forum");
  if (tab !== "view" && tab !== "list") els.blogFloatingActions.classList.add("hidden");
  requestAnimationFrame(blogUpdateTopButton);
}

function blogUpdateTopButton() {
  if (mode !== "blog" || els.blogApp.classList.contains("hidden")) {
    els.blogFloatingActions.classList.add("hidden");
    els.blogCommentBtn.classList.add("hidden");
    els.blogTopBtn.classList.add("hidden");
    return;
  }
  const reading = !els.blogTabView.classList.contains("hidden");
  const listing = !els.blogTabList.classList.contains("hidden");
  const forumViewing = !els.blogTabForum.classList.contains("hidden") &&
    !els.forumTopicView.classList.contains("hidden");
  if (!reading && !listing && !forumViewing) { els.blogFloatingActions.classList.add("hidden"); return; }
  const anchor = forumViewing ? els.forumViewTitle : reading ? els.blogViewTitle : els.blogList;
  const anchorTop = anchor.getBoundingClientRect().top + window.scrollY;
  const scrolled = window.scrollY >= anchorTop + 500;
  if (forumViewing) {
    const replyRect = els.forumReplyBox.getBoundingClientRect();
    const replyVisible = replyRect.top < window.innerHeight && replyRect.bottom > 0;
    els.blogFloatingActions.classList.remove("hidden");
    els.blogCommentBtn.textContent = "去回复";
    els.blogCommentBtn.classList.toggle("hidden", replyVisible);
    els.blogTopBtn.classList.toggle("hidden", !scrolled);
    return;
  }
  els.blogFloatingActions.classList.toggle("hidden", !scrolled);
  els.blogCommentBtn.textContent = "去评论";
  els.blogCommentBtn.classList.toggle("hidden", !reading);
  els.blogTopBtn.classList.remove("hidden");
}

function blogScrollToTitle() {
  const reading = !els.blogTabView.classList.contains("hidden");
  const forumViewing = !els.blogTabForum.classList.contains("hidden") &&
    !els.forumTopicView.classList.contains("hidden");
  const anchor = forumViewing ? els.forumViewTitle : reading ? els.blogViewTitle : els.blogList;
  const tabs = document.querySelector("#blogApp > .tabs");
  const offset = (tabs ? tabs.offsetHeight : 0) + 8;
  const top = anchor.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

// ---- edit / new ----------------------------------------------------------
function blogResetForm() {
  els.blogEditId.value = "";
  els.blogTitleInput.value = "";
  els.blogDateInput.value = todayStr();
  blogSelectedTags = new Set(); blogRenderTagOptions();
  els.blogBodyInput.value = "";
  els.blogImageInput.value = "";
  els.blogAudioInput.value = "";
  els.blogVideoInput.value = "";
  els.blogImageHint.textContent = "选择图片后会上传，并在正文光标处插入引用。";
  els.blogAudioHint.textContent = "支持 iPhone 语音备忘录导出的 M4A，以及 MP3、WAV、AAC；单文件不超过 50MB。";
  els.blogVideoHint.textContent = "支持 MP4 / MOV，单文件不超过 200MB。云端位置：OneDrive / Apps / BlogTracker / video/";
  els.blogImgPicker.classList.add("hidden");
  els.blogEditFormTitle.textContent = "写博文";
}
function blogNew() { blogCapturePosition(blogActiveSection()); clearDeepLink(); blogResetForm(); blogSwitchTab("edit"); window.scrollTo({ top: 0, behavior: "auto" }); }
async function blogEditThis() {
  const post = blogPosts.find((p) => p.id === blogViewId);
  if (!post) return;
  blogResetForm();
  els.blogEditFormTitle.textContent = "编辑文章";
  els.blogEditId.value = post.id;
  els.blogTitleInput.value = post.title || "";
  els.blogDateInput.value = post.date || todayStr();
  blogSelectedTags = new Set(blogNormalizeTags(post.tags)); blogRenderTagOptions();
  blogCapturePosition("view"); blogSwitchTab("edit"); window.scrollTo({ top: 0, behavior: "auto" });
  els.blogBodyInput.value = "载入中…";
  try {
    const token = await getToken();
    await blogResolveFolder(token);
    els.blogBodyInput.value = (await blogReadText(token, "posts/" + post.id + ".md")) || "";
  } catch (e) {
    els.blogBodyInput.value = "";
    setStatus("载入正文失败：" + (e.message || e), "error");
  }
}

// derive next id for a date (YYYY-MM-DD-NN), unique across index
function blogNextId(date) {
  const d = date || todayStr();
  let n = 0;
  blogPosts.forEach((p) => {
    const m = (p.id || "").match(new RegExp("^" + d + "-(\\d+)$"));
    if (m) n = Math.max(n, parseInt(m[1], 10));
  });
  let id;
  do { n++; id = d + "-" + String(n).padStart(2, "0"); }
  while (blogPosts.some((p) => p.id === id));
  return id;
}

function blogMakeExcerpt(md) {
  const s = md.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_|\-]+/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
  return s.slice(0, 120);
}

async function blogSave() {
  const title = els.blogTitleInput.value.trim();
  const date = els.blogDateInput.value || todayStr();
  const body = els.blogBodyInput.value;
  if (!title) { setStatus("请填写标题。", "warn"); els.blogTitleInput.focus(); return; }
  els.blogSaveBtn.disabled = true;
  try {
    setStatus("正在保存文章…");
    const token = await getToken();
    await blogResolveFolder(token);
    let id = els.blogEditId.value;
    const isNew = !id;
    if (isNew) id = blogNextId(date);
    await blogWriteText(token, "posts/" + id + ".md", body);
    const imgCount = (body.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    const oldEntry = blogPosts.find((p) => p.id === id);
    const entry = {
      id, title, date, tags: [...blogSelectedTags],
      created: (oldEntry && oldEntry.created) || new Date().toISOString(),
      modified: new Date().toISOString(),
      excerpt: blogMakeExcerpt(body),
      searchText: blogMakeExcerpt(body).slice(0, 2000),
      images: imgCount,
    };
    const idx = blogPosts.findIndex((p) => p.id === id);
    if (idx >= 0) blogPosts[idx] = entry; else blogPosts.push(entry);
    blogPosts.sort(blogCmp);
    blogRenderTagOptions();
    await blogWriteIndex(token);
    setStatus("已保存。", "ok", 2500);
    blogViewId = id;
    blogRenderList();
    blogOpen(id);
  } catch (e) {
    setStatus("保存失败：" + (e.message || e), "error");
  } finally {
    els.blogSaveBtn.disabled = false;
  }
}

async function blogDeleteThis() {
  const post = blogPosts.find((p) => p.id === blogViewId);
  if (!post) return;
  if (!confirm("确定删除这篇文章吗？\n「" + (post.title || "") + "」")) return;
  try {
    setStatus("正在删除…");
    const token = await getToken();
    await blogResolveFolder(token);
    blogPosts = blogPosts.filter((p) => p.id !== post.id);
    await blogWriteIndex(token);
    await blogDeleteFile(token, "posts/" + post.id + ".md");
    await blogDeleteFile(token, blogCommentPath(post.id));
    blogViewId = null;
    blogRenderList();
    clearDeepLink();
    blogSwitchTab("list");
    setStatus("已删除。", "ok", 2500);
  } catch (e) {
    setStatus("删除失败：" + (e.message || e), "error");
  }
}

// ---- image upload (insert reference at cursor) ---------------------------
function blogSlugExt(name) {
  const m = (name || "").match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "png";
}
async function blogOnPickImages(files) {
  if (!files || !files.length) return;
  els.blogImageInput.disabled = true;
  try {
    const token = await getToken();
    await blogResolveFolder(token);
    const refs = [];
    for (const f of files) {
      const ext = blogSlugExt(f.name);
      const name = "img" + Date.now() + Math.floor(Math.random() * 1000) + "." + ext;
      els.blogImageHint.textContent = "正在上传 " + name + " …";
      const buf = await f.arrayBuffer();
      const res = await fetch(blogContentUrl("images/" + name), {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": f.type || "application/octet-stream" },
        body: buf,
      });
      if (!res.ok) throw new Error("上传失败(" + name + ")：" + res.status);
      refs.push("![](images/" + name + ")");
    }
    blogInsertAtCursor(els.blogBodyInput, "\n\n" + refs.join("\n\n") + "\n\n");
    els.blogImageHint.textContent = "已插入 " + refs.length + " 张图片引用。";
    els.blogImageInput.value = "";
  } catch (e) {
    els.blogImageHint.textContent = "";
    setStatus("图片上传失败：" + (e.message || e), "error");
  } finally {
    els.blogImageInput.disabled = false;
  }
}

async function forumUploadImages(files, target, input, hint) {
  if (!files || !files.length) return;
  input.disabled = true;
  try {
    const token = await getToken();
    await blogResolveFolder(token);
    const refs = [];
    for (const f of files) {
      const name = "img" + Date.now() + Math.floor(Math.random() * 1000) + "." + blogSlugExt(f.name);
      hint.textContent = "正在上传 " + name + " …";
      const res = await fetch(blogContentUrl("images/" + name), {
        method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": f.type || "application/octet-stream" },
        body: await f.arrayBuffer(),
      });
      if (!res.ok) throw new Error("上传失败(" + name + ")：" + res.status);
      refs.push("![](images/" + name + ")");
    }
    blogInsertAtCursor(target, "\n\n" + refs.join("\n\n") + "\n\n");
    forumAutoGrowEditor(target);
    hint.textContent = "已插入 " + refs.length + " 张图片。";
    input.value = "";
  } catch (e) {
    setStatus("图片上传失败：" + (e.message || e), "error");
  } finally { input.disabled = false; }
}

const AUDIO_EXT = /\.(m4a|mp3|wav|aac)$/i;
const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
let audioFolderReady = false;
async function ensureAudioFolder(token) {
  if (audioFolderReady) return;
  const check = await fetch(`${blogDriveBase}:/audio`, { headers: { Authorization: "Bearer " + token } });
  if (check.ok) { audioFolderReady = true; return; }
  if (check.status !== 404) throw new Error("检查 audio 文件夹失败：" + check.status);
  const create = await fetch(`${blogDriveBase}/children`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "audio", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (!create.ok && create.status !== 409) throw new Error("创建 audio 文件夹失败：" + create.status);
  audioFolderReady = true;
}
async function uploadAudioFiles(files, target, input, hint) {
  if (!files || !files.length) return;
  input.disabled = true;
  try {
    const token = await getToken(); await blogResolveFolder(token); await ensureAudioFolder(token);
    const refs = [];
    for (const f of files) {
      if (f.size > AUDIO_MAX_BYTES) throw new Error(f.name + " 超过 50MB");
      const ext = blogSlugExt(f.name);
      if (!AUDIO_EXT.test("." + ext)) throw new Error("不支持的音频格式：" + f.name);
      const name = "audio" + Date.now() + Math.floor(Math.random() * 1000) + "." + ext;
      hint.textContent = "正在上传 " + name + " …";
      const res = await fetch(blogContentUrl("audio/" + name), {
        method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": f.type || "application/octet-stream" },
        body: await f.arrayBuffer(),
      });
      if (!res.ok) throw new Error("上传失败(" + name + ")：" + res.status);
      refs.push("@[audio](audio/" + name + ")");
    }
    blogInsertAtCursor(target, "\n\n" + refs.join("\n\n") + "\n\n");
    if (target !== els.blogBodyInput) forumAutoGrowEditor(target);
    hint.textContent = "已插入 " + refs.length + " 段音频。"; input.value = "";
  } catch (e) { setStatus("音频上传失败：" + (e.message || e), "error"); }
  finally { input.disabled = false; }
}

async function openAudioPicker(target) {
  els.audioPicker.classList.remove("hidden");
  els.audioPickerCount.textContent = "正在载入…";
  els.audioPickerList.innerHTML = "";
  try {
    const token = await getToken(); await blogResolveFolder(token);
    const res = await fetch(`${blogDriveBase}:/audio:/children?$select=name,file,size,lastModifiedDateTime&$top=200`, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 404) { els.audioPickerCount.textContent = "audio/ 文件夹暂无音频。"; return; }
    if (!res.ok) throw new Error(String(res.status));
    const items = (await res.json()).value || [];
    const audios = items.filter((it) => it.file && AUDIO_EXT.test(it.name || ""))
      .sort((a, b) => new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0));
    els.audioPickerCount.textContent = "共 " + audios.length + " 段音频（点击插入）";
    audios.forEach((it) => {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "audio-picker-item";
      btn.textContent = it.name + (it.size ? "（" + (it.size / 1024 / 1024).toFixed(1) + "MB）" : "");
      btn.onclick = () => { blogInsertAtCursor(target, "\n\n@[audio](audio/" + it.name + ")\n\n"); if (target !== els.blogBodyInput) forumAutoGrowEditor(target); };
      els.audioPickerList.appendChild(btn);
    });
  } catch (e) { setStatus("载入已有音频失败：" + (e.message || e), "error"); }
}

const VIDEO_EXT = /\.(mp4|mov)$/i;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
let videoFolderReady = false;
async function ensureVideoFolder(token) {
  if (videoFolderReady) return;
  const check = await fetch(`${blogDriveBase}:/video`, { headers: { Authorization: "Bearer " + token } });
  if (check.ok) { videoFolderReady = true; return; }
  if (check.status !== 404) throw new Error("检查 video 文件夹失败：" + check.status);
  const create = await fetch(`${blogDriveBase}/children`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ name: "video", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) });
  if (!create.ok && create.status !== 409) throw new Error("创建 video 文件夹失败：" + create.status);
  videoFolderReady = true;
}
async function uploadVideoFiles(files, target, input, hint) {
  if (!files || !files.length) return; input.disabled = true;
  try {
    const token = await getToken(); await blogResolveFolder(token); await ensureVideoFolder(token);
    const refs = [];
    for (const f of files) {
      if (f.size > VIDEO_MAX_BYTES) throw new Error(f.name + " 超过 200MB");
      const ext = blogSlugExt(f.name); if (!VIDEO_EXT.test("." + ext)) throw new Error("不支持的视频格式：" + f.name);
      const name = "video" + Date.now() + Math.floor(Math.random() * 1000) + "." + ext;
      hint.textContent = "正在上传 " + name + " …";
      const res = await fetch(blogContentUrl("video/" + name), { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": f.type || "application/octet-stream" }, body: await f.arrayBuffer() });
      if (!res.ok) throw new Error("上传失败(" + name + ")：" + res.status);
      refs.push("@[video](video/" + name + ")");
    }
    blogInsertAtCursor(target, "\n\n" + refs.join("\n\n") + "\n\n");
    if (target !== els.blogBodyInput) forumAutoGrowEditor(target);
    hint.textContent = "已插入 " + refs.length + " 段视频。"; input.value = "";
  } catch (e) { setStatus("视频上传失败：" + (e.message || e), "error"); }
  finally { input.disabled = false; }
}
async function openVideoPicker(target) {
  els.videoPicker.classList.remove("hidden"); els.videoPickerCount.textContent = "正在载入…"; els.videoPickerList.innerHTML = "";
  try {
    const token = await getToken(); await blogResolveFolder(token);
    const res = await fetch(`${blogDriveBase}:/video:/children?$select=name,file,size,lastModifiedDateTime&$top=200`, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 404) { els.videoPickerCount.textContent = "video/ 文件夹暂无视频。"; return; }
    if (!res.ok) throw new Error(String(res.status));
    const items = ((await res.json()).value || []).filter((it) => it.file && VIDEO_EXT.test(it.name || ""));
    els.videoPickerCount.textContent = "共 " + items.length + " 段视频（点击插入）";
    items.forEach((it) => { const btn = document.createElement("button"); btn.type = "button"; btn.className = "audio-picker-item"; btn.textContent = it.name + (it.size ? "（" + (it.size/1024/1024).toFixed(1) + "MB）" : ""); btn.onclick = () => { blogInsertAtCursor(target, "\n\n@[video](video/" + it.name + ")\n\n"); if (target !== els.blogBodyInput) forumAutoGrowEditor(target); }; els.videoPickerList.appendChild(btn); });
  } catch (e) { setStatus("载入已有视频失败：" + (e.message || e), "error"); }
}
function blogInsertAtCursor(ta, text) {
  const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const pos = s + text.length;
  ta.selectionStart = ta.selectionEnd = pos;
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---- Markdown toolbar helpers --------------------------------------------
// Wrap the current selection with before/after; if nothing selected, insert a
// placeholder and select it so the user can type over it.
function blogWrapSelection(ta, before, after, placeholder) {
  const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
  const sel = ta.value.slice(s, e) || (placeholder || "");
  const text = before + sel + after;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
// Prepend a prefix to every line touched by the selection (or the cursor line).
function blogLinePrefix(ta, prefix) {
  const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
  const v = ta.value;
  const ls = v.lastIndexOf("\n", s - 1) + 1;            // start of first line
  let le = v.indexOf("\n", e); if (le === -1) le = v.length; // end of last line
  const block = v.slice(ls, le);
  const replaced = block.split("\n").map((l) => prefix + l).join("\n");
  ta.value = v.slice(0, ls) + replaced + v.slice(le);
  ta.selectionStart = ls;
  ta.selectionEnd = ls + replaced.length;
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
function blogMdAction(md, ta) {
  ta = ta || els.blogBodyInput;
  switch (md) {
    case "bold": return blogWrapSelection(ta, "**", "**", "加粗文字");
    case "italic": return blogWrapSelection(ta, "*", "*", "斜体文字");
    case "underline": return blogWrapSelection(ta, "<u>", "</u>", "下划线文字");
    case "code": return blogWrapSelection(ta, "`", "`", "代码");
    case "h2": return blogLinePrefix(ta, "## ");
    case "quote": return blogLinePrefix(ta, "> ");
    case "ul": return blogLinePrefix(ta, "- ");
    case "ol": return blogLinePrefix(ta, "1. ");
    case "hr": return blogInsertAtCursor(ta, "\n\n---\n\n");
    case "link": {
      const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
      const sel = ta.value.slice(s, e) || "链接文字";
      const text = "[" + sel + "](url)";
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      // Select the "url" placeholder so it's easy to replace.
      const urlStart = s + text.length - 4;
      ta.selectionStart = urlStart;
      ta.selectionEnd = urlStart + 3;
      ta.focus();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
  }
}

// ---- pick from images already in the images/ folder ----------------------
const BLOG_IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/i;
const BLOG_PICKER_PAGE_SIZE = 24;
let blogPickerItems = [];
let blogPickerPage = 0;
const blogPickerPicked = {}; // name -> true (survives paging)

async function blogTogglePicker() {
  if (!els.blogImgPicker.classList.contains("hidden")) {
    els.blogImgPicker.classList.add("hidden");
    return;
  }
  els.blogImgPicker.classList.remove("hidden");
  els.blogImgPickerGrid.innerHTML = "";
  els.blogImgPickerCount.textContent = "正在载入…";
  els.blogImgPickerPager.classList.add("hidden");
  try {
    const token = await getToken();
    await blogResolveFolder(token);
    let url = `${blogDriveBase}:/images:/children?$select=name,file,lastModifiedDateTime&$expand=thumbnails($select=medium,small)&$top=200`;
    const items = [];
    while (url) {
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      (data.value || []).forEach((it) => {
        if (it.file && BLOG_IMG_EXT.test(it.name || "")) items.push(it);
      });
      url = data["@odata.nextLink"] || null;
    }
    items.sort((a, b) => new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0)); // newest updated first
    blogPickerItems = items;
    blogPickerPage = 0;
    if (!items.length) {
      els.blogImgPickerCount.textContent = "images/ 文件夹暂无图片。";
      els.blogImgPickerPager.classList.add("hidden");
      return;
    }
    blogRenderPickerPage();
  } catch (e) {
    els.blogImgPickerCount.textContent = "";
    setStatus("载入已有图片失败：" + (e.message || e), "error");
  }
}

function blogRenderPickerPage() {
  const total = blogPickerItems.length;
  const pages = Math.max(1, Math.ceil(total / BLOG_PICKER_PAGE_SIZE));
  if (blogPickerPage > pages - 1) blogPickerPage = pages - 1;
  if (blogPickerPage < 0) blogPickerPage = 0;
  const start = blogPickerPage * BLOG_PICKER_PAGE_SIZE;
  const slice = blogPickerItems.slice(start, start + BLOG_PICKER_PAGE_SIZE);
  els.blogImgPickerCount.textContent = "共 " + total + " 张（点击插入，可连续多选）";
  els.blogImgPickerGrid.innerHTML = "";
  slice.forEach((it) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "blog-img-cell" + (blogPickerPicked[it.name] ? " picked" : "");
    cell.title = it.name;
    const im = document.createElement("img");
    const th = it.thumbnails && it.thumbnails[0];
    const src = th && ((th.medium && th.medium.url) || (th.small && th.small.url));
    if (src) im.src = src;
    im.alt = it.name;
    im.loading = "lazy";
    cell.appendChild(im);
    cell.onclick = () => {
      blogInsertAtCursor(els.blogBodyInput, "\n\n![](images/" + it.name + ")\n\n");
      els.blogImageHint.textContent = "已插入 images/" + it.name + "。";
      blogPickerPicked[it.name] = true;
      cell.classList.add("picked");
    };
    els.blogImgPickerGrid.appendChild(cell);
  });
  els.blogImgPickerPageInfo.textContent = "第 " + (blogPickerPage + 1) + " / 共 " + pages + " 页";
  els.blogImgPickerPrev.disabled = blogPickerPage <= 0;
  els.blogImgPickerNext.disabled = blogPickerPage >= pages - 1;
  els.blogImgPickerPager.classList.toggle("hidden", pages <= 1);
  els.blogImgPickerGrid.scrollTop = 0;
}

// ---- wiring --------------------------------------------------------------
function blogWireEvents() {
  els.commentReminderBtn.onclick = (e) => { e.stopPropagation(); els.commentReminderPanel.classList.toggle("hidden"); };
  document.addEventListener("click", (e) => { if (!els.commentReminderWrap.contains(e.target)) els.commentReminderPanel.classList.add("hidden"); });
  els.summaryModelInput.addEventListener("input", updateSummaryModelSaveState);
  els.summaryModelSaveBtn.onclick = () => saveSummaryModel();
  els.blogTabListBtn.onclick = () => blogOpenListTab();
  els.blogTabViewBtn.onclick = () => { if (blogViewId) { blogCapturePosition(blogActiveSection()); blogSwitchTab("view"); blogRestorePosition("view"); } };
  els.blogTabEditBtn.onclick = () => blogNew();
  els.blogTagToggle.onclick = (e) => { e.stopPropagation(); els.blogTagPanel.classList.toggle("hidden"); };
  els.blogTagAddBtn.onclick = () => blogAddTagCandidate();
  els.blogTagNewInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); blogAddTagCandidate(); } });
  document.addEventListener("click", (e) => { if (!els.blogTagSelect.contains(e.target)) els.blogTagPanel.classList.add("hidden"); });
  els.blogTopBtn.onclick = () => blogScrollToTitle();
  els.blogCommentBtn.onclick = () => {
    const forumViewing = !els.blogTabForum.classList.contains("hidden") &&
      !els.forumTopicView.classList.contains("hidden");
    const target = forumViewing ? els.forumReplyBox : els.blogComments;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    if (forumViewing) setTimeout(() => els.forumReplyInput.focus({ preventScroll: true }), 350);
  };
  window.addEventListener("scroll", blogUpdateTopButton, { passive: true });
  window.addEventListener("pageshow", () => requestAnimationFrame(blogUpdateTopButton));
  window.addEventListener("focus", () => requestAnimationFrame(blogUpdateTopButton));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestAnimationFrame(blogUpdateTopButton);
  });
  els.blogSearch.addEventListener("input", () => { blogListPage = 0; blogSearchText = els.blogSearch.value; blogRenderList(); });
  els.blogClearFilterBtn.onclick = () => { blogListPage = 0; els.blogSearch.value = ""; blogSearchText = ""; blogRenderList(); };
  const goBlogPage = () => {
    const pages = Math.max(1, Math.ceil(blogAllEntries().filter((p) => {
      const q = blogSearchText.trim().toLowerCase();
      if (blogTagFilter && !blogNormalizeTags(p.tags).includes(blogTagFilter)) return false;
      return !q || ((p.title || "") + " " + (p.searchText || p.excerpt || "") + " " + (p.date || "") + " " + blogNormalizeTags(p.tags).join(" ")).toLowerCase().includes(q);
    }).length / BLOG_LIST_PAGE_SIZE));
    const wanted = Math.floor(Number(els.blogListPageInput.value));
    if (!isFinite(wanted)) return;
    blogListPage = Math.max(0, Math.min(pages - 1, wanted - 1)); blogRenderList();
  };
  els.blogListFirst.onclick = () => { blogListPage = 0; blogRenderList(); };
  els.blogListPrev.onclick = () => { blogListPage--; blogRenderList(); };
  els.blogListNext.onclick = () => { blogListPage++; blogRenderList(); };
  els.blogListLast.onclick = () => { blogListPage = Number(els.blogListPageInput.max || 1) - 1; blogRenderList(); };
  els.blogListGo.onclick = goBlogPage;
  els.blogListPageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") goBlogPage(); });
  els.blogTagFilterClear.onclick = () => blogSetTagFilter("");
  els.blogPickExistingBtn.onclick = () => blogTogglePicker();
  els.blogAudioInput.onchange = () => uploadAudioFiles(els.blogAudioInput.files, els.blogBodyInput, els.blogAudioInput, els.blogAudioHint);
  els.blogPickAudioBtn.onclick = () => openAudioPicker(els.blogBodyInput);
  els.blogVideoInput.onchange = () => uploadVideoFiles(els.blogVideoInput.files, els.blogBodyInput, els.blogVideoInput, els.blogVideoHint);
  els.blogPickVideoBtn.onclick = () => openVideoPicker(els.blogBodyInput);
  els.blogMdToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".md-btn");
    if (btn && btn.dataset.md) blogMdAction(btn.dataset.md, els.blogBodyInput);
  });
  els.blogImgPickerClose.onclick = () => els.blogImgPicker.classList.add("hidden");
  els.blogImgPickerPrev.onclick = () => { blogPickerPage--; blogRenderPickerPage(); };
  els.blogImgPickerNext.onclick = () => { blogPickerPage++; blogRenderPickerPage(); };
  els.blogLightbox.onclick = () => blogCloseLightbox();
  els.blogCommentInput.addEventListener("input", () => {
    forumAutoGrowEditor(els.blogCommentInput);
    updateBlogCommentSubmitState();
  });
  document.querySelector(".comment-md-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest(".md-btn");
    if (btn && btn.dataset.md) { blogMdAction(btn.dataset.md, els.blogCommentInput); forumAutoGrowEditor(els.blogCommentInput); }
  });
  els.blogCommentSubmitBtn.onclick = () => blogSaveComment();
  els.blogCommentCancelBtn.onclick = () => blogResetCommentEditor();
  els.blogCommentImageInput.onchange = () => forumUploadImages(els.blogCommentImageInput.files, els.blogCommentInput, els.blogCommentImageInput, els.blogCommentImageHint);
  els.blogCommentAudioInput.onchange = () => uploadAudioFiles(els.blogCommentAudioInput.files, els.blogCommentInput, els.blogCommentAudioInput, els.blogCommentAudioHint);
  els.blogCommentVideoInput.onchange = () => uploadVideoFiles(els.blogCommentVideoInput.files, els.blogCommentInput, els.blogCommentVideoInput, els.blogCommentVideoHint);
  els.blogCommentPickImageBtn.onclick = () => forumOpenImagePicker(els.blogCommentInput);
  els.blogCommentPickAudioBtn.onclick = () => openAudioPicker(els.blogCommentInput);
  els.blogCommentPickVideoBtn.onclick = () => openVideoPicker(els.blogCommentInput);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.blogLightbox.classList.contains("hidden")) blogCloseLightbox();
  });
  els.blogBackBtn.onclick = () => { blogCapturePosition("view"); blogReturnToList(); };
  els.blogShareBtn.onclick = () => {
    const post = blogAllEntries().find((p) => p.id === blogViewId);
    if (post) sharePrivateLink("blog", post.id, post.title || "博客文章");
  };
  els.blogEditThisBtn.onclick = () => blogEditThis();
  els.blogDeleteThisBtn.onclick = () => blogDeleteThis();
  els.blogSaveBtn.onclick = () => blogSave();
  els.blogCancelBtn.onclick = () => { blogViewId ? blogSwitchTab("view") : blogSwitchTab("list"); };
els.blogImageInput.addEventListener("change", () => blogOnPickImages(els.blogImageInput.files));
}

/* ========================================================================= *
 *                        贴吧 (forum*)  —  主题 + 回帖                        *
 *   Topics live in the SAME OneDrive folder as the blog (family members       *
 *   already have edit access). Structure:  forum-index.json  +                *
 *   forum/<topicId>.json  ({ topic, posts:[{id,author,content,created}] }).   *
 *   Posts are Markdown, rendered with the blog renderer + image resolver.     *
 * ========================================================================= */
let forumDriveBase = "";
let forumTopics = [];          // index entries [{id,title,author,created,postCount,lastUpdated}]
let forumIndexEtag = null;
let forumLoaded = false;
let forumLoadPromise = null;
let forumCurTopicId = null;    // id of the open topic
let forumCurPosts = [];        // posts of the open topic
let forumCurEtag = null;       // eTag of forum/<id>.json (optimistic concurrency)
let forumOpenRequestId = 0;    // stale reads must not replace a newer topic
let forumSearchText = "";      // topic-title search filter
const FORUM_LIST_PAGE_SIZE = 20;
let forumListPage = 0;
const FORUM_POST_PAGE_SIZE = 20;
let forumPostPage = 0;
let forumPickerTarget = null;
let forumPickerItems = [];
let forumPickerPage = 0;

function forumCurrentAuthor() {
  return String((account && (account.name || account.username)) || "").trim();
}
function forumIsAuthor(value) {
  return !!value && String(value).trim().toLowerCase() === forumCurrentAuthor().toLowerCase();
}
function forumIsProtectedTopic(topic) {
  return !!topic && (topic.id === STK_FORUM_TOPIC_ID || topic.protected === true);
}
function forumCannotDeleteTopic(topic) { return forumIsProtectedTopic(topic) || !!(topic && (topic.id === CLOUD_GROWTH_TOPIC_ID || topic.noDelete)); }
function forumCannotDeleteReplies(topic) { return !!topic && (topic.id === CLOUD_GROWTH_TOPIC_ID || topic.repliesDeletable === false); }
function forumIsProtectedPost(post) {
  return !!post && (post.generated === true || post.protected === true);
}

// ---- folder addressing (reuses the blog folder via blogDriveBase) ---------
async function forumResolveFolder(token) {
  await blogResolveFolder(token);   // same folder as the blog
  forumDriveBase = blogDriveBase;
}
function forumEncPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function forumContentUrl(path) { return `${forumDriveBase}:/${forumEncPath(path)}:/content`; }

// ---- index JSON read/write (eTag optimistic concurrency) -----------------
async function forumReadIndex(token) {
  const res = await fetch(forumContentUrl(FORUM_INDEX_FILE), {
    cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Cache-Control": "no-cache" },
  });
  if (res.status === 404) return { topics: [], etag: null };
  if (!res.ok) throw new Error("载入贴吧索引失败：" + res.status);
  let data = null;
  try { data = await res.json(); }
  catch { throw new Error("贴吧索引内容无法解析，请下拉刷新重试。"); }
  const topics = (data && Array.isArray(data.topics)) ? data.topics : [];
  return { topics, etag: res.headers.get("ETag") };
}
async function forumWriteIndex(token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (forumIndexEtag) headers["If-Match"] = forumIndexEtag;
    const res = await fetch(forumContentUrl(FORUM_INDEX_FILE), {
      method: "PUT", headers, body: JSON.stringify({ topics: forumTopics }),
    });
    if (res.ok) { const it = await res.json(); forumIndexEtag = it.eTag; return; }
    if (res.status === 412) { // someone else changed it — reload & keep our edits by id
      const fresh = await forumReadIndex(token);
      const byId = {}; fresh.topics.forEach((t) => { byId[t.id] = t; });
      forumTopics.forEach((t) => { byId[t.id] = t; });
      forumTopics = Object.values(byId).sort(forumCmp);
      forumIndexEtag = fresh.etag;
      continue;
    }
    throw new Error("保存贴吧索引失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存贴吧索引冲突，重试多次仍失败。");
}

// ---- single topic read/write (posts merged by id on conflict) ------------
async function forumReadTopic(token, id) {
  const res = await fetch(forumContentUrl("forum/" + id + ".json"), {
    cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Cache-Control": "no-cache" },
  });
  if (res.status === 404) return await forumReadTopicByFileId(token, id);
  if (!res.ok) throw new Error("载入主题失败：" + res.status);
  const data = await forumParseTopicResponse(res);
  const posts = (data && Array.isArray(data.posts)) ? data.posts : [];
  return { topic: data && data.topic || null, posts, etag: res.headers.get("ETag"), notFound: false };
}

async function forumReadTopicByFileId(token, id) {
  const list = await fetch(`${forumDriveBase}:/forum:/children?$top=200`, {
    cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Cache-Control": "no-cache" },
  });
  if (!list.ok) throw new Error("核对主题文件失败：" + list.status);
  let items = null;
  try { items = await list.json(); }
  catch { throw new Error("主题目录内容无法解析，请下拉刷新重试。"); }
  const expected = id + ".json";
  const item = ((items && items.value) || []).find((entry) => entry.name === expected);
  if (!item) return { topic: null, posts: [], etag: null, notFound: true };
  const driveId = item.parentReference && item.parentReference.driveId;
  if (!driveId || !item.id) throw new Error("主题文件信息不完整，请下拉刷新重试。");
  const res = await fetch(`${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/content`, {
    cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error("按文件编号载入主题失败：" + res.status);
  const data = await forumParseTopicResponse(res);
  const posts = (data && Array.isArray(data.posts)) ? data.posts : [];
  return { topic: data && data.topic || null, posts, etag: res.headers.get("ETag") || item.eTag || null, notFound: false };
}

async function forumParseTopicResponse(res) {
  try { return await res.json(); }
  catch { throw new Error("主题内容无法解析，请下拉刷新重试。"); }
}
async function forumWriteTopic(token, topic, posts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (forumCurEtag) headers["If-Match"] = forumCurEtag;
    const res = await fetch(forumContentUrl("forum/" + topic.id + ".json"), {
      method: "PUT", headers, body: JSON.stringify({ topic, posts }),
    });
    if (res.ok) { const it = await res.json(); forumCurEtag = it.eTag; return; }
    if (res.status === 412) { // concurrent reply — merge posts by id, retry
      const fresh = await forumReadTopic(token, topic.id);
      const byId = {}; fresh.posts.forEach((p) => { byId[p.id] = p; });
      posts.forEach((p) => { byId[p.id] = p; });
      posts = Object.values(byId);
      forumCurEtag = fresh.etag;
      continue;
    }
    throw new Error("保存主题失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存主题冲突，重试多次仍失败。");
}

// newest-activity first (lastUpdated desc, then id desc)
function forumCmp(a, b) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  const ka = a.lastUpdated || a.created || "", kb = b.lastUpdated || b.created || "";
  if (ka !== kb) return kb < ka ? -1 : 1;
  return (b.id || "") < (a.id || "") ? -1 : 1;
}

// ---- load ----------------------------------------------------------------
async function forumLoad() {
  if (forumLoaded) return;
  if (forumLoadPromise) return forumLoadPromise;
  forumLoadPromise = forumLoadFull();
  try { await forumLoadPromise; }
  finally { forumLoadPromise = null; }
}
async function forumLoadFull() {
  setStatus("正在载入贴吧…");
  const token = await getToken();
  await forumResolveFolder(token);
  const idx = await forumReadIndex(token);
  forumTopics = idx.topics.slice().sort(forumCmp);
  forumIndexEtag = idx.etag;
  const growth = forumTopics.find((t) => t.id === CLOUD_GROWTH_TOPIC_ID);
  if (growth && (growth.pinned !== true || growth.noDelete !== true || growth.repliesDeletable !== false)) {
    growth.pinned = true; growth.noDelete = true; growth.repliesDeletable = false;
    forumTopics.sort(forumCmp);
    await forumWriteIndex(token);
  }
  forumLoaded = true;
  forumRenderList();
  forumSwitchTab("list");
  setStatus("已载入 " + forumTopics.length + " 个主题。", "ok", 2000);
}

// ---- sub-view switching (inside #blogTabForum) ---------------------------
function forumSwitchTab(tab) {
  els.forumTopicList.classList.toggle("hidden", tab !== "list");
  els.forumTopicEdit.classList.toggle("hidden", tab !== "edit");
  els.forumTopicView.classList.toggle("hidden", tab !== "view");
  requestAnimationFrame(blogUpdateTopButton);
}

// ---- topic list rendering -------------------------------------------------
function forumRenderList() {
  const q = forumSearchText.trim().toLowerCase();
  els.forumClearFilterBtn.classList.toggle("hidden", !q);
  const list = forumTopics.slice().filter((t) => !q || (t.title || "").toLowerCase().includes(q));
  list.forEach((t) => { if (t.id === CLOUD_GROWTH_TOPIC_ID) t.pinned = true; });
  list.sort(forumCmp);
  const pages = Math.max(1, Math.ceil(list.length / FORUM_LIST_PAGE_SIZE));
  forumListPage = Math.min(forumListPage, pages - 1);
  const pageRows = list.slice(forumListPage * FORUM_LIST_PAGE_SIZE, (forumListPage + 1) * FORUM_LIST_PAGE_SIZE);
  els.forumCount.textContent = "共 " + list.length + " 个主题";
  els.forumListPageInput.value = forumListPage + 1;
  els.forumListPageInput.max = pages;
  els.forumListPageInfo.textContent = "/ " + pages + " 页";
  els.forumListFirst.disabled = forumListPage === 0;
  els.forumListPrev.disabled = forumListPage === 0;
  els.forumListNext.disabled = forumListPage >= pages - 1;
  els.forumListLast.disabled = forumListPage >= pages - 1;
  els.forumListPager.classList.toggle("hidden", pages <= 1);
  els.forumList.innerHTML = "";
  els.forumEmpty.classList.toggle("hidden", list.length > 0);
  pageRows.forEach((t) => {
    const item = document.createElement("div");
    item.className = "forum-item" + (t.pinned ? " forum-item-pinned" : "");
    item.tabIndex = 0;
    const h = document.createElement("div");
    h.className = "forum-item-title";
    h.textContent = t.title || "(无标题)";
    if (t.pinned) {
      const badge = document.createElement("span");
      badge.className = "forum-pinned-badge";
      badge.textContent = "置顶";
      h.appendChild(document.createTextNode(" "));
      h.appendChild(badge);
    }
    const meta = document.createElement("div");
    meta.className = "forum-item-meta";
    meta.textContent = (t.author || "匿名") + " 发起 · " + formatBeijingTime(t.created) + " · " + (t.postCount || 0) + " 楼";
    item.appendChild(h); item.appendChild(meta);
    item.onclick = () => forumOpenTopic(t.id);
    item.onkeydown = (e) => { if (e.key === "Enter") forumOpenTopic(t.id); };
    els.forumList.appendChild(item);
  });
}

// ---- open / view a topic --------------------------------------------------
async function forumOpenTopic(id, fromDeepLink) {
  const topic = forumTopics.find((t) => t.id === id);
  if (!topic) return;
  const requestId = ++forumOpenRequestId;
  forumCurTopicId = id;
  forumPostPage = 0;
  history.replaceState(null, "", deepLinkUrl("forum", id));
  forumSwitchTab("view");
  els.forumViewTitle.textContent = topic.title || "(无标题)";
  els.forumViewMeta.textContent = (topic.author || "匿名") + " 发起 · " + formatBeijingTime(topic.created) + " · " + (topic.postCount || 0) + " 楼";
  els.forumEditBtn.classList.toggle("hidden", forumIsProtectedTopic(topic) || !forumIsAuthor(topic.author));
  els.forumDeleteBtn.classList.toggle("hidden", forumCannotDeleteTopic(topic) || !forumIsAuthor(topic.author));
  els.forumPosts.innerHTML = "<p class='muted'>正在载入…</p>";
  els.forumPostPager.classList.add("hidden");
  forumResetReplyEditor();
  try {
    const token = await getToken();
    await forumResolveFolder(token);
    const data = await forumReadTopic(token, id);
    if (requestId !== forumOpenRequestId || forumCurTopicId !== id) return;
    forumCurPosts = data.posts;
    forumCurEtag = data.etag;
    await forumRenderPosts(token);
  } catch (e) {
    if (requestId !== forumOpenRequestId || forumCurTopicId !== id) return;
    els.forumPosts.innerHTML = "";
    setStatus("打开主题失败：" + (e.message || e), "error");
  }
}

async function forumRenderPosts(token) {
  els.forumPosts.innerHTML = "";
  if (!forumCurPosts.length) {
    els.forumPosts.innerHTML = "<p class='muted'>暂无回帖。</p>";
    els.forumPostPager.classList.add("hidden");
    return;
  }
  const chronological = forumCurPosts.slice().sort((a, b) =>
    String(a.created || "").localeCompare(String(b.created || "")) ||
    String(a.id || "").localeCompare(String(b.id || "")));
  const topic = forumTopics.find((t) => t.id === forumCurTopicId);
  const isSystemTopic = forumCurTopicId === STK_FORUM_TOPIC_ID || !!(topic && topic.protected);
  const intro = chronological.find((p) => p.id === STK_FORUM_INTRO_POST_ID);
  const fixedPost = isSystemTopic ? intro : chronological[0];
  const replies = (isSystemTopic
    ? chronological.filter((p) => p.id !== STK_FORUM_INTRO_POST_ID)
    : chronological.slice(1)).reverse();
  const pages = Math.max(1, Math.ceil(replies.length / FORUM_POST_PAGE_SIZE));
  forumPostPage = Math.max(0, Math.min(forumPostPage, pages - 1));
  const pageReplies = replies.slice(forumPostPage * FORUM_POST_PAGE_SIZE, (forumPostPage + 1) * FORUM_POST_PAGE_SIZE);
  const displayPosts = (fixedPost ? [fixedPost] : []).concat(pageReplies);
  els.forumPostPageInput.value = forumPostPage + 1;
  els.forumPostPageInput.max = pages;
  els.forumPostPageInfo.textContent = "/ " + pages + " 页";
  els.forumPostFirst.disabled = forumPostPage === 0;
  els.forumPostPrev.disabled = forumPostPage === 0;
  els.forumPostNext.disabled = forumPostPage >= pages - 1;
  els.forumPostLast.disabled = forumPostPage >= pages - 1;
  els.forumPostPager.classList.toggle("hidden", pages <= 1);
  const floorById = new Map(chronological.map((p, i) => [p.id, i + 1]));
  displayPosts.forEach((p) => {
    const floor = floorById.get(p.id) || 1;
    const isOp = (!isSystemTopic && floor === 1) || p.id === STK_FORUM_INTRO_POST_ID;
    const div = document.createElement("div");
    div.className = "forum-post" + (isOp ? " forum-post-op" : "");
    div.dataset.postId = p.id;
    const meta = document.createElement("div");
    meta.className = "forum-post-meta";
    meta.textContent = (isOp ? "楼主 " : floor + "楼 ") +
      (p.author || "匿名") + " · " + formatBeijingTime(p.created);
    const body = document.createElement("div");
    body.className = "blog-body forum-post-body";
    body.innerHTML = blogRenderMarkdown(p.content || "");
    div.appendChild(meta); div.appendChild(body);
    if (!forumIsProtectedPost(p) && forumIsAuthor(p.author)) {
      const actions = document.createElement("div");
      actions.className = "forum-post-actions";
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "btn btn-ghost btn-mini"; edit.textContent = "编辑";
      edit.onclick = () => forumStartEditPost(p.id);
      actions.appendChild(edit);
      if (!isOp && !forumCannotDeleteReplies(topic)) {
        const del = document.createElement("button");
        del.type = "button"; del.className = "btn btn-danger btn-mini"; del.textContent = "删除";
        del.onclick = () => forumDeletePost(p.id);
        actions.appendChild(del);
      }
      div.appendChild(actions);
    }
    els.forumPosts.appendChild(div);
  });
  if (token) await blogResolveImages(token, els.forumPosts);
}

function forumPageForPost(id) {
  const chronological = forumCurPosts.slice().sort((a, b) =>
    String(a.created || "").localeCompare(String(b.created || "")) ||
    String(a.id || "").localeCompare(String(b.id || "")));
  const topic = forumTopics.find((t) => t.id === forumCurTopicId);
  const isSystemTopic = forumCurTopicId === STK_FORUM_TOPIC_ID || !!(topic && topic.protected);
  const replies = (isSystemTopic
    ? chronological.filter((p) => p.id !== STK_FORUM_INTRO_POST_ID)
    : chronological.slice(1)).reverse();
  const index = replies.findIndex((p) => p.id === id);
  return index < 0 ? 0 : Math.floor(index / FORUM_POST_PAGE_SIZE);
}

function scrollToRenderedItem(selector) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.querySelector(selector);
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
  }));
}

// ---- new topic ------------------------------------------------------------
function forumNewTopic() {
  forumOpenRequestId++;
  clearDeepLink();
  els.forumEditTitle.textContent = "新建主题";
  els.forumEditTopicId.value = "";
  els.forumSaveBtn.textContent = "发布主题";
  els.forumTitleInput.value = "";
  els.forumBodyInput.value = "";
  forumAutoGrowEditor(els.forumBodyInput);
  forumSwitchTab("edit");
}
function forumNextTopicId() {
  const d = todayStr();
  let n = 0;
  forumTopics.forEach((t) => {
    const m = (t.id || "").match(new RegExp("^" + d + "-(\\d+)$"));
    if (m) n = Math.max(n, parseInt(m[1], 10));
  });
  let id;
  do { n++; id = d + "-" + String(n).padStart(2, "0"); }
  while (forumTopics.some((t) => t.id === id));
  return id;
}
async function forumSaveTopic() {
  const title = els.forumTitleInput.value.trim();
  const content = els.forumBodyInput.value.trim();
  if (!title) { setStatus("请填写主题标题。", "warn"); els.forumTitleInput.focus(); return; }
  if (!content) { setStatus("请填写首楼正文。", "warn"); els.forumBodyInput.focus(); return; }
  els.forumSaveBtn.disabled = true;
  try {
    setStatus("正在发布主题…");
    const token = await getToken();
    await forumResolveFolder(token);
    const editId = els.forumEditTopicId.value;
    const id = editId || forumNextTopicId();
    const created = new Date().toISOString();
    const author = forumCurrentAuthor();
    let topic;
    if (editId) {
      topic = forumTopics.find((t) => t.id === editId);
      if (!topic || forumIsProtectedTopic(topic) || !forumIsAuthor(topic.author)) throw new Error("无权编辑该主题。");
      const updated = new Date().toISOString();
      topic.title = title; topic.lastUpdated = updated;
      await forumMutateTopic(token, topic, (posts) => posts.map((p, i) =>
        i === 0 ? Object.assign({}, p, { content, modified: updated }) : p));
    } else {
      topic = { id, title, author, created, postCount: 1, lastUpdated: created };
      forumCurEtag = null;
      await forumWriteTopic(token, topic, [{ id: "p1", author, content, created }]);
      forumTopics.push(topic);
    }
    forumTopics.sort(forumCmp);
    await forumWriteIndex(token);
    forumRenderList();
    await forumOpenTopic(id);
    setStatus(editId ? "主题已更新。" : "主题已发布。", "ok", 2500);
  } catch (e) {
    setStatus("发布失败：" + (e.message || e), "error");
  } finally {
    els.forumSaveBtn.disabled = false;
  }
}

function forumEditTopic() {
  const topic = forumTopics.find((t) => t.id === forumCurTopicId);
  if (!topic || forumIsProtectedTopic(topic) || !forumIsAuthor(topic.author)) return;
  const chronological = forumCurPosts.slice().sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
  els.forumEditTitle.textContent = "编辑主题";
  els.forumEditTopicId.value = topic.id;
  els.forumSaveBtn.textContent = "保存修改";
  els.forumTitleInput.value = topic.title || "";
  els.forumBodyInput.value = chronological[0] ? chronological[0].content || "" : "";
  forumAutoGrowEditor(els.forumBodyInput);
  forumSwitchTab("edit");
}

function forumCancelTopicEdit() {
  const id = els.forumEditTopicId.value;
  if (!id) { forumSwitchTab("list"); return; }
  forumCurTopicId = id;
  history.replaceState(null, "", deepLinkUrl("forum", id));
  forumSwitchTab("view");
}

function forumResetReplyEditor() {
  els.forumEditPostId.value = "";
  els.forumReplyInput.value = "";
  els.forumReplyInput.classList.remove("editing");
  forumAutoGrowEditor(els.forumReplyInput);
  els.forumReplyLabel.textContent = "发表回复（Markdown）";
  els.forumReplyBtn.textContent = "发表回复";
  els.forumReplyCancelBtn.classList.add("hidden");
}

function forumStartEditPost(id) {
  const post = forumCurPosts.find((p) => p.id === id);
  if (!post || forumIsProtectedPost(post) || !forumIsAuthor(post.author)) return;
  els.forumEditPostId.value = id;
  els.forumReplyInput.value = post.content || "";
  els.forumReplyInput.classList.add("editing");
  forumAutoGrowEditor(els.forumReplyInput);
  els.forumReplyLabel.textContent = "编辑回复（Markdown）";
  els.forumReplyBtn.textContent = "保存修改";
  els.forumReplyCancelBtn.classList.remove("hidden");
  els.forumReplyInput.focus();
}

function forumAutoGrowEditor(editor) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = Math.max(210, editor.scrollHeight) + "px";
}

async function forumOpenImagePicker(target) {
  forumPickerTarget = target;
  els.forumImgPicker.classList.remove("hidden");
  els.forumImgPickerCount.textContent = "正在载入…";
  try {
    const token = await getToken(); await blogResolveFolder(token);
    let url = `${blogDriveBase}:/images:/children?$select=name,file,lastModifiedDateTime&$expand=thumbnails($select=medium,small)&$top=200`;
    const items = [];
    while (url) {
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      (data.value || []).forEach((it) => { if (it.file && BLOG_IMG_EXT.test(it.name || "")) items.push(it); });
      url = data["@odata.nextLink"] || null;
    }
    items.sort((a, b) => new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0));
    forumPickerItems = items; forumPickerPage = 0;
    forumRenderImagePickerPage();
  } catch (e) { setStatus("载入已有图片失败：" + (e.message || e), "error"); }
}

function forumRenderImagePickerPage() {
  const pages = Math.max(1, Math.ceil(forumPickerItems.length / BLOG_PICKER_PAGE_SIZE));
  forumPickerPage = Math.max(0, Math.min(forumPickerPage, pages - 1));
  const items = forumPickerItems.slice(forumPickerPage * BLOG_PICKER_PAGE_SIZE, (forumPickerPage + 1) * BLOG_PICKER_PAGE_SIZE);
  els.forumImgPickerGrid.innerHTML = "";
  els.forumImgPickerCount.textContent = "共 " + forumPickerItems.length + " 张（点击插入）";
  items.forEach((it) => {
      const cell = document.createElement("button"); cell.type = "button"; cell.className = "blog-img-cell";
      const img = document.createElement("img"); const th = it.thumbnails && it.thumbnails[0];
      img.src = th && ((th.medium && th.medium.url) || (th.small && th.small.url)) || ""; img.alt = it.name;
      cell.appendChild(img); cell.onclick = () => {
        blogInsertAtCursor(forumPickerTarget, "\n\n![](images/" + it.name + ")\n\n");
        forumAutoGrowEditor(forumPickerTarget);
      };
      els.forumImgPickerGrid.appendChild(cell);
  });
  els.forumImgPickerPageInfo.textContent = "第 " + (forumPickerPage + 1) + " / " + pages + " 页";
  els.forumImgPickerPrev.disabled = forumPickerPage === 0;
  els.forumImgPickerNext.disabled = forumPickerPage >= pages - 1;
  els.forumImgPickerPager.classList.toggle("hidden", pages <= 1);
}

async function forumDeletePost(id) {
  const post = forumCurPosts.find((p) => p.id === id);
  const topic = forumTopics.find((t) => t.id === forumCurTopicId);
  if (!post || !topic || forumIsProtectedPost(post) || !forumIsAuthor(post.author)) return;
  if (forumCannotDeleteReplies(topic)) {
    setStatus("该主题的回复不能删除。", "warn", 3000);
    return;
  }
  const chronological = forumCurPosts.slice().sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
  if (chronological[0] && chronological[0].id === id) return;
  if (!confirm("确定删除这条回复吗？")) return;
  try {
    const token = await getToken();
    await forumResolveFolder(token);
    await forumMutateTopic(token, topic, (posts) => posts.filter((p) => p.id !== id));
    topic.postCount = forumCurPosts.length;
    topic.lastUpdated = new Date().toISOString();
    forumTopics.sort(forumCmp);
    await forumWriteIndex(token);
    await forumRenderPosts(token);
    forumRenderList();
    setStatus("回复已删除。", "ok", 2000);
  } catch (e) {
    setStatus("删除回复失败：" + (e.message || e), "error");
  }
}

// ---- reply ---------------------------------------------------------------
async function forumReply() {
  const content = els.forumReplyInput.value.trim();
  if (!content) { setStatus("请填写回复内容。", "warn"); els.forumReplyInput.focus(); return; }
  const topicId = forumCurTopicId;
  if (!topicId) return;
  const editId = els.forumEditPostId.value;
  let post = null;
  els.forumReplyBtn.disabled = true;
  try {
    setStatus("正在发表回复…");
    const token = await getToken();
    await forumResolveFolder(token);
    const author = (account && (account.name || account.username)) || "";
    const topic = forumTopics.find((t) => t.id === topicId);
    if (!topic || forumCurTopicId !== topicId) throw new Error("当前主题已变化，请重新发表回复。");
    if (editId) {
      const existing = forumCurPosts.find((p) => p.id === editId);
      if (!existing || forumIsProtectedPost(existing) || !forumIsAuthor(existing.author)) throw new Error("无权编辑该回复。");
      const modified = new Date().toISOString();
      await forumMutateTopic(token, topic, (posts) => posts.map((p) =>
        p.id === editId ? Object.assign({}, p, { content, modified }) : p));
      topic.lastUpdated = modified;
    } else {
      post = { id: "p" + Date.now(), author, content, created: new Date().toISOString() };
      forumCurPosts.push(post);
      await forumWriteTopic(token, topic, forumCurPosts);
      topic.lastUpdated = post.created;
    }
    if (topic) {
      topic.postCount = forumCurPosts.length;
    }
    forumTopics.sort(forumCmp);
    await forumWriteIndex(token);
    if (forumCurTopicId !== topicId) return;
    history.replaceState(null, "", deepLinkUrl("forum", topicId));
    forumResetReplyEditor();
    const targetId = editId || post.id;
    forumPostPage = forumPageForPost(targetId);
    await forumRenderPosts(token);
    scrollToRenderedItem(`[data-post-id="${CSS.escape(targetId)}"]`);
    forumRenderList();
    setStatus(editId ? "回复已更新。" : "已回复。", "ok", 2000);
  } catch (e) {
    if (post) forumCurPosts = forumCurPosts.filter((p) => p.id !== post.id);
    setStatus("回复失败：" + (e.message || e), "error");
  } finally {
    els.forumReplyBtn.disabled = false;
  }
}

// ---- delete topic ---------------------------------------------------------
async function forumDeleteTopic() {
  const topic = forumTopics.find((t) => t.id === forumCurTopicId);
  if (!topic) return;
  if (forumCannotDeleteTopic(topic)) {
    setStatus("该主题已保护，不能手动删除。", "warn", 4000);
    return;
  }
  if (!confirm("确定删除该主题吗？\n「" + (topic.title || "") + "」\n（其下所有回帖将一并删除）")) return;
  try {
    setStatus("正在删除…");
    const token = await getToken();
    await forumResolveFolder(token);
    forumTopics = forumTopics.filter((t) => t.id !== topic.id);
    await forumWriteIndex(token);
    await fetch(`${forumDriveBase}:/${forumEncPath("forum/" + topic.id + ".json")}`, {
      method: "DELETE", headers: { Authorization: "Bearer " + token },
    });
    forumCurTopicId = null;
    forumCurPosts = [];
    forumCurEtag = null;
    clearDeepLink();
    forumRenderList();
    forumSwitchTab("list");
    setStatus("已删除。", "ok", 2500);
  } catch (e) {
    setStatus("删除失败：" + (e.message || e), "error");
  }
}

// ---- wiring --------------------------------------------------------------
function forumWireEvents() {
  els.blogTabForumBtn.onclick = async () => { blogCapturePosition(blogActiveSection()); clearDeepLink(); blogSwitchTab("forum"); await forumLoad(); blogRestorePosition("forum"); };
  els.forumNewTopicBtn.onclick = () => forumNewTopic();
  els.forumSearch.addEventListener("input", () => { forumListPage = 0; forumSearchText = els.forumSearch.value; forumRenderList(); });
  els.forumClearFilterBtn.onclick = () => {
    forumListPage = 0; forumSearchText = ""; els.forumSearch.value = ""; forumRenderList();
  };
  const goForumPage = () => {
    const q = forumSearchText.trim().toLowerCase();
    const total = forumTopics.filter((t) => !q || (t.title || "").toLowerCase().includes(q)).length;
    const pages = Math.max(1, Math.ceil(total / FORUM_LIST_PAGE_SIZE));
    const wanted = Math.floor(Number(els.forumListPageInput.value));
    if (!isFinite(wanted)) return;
    forumListPage = Math.max(0, Math.min(pages - 1, wanted - 1)); forumRenderList();
  };
  els.forumListFirst.onclick = () => { forumListPage = 0; forumRenderList(); };
  els.forumListPrev.onclick = () => { forumListPage--; forumRenderList(); };
  els.forumListNext.onclick = () => { forumListPage++; forumRenderList(); };
  els.forumListLast.onclick = () => { forumListPage = Number(els.forumListPageInput.max || 1) - 1; forumRenderList(); };
  els.forumListGo.onclick = goForumPage;
  els.forumListPageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") goForumPage(); });
  const goForumPostPage = async () => {
    const wanted = Math.floor(Number(els.forumPostPageInput.value));
    if (!isFinite(wanted)) return;
    const pages = Number(els.forumPostPageInput.max || 1);
    forumPostPage = Math.max(0, Math.min(pages - 1, wanted - 1));
    await forumRenderPosts(await getToken());
    els.forumPosts.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  els.forumPostFirst.onclick = async () => { forumPostPage = 0; await forumRenderPosts(await getToken()); els.forumPosts.scrollIntoView({ block: "start", behavior: "smooth" }); };
  els.forumPostPrev.onclick = async () => { forumPostPage--; await forumRenderPosts(await getToken()); els.forumPosts.scrollIntoView({ block: "start", behavior: "smooth" }); };
  els.forumPostNext.onclick = async () => { forumPostPage++; await forumRenderPosts(await getToken()); els.forumPosts.scrollIntoView({ block: "start", behavior: "smooth" }); };
  els.forumPostLast.onclick = async () => { forumPostPage = Number(els.forumPostPageInput.max || 1) - 1; await forumRenderPosts(await getToken()); els.forumPosts.scrollIntoView({ block: "start", behavior: "smooth" }); };
  els.forumPostGo.onclick = goForumPostPage;
  els.forumPostPageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") goForumPostPage(); });
  els.forumSaveBtn.onclick = () => forumSaveTopic();
  els.forumCancelBtn.onclick = () => forumCancelTopicEdit();
  els.forumBackBtn.onclick = () => { blogCapturePosition("forum"); forumReturnToList(); };
  els.forumShareBtn.onclick = () => {
    const topic = forumTopics.find((t) => t.id === forumCurTopicId);
    if (topic) sharePrivateLink("forum", topic.id, topic.title || "贴吧主题");
  };
  els.forumEditBtn.onclick = () => forumEditTopic();
  els.forumDeleteBtn.onclick = () => forumDeleteTopic();
  els.forumReplyBtn.onclick = () => forumReply();
  els.forumReplyCancelBtn.onclick = () => forumResetReplyEditor();
  els.forumReplyInput.addEventListener("input", () => forumAutoGrowEditor(els.forumReplyInput));
  els.forumBodyInput.addEventListener("input", () => forumAutoGrowEditor(els.forumBodyInput));
  document.querySelectorAll(".forum-md-toolbar").forEach((toolbar) => toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".md-btn");
    const target = document.getElementById(toolbar.dataset.target);
    if (btn && btn.dataset.md && target) { blogMdAction(btn.dataset.md, target); forumAutoGrowEditor(target); }
  }));
  els.forumTopicImageInput.onchange = () => forumUploadImages(els.forumTopicImageInput.files, els.forumBodyInput, els.forumTopicImageInput, els.forumTopicImageHint);
  els.forumReplyImageInput.onchange = () => forumUploadImages(els.forumReplyImageInput.files, els.forumReplyInput, els.forumReplyImageInput, els.forumReplyImageHint);
  els.forumTopicPickBtn.onclick = () => forumOpenImagePicker(els.forumBodyInput);
  els.forumReplyPickBtn.onclick = () => forumOpenImagePicker(els.forumReplyInput);
  els.forumTopicAudioInput.onchange = () => uploadAudioFiles(els.forumTopicAudioInput.files, els.forumBodyInput, els.forumTopicAudioInput, els.forumTopicAudioHint);
  els.forumReplyAudioInput.onchange = () => uploadAudioFiles(els.forumReplyAudioInput.files, els.forumReplyInput, els.forumReplyAudioInput, els.forumReplyAudioHint);
  els.forumTopicAudioPickBtn.onclick = () => openAudioPicker(els.forumBodyInput);
  els.forumReplyAudioPickBtn.onclick = () => openAudioPicker(els.forumReplyInput);
  els.forumTopicVideoInput.onchange = () => uploadVideoFiles(els.forumTopicVideoInput.files, els.forumBodyInput, els.forumTopicVideoInput, els.forumTopicVideoHint);
  els.forumReplyVideoInput.onchange = () => uploadVideoFiles(els.forumReplyVideoInput.files, els.forumReplyInput, els.forumReplyVideoInput, els.forumReplyVideoHint);
  els.forumTopicVideoPickBtn.onclick = () => openVideoPicker(els.forumBodyInput);
  els.forumReplyVideoPickBtn.onclick = () => openVideoPicker(els.forumReplyInput);
  els.audioPickerClose.onclick = () => els.audioPicker.classList.add("hidden");
  els.videoPickerClose.onclick = () => els.videoPicker.classList.add("hidden");
  els.forumImgPickerClose.onclick = () => els.forumImgPicker.classList.add("hidden");
  els.forumImgPickerPrev.onclick = () => { forumPickerPage--; forumRenderImagePickerPage(); };
  els.forumImgPickerNext.onclick = () => { forumPickerPage++; forumRenderImagePickerPage(); };
  els.forumReplyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) forumReply();
  });
}

/* ========================================================================= *
 *                    旅行地图 (travel*)  —  腾讯地图 + 记录                     *
 *   Records live in the shared OtherTracker folder (EXTRA_FOLDER_SHARE_URL)  *
 *   as travel.json:  { records: [{id,title,date,latitude,longitude,          *
 *   remark,people,createdBy,modified}], customPeople: [name, ...] }. The map *
 *   is Tencent Map GL JS. customPeople is the shared pool of extra people    *
 *   (besides Nathan/Celine/Cloud) remembered across the family.              *
 * ========================================================================= */
let travelDriveBase = "";
let travelRecords = [];        // travel.json records
let travelCustomPeople = [];   // travel.json customPeople (shared extra people)
let travelEtag = null;
let travelLoaded = false;
let travelMapObj = null;       // TMap.Map instance
let travelMarkerLayer = null;  // TMap.MultiMarker layer
let travelInfoWindow = null;   // currently open info window
let travelMapInited = false;   // map + script ready
let travelMapInitPromise = null;
let travelPickedCoords = null; // {lat, lng} from the latest map click
let travelMarkerClickAt = 0;
let travelSuggestionService = null;
let travelPlaceResults = [];
let travelSelectedPlace = null;
let travelSearchMarkerLayer = null;
let travelPlaceRequestId = 0;
let travelPlaceSearchInFlight = 0;
let travelPlaceQuotaExceeded = false;
const travelPlaceCache = new Map();

const TRAVEL_FAMILY = ["Nathan Zhu", "Celine Rao", "Cloud Zhu"];
function travelCleanCustomPeople(values) {
  return (Array.isArray(values) ? values : []).map(travelNormalizeName)
    .filter((name, index, all) => name && !TRAVEL_FAMILY.includes(name) && all.indexOf(name) === index);
}
function travelPeoplePool() {
  return TRAVEL_FAMILY.concat(travelCleanCustomPeople(travelCustomPeople));
}

// Names in the CSV look like "Nathan Zhu CN" — strip a trailing 2-letter
// country suffix for display/filtering so form checkboxes ("Nathan Zhu") match.
function travelNormalizeName(n) {
  return (n || "").trim().replace(/\s+[A-Za-z]{2}$/, "");
}
function travelPeopleOf(r) {
  return (r && Array.isArray(r.people) ? r.people : []).map(travelNormalizeName).filter(Boolean);
}
function travelCmp(a, b) {
  if ((a.date || "") !== (b.date || "")) return (b.date || "") < (a.date || "") ? -1 : 1;
  return (b.title || "") < (a.title || "") ? -1 : 1;
}

// ---- folder + file addressing (OtherTracker folder) -----------------------
async function travelResolveFolder(token) {
  if (travelDriveBase) return;
  const sid = encodeShareUrl(TRAVEL_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问 OtherTracker 文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  travelDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function travelEncPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function travelContentUrl(path) { return `${travelDriveBase}:/${travelEncPath(path)}:/content`; }

// ---- travel.json read/write (eTag optimistic concurrency) ----------------
async function travelRead(token) {
  const res = await fetch(travelContentUrl(TRAVEL_RECORDS_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { records: [], customPeople: [], etag: null };
  if (!res.ok) throw new Error("载入旅行数据失败：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const records = (data && Array.isArray(data.records)) ? data.records : [];
  const customPeople = travelCleanCustomPeople(data && data.customPeople);
  return { records, customPeople, etag: res.headers.get("ETag") };
}
async function travelWrite(token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    travelCustomPeople = travelCleanCustomPeople(travelCustomPeople);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (travelEtag) headers["If-Match"] = travelEtag;
    const res = await fetch(travelContentUrl(TRAVEL_RECORDS_FILE), {
      method: "PUT", headers, body: JSON.stringify({ records: travelRecords, customPeople: travelCustomPeople }),
    });
    if (res.ok) { const it = await res.json(); travelEtag = it.eTag; return; }
    if (res.status === 412) { // merge by id, keep our edits
      const fresh = await travelRead(token);
      const byId = {}; fresh.records.forEach((r) => { byId[r.id] = r; });
      travelRecords.forEach((r) => { byId[r.id] = r; });
      travelRecords = Object.values(byId).sort(travelCmp);
      travelCustomPeople = travelCleanCustomPeople(
        travelCustomPeople.concat(fresh.customPeople || []));
      travelEtag = fresh.etag;
      continue;
    }
    throw new Error("保存旅行数据失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存旅行数据冲突，重试多次仍失败。");
}

// ---- load ----------------------------------------------------------------
async function travelLoad(force) {
  if (travelLoaded && !force) return;
  setStatus("正在载入旅行数据…");
  const token = await getToken();
  await travelResolveFolder(token);
  const data = await travelRead(token);
  travelRecords = data.records.slice().sort(travelCmp);
  travelCustomPeople = travelCleanCustomPeople(data.customPeople);
  travelEtag = data.etag;
  travelLoaded = true;
  travelRenderPersonFilter();
  travelRenderList();
  travelRenderMarkers();
  travelEnsureMap();
  setStatus("已载入 " + travelRecords.length + " 条旅行记录。", "ok", 2000);
}

// ---- person filter -------------------------------------------------------
function travelRenderPersonFilter() {
  const selected = els.travelPersonFilter.value || "__all__";
  const names = {};
  travelRecords.forEach((r) => travelPeopleOf(r).forEach((n) => { names[n] = true; }));
  const opts = Object.keys(names).sort();
  els.travelPersonFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "__all__"; all.textContent = "全部";
  els.travelPersonFilter.appendChild(all);
  opts.forEach((n) => {
    const o = document.createElement("option");
    o.value = n; o.textContent = n;
    els.travelPersonFilter.appendChild(o);
  });
  els.travelPersonFilter.value = opts.includes(selected) ? selected : "__all__";
}

async function forumMutateTopic(token, topic, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await forumReadTopic(token, topic.id);
    const posts = fresh.posts.slice();
    const next = mutate(posts);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (fresh.etag) headers["If-Match"] = fresh.etag;
    const res = await fetch(forumContentUrl("forum/" + topic.id + ".json"), {
      method: "PUT", headers, body: JSON.stringify({ topic, posts: next }),
    });
    if (res.ok) {
      forumCurPosts = next;
      forumCurEtag = (await res.json()).eTag || null;
      return;
    }
    if (res.status === 412) continue;
    throw new Error("保存主题失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存主题冲突，重试多次仍失败。");
}

// ---- list rendering ------------------------------------------------------
function travelRenderList() {
  const q = (els.travelSearch.value || "").trim().toLowerCase();
  const list = travelRecords.filter((r) =>
    !q || ((r.title || "") + " " + (r.remark || "")).toLowerCase().includes(q));
  els.travelListCount.textContent = "共 " + list.length + " 条";
  const tbody = els.travelTableBody;
  tbody.innerHTML = "";
  els.travelListEmpty.classList.toggle("hidden", list.length > 0);
  list.forEach((r) => {
    const tr = document.createElement("tr");
    const td = (t) => { const c = document.createElement("td"); c.textContent = t; return c; };
    tr.appendChild(td(r.date || ""));
    tr.appendChild(td(r.title || ""));
    tr.appendChild(td(r.longitude != null ? String(r.longitude) : ""));
    tr.appendChild(td(r.latitude != null ? String(r.latitude) : ""));
    tr.appendChild(td(travelPeopleOf(r).join(", ")));
    tr.appendChild(td(r.remark || ""));
    const ops = document.createElement("td");
    const editBtn = document.createElement("button");
    editBtn.type = "button"; editBtn.className = "btn btn-ghost btn-mini";
    editBtn.textContent = "编辑"; editBtn.onclick = () => travelEdit(r.id);
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "btn btn-danger btn-mini";
    delBtn.textContent = "删除"; delBtn.onclick = () => travelDelete(r.id);
    ops.appendChild(editBtn); ops.appendChild(document.createTextNode(" ")); ops.appendChild(delBtn);
    tr.appendChild(ops);
    tbody.appendChild(tr);
  });
}

// ---- map (Tencent GL JS) -------------------------------------------------
let travelMapScriptPromise = null;
function travelLoadMapScript() {
  if (window.TMap) return Promise.resolve();
  if (travelMapScriptPromise) return travelMapScriptPromise;
  travelMapScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TENCENT_MAP_LIB_URL + encodeURIComponent(TENCENT_MAP_KEY);
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("腾讯地图脚本加载失败（检查网络或 Key）"));
    document.head.appendChild(s);
  });
  return travelMapScriptPromise;
}

async function travelEnsureMap() {
  if (travelMapInited) return;
  if (travelMapInitPromise) return travelMapInitPromise;
  travelMapInitPromise = travelInitMap();
  try { await travelMapInitPromise; }
  finally { travelMapInitPromise = null; }
}

async function travelInitMap() {
  if (!TENCENT_MAP_KEY || TENCENT_MAP_KEY.startsWith("PASTE-")) {
    els.travelMapEmpty.classList.remove("hidden");
    els.travelMapEmpty.textContent = "请先在 app.js 配置 TENCENT_MAP_KEY（腾讯地图开发者 key）。";
    return;
  }
  try {
    await travelLoadMapScript();
  } catch (e) {
    els.travelMapEmpty.classList.remove("hidden");
    els.travelMapEmpty.textContent = "加载腾讯地图失败：" + (e.message || e);
    return;
  }
  els.travelMapEmpty.classList.add("hidden");
  travelMapObj = new TMap.Map(els.travelMap, {
    center: new TMap.LatLng(31.2, 121.5),
    zoom: 5,
    viewMode: "2D",
  });
  travelSuggestionService = new TMap.service.Suggestion({ pageSize: 8 });
  travelMapObj.removeControl(TMap.constants.DEFAULT_CONTROL_ID.ROTATION);
  travelMapObj.on("click", (e) => {
    if (Date.now() - travelMarkerClickAt < 500) return;
    const ll = travelLL(e.latLng);
    if (travelInfoWindow) travelInfoWindow.close();
    travelClearPlaceSearch(true);
    travelShowCoords(ll.lat, ll.lng);
  });
  window.addEventListener("resize", () => { if (travelMapObj) travelMapObj.resize(); });
  travelMapInited = true;
  travelMapObj.resize();
  travelShowCoords(null);
  travelRenderMarkers();
}

function travelClearSearchMarker() {
  if (!travelSearchMarkerLayer) return;
  const ids = travelSearchMarkerLayer.getGeometries().map((geometry) => geometry.id);
  if (ids.length) travelSearchMarkerLayer.remove(ids);
}

function travelShowSearchMarker(lat, lng) {
  if (!travelMapObj || typeof TMap === "undefined") return;
  const geometry = [{ id: "travel-search", styleId: "search", position: new TMap.LatLng(lat, lng) }];
  if (!travelSearchMarkerLayer) {
    travelSearchMarkerLayer = new TMap.MultiMarker({
      map: travelMapObj,
      isStopPropagation: true,
      styles: {
        search: new TMap.MarkerStyle({
          width: 32, height: 44, anchor: { x: 16, y: 44 }, src: TRAVEL_SEARCH_MARKER_SRC,
        }),
      },
      geometries: geometry,
    });
    if (travelSearchMarkerLayer.setStopPropagation) travelSearchMarkerLayer.setStopPropagation(true);
  } else {
    travelClearSearchMarker();
    travelSearchMarkerLayer.add(geometry);
  }
}

function travelClearPlaceSearch(clearInput) {
  travelPlaceRequestId++;
  travelPlaceSearchInFlight = 0;
  travelPlaceResults = [];
  travelSelectedPlace = null;
  els.travelPlaceResults.innerHTML = "";
  els.travelPlaceResults.classList.add("hidden");
  els.travelPlaceStatus.textContent = "";
  els.travelPlaceClearBtn.classList.add("hidden");
  if (clearInput) els.travelPlaceSearch.value = "";
  travelClearSearchMarker();
  els.travelCoordPlaceRow.classList.add("hidden");
  els.travelCoordPlace.textContent = "—";
  els.travelPlaceSearchBtn.disabled = false;
}

function travelRenderPlaceResults(rows) {
  els.travelPlaceResults.innerHTML = "";
  rows.forEach((place, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "travel-place-result";
    button.setAttribute("role", "option");
    const title = document.createElement("strong");
    title.textContent = place.title || place.name || "未命名地点";
    const address = document.createElement("span");
    address.textContent = [place.city, place.address].filter(Boolean).join(" · ");
    button.appendChild(title); button.appendChild(address);
    const stop = (event) => event.stopPropagation();
    button.addEventListener("pointerdown", stop);
    button.addEventListener("touchstart", stop, { passive: true });
    button.addEventListener("mousedown", stop);
    button.onclick = (event) => {
      event.preventDefault(); event.stopPropagation();
      travelSelectPlace(index);
    };
    els.travelPlaceResults.appendChild(button);
  });
  els.travelPlaceResults.classList.toggle("hidden", rows.length === 0);
}

function travelSelectPlace(index) {
  const place = travelPlaceResults[index];
  if (!place || !place.location) return;
  const coords = travelLL(place.location);
  if (!isFinite(coords.lat) || !isFinite(coords.lng)) return;
  travelSelectedPlace = {
    title: place.title || place.name || "",
    address: place.address || "",
    city: place.city || "",
    lat: coords.lat, lng: coords.lng,
  };
  travelMarkerClickAt = Date.now();
  els.travelPlaceSearch.value = travelSelectedPlace.title;
  els.travelPlaceResults.classList.add("hidden");
  els.travelPlaceStatus.textContent = "正在定位到：" + travelSelectedPlace.title;
  els.travelPlaceClearBtn.classList.remove("hidden");
  travelShowCoords(coords.lat, coords.lng);
  els.travelCoordPlace.textContent = travelSelectedPlace.title || "—";
  els.travelCoordPlaceRow.classList.toggle("hidden", !travelSelectedPlace.title);
  travelMapObj.resize();
  const center = new TMap.LatLng(coords.lat, coords.lng);
  let markerShown = false;
  const showMarker = () => {
    if (markerShown || travelSelectedPlace == null ||
        travelSelectedPlace.lat !== coords.lat || travelSelectedPlace.lng !== coords.lng) return;
    markerShown = true;
    try { travelShowSearchMarker(coords.lat, coords.lng); }
    catch (e) { console.warn("travel search marker:", e); }
    els.travelPlaceStatus.textContent = "已定位到：" + [travelSelectedPlace.title, travelSelectedPlace.address]
      .filter(Boolean).join(" · ");
  };
  if (travelMapObj.once) travelMapObj.once("idle", showMarker);
  if (travelMapObj.easeTo) travelMapObj.easeTo({ center, zoom: 16 }, { duration: 500 });
  else { travelMapObj.setCenter(center); travelMapObj.setZoom(16); }
  setTimeout(showMarker, 900);
}

async function travelSearchPlaces() {
  const keyword = (els.travelPlaceSearch.value || "").trim();
  if (!keyword) { setStatus("请输入要搜索的地图位置。", "warn", 2000); return; }
  if (travelPlaceQuotaExceeded) {
    els.travelPlaceStatus.textContent = "腾讯地图地点搜索今日额度已用完，请明日再试；地图点击取坐标仍可使用。";
    return;
  }
  if (travelPlaceSearchInFlight) {
    els.travelPlaceStatus.textContent = "地点搜索正在进行，请稍候。";
    return;
  }
  const cacheKey = keyword.toLocaleLowerCase("zh-CN");
  if (travelPlaceCache.has(cacheKey)) {
    travelPlaceResults = travelPlaceCache.get(cacheKey);
    travelRenderPlaceResults(travelPlaceResults);
    els.travelPlaceStatus.textContent = travelPlaceResults.length
      ? `找到 ${travelPlaceResults.length} 个地图位置，请选择（缓存）。` : "没有找到匹配的地图位置（缓存）。";
    els.travelPlaceClearBtn.classList.remove("hidden");
    return;
  }
  const requestId = ++travelPlaceRequestId;
  travelPlaceSearchInFlight = requestId;
  els.travelPlaceSearchBtn.disabled = true;
  els.travelPlaceStatus.textContent = "正在搜索地图位置…";
  try {
    await travelEnsureMap();
    if (!travelSuggestionService) {
      throw new Error("地点搜索服务尚未加载，请检查腾讯地图 Key 权限。");
    }
    const response = await travelSuggestionService.getSuggestions({
      keyword,
      location: travelMapObj && travelMapObj.getCenter ? travelMapObj.getCenter() : undefined,
    });
    if (requestId !== travelPlaceRequestId) return;
    travelPlaceResults = (response && Array.isArray(response.data) ? response.data : []).slice(0, 8);
    travelPlaceCache.set(cacheKey, travelPlaceResults);
    travelRenderPlaceResults(travelPlaceResults);
    els.travelPlaceStatus.textContent = travelPlaceResults.length
      ? `找到 ${travelPlaceResults.length} 个地图位置，请选择。` : "没有找到匹配的地图位置。";
    els.travelPlaceClearBtn.classList.remove("hidden");
  } catch (e) {
    const status = Number(e && (e.status || e.code));
    if (status === 121 || /调用量|额度|quota/i.test(String(e && (e.message || e)))) {
      travelPlaceQuotaExceeded = true;
    }
    if (requestId !== travelPlaceRequestId) return;
    travelPlaceResults = [];
    travelRenderPlaceResults([]);
    if (travelPlaceQuotaExceeded) {
      els.travelPlaceStatus.textContent = "腾讯地图地点搜索今日额度已用完，请明日再试；地图点击取坐标仍可使用。";
    } else {
      els.travelPlaceStatus.textContent = "搜索地图位置失败：" + (e.message || e);
    }
  } finally {
    if (travelPlaceSearchInFlight === requestId) travelPlaceSearchInFlight = 0;
    if (requestId === travelPlaceRequestId) els.travelPlaceSearchBtn.disabled = false;
  }
}

function travelInfoHtml(r) {
  const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const people = travelPeopleOf(r).map(esc).join(", ");
  const remark = r.remark ? "<div style='margin-top:5px;color:#555;overflow-wrap:anywhere;'>" + esc(r.remark) + "</div>" : "";
  return "<div style='width:220px;max-width:70vw;font-size:13px;line-height:1.5;white-space:normal;'>" +
    "<b style='display:block;overflow-wrap:anywhere;'>" + esc(r.title) + "</b>" +
    "<div style='color:#888;font-size:12px;'>" + esc(r.date) + "</div>" +
    (people ? "<div style='color:#888;font-size:12px;overflow-wrap:anywhere;'>" + people + "</div>" : "") +
    remark + "</div>";
}

function travelFilteredRecords() {
  const sel = els.travelPersonFilter.value;
  if (!sel || sel === "__all__") return travelRecords.slice();
  return travelRecords.filter((r) => travelPeopleOf(r).includes(sel));
}

// TMap.LatLng exposes both .lat/.lng properties and getLat()/getLng() methods
// depending on API version — read whichever is available.
function travelLL(ll) {
  return {
    lat: Number(ll.lat != null ? ll.lat : ll.getLat()),
    lng: Number(ll.lng != null ? ll.lng : ll.getLng()),
  };
}

const TRAVEL_MARKER_SRC = "https://mapapi.qq.com/web/lbs/javascriptGL/demo/img/markerDefault.png";
const TRAVEL_SEARCH_MARKER_SRC = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">' +
  '<path fill="#d92d20" stroke="#fff" stroke-width="2" d="M16 1C8.3 1 2 7.3 2 15c0 10.4 14 27 14 27s14-16.6 14-27C30 7.3 23.7 1 16 1z"/>' +
  '<circle cx="16" cy="15" r="5" fill="#fff"/></svg>');
function travelValidCoords(r) {
  const lat = Number(r && r.latitude), lng = Number(r && r.longitude);
  return isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function travelCreateMarkerLayer(geometries) {
  travelMarkerLayer = new TMap.MultiMarker({
    map: travelMapObj,
    isStopPropagation: true,
    styles: {
      default: new TMap.MarkerStyle({
        width: 25, height: 35,
        anchor: { x: 12, y: 35 },
        src: TRAVEL_MARKER_SRC,
      }),
    },
    geometries,
  });
  if (travelMarkerLayer.setStopPropagation) travelMarkerLayer.setStopPropagation(true);
  travelMarkerLayer.on("click", (e) => {
    travelMarkerClickAt = Date.now();
    const g = e.geometry;
    const recordId = (g.properties && g.properties.id) || g.id;
    const r = travelRecords.find((x) => x.id === recordId);
    if (!r) return;
    if (travelInfoWindow) travelInfoWindow.close();
    const pos = g.position ? travelLL(g.position) : {
      lat: Number(r.latitude), lng: Number(r.longitude),
    };
    travelInfoWindow = new TMap.InfoWindow({
      map: travelMapObj,
      position: new TMap.LatLng(pos.lat, pos.lng),
      content: travelInfoHtml(r),
    });
    if (travelInfoWindow.open) travelInfoWindow.open();
  });
}

document.querySelectorAll(".media-local-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.input);
    if (input) input.click();
  });
});

function travelRenderMarkers() {
  const filtered = travelFilteredRecords();
  const valid = filtered.filter(travelValidCoords);
  els.travelMapCount.textContent = "显示 " + valid.length + " / " + travelRecords.length + " 处";
  if (!travelMapObj || typeof TMap === "undefined") return;
  const geoms = valid.map((r) => ({
    id: r.id,
    styleId: "default",
    position: new TMap.LatLng(r.latitude, r.longitude),
    properties: { id: r.id },
  }));
  if (travelInfoWindow) { travelInfoWindow.close(); travelInfoWindow = null; }
  if (!travelMarkerLayer) {
    travelCreateMarkerLayer(geoms);
    return;
  }
  const oldIds = travelMarkerLayer.getGeometries().map((g) => g.id);
  if (oldIds.length) travelMarkerLayer.remove(oldIds);
  if (geoms.length) travelMarkerLayer.add(geoms);
}

// ---- click-to-copy coordinates -------------------------------------------
function travelShowCoords(lat, lng) {
  if (lat == null || lng == null) {
    travelPickedCoords = null;
    els.travelCoordPanel.classList.add("hidden");
    els.travelCoordPlaceRow.classList.add("hidden");
    els.travelCoordPlace.textContent = "—";
    return;
  }
  travelPickedCoords = { lat: Number(lat), lng: Number(lng) };
  els.travelCoordPanel.classList.remove("hidden");
  els.travelCoordLat.textContent = travelPickedCoords.lat.toFixed(6);
  els.travelCoordLng.textContent = travelPickedCoords.lng.toFixed(6);
  if (!travelSelectedPlace) {
    els.travelCoordPlaceRow.classList.add("hidden");
    els.travelCoordPlace.textContent = "—";
  }
}
async function travelCopyCoord(which) {
  if (!travelPickedCoords) { setStatus("请先点击地图取坐标。", "warn", 2000); return; }
  const v = travelPickedCoords[which].toFixed(6);
  let copied = false;
  const ta = document.createElement("textarea");
  ta.value = v;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { copied = document.execCommand("copy") === true; } catch { copied = false; }
  ta.remove();
  try {
    if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(v);
      copied = true;
    }
  } catch {
    // The synchronous fallback above already had the original user gesture.
  }
  if (!copied) { setStatus("复制失败，请长按坐标手动复制。", "error", 3000); return; }
  setStatus(which === "lng" ? "经度已复制：" + v : "纬度已复制：" + v, "ok", 1500);
}
function travelCoordFill() {
  const picked = travelPickedCoords;
  const place = travelSelectedPlace;
  travelNew(picked, place);
  if (picked) {
    setStatus("经纬度已填入表单，可补充地点/日期后保存。", "ok", 2500);
  } else {
    setStatus("未选择坐标，请在地图上点击后再填入。", "warn", 2500);
  }
}

// ---- tabs ----------------------------------------------------------------
function travelSwitchTab(tab) {
  els.travelTabMapBtn.classList.toggle("active", tab === "map");
  els.travelTabListBtn.classList.toggle("active", tab === "list");
  els.travelTabMap.classList.toggle("hidden", tab !== "map");
  els.travelTabList.classList.toggle("hidden", tab !== "list");
  els.travelTabEdit.classList.toggle("hidden", tab !== "edit");
  if (tab === "map") {
    travelLoad();
    travelEnsureMap();
    if (travelMapObj) setTimeout(() => travelMapObj.resize(), 60);
  }
}

// ---- add / edit / delete -------------------------------------------------
function travelRenderPeopleBox(checkedSet) {
  const checked = checkedSet || new Set();
  const box = els.travelPeopleBox;
  box.innerHTML = "";
  travelPeoplePool().forEach((n) => {
    const isFamily = TRAVEL_FAMILY.includes(n);
    const lbl = document.createElement("label");
    lbl.className = "travel-people-item";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = n; cb.checked = checked.has(n);
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(" " + n));
    if (!isFamily) {
      const del = document.createElement("span");
      del.className = "travel-chip-del"; del.textContent = "×";
      del.title = "删除该人员";
      del.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        travelRemoveCustom(n);
      });
      lbl.appendChild(del);
    }
    box.appendChild(lbl);
  });
  if (els.travelPeopleList) {
    const dl = els.travelPeopleList;
    dl.innerHTML = "";
    travelCustomPeople.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      dl.appendChild(o);
    });
  }
}
function travelCheckedSet() {
  return new Set(Array.from(els.travelPeopleBox.querySelectorAll("input:checked")).map((c) => c.value));
}
async function travelAddCustomFromInput() {
  const raw = (els.travelPeopleExtra.value || "").split(";").map(travelNormalizeName).filter(Boolean);
  if (!raw.length) { setStatus("请先输入要添加的人员名字。", "warn"); els.travelPeopleExtra.focus(); return; }
  const fresh = raw.filter((n) => !travelPeoplePool().includes(n));
  if (!fresh.length) { setStatus("这些人员已在列表中。", "warn", 1800); els.travelPeopleExtra.value = ""; return; }
  const checked = travelCheckedSet();
  fresh.forEach((n) => checked.add(n));
  travelCustomPeople = travelCleanCustomPeople(travelCustomPeople.concat(fresh));
  els.travelPeopleExtra.value = "";
  travelRenderPeopleBox(checked);
  try {
    const token = await getToken();
    await travelResolveFolder(token);
    await travelWrite(token);
    setStatus("已记住人员：" + fresh.join("、"), "ok", 2000);
  } catch (e) {
    setStatus("已添加，但同步到云端失败：" + (e.message || e), "error");
  }
}
async function travelRemoveCustom(name) {
  const checked = travelCheckedSet();
  checked.delete(name);
  travelCustomPeople = travelCustomPeople.filter((n) => n !== name);
  travelRenderPeopleBox(checked);
  try {
    const token = await getToken();
    await travelResolveFolder(token);
    await travelWrite(token);
    setStatus("已删除人员：" + name, "ok", 2000);
  } catch (e) {
    setStatus("已删除，但同步到云端失败：" + (e.message || e), "error");
  }
}
function travelNew(coords, place) {
  travelSwitchTab("edit");
  els.travelEditTitle.textContent = "新建记录";
  els.travelEditId.value = "";
  els.travelTitleInput.value = (place && place.title) || "";
  els.travelDateInput.value = todayStr();
  els.travelLatInput.value = "";
  els.travelLngInput.value = "";
  els.travelRemarkInput.value = "";
  // The people-box render must never block navigation to the form.
  try { travelRenderPeopleBox(new Set()); } catch (e) { console.warn("travelRenderPeopleBox:", e); }
  els.travelPeopleExtra.value = "";
  if (coords) {
    els.travelLatInput.value = Number(coords.lat).toFixed(6);
    els.travelLngInput.value = Number(coords.lng).toFixed(6);
  }
}
function travelEdit(id) {
  const r = travelRecords.find((x) => x.id === id);
  if (!r) return;
  travelNew();
  els.travelEditTitle.textContent = "编辑记录";
  els.travelEditId.value = r.id;
  els.travelTitleInput.value = r.title || "";
  els.travelDateInput.value = r.date || todayStr();
  els.travelLatInput.value = r.latitude;
  els.travelLngInput.value = r.longitude;
  els.travelRemarkInput.value = r.remark || "";
  const names = travelPeopleOf(r);
  els.travelPeopleBox.querySelectorAll("input").forEach((c) => { c.checked = names.includes(c.value); });
  const extra = names.filter((n) => !travelPeoplePool().includes(n));
  els.travelPeopleExtra.value = extra.join(";");
  travelSwitchTab("edit");
}
async function travelSave() {
  const title = els.travelTitleInput.value.trim();
  const lat = parseFloat(els.travelLatInput.value);
  const lng = parseFloat(els.travelLngInput.value);
  const date = els.travelDateInput.value || todayStr();
  if (!title) { setStatus("请填写地点。", "warn"); els.travelTitleInput.focus(); return; }
  if (isNaN(lat) || isNaN(lng)) { setStatus("请填写有效的经度/纬度。", "warn"); (isNaN(lat) ? els.travelLatInput : els.travelLngInput).focus(); return; }
  const checked = Array.from(els.travelPeopleBox.querySelectorAll("input:checked")).map((c) => c.value);
  const extra = (els.travelPeopleExtra.value || "").split(";").map(travelNormalizeName).filter(Boolean);
  const people = checked.concat(extra).filter((n, i, a) => a.indexOf(n) === i);
  const newCustom = people.filter((n) => !travelPeoplePool().includes(n));
  if (newCustom.length) {
    travelCustomPeople = travelCleanCustomPeople(travelCustomPeople.concat(newCustom));
  }
  els.travelSaveBtn.disabled = true;
  try {
    setStatus("正在保存…");
    const token = await getToken();
    await travelResolveFolder(token);
    const id = els.travelEditId.value;
    const rec = {
      id: id || ("t" + Date.now() + Math.floor(Math.random() * 1000)),
      title, date, latitude: lat, longitude: lng,
      remark: els.travelRemarkInput.value.trim(),
      people,
      createdBy: (account && (account.name || account.username)) || "",
      modified: new Date().toISOString(),
    };
    const idx = travelRecords.findIndex((x) => x.id === rec.id);
    if (idx >= 0) travelRecords[idx] = rec; else travelRecords.push(rec);
    travelRecords.sort(travelCmp);
    await travelWrite(token);
    travelRenderPersonFilter();
    travelRenderList();
    travelRenderMarkers();
    travelSwitchTab("list");
    setStatus("已保存。", "ok", 2500);
  } catch (e) {
    setStatus("保存失败：" + (e.message || e), "error");
  } finally {
    els.travelSaveBtn.disabled = false;
  }
}
async function travelDelete(id) {
  const r = travelRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm("确定删除「" + (r.title || "") + "」吗？")) return;
  try {
    setStatus("正在删除…");
    const token = await getToken();
    await travelResolveFolder(token);
    travelRecords = travelRecords.filter((x) => x.id !== id);
    await travelWrite(token);
    travelRenderPersonFilter();
    travelRenderList();
    travelRenderMarkers();
    setStatus("已删除。", "ok", 2500);
  } catch (e) {
    setStatus("删除失败：" + (e.message || e), "error");
  }
}

// ---- wiring --------------------------------------------------------------
function travelWireEvents() {
  // Bind coordinate controls first; unrelated wiring failures must not disable them.
  if (els.travelCopyLngBtn) els.travelCopyLngBtn.onclick = (e) => { e.stopPropagation(); travelCopyCoord("lng"); };
  if (els.travelCopyLatBtn) els.travelCopyLatBtn.onclick = (e) => { e.stopPropagation(); travelCopyCoord("lat"); };
  if (els.travelCoordFillBtn) els.travelCoordFillBtn.onclick = (e) => { e.stopPropagation(); travelCoordFill(); };
  els.travelTabMapBtn.onclick = () => travelSwitchTab("map");
  els.travelTabListBtn.onclick = () => { travelLoad(); travelSwitchTab("list"); };
  els.travelPersonFilter.addEventListener("change", () => travelRenderMarkers());
  els.travelRefreshBtn.onclick = () => { travelLoad(true); travelEnsureMap(); };
  els.travelPlaceSearchBtn.onclick = () => travelSearchPlaces();
  els.travelPlaceClearBtn.onclick = () => travelClearPlaceSearch(true);
  ["pointerdown", "mousedown", "click", "touchstart"].forEach((eventName) => {
    els.travelPlaceResults.addEventListener(eventName, (event) => event.stopPropagation(),
      eventName === "touchstart" ? { passive: true } : false);
  });
  els.travelPlaceSearch.addEventListener("input", () => {
    travelClearPlaceSearch(false);
  });
  els.travelPlaceSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); travelSearchPlaces(); }
    else if (e.key === "Escape") travelClearPlaceSearch(false);
  });
  els.travelSearch.addEventListener("input", () => travelRenderList());
  els.travelNewBtn.onclick = () => travelNew();
  els.travelSaveBtn.onclick = () => travelSave();
  els.travelCancelBtn.onclick = () => travelSwitchTab("list");
  if (els.travelPeopleAddBtn) els.travelPeopleAddBtn.onclick = () => travelAddCustomFromInput();
}

/* ========================================================================= *
 *                       AI 对话 (chat*)  —  DeepSeek                          *
 *   Multi-conversation, streaming chat. History is stored in its own          *
 *   OneDrive folder:  chat-index.json  +  chats/<id>.json                      *
 *   DeepSeek is reached through the Cloudflare Worker at CHAT_API_URL, which   *
 *   injects the secret API key and only serves the allowed accounts.          *
 * ========================================================================= */
// NOTE: these use `var` (hoisted, no TDZ) because boot() calls chatWireEvents()
// -> chatRenderModels() early, before this line executes in source order.
var chatDriveBase = "";
var chatConvs = [];          // index entries [{id,title,updated}]
var chatIndexEtag = null;
var chatModelsEtag = null;   // eTag for chat-models.json (custom models sync)
var chatLoaded = false;
var chatCurId = null;        // id of the open conversation
var chatMessages = [];       // messages of the open conversation [{role,content,reasoning}]
var chatCurEtag = null;      // eTag of chats/<id>.json (optimistic concurrency)
var chatSending = false;     // guard against concurrent sends
var chatLastModel = "";      // last valid model selection (for revert on cancel)
var chatStatusTimer = null;  // auto-hide timer for stream completion status
var chatWired = false;       // idempotency guard for chatWireEvents()
var chatSearchQuery = "";    // lower-cased sidebar title filter (title-only search)
var chatMenuId = null;       // conversation id the ⋯ popup menu currently targets

// ---- local content cache (instant re-open) -------------------------------
// Caches each conversation's messages + eTag in localStorage so re-opening is
// instant. On open we show the cached copy immediately, then revalidate against
// OneDrive in the background and re-render only if the eTag changed.
const CHAT_CACHE_KEY = "chatConvCache";
function chatCacheAll() {
  try { return JSON.parse(localStorage.getItem(CHAT_CACHE_KEY) || "{}") || {}; }
  catch { return {}; }
}
function chatCacheGet(id) {
  const all = chatCacheAll();
  const e = all[id];
  return e && Array.isArray(e.messages) ? e : null;
}
function chatCacheSet(id, etag, messages) {
  if (!etag) return; // don't cache un-versioned (e.g. 404) content
  try {
    const all = chatCacheAll();
    all[id] = { etag, messages };
    localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded etc. — cache is best-effort */ }
}
function chatCacheDelete(id) {
  try {
    const all = chatCacheAll();
    if (id in all) { delete all[id]; localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(all)); }
  } catch {}
}

// ---- folder + file addressing (own driveBase from CHAT_FOLDER_SHARE_URL) --
async function chatResolveFolder(token) {
  if (chatDriveBase) return;
  const sid = encodeShareUrl(CHAT_FOLDER_SHARE_URL);
  const res = await fetch(
    `${GRAPH}/shares/${sid}/driveItem?$select=id,parentReference`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("无法访问对话文件夹：" + res.status + " " + (await res.text()));
  const item = await res.json();
  const driveId = item.parentReference && item.parentReference.driveId;
  chatDriveBase = `${GRAPH}/drives/${driveId}/items/${item.id}`;
}
function chatEncPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function chatContentUrl(path) { return `${chatDriveBase}:/${chatEncPath(path)}:/content`; }

// ---- index JSON read/write (eTag optimistic concurrency) -----------------
async function chatReadIndex(token) {
  const res = await fetch(chatContentUrl(CHAT_INDEX_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { convs: [], etag: null };
  if (!res.ok) throw new Error("载入对话索引失败：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const convs = (data && Array.isArray(data.convs)) ? data.convs : [];
  return { convs, etag: res.headers.get("ETag") };
}
async function chatWriteIndex(token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (chatIndexEtag) headers["If-Match"] = chatIndexEtag;
    const res = await fetch(chatContentUrl(CHAT_INDEX_FILE), {
      method: "PUT", headers, body: JSON.stringify({ convs: chatConvs }),
    });
    if (res.ok) { const it = await res.json(); chatIndexEtag = it.eTag; return; }
    if (res.status === 412) { // merge by id, keep our edits
      const fresh = await chatReadIndex(token);
      const byId = {}; fresh.convs.forEach((c) => { byId[c.id] = c; });
      chatConvs.forEach((c) => { byId[c.id] = c; });
      chatConvs = Object.values(byId).sort(chatCmp);
      chatIndexEtag = fresh.etag;
      continue;
    }
    throw new Error("保存对话索引失败：" + res.status + " " + (await res.text()));
  }
  throw new Error("保存对话索引冲突，重试多次仍失败。");
}
function chatCmp(a, b) {
  const ua = a.updated || "", ub = b.updated || "";
  if (ua !== ub) return ub < ua ? -1 : 1;   // updated desc
  return (b.id || "") < (a.id || "") ? -1 : 1;
}

// ---- single conversation read/write --------------------------------------
async function chatReadConv(token, id) {
  const res = await fetch(chatContentUrl("chats/" + id + ".json"), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { messages: [], etag: null };
  if (!res.ok) throw new Error("载入对话失败：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const messages = (data && Array.isArray(data.messages)) ? data.messages : [];
  const etag = res.headers.get("ETag");
  chatCacheSet(id, etag, messages);
  return { messages, etag };
}
async function chatWriteConv(token, id) {
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  if (chatCurEtag) headers["If-Match"] = chatCurEtag;
  const res = await fetch(chatContentUrl("chats/" + id + ".json"), {
    method: "PUT", headers, body: JSON.stringify({ messages: chatMessages }),
  });
  if (res.status === 412) { // conflict: overwrite without If-Match (last write wins for a single chat)
    delete headers["If-Match"];
    const res2 = await fetch(chatContentUrl("chats/" + id + ".json"), {
      method: "PUT", headers, body: JSON.stringify({ messages: chatMessages }),
    });
    if (!res2.ok) throw new Error("保存对话失败：" + res2.status);
    const it2 = await res2.json(); chatCurEtag = it2.eTag; chatCacheSet(id, it2.eTag, chatMessages); return;
  }
  if (!res.ok) throw new Error("保存对话失败：" + res.status + " " + (await res.text()));
  const it = await res.json(); chatCurEtag = it.eTag; chatCacheSet(id, it.eTag, chatMessages);
}
async function chatDeleteConv(token, id) {
  chatCacheDelete(id);
  await fetch(`${chatDriveBase}:/${chatEncPath("chats/" + id + ".json")}`, {
    method: "DELETE", headers: { Authorization: "Bearer " + token },
  });
}

// ---- load ----------------------------------------------------------------
async function chatLoad() {
  if (chatLoaded) return;
  // Guarantee the UI is wired (idempotent) even if the boot-time call didn't
  // complete for any reason — this runs the moment the user opens the tab.
  try { chatWireEvents(); } catch (e) { console.warn("chatWireEvents (load) failed:", e); }
  if (CHAT_FOLDER_SHARE_URL.startsWith("PASTE-")) {
    setStatus("请先在 app.js 里填入 CHAT_FOLDER_SHARE_URL（对话文件夹分享链接）。", "error");
    return;
  }
  setStatus("正在载入对话…");
  const token = await getToken();
  await chatResolveFolder(token);
  const idx = await chatReadIndex(token);
  chatConvs = idx.convs.slice().sort(chatCmp);
  chatIndexEtag = idx.etag;
  chatLoaded = true;
  chatRenderList();
  // Merge cross-device custom models (best-effort; falls back to local-only).
  try {
    const cloud = await chatReadCustomModelsFile(token);
    chatModelsEtag = cloud.etag;
    const local = chatGetCustomModels();
    const merged = cloud.custom.slice();
    local.forEach((m) => { if (!merged.includes(m)) merged.push(m); });
    // If the cloud was missing anything we had locally, push our additions up.
    const needUp = local.some((m) => !cloud.custom.includes(m));
    chatSaveCustomModels(merged);
    chatRenderModels(chatLastModel);
    if (needUp) { chatSyncCustomModelsUp(token, "merge").catch((e) => console.warn("custom-model sync up:", e)); }
  } catch (e) { console.warn("custom-model sync (load) failed:", e); }
  // Always start on a fresh new conversation; existing ones are in the sidebar.
  chatNew();
  setStatus("已载入 " + chatConvs.length + " 个对话。", "ok", 1500);
}

// ---- conversation list rendering -----------------------------------------
function chatRenderList() {
  const box = els.aiConvList;
  box.innerHTML = "";
  if (!chatConvs.length) {
    box.innerHTML = '<p class="muted" style="padding:8px;">还没有对话，点“新对话”开始。</p>';
    return;
  }
  const q = chatSearchQuery;
  const list = q
    ? chatConvs.filter((c) => (c.title || "").toLowerCase().includes(q))
    : chatConvs;
  if (!list.length) {
    box.innerHTML = '<p class="muted" style="padding:8px;">无匹配对话。</p>';
    return;
  }
  list.forEach((c) => {
    const item = document.createElement("div");
    item.className = "ai-conv-item" + (c.id === chatCurId ? " active" : "");
    const t = document.createElement("span");
    t.className = "ai-conv-title";
    t.textContent = c.title || "新对话";
    t.onclick = () => chatOpen(c.id);
    const more = document.createElement("button");
    more.className = "ai-conv-more";
    more.textContent = "⋯";
    more.title = "更多";
    more.onclick = (e) => { e.stopPropagation(); chatOpenConvMenu(c.id, more); };
    item.appendChild(t);
    item.appendChild(more);
    box.appendChild(item);
  });
}

// Position and show the shared ⋯ popup menu (重命名 / 删除) next to the button
// that was clicked. A single fixed-position element is reused for every row so
// it is never clipped by the scrollable list's overflow.
function chatOpenConvMenu(id, anchorEl) {
  chatMenuId = id;
  const menu = els.aiConvMenu;
  if (!menu) return;
  const r = anchorEl.getBoundingClientRect();
  menu.classList.remove("hidden");
  // Measure now that it's visible, then clamp within the viewport.
  const mw = menu.offsetWidth || 140;
  const mh = menu.offsetHeight || 80;
  let left = r.right - mw;
  if (left < 6) left = 6;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 6) top = r.top - mh - 4; // flip up near bottom
  if (top < 6) top = 6;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}
function chatCloseConvMenu() {
  if (els.aiConvMenu) els.aiConvMenu.classList.add("hidden");
  chatMenuId = null;
}

// Rename a conversation. The title lives only in the index (chat-index.json),
// so we mutate chatConvs and persist via chatWriteIndex — chatWriteConv (the
// per-conversation messages file) is not involved. `updated` is left untouched
// so the sort order stays stable.
async function chatRename(id) {
  const c = chatConvs.find((x) => x.id === id);
  if (!c) return;
  const name = (prompt("重命名对话：", c.title || "新对话") || "").trim();
  if (!name || name === c.title) return;
  c.title = name.slice(0, 60);
  chatRenderList();
  if (id === chatCurId) els.aiTitle.textContent = c.title;
  try {
    await chatWriteIndex(await getToken());
    setStatus("已重命名。", "ok", 2000);
  } catch (e) {
    setStatus("重命名同步失败：" + (e.message || e), "warn", 5000);
  }
}

// ---- open / new / delete -------------------------------------------------
async function chatOpen(id) {
  chatSetStreamStatus("", "", 0);
  // Respond instantly: highlight the item, set the title, and close the mobile
  // sidebar BEFORE the (slow) network read so the UI never feels laggy.
  chatCurId = id;
  const meta = chatConvs.find((c) => c.id === id);
  els.aiTitle.textContent = (meta && meta.title) || "对话";
  chatRenderList();
  chatCloseSidebarMobile();

  // Show the cached copy immediately (秒开) if we have one; otherwise a spinner.
  const cached = chatCacheGet(id);
  if (cached) {
    chatMessages = cached.messages;
    chatCurEtag = cached.etag;
    chatRenderMessages();
  } else if (els.aiMessages) {
    els.aiMessages.innerHTML = '<div class="ai-loading">加载中…</div>';
  }

  // Revalidate against OneDrive in the background; re-render only if changed.
  let conv;
  try {
    const token = await getToken();
    conv = await chatReadConv(token, id);
  } catch (e) {
    if (!cached && els.aiMessages) {
      els.aiMessages.innerHTML = '<div class="ai-loading">载入失败：' + escapeHtml(e.message || String(e)) + "</div>";
    }
    return;
  }
  // Guard against a race: user may have opened another conversation meanwhile.
  if (chatCurId !== id) return;
  if (cached && conv.etag && cached.etag === conv.etag) return; // unchanged
  chatMessages = conv.messages;
  chatCurEtag = conv.etag;
  chatRenderMessages();
}
function chatNew() {
  chatSetStreamStatus("", "", 0);
  chatCurId = null;
  chatMessages = [];
  chatCurEtag = null;
  els.aiTitle.textContent = "新对话";
  chatRenderList();
  chatRenderMessages();
  els.aiInput.focus();
  chatCloseSidebarMobile();
}
async function chatDelete(id) {
  if (!confirm("删除这个对话？此操作无法撤销。")) return;
  const token = await getToken();
  await chatDeleteConv(token, id);
  chatConvs = chatConvs.filter((c) => c.id !== id);
  await chatWriteIndex(token);
  if (chatCurId === id) {
    if (chatConvs.length) await chatOpen(chatConvs[0].id);
    else chatNew();
  } else {
    chatRenderList();
  }
  setStatus("对话已删除。", "ok", 1500);
}

// ---- message rendering ---------------------------------------------------
function chatRenderMessages() {
  const box = els.aiMessages;
  box.innerHTML = "";
  if (!chatMessages.length) {
    box.innerHTML =
      '<div class="ai-empty">向 DeepSeek 提问吧 👋' +
      '<div class="ai-empty-note">Qwen- 开头为阿里云免费模型<br>其余为收费模型</div>' +
      '</div>';
    return;
  }
  chatMessages.forEach((m) => box.appendChild(chatBubble(m)));
  chatScrollBottom();
}
function chatBubble(m) {
  const wrap = document.createElement("div");
  wrap.className = "ai-msg ai-" + (m.role === "user" ? "user" : "assistant");
  if (m.role === "assistant" && m.reasoning) {
    const det = document.createElement("details");
    det.className = "ai-reasoning";
    const sum = document.createElement("summary");
    sum.textContent = "💭 思考过程";
    const rc = document.createElement("div");
    rc.className = "ai-reasoning-body";
    rc.textContent = m.reasoning;
    det.appendChild(sum);
    det.appendChild(rc);
    wrap.appendChild(det);
  }
  const body = document.createElement("div");
  body.className = "ai-msg-body";
  if (m.role === "assistant") body.innerHTML = blogRenderMarkdown(m.content || "");
  else body.textContent = m.content || "";
  wrap.appendChild(body);
  return wrap;
}
function chatScrollBottom() {
  const box = els.aiMessages;
  box.scrollTop = box.scrollHeight;
}
function chatClearTurnSpacer() {
  els.aiMessages?.querySelector(".ai-turn-spacer")?.remove();
}
function chatPositionTurnAtTop(userWrap, spacer) {
  const box = els.aiMessages;
  if (!box || !userWrap || !spacer) return;
  requestAnimationFrame(() => {
    // Reserve enough space below this turn for the user bubble to sit at the
    // top even while the assistant response is still short.
    const reserve = Math.max(0, box.clientHeight - userWrap.offsetHeight - 24);
    spacer.style.height = reserve + "px";
    const boxTop = box.getBoundingClientRect().top;
    const userTop = userWrap.getBoundingClientRect().top;
    box.scrollTop += userTop - boxTop - 6;
  });
}
function chatSetStreamStatus(text, cls, autoHideMs) {
  if (!els.aiStreamStatus) return;
  if (chatStatusTimer) { clearTimeout(chatStatusTimer); chatStatusTimer = null; }
  els.aiStreamStatus.textContent = text || "";
  els.aiStreamStatus.className = "ai-stream-status" + (cls ? " " + cls : "");
  els.aiStreamStatus.classList.toggle("hidden", !text);
  if (text && autoHideMs) {
    chatStatusTimer = setTimeout(() => {
      els.aiStreamStatus.classList.add("hidden");
      chatStatusTimer = null;
    }, autoHideMs);
  }
}

// ---- send (streaming) ----------------------------------------------------
async function chatSend() {
  if (chatSending) return;
  if (!els.aiInput || !els.aiMessages) return;
  const text = els.aiInput.value.trim();
  if (!text) return;
  chatSending = true;
  if (els.aiSendBtn) els.aiSendBtn.disabled = true;
  chatSetStreamStatus("正在输出…", "", 0);

  let acc = "";      // assistant content
  let reasoning = "";// reasoning content
  let liveBody = null;
  try {
    els.aiInput.value = "";
    chatClearTurnSpacer();

    // Append the user message, render it.
    chatMessages.push({ role: "user", content: text, created: new Date().toISOString() });
    els.aiMessages.querySelector(".ai-empty")?.remove();
    const userWrap = chatBubble({ role: "user", content: text });
    els.aiMessages.appendChild(userWrap);

    // Create a live assistant bubble to stream into.
    const liveWrap = document.createElement("div");
    liveWrap.className = "ai-msg ai-assistant";
    const reDet = document.createElement("details");
    reDet.className = "ai-reasoning hidden";
    reDet.open = true;
    const reSum = document.createElement("summary"); reSum.textContent = "💭 思考过程";
    const reBody = document.createElement("div"); reBody.className = "ai-reasoning-body";
    reDet.appendChild(reSum); reDet.appendChild(reBody);
    liveBody = document.createElement("div"); liveBody.className = "ai-msg-body";
    liveBody.innerHTML = '<span class="ai-cursor">▋</span>';
    liveWrap.appendChild(reDet); liveWrap.appendChild(liveBody);
    els.aiMessages.appendChild(liveWrap);
    const turnSpacer = document.createElement("div");
    turnSpacer.className = "ai-turn-spacer";
    turnSpacer.setAttribute("aria-hidden", "true");
    els.aiMessages.appendChild(turnSpacer);
    chatPositionTurnAtTop(userWrap, turnSpacer);

    const token = await getToken();
    // A "Qwen-" prefix in the dropdown value marks an Aliyun Bailian model.
    // Strip it to get the real model name and tell the Worker which provider to
    // use; the Worker translates the thinking params for Bailian.
    const selVal = els.aiModel.value || CHAT_MODELS[0];
    let provider = "deepseek", modelName = selVal;
    if (selVal.startsWith("Qwen-")) { provider = "bailian"; modelName = selVal.slice(5); }
    const body = {
      model: modelName,
      provider,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (els.aiThinking.checked) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = "high";
    } else {
      body.thinking = { type: "disabled" };
    }
    const res = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const errTxt = await res.text().catch(() => "");
      throw new Error("请求失败 " + res.status + " " + errTxt);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Parse SSE lines: "data: {...}\n"
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let obj;
        try { obj = JSON.parse(data); } catch { continue; }
        if (obj.error) { throw new Error(typeof obj.error === "string" ? obj.error : (obj.error.message || JSON.stringify(obj.error))); }
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          reDet.classList.remove("hidden");
          reBody.textContent = reasoning;
        }
        if (delta.content) {
          acc += delta.content;
          liveBody.innerHTML = blogRenderMarkdown(acc) + '<span class="ai-cursor">▋</span>';
        }
      }
    }
    liveBody.innerHTML = blogRenderMarkdown(acc);

    // Persist the assistant message.
    chatSetStreamStatus("正在保存…", "", 0);
    const msg = { role: "assistant", content: acc, created: new Date().toISOString() };
    if (reasoning) msg.reasoning = reasoning;
    chatMessages.push(msg);
    await chatPersistAfterTurn(text);
    chatSetStreamStatus("输出完成", "done", 3000);
  } catch (e) {
    const errHtml = '<span class="ai-error">出错了：' + escapeHtml(e.message || String(e)) + "</span>";
    if (liveBody) liveBody.innerHTML = errHtml;
    else setStatus("发送失败：" + (e.message || e), "error");
    chatSetStreamStatus("输出失败", "error", 5000);
    // Roll back the user message we optimistically added so a retry is clean.
    if (chatMessages.length && chatMessages[chatMessages.length - 1].role === "user") chatMessages.pop();
  } finally {
    chatSending = false;
    if (els.aiSendBtn) els.aiSendBtn.disabled = false;
  }
}

// After a successful turn: ensure a conversation id/title exist, save the
// conversation file, and update the index.
async function chatPersistAfterTurn(firstUserText) {
  const token = await getToken();
  const now = new Date().toISOString();
  if (!chatCurId) {
    chatCurId = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const title = firstUserText.slice(0, 24) || "新对话";
    chatConvs.unshift({ id: chatCurId, title, updated: now });
    els.aiTitle.textContent = title;
  } else {
    const meta = chatConvs.find((c) => c.id === chatCurId);
    if (meta) meta.updated = now;
  }
  chatConvs.sort(chatCmp);
  await chatWriteConv(token, chatCurId);
  await chatWriteIndex(token);
  chatRenderList();
}

// ---- mobile sidebar toggle -----------------------------------------------
function chatSetSidebar(open) {
  if (!els.aiSidebar) return;
  els.aiSidebar.classList.toggle("open", open);
  const bd = els.aiBackdrop || document.getElementById("aiBackdrop");
  if (bd) bd.classList.toggle("show", open && window.innerWidth <= 700);
}
function chatCloseSidebarMobile() {
  if (window.innerWidth <= 700) chatSetSidebar(false);
}

// ---- wiring --------------------------------------------------------------
// ---- model dropdown (built-in + user-defined custom models) --------------
function chatGetCustomModels() {
  try {
    const arr = JSON.parse(localStorage.getItem("chatCustomModels") || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function chatSaveCustomModels(arr) {
  try { localStorage.setItem("chatCustomModels", JSON.stringify(arr)); } catch {}
}

// ---- custom-model cross-device sync (OneDrive chat-models.json) ----------
// Only the user-defined custom models are synced. The selected model and any
// hidden built-ins stay device-local. localStorage remains the instant-open
// cache; the cloud file is the cross-device source of truth.
async function chatReadCustomModelsFile(token) {
  const res = await fetch(chatContentUrl(CHAT_MODELS_FILE), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return { custom: [], etag: null };
  if (!res.ok) throw new Error("载入自定义模型失败：" + res.status);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const custom = (data && Array.isArray(data.custom)) ? data.custom.filter((m) => typeof m === "string") : [];
  return { custom, etag: res.headers.get("ETag") };
}
// Push the local custom-model list to the cloud.
//   mode "merge"   : cloud ∪ local  (used on add / initial load) — never loses
//                    a model another device just added.
//   mode "replace" : local wins outright (used on delete) — otherwise a merge
//                    would resurrect the just-deleted model from the cloud.
// Writes the resolved list back to both localStorage and the cloud file.
async function chatSyncCustomModelsUp(token, mode) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let fresh;
    try { fresh = await chatReadCustomModelsFile(token); } catch { fresh = { custom: [], etag: chatModelsEtag }; }
    const local = chatGetCustomModels();
    let resolved;
    if (mode === "replace") {
      resolved = local.slice();
    } else { // merge
      resolved = fresh.custom.slice();
      local.forEach((m) => { if (!resolved.includes(m)) resolved.push(m); });
    }
    // Keep localStorage in step with what we're about to persist.
    chatSaveCustomModels(resolved);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (fresh.etag) headers["If-Match"] = fresh.etag;
    const res = await fetch(chatContentUrl(CHAT_MODELS_FILE), {
      method: "PUT", headers, body: JSON.stringify({ custom: resolved }),
    });
    if (res.ok) { const it = await res.json(); chatModelsEtag = it.eTag; return resolved; }
    if (res.status === 412) { chatModelsEtag = null; continue; } // conflict: re-read and retry
    throw new Error("保存自定义模型失败：" + res.status);
  }
  throw new Error("保存自定义模型冲突，重试多次仍失败。");
}
// Fire-and-forget wrapper for the sync-up (used from the sync onchange handler).
function chatPushCustomModels(mode) {
  getToken()
    .then((token) => chatSyncCustomModelsUp(token, mode))
    .catch((e) => console.warn("custom-model sync up (" + mode + "):", e));
}

// Built-in models the user has chosen to hide from the dropdown.
function chatGetRemovedModels() {
  try {
    const arr = JSON.parse(localStorage.getItem("chatRemovedModels") || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function chatSaveRemovedModels(arr) {
  try { localStorage.setItem("chatRemovedModels", JSON.stringify(arr)); } catch {}
}
// The full, visible model list (built-in + custom, minus removed).
function chatModelList() {
  const removed = chatGetRemovedModels();
  const list = [];
  CHAT_MODELS.forEach((m) => { if (!removed.includes(m)) list.push(m); });
  chatGetCustomModels().forEach((m) => { if (!list.includes(m) && !removed.includes(m)) list.push(m); });
  if (!list.length) list.push(CHAT_MODELS[0]); // never leave the dropdown empty
  return list;
}
function chatRenderModels(selected) {
  const sel = els.aiModel;
  if (!sel) return;
  sel.innerHTML = "";
  const list = chatModelList();
  list.forEach((m) => {
    const o = document.createElement("option");
    o.value = m; o.textContent = m;
    sel.appendChild(o);
  });
  const cust = document.createElement("option");
  cust.value = "__custom__"; cust.textContent = "＋ 自定义…";
  sel.appendChild(cust);
  // Always offer a delete entry as long as there's more than one model.
  if (list.length > 1) {
    const del = document.createElement("option");
    del.value = "__delete__"; del.textContent = "－ 删除模型…";
    sel.appendChild(del);
  }
  const want = selected && list.includes(selected) ? selected : list[0];
  sel.value = want;
  chatLastModel = want;
}

function chatWireEvents() {
  // Defensive: if the AI UI isn't present (e.g. an old cached index.html is
  // being served alongside a new app.js), skip wiring entirely so we never
  // throw and brick the rest of boot() (MSAL init, login, etc.).
  if (!els.aiApp || !els.aiModel) return;
  if (chatWired) return;   // idempotent: safe to call from boot() and chatLoad()
  chatWired = true;

  // ---- Wire the CRITICAL handlers FIRST, before anything that could throw
  // (model dropdown / localStorage), so the 发送 button is always usable. ----
  if (els.aiSendBtn) els.aiSendBtn.onclick = () => chatSend();
  if (els.aiNewChatBtn) els.aiNewChatBtn.onclick = () => chatNew();
  if (els.aiConvSearch) {
    els.aiConvSearch.oninput = () => {
      chatSearchQuery = els.aiConvSearch.value.trim().toLowerCase();
      chatRenderList();
    };
  }
  if (els.aiConvMenu) {
    els.aiConvMenu.querySelectorAll(".ai-conv-menu-item").forEach((it) => {
      it.onclick = (e) => {
        e.stopPropagation();
        const id = chatMenuId;
        const act = it.dataset.act;
        chatCloseConvMenu();
        if (!id) return;
        if (act === "rename") chatRename(id);
        else if (act === "delete") chatDelete(id);
      };
    });
    // Close on outside-click, list scroll, or window resize.
    document.addEventListener("click", (e) => {
      if (!els.aiConvMenu.contains(e.target)) chatCloseConvMenu();
    });
    if (els.aiConvList) els.aiConvList.addEventListener("scroll", chatCloseConvMenu);
    window.addEventListener("resize", chatCloseConvMenu);
  }
  if (els.aiInput) {
    els.aiInput.addEventListener("keydown", (e) => {
      // Enter sends; Shift+Enter makes a newline.
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
    });
  }
  if (els.aiToggleSidebar) {
    els.aiToggleSidebar.onclick = () => chatSetSidebar(!els.aiSidebar.classList.contains("open"));
  }
  const bd = els.aiBackdrop || document.getElementById("aiBackdrop");
  if (bd) bd.onclick = () => chatSetSidebar(false);

  // ---- Non-critical: model dropdown (built-in + saved custom + "自定义…") ----
  let savedModel = CHAT_MODELS[0];
  try { savedModel = localStorage.getItem("chatModel") || CHAT_MODELS[0]; } catch {}
  chatRenderModels(savedModel);
  els.aiModel.onchange = () => {
    if (els.aiModel.value === "__custom__") {
      const name = (prompt(
        "输入模型名称：\n\n" +
        "• DeepSeek 模型：直接填模型 ID，如 deepseek-v5-pro\n" +
        "• 百炼(阿里云 DashScope)模型：加 Qwen- 前缀，如 Qwen-qwen-max\n\n" +
        "注意：Qwen- 前缀是路由标记（走百炼），去掉前缀后须与百炼控制台的真实模型 ID 完全一致。"
      ) || "").trim();
      if (name) {
        // Re-adding: un-hide a previously removed built-in, or store a new custom.
        const removed = chatGetRemovedModels();
        if (removed.includes(name)) chatSaveRemovedModels(removed.filter((m) => m !== name));
        const arr = chatGetCustomModels();
        if (!CHAT_MODELS.includes(name) && !arr.includes(name)) {
          arr.push(name); chatSaveCustomModels(arr);
          chatPushCustomModels("merge");   // sync the new model across devices
        }
        chatRenderModels(name);
      } else {
        chatRenderModels(chatLastModel);   // cancelled: revert
      }
    } else if (els.aiModel.value === "__delete__") {
      const list = chatModelList();
      const name = (prompt(
        "输入要删除的模型名称：\n\n可删除：" + list.join("、")
      ) || "").trim();
      if (name && list.includes(name)) {
        // Custom models are removed from the custom list; built-ins are hidden.
        const custom = chatGetCustomModels();
        if (custom.includes(name)) {
          chatSaveCustomModels(custom.filter((m) => m !== name));
          chatPushCustomModels("replace");   // sync the deletion across devices
        } else {
          const removed = chatGetRemovedModels();
          if (!removed.includes(name)) { removed.push(name); chatSaveRemovedModels(removed); }
        }
        // If the deleted model was the current default, fall back to the first remaining one.
        const remaining = chatModelList();
        const keep = chatLastModel === name ? remaining[0] : chatLastModel;
        if (chatLastModel === name) { try { localStorage.setItem("chatModel", keep); } catch {} }
        chatRenderModels(keep);
        setStatus("已删除模型：" + name, "ok", 1500);
      } else {
        if (name) setStatus("未找到可删除的模型：" + name, "warn", 2000);
        chatRenderModels(chatLastModel);   // cancelled: revert
      }
    }
    chatLastModel = els.aiModel.value;
    try { localStorage.setItem("chatModel", chatLastModel); } catch {}
  };
}
