const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const StockRealization = require("../public/stock-realization.js");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.classes = new Set();
    this.classList = {
      add: (c) => this.classes.add(c),
      toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); },
      contains: (c) => this.classes.has(c),
    };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll() { return this.children.filter((c) => c.classes.has("wf-interactive")); }
}
const els = Object.fromEntries(["stkPnlDetails", "stkPnlDetailsTitle", "stkPnlDetailsSummary",
  "stkPnlDetailsBody", "stkPnlBars"].map((key) => [key, new Element()]));
const context = vm.createContext({
  StockRealization, els, document: { createElement: () => new Element() },
  stkPnlDetailYear: null, stockRecords: [],
  round2: (n) => Math.round(n * 100) / 100,
  fmtAmount: (n) => Number(n).toFixed(2), fmtInt: (n) => String(Math.round(n)),
  escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
});
for (const name of ["stkSortTrades", "stkDeriveClosedCycles", "stkDeriveRealizedEvents",
  "stkRealizedRows", "stkRecordTotal", "stkRealizedSortKey", "stkRealizedYear",
  "stkRealizedByYearAccount", "stkBuildWaterfall", "stkPnlDetailRows", "stkSelectPnlYear",
  "stkRenderPnlDetails", "stkPeakCapitalReturnsByYear", "stkPeakCapitalReturnLabel",
  "stkYearsAsc", "stkFeesByYear", "stkRenderChart"]) {
  const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}
const trade = (id, date, shares, total, extra = {}) => ({
  id, date, shares, total, amount: total, code: "000001测试", account: "88主账户", ...extra,
});
context.stockRecords = [
  trade("buy1", "2025-12-01", -100, -1000),
  trade("close1", "2026-01-01", 100, 1100),
  trade("buy2", "2026-02-01", -100, -1000),
  trade("close2", "2026-03-01", 100, 900),
  trade("buy3", "2026-04-01", -100, -1000, { account: "15教育账户" }),
  trade("sale1", "2026-05-01", 40, 600, { account: "15教育账户", realizationVersion: 2, tradeOrder: 1 }),
  trade("sale2", "2026-05-01", 60, 900, { account: "15教育账户", realizationVersion: 2, tradeOrder: 2 }),
  trade("dividend", "2026-06-01", 0, 50, { realizationVersion: 2, code: "000002<测试>" }),
];
const rows = context.stkPnlDetailRows("2026");
assert.deepEqual(Array.from(rows, (r) => r.transactionId || r.closingTransactionId),
  ["dividend", "sale2", "sale1", "close2", "close1"]);
assert.equal(rows.filter((r) => r.kind === "legacy").length, 2, "multiple closes of one stock stay separate");
assert.equal(rows.reduce((sum, row) => sum + row.pnl, 0), context.stkRealizedByYearAccount().yearTotals.get("2026"));
context.stkBuildWaterfall(els.stkPnlBars, [{ name: "2025", val: 0 }, { name: "2026", val: 550 }], {
  onSelect: context.stkSelectPnlYear,
});
const bars = els.stkPnlBars.querySelectorAll();
assert.equal(bars.length, 2);
assert.equal(bars[1].attributes.role, "button");
assert.equal(bars[1].tabIndex, 0);
bars[1].onclick();
assert.equal(context.stkPnlDetailYear, "2026");
assert.equal(els.stkPnlDetails.classList.contains("hidden"), false);
assert.equal(els.stkPnlDetailsBody.children.length, 5);
assert.match(els.stkPnlDetailsSummary.textContent, /共 5 条，收益合计 550.00/);
assert.match(els.stkPnlDetailsBody.children[0].innerHTML, /000002&lt;测试&gt;/);
assert.match(els.stkPnlDetailsBody.children[1].innerHTML, /15教育账户/);
assert.match(els.stkPnlDetailsBody.children[3].innerHTML, /stk-pnl-loss.*-100.00/);
assert.equal(bars[1].attributes["aria-expanded"], "true");
assert.equal(bars[0].classList.contains("dim"), true);
let prevented = false;
bars[0].onkeydown({ key: "Enter", preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(context.stkPnlDetailYear, "2025");
assert.match(els.stkPnlDetailsBody.innerHTML, /暂无已实现收益/);
assert.equal(bars[1].attributes["aria-expanded"], "false");
context.stkPnlDetailYear = null;
context.stkRenderPnlDetails();
assert.equal(els.stkPnlDetails.classList.contains("hidden"), true);
// A zero-net year must still expose offsetting gains and losses.
context.stkBuildWaterfall(els.stkPnlBars, [{ name: "2026", val: 0 }], { onSelect: context.stkSelectPnlYear });
assert.equal(els.stkPnlBars.querySelectorAll().length, 1);
assert.ok(html.indexOf('id="stkPnlDetails"') > html.indexOf('id="stkPnlBars"'));
assert.ok(html.indexOf('id="stkPnlDetails"') < html.indexOf('id="stkFeeBars"'));
assert.match(html, /收益年度：/);
// Sequential investments reuse capital; all realized P&L including dividends
// is divided by the peak simultaneous holding cost, not summed trade costs.
const summary = context.stkPeakCapitalReturnsByYear().get("2026");
assert.equal(summary.principal, 1000);
assert.equal(summary.pnl, 550);
assert.equal(summary.rate, 0.55);
assert.equal(context.stkPeakCapitalReturnsByYear().get("2025").principal, 1000);
assert.equal(context.stkPeakCapitalReturnLabel(summary).text, "55.00%");
context.stkBuildWaterfall(els.stkPnlBars, [
  { name: "2026", val: 550, returnLabel: context.stkPeakCapitalReturnLabel(summary) },
], { onSelect: context.stkSelectPnlYear });
const rateBar = els.stkPnlBars.children[0];
assert.match(rateBar.innerHTML, /class="wf-return"[^]*55\.00%<\/span>550/);
assert.match(rateBar.innerHTML, /最大同时占用成本本金 1000\.00 元/);
assert.match(rateBar.attributes["aria-label"], /年度最大占用本金收益率：55\.00%/);
assert.doesNotMatch(els.stkPnlBars.children[1].innerHTML, /wf-return/, "grand total is not an annual rate");
const weightedRecords = [
  trade("small-buy", "2025-12-01", -100, -10000, { code: "small" }),
  trade("small-sale", "2026-01-01", 100, 12000, { code: "small", realizationVersion: 2 }),
  trade("large-buy", "2026-01-01", -1000, -100000, { code: "large" }),
  trade("large-sale", "2026-02-01", 1000, 105000, { code: "large", realizationVersion: 2 }),
];
const weighted = context.stkPeakCapitalReturnsByYear(weightedRecords).get("2026");
assert.equal(weighted.principal, 100000, "sell then buy on the same date releases prior capital");
assert.equal(weighted.pnl, 7000);
assert.equal(context.stkPeakCapitalReturnLabel(weighted).text, "7.00%");
const partial = context.stkPeakCapitalReturnsByYear([
  trade("buy", "2025-12-01", -100, -1005),
  trade("sale", "2026-01-01", 40, 300, { realizationVersion: 2 }),
  trade("sale2", "2027-01-01", 60, 1000, { realizationVersion: 2 }),
]);
assert.equal(partial.get("2026").principal, 1005, "peak includes the position before a partial sale");
assert.equal(partial.get("2027").principal, 603);
assert.equal(context.stkPeakCapitalReturnLabel(partial.get("2026")).text, "-10.15%");
context.stkBuildWaterfall(els.stkPnlBars, [{ name: "2026", val: -102,
  returnLabel: context.stkPeakCapitalReturnLabel(partial.get("2026")) }], {});
assert.match(els.stkPnlBars.children[0].innerHTML, /wf-return neg/);
const legacyDividend = context.stkPeakCapitalReturnsByYear([
  trade("buy", "2025-12-01", -100, -1000),
  trade("dividend", "2026-01-01", 0, 50),
  trade("close", "2026-02-01", 100, 1100),
]).get("2026");
assert.equal(legacyDividend.principal, 1000);
assert.equal(legacyDividend.pnl, 150);
assert.equal(context.stkPeakCapitalReturnLabel(legacyDividend).text, "15.00%");
const dividendOnly = context.stkPeakCapitalReturnsByYear([
  trade("dividend", "2026-01-01", 0, 50, { realizationVersion: 2 }),
]).get("2026");
assert.equal(dividendOnly.principal, 0);
assert.equal(context.stkPeakCapitalReturnLabel(dividendOnly).text, "—");
const missingCost = context.stkPeakCapitalReturnsByYear(weightedRecords.concat([
  trade("missing-cost", "2026-03-01", 10, 100, { code: "missing", realizationVersion: 2 }),
])).get("2026");
assert.equal(missingCost.rate, null, "one transaction without principal invalidates the aggregate rate");
assert.match(context.stkPeakCapitalReturnLabel(missingCost).title, /无法计算年度收益率/);
const flat = context.stkPeakCapitalReturnsByYear([
  trade("buy", "2026-01-01", -100, -1000),
  trade("sale", "2026-02-01", 100, 1000, { realizationVersion: 2 }),
]).get("2026");
context.stkBuildWaterfall(els.stkPnlBars, [{ name: "2026", val: 0,
  returnLabel: context.stkPeakCapitalReturnLabel(flat) }], { onSelect: context.stkSelectPnlYear });
assert.match(els.stkPnlBars.children[0].innerHTML, /0\.00%<\/span>0/);
assert.equal(context.stkPeakCapitalReturnLabel(undefined).text, "—");
assert.match(html, /年度最大占用本金收益率/);
const reused = [
  trade("b1", "2026-01-01", -100, -100000),
  trade("s1", "2026-02-01", 100, 110000, { realizationVersion: 2 }),
  trade("b2", "2026-03-01", -100, -100000),
  trade("s2", "2026-04-01", 100, 120000, { realizationVersion: 2 }),
];
const reusedSummary = context.stkPeakCapitalReturnsByYear(reused).get("2026");
assert.equal(reusedSummary.principal, 100000);
assert.equal(reusedSummary.pnl, 30000);
assert.equal(context.stkPeakCapitalReturnLabel(reusedSummary).text, "30.00%");
const overlap = context.stkPeakCapitalReturnsByYear([
  trade("b1", "2026-01-01", -100, -100000),
  trade("b2", "2026-01-02", -100, -100000, { account: "15教育账户" }),
  trade("s1", "2026-02-01", 100, 110000, { realizationVersion: 2 }),
  trade("s2", "2026-03-01", 100, 120000, { account: "15教育账户", realizationVersion: 2 }),
]).get("2026");
assert.equal(overlap.principal, 200000, "simultaneous positions across accounts add together");
assert.equal(context.stkPeakCapitalReturnLabel(overlap).text, "15.00%");
const carry = context.stkPeakCapitalReturnsByYear([
  trade("buy", "2024-12-01", -100, -1000),
  trade("dividend", "2026-01-01", 0, 100, { realizationVersion: 2 }),
]);
assert.equal(carry.get("2025").principal, 1000, "carry cost through years without trades");
assert.equal(carry.get("2025").rate, 0);
assert.equal(carry.get("2026").rate, 0.1, "dividends use inherited holding capital");
const sameDay = [
  trade("buy", "2026-01-01", -100, -1000),
  trade("rebuy", "2026-02-01", -100, -1000, { tradeOrder: 2 }),
  trade("close", "2026-02-01", 100, 1100, { tradeOrder: 1, realizationVersion: 2 }),
];
assert.equal(context.stkPeakCapitalReturnsByYear(sameDay).get("2026").principal, 1000,
  "explicit order closes before reinvesting despite input order");
sameDay[1].tradeOrder = 1;
sameDay[2].tradeOrder = 2;
assert.equal(context.stkPeakCapitalReturnsByYear(sameDay).get("2026").principal, 2000,
  "buying before selling genuinely increases occupied capital");
const reinvestProfit = reused.map((r) => r.id === "b2" ? { ...r, total: -110000 } : r);
assert.equal(context.stkPeakCapitalReturnsByYear(reinvestProfit).get("2026").principal, 110000,
  "profits reinvested increase the actual peak holding cost");
const invalidCarry = context.stkPeakCapitalReturnsByYear([
  trade("bad", "2025-01-01", -100, 0),
  trade("close", "2026-01-01", 100, 1000, { realizationVersion: 2 }),
  trade("buy", "2027-01-01", -100, -1000),
  trade("sale", "2027-02-01", 100, 1100, { realizationVersion: 2 }),
]);
assert.equal(invalidCarry.get("2026").rate, null);
assert.equal(invalidCarry.get("2027").rate, 0.1, "closing an invalid position resets cost state for future years");
// Verify the actual chart passes annual summaries into the shared waterfall.
for (const key of ["stkChartYear", "stkChartEmpty", "stkFeeBars", "stkPnlLegend",
  "stkAcctBreakdown", "stkChartTotal", "stkChartTotalLabel"]) els[key] = new Element();
context.STK_BAR_COLORS = ["#118DFF", "#26890D"];
context.stkChartYearVal = "ALL";
context.stkPnlDetailYear = null;
context.stkRenderChart();
assert.match(els.stkPnlBars.children[1].innerHTML, /55\.00%<\/span>550/);
assert.equal(els.stkChartTotal.textContent, "550.00", "P&L continues to include standalone dividends");
assert.ok(els.stkFeeBars.children.every((col) => !col.innerHTML.includes("wf-return")));
console.log("stock chart detail totals, separate cycles, rendering and bar interaction tests passed");
console.log("annual peak capital return, reinvestment, overlap, carry, dividends and labels tests passed");
