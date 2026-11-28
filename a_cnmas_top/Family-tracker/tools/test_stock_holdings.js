const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const StockRealization = require("../public/stock-realization.js");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../public/style.css"), "utf8");

class Element {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.style = {};
    this.attributes = {};
    this.textContent = "";
    this.markup = "";
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); },
      contains: (c) => this.classes.has(c),
    };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
}

const els = Object.fromEntries(["stkHoldingsTotal", "stkHoldingsTotalLabel", "stkHoldingsPies",
  "stkHoldingsBody", "stkHoldingsEmpty"].map((key) => [key, new Element()]));
const context = vm.createContext({
  StockRealization, els,
  document: { createElement: () => new Element() },
  stockRecords: [],
  STK_BAR_COLORS: ["#111111", "#222222", "#333333"],
  STK_HOLDING_STOCK_COLORS: ["#111111", "#222222", "#333333"],
  STK_FUND_COLORS: ["#f11111", "#f22222"],
  round2: (n) => Math.round((Number(n) || 0) * 100) / 100,
  fmtAmount: (n) => (Number(n) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtInt: (n) => Math.round(Number(n) || 0).toLocaleString("zh-CN"),
  escapeHtml: (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
});
for (const name of ["stkHoldingKind", "stkHoldingSort", "stkHoldingsRows", "stkRenderHoldings"]) {
  const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}

for (const code of ["510300沪深300ETF", "510300", "159915创业板ETF", "159915"]) {
  assert.equal(context.stkHoldingKind(code), "fund", code);
}
for (const code of ["000001测试", "600132重庆啤酒", "H01548金斯瑞", "东方电气600875", "88--5302"]) {
  assert.equal(context.stkHoldingKind(code), "stock", code);
}

const trade = (id, date, shares, total, extra = {}) => ({
  id, date, shares, total, amount: total, code: "000001测试", account: "88主账户", ...extra,
});

const tabs = ["stkTabListBtn", "stkTabAddBtn", "stkTabChartBtn", "stkTabHoldingsBtn", "stkTabSettingsBtn"]
  .map((id) => html.indexOf(`id="${id}"`));
assert.ok(tabs.every((pos) => pos >= 0), "all stock tab buttons exist");
assert.deepEqual([...tabs].sort((a, b) => a - b), tabs, "持仓 sits between 统计 and 设置");
assert.match(html, /id="stkTabChartBtn">统计</);
assert.match(html, /id="stkTabHoldingsBtn">持仓</);
assert.match(html, /id="stkTabHoldings"/);
assert.match(html, /id="stkHoldingsPies"/);
assert.match(html, /id="stkHoldingsBody"/);
assert.match(html, /id="stkHoldingsPies" class="stk-holdings-pies"/);
assert.match(html, /<th>类型<\/th>[\s\S]*<th>名称<\/th>[\s\S]*<th>账户<\/th>[\s\S]*<th class="num">股数<\/th>[\s\S]*<th class="num">总成本<\/th>[\s\S]*<th class="num">占比<\/th>/);
assert.doesNotMatch(html, /<th class="num">成交价<\/th>/);

context.stockRecords = [
  trade("b1", "2026-01-01", -100, -1005),
  trade("s1", "2026-01-03", 40, 600, { realizationVersion: 2 }),
  trade("d1", "2026-01-04", 0, 80, { realizationVersion: 2 }),
  trade("fund1", "2026-01-05", -100, -5000, { code: "510300沪深300ETF" }),
  trade("b2", "2026-01-02", -100, -2005, { account: "15教育账户", code: "000002<测试>" }),
  trade("fund2", "2026-01-06", -100, -3000, { account: "15教育账户", code: "159915创业板ETF" }),
  trade("closed-buy", "2025-01-01", -10, -100, { code: "已清仓" }),
  trade("closed-sale", "2025-01-02", 10, 120, { code: "已清仓" }),
];
context.stkRenderHoldings();

assert.equal(els.stkHoldingsBody.children.length, 4, "only open positions are listed");
assert.equal(els.stkHoldingsPies.children.length, 2, "one pie per account");
assert.equal(els.stkHoldingsEmpty.classList.contains("hidden"), true);
assert.match(els.stkHoldingsTotalLabel.textContent, /持仓成本合计（4 个股票\/账户组合）/);

const eduCard = els.stkHoldingsPies.children[0];
const mainCard = els.stkHoldingsPies.children[1];
assert.equal(eduCard.children[0].textContent, "15教育账户");
assert.equal(mainCard.children[0].textContent, "88主账户");
assert.equal(eduCard.children[1].children[0].attributes["aria-label"], "15教育账户 持仓成本占比饼图");

// Education account: stock 2,005 + fund 3,000 = 5,005; stocks come first.
const eduPie = eduCard.children[1].children[0];
assert.match(eduPie.style.background, /^conic-gradient\(#222222 0%.*#f11111/);
assert.equal(eduPie.children.length, 1, "fund slices get a hatch overlay");
assert.equal(eduPie.children[0].className, "stk-fund-pattern");
assert.match(eduPie.children[0].style.maskImage, /conic-gradient\(.*#000/);
assert.match(eduPie.children[0].style.maskImage, /transparent/);
assert.match(eduCard.children[2].innerHTML, /股票总成本/);
assert.match(eduCard.children[2].innerHTML, /2,005\.00/);
assert.match(eduCard.children[2].innerHTML, /基金总成本/);
assert.match(eduCard.children[2].innerHTML, /3,000\.00/);
assert.match(eduCard.children[2].innerHTML, /持仓总成本/);
assert.match(eduCard.children[2].innerHTML, /5,005\.00/);

// Main account: stock 603 + fund 5,000 = 5,603; stocks come first.
const mainPie = mainCard.children[1].children[0];
assert.match(mainPie.style.background, /^conic-gradient\(#111111 0%.*#f22222/);
assert.equal(mainPie.children.length, 1);
assert.match(mainPie.children[0].style.maskImage, /conic-gradient\(.*#000/);
assert.match(mainCard.children[2].innerHTML, /股票总成本/);
assert.match(mainCard.children[2].innerHTML, /603\.00/);
assert.match(mainCard.children[2].innerHTML, /基金总成本/);
assert.match(mainCard.children[2].innerHTML, /5,000\.00/);
assert.match(mainCard.children[2].innerHTML, /持仓总成本/);
assert.match(mainCard.children[2].innerHTML, /5,603\.00/);

assert.equal(eduCard.children[3].children.length, 2);
assert.match(eduCard.children[3].children[0].innerHTML, /000002&lt;测试&gt;/);
assert.match(eduCard.children[3].children[0].innerHTML, /stk-kind-stock.*股票/);
assert.match(eduCard.children[3].children[0].innerHTML, /100 股 · 总成本 2,005\.00/);
assert.match(eduCard.children[3].children[1].innerHTML, /159915创业板ETF/);
assert.match(eduCard.children[3].children[1].innerHTML, /stk-kind-fund.*基金/);
assert.match(eduCard.children[3].children[1].innerHTML, /100 股 · 总成本 3,000\.00/);
assert.doesNotMatch(eduCard.children[3].innerHTML, /20\.05|平均|单价/);

assert.equal(mainCard.children[3].children.length, 2);
assert.match(mainCard.children[3].children[0].innerHTML, /000001测试/);
assert.match(mainCard.children[3].children[0].innerHTML, /stk-kind-stock.*股票/);
assert.match(mainCard.children[3].children[0].innerHTML, /60 股 · 总成本 603\.00/);
assert.match(mainCard.children[3].children[1].innerHTML, /510300沪深300ETF/);
assert.match(mainCard.children[3].children[1].innerHTML, /stk-kind-fund.*基金/);
assert.match(mainCard.children[3].children[1].innerHTML, /100 股 · 总成本 5,000\.00/);
assert.doesNotMatch(mainCard.children[3].innerHTML, /10\.05|平均|单价/);

// Table follows the same account -> stock -> fund order as the pies.
assert.equal(els.stkHoldingsBody.children[0].innerHTML,
  "<td><span class=\"stk-kind-badge stk-kind-stock\">股票</span></td>" +
  "<td>000002&lt;测试&gt;</td><td>15教育账户</td><td class=\"num\">100</td>" +
  "<td class=\"num strong\">2,005.00</td><td class=\"num\">18.9%</td>");
assert.match(els.stkHoldingsBody.children[1].innerHTML, /159915创业板ETF/);
assert.match(els.stkHoldingsBody.children[1].innerHTML, /stk-kind-fund.*基金/);
assert.match(els.stkHoldingsBody.children[1].innerHTML, /3,000\.00/);
assert.match(els.stkHoldingsBody.children[1].innerHTML, /28\.3%/);
assert.match(els.stkHoldingsBody.children[2].innerHTML, /000001测试/);
assert.match(els.stkHoldingsBody.children[2].innerHTML, /stk-kind-stock.*股票/);
assert.match(els.stkHoldingsBody.children[2].innerHTML, /<td class="num">60<\/td>/);
assert.match(els.stkHoldingsBody.children[2].innerHTML, /603\.00/);
assert.match(els.stkHoldingsBody.children[2].innerHTML, /5\.7%/);
assert.match(els.stkHoldingsBody.children[3].innerHTML, /510300沪深300ETF/);
assert.match(els.stkHoldingsBody.children[3].innerHTML, /stk-kind-fund.*基金/);
assert.match(els.stkHoldingsBody.children[3].innerHTML, /5,000\.00/);
assert.match(els.stkHoldingsBody.children[3].innerHTML, /47\.1%/);
assert.doesNotMatch(els.stkHoldingsBody.innerHTML, /成交价|平均成本/);

context.stockRecords = [];
context.stkRenderHoldings();
assert.equal(els.stkHoldingsBody.children.length, 0);
assert.equal(els.stkHoldingsPies.children.length, 0);
assert.equal(els.stkHoldingsEmpty.classList.contains("hidden"), false);
assert.equal(els.stkHoldingsTotal.textContent, "0.00");

assert.match(css, /\.stk-holdings-pies \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /\.stk-kind-fund/);
assert.match(css, /\.stk-kind-stock/);
assert.match(css, /\.stk-fund-pattern \{[^}]*repeating-linear-gradient/);
const stockPalette = app.match(/const STK_HOLDING_STOCK_COLORS = \[([^\]]+)\]/)[1].match(/#[0-9A-Fa-f]{6}/g);
const fundPalette = app.match(/const STK_FUND_COLORS = \[([^\]]+)\]/)[1].match(/#[0-9A-Fa-f]{6}/g);
assert.equal(stockPalette.some((color) => fundPalette.includes(color)), false,
  "stock and fund palettes must not share colors");

console.log("stock holdings tab, stock/fund split, per-account pies, totals and list rendering tests passed");
