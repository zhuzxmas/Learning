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
  "stkRenderPnlDetails"]) {
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
console.log("stock chart detail totals, separate cycles, rendering and bar interaction tests passed");
