const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const StockRealization = require("../public/stock-realization.js");
const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
class Element {
  constructor() {
    this.children = []; this.classes = new Set();
    this.classList = {
      add: (c) => this.classes.add(c),
      toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c),
    };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup; }
  appendChild(child) { this.children.push(child); }
}
const els = Object.fromEntries(["incChartYear", "incChartTitle", "incChartTotal",
  "incChartEmpty", "incWaterfall", "incMonthBars", "incCatLegend"].map((key) => [key, new Element()]));
const context = vm.createContext({
  StockRealization, els, document: { createElement: () => new Element() },
  incomeRecords: [], stockRecords: [], incomeLoaded: true, stockLoaded: false,
  incTab: "chart", incChartStockReady: false, incChartYearVal: null,
  round2: (n) => Math.round(n * 100) / 100,
  fmtAmount: (n) => Number(n).toFixed(2), escapeHtml: (s) => String(s),
  MONTH_LABELS: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  incCatColor: () => "#118DFF",
  stkBuildWaterfall: (_, steps) => { context.months = steps; },
  incBuildMonthBars: (totals, categories) => { context.monthCat = categories; },
});
vm.runInContext(app.match(/^const STK_(?:INCOME|REALIZED)\w* = .*;$/gm).join("\n"), context);
for (const name of ["stkSortTrades", "stkDeriveClosedCycles", "stkDeriveRealizedEvents",
  "stkRealizedRows", "stkRecordTotal", "stkRealizedSortKey", "stkRealizedYear",
  "stkIsGeneratedIncome", "stkRealizedByYearAccount", "stkReadLatestRecords",
  "incChartRows", "incYears", "incRenderChart", "incLoadChart", "incBuildCatLegend", "incRender"]) {
  const match = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}
const trade = (id, date, shares, total, extra = {}) => ({
  id, date, shares, total, amount: total, code: "000001测试", account: "88主账户", ...extra,
});
const records = [
  trade("old-buy", "2024-12-01", -100, -1000),
  trade("old-close", "2025-01-01", 100, 1100.25),
  trade("buy", "2025-12-01", -100, -1000, { account: "15教育账户" }),
  trade("loss", "2026-01-01", 100, 900.10, { account: "15教育账户" }),
  trade("new-buy", "2026-02-01", -100, -1000),
  trade("sale", "2026-03-01", 40, 600.12, { realizationVersion: 2, incomeSyncEligible: false }),
  trade("close", "2026-04-01", 60, 900.23, { realizationVersion: 2 }),
  trade("dividend", "2026-05-01", 0, 25.34, { realizationVersion: 2, account: "未映射账户" }),
  trade("open-buy", "2026-06-01", -100, -800, { code: "000002" }),
];
context.incomeRecords = [
  { id: "salary", title: "工资", date: "2026-01-01", netAmount: 1000 },
  { id: "manual-stock", title: "股票投资收入", date: "2026-01-01", netAmount: 99999 },
  { id: "obsolete-stock", title: "股票投资收入", date: "2030-01-01", netAmount: 200 },
  { id: "synced", title: "股票投资收入", date: "2026-03-01", netAmount: 200.12,
    generated: true, source: { module: "stock", type: "realized-transaction" } },
];
async function main() {
  context.incRenderChart();
  assert.equal(els.incChartTotal.textContent, "—", "do not show a mismatched total before stock loads");
  let downloads = 0;
  Object.assign(context, {
    incLoad: async () => {}, getToken: async () => "test-token",
    stkResolveFolder: async () => {}, stkReadETag: async () => "live",
    idbGet: async () => ({ etag: "stale", records: [] }),
    stkReadJson: async () => { downloads++; return { exists: true, etag: "live", data: { records } }; },
    idbSet: () => {}, STOCK_RECORDS_FILE: "stock-records.json",
    setStatus: (message) => { context.status = message; },
  });
  await context.incLoadChart();
  assert.equal(downloads, 1, "opening income first loads latest stock records");
  assert.equal(context.incChartStockReady, true);
  assert.equal(els.incChartTotal.textContent, "1425.79");
  assert.equal(context.monthCat[0].get("股票投资收入"), -99.9);
  assert.equal(context.monthCat[2].get("股票投资收入"), 200.12);
  assert.equal(context.monthCat[3].get("股票投资收入"), 300.23);
  assert.equal(context.monthCat[4].get("股票投资收入"), 25.34);
  assert.deepEqual(els.incChartYear.children.map((o) => o.value), ["2026", "2025"]);
  for (const year of ["2025", "2026"]) {
    context.incChartYearVal = year;
    context.incRenderChart();
    const expected = context.stkRealizedByYearAccount().yearTotals.get(year);
    const legend = els.incCatLegend.children.find((el) => el.innerHTML.includes("股票投资收入"));
    assert.ok(legend.innerHTML.includes(expected.toFixed(2)), "stock category matches stock page to cents");
    assert.equal(context.round2(context.monthCat.reduce((sum, m) => sum + (m.get("股票投资收入") || 0), 0)), expected);
  }
  // Existing chart updates on income renders, stock edits/deletes and rollback.
  const original = context.stockRecords.slice();
  context.incChartYearVal = "2026";
  context.incFillFilterSelects = () => {};
  context.incRenderTable = () => {};
  context.stockRecords = records.filter((r) => r.id !== "dividend");
  context.incRender();
  assert.equal(els.incChartTotal.textContent, "1400.45");
  context.stockRecords = context.stockRecords.map((r) => r.id === "close" ? { ...r, total: 1000.23 } : r);
  context.incRender();
  assert.equal(els.incChartTotal.textContent, "1500.45");
  context.stockRecords = original;
  context.incRender();
  assert.equal(els.incChartTotal.textContent, "1425.79");
  context.idbGet = async () => ({ etag: "live", records: original });
  await context.incLoadChart();
  assert.equal(downloads, 1, "validated cache avoids another download");
  context.stkReadETag = async () => { throw new Error("offline"); };
  await context.incLoadChart();
  assert.equal(els.incChartTotal.textContent, "—");
  assert.match(context.status, /offline/);
  context.stockRecords = [];
  context.incomeRecords = [];
  context.incChartStockReady = true;
  context.incRenderChart();
  assert.equal(els.incChartTotal.textContent, "0.00");
  assert.equal(els.incChartEmpty.classes.has("hidden"), false);
  assert.match(app, /function stkRender\(\) \{\s*if \(incomeLoaded && incTab === "chart"\) incRenderChart\(\);/);
  console.log("income/stock chart parity, loading, dates, precision and refresh tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
