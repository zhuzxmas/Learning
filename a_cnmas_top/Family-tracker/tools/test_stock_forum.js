const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const StockRealization = require("../public/stock-realization.js");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const context = vm.createContext({
  StockRealization, console,
  round2: (n) => Math.round(n * 100) / 100,
  fmtInt: (n) => String(Math.round(n)),
  stockRecords: [], stockLoaded: false, incomeLoaded: false,
  forumLoaded: false, forumCurTopicId: "", forumTopics: [],
  FORUM_POST_PAGE_SIZE: 2,
  FORUM_INDEX_FILE: "forum/index.json",
});
const constants = app.match(/^const STK_(?:INCOME|REALIZED|FORUM)\w* = .*;$/gm);
vm.runInContext(constants.join("\n"), context);
for (const name of [
  "stkSortTrades", "stkDeriveClosedCycles", "stkDeriveRealizedEvents", "stkRealizedRows",
  "stkRecordTotal", "stkForumAccountLabel", "stkForumMoney", "stkForumCompactMoney",
  "stkForumDate", "stkRealizedSortKey", "stkRealizedYear", "stkRealizedTotals",
  "stkForumPostContent", "stkForumPostCreated", "stkRealizedForumPostContent",
  "stkRealizedByYearAccount", "stkReconcileForum", "forumPostSortKey", "forumPostLayout",
  "forumPageForPost", "stkReadLatestRecords", "forumOpenTopic",
]) {
  const match = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}

function trade(id, date, shares, total, extra = {}) {
  return { id, date, code: "000001测试", account: "88--5302", shares, total,
    amount: total, ...extra };
}
context.stockRecords = [
  trade("old-buy", "2024-12-01", -100, -1000),
  trade("old-close", "2025-01-03", 100, 1100),
  trade("buy", "2025-12-01", -100, -1000, { account: "15教育" }),
  trade("close", "2026-01-03", 100, 1200, { account: "15教育" }),
  trade("new-buy", "2026-02-01", -100, -1000),
  trade("z-sale", "2026-03-01", 40, 600, { realizationVersion: 2, tradeOrder: 1 }),
  trade("a-sale", "2026-03-01", 60, 900, { realizationVersion: 2, tradeOrder: 2 }),
  trade("dividend", "2026-04-01", 0, 50, { realizationVersion: 2 }),
];

async function main() {
  const rows = context.stkRealizedRows(context.stockRecords);
  const chart = context.stkRealizedByYearAccount();
  assert.equal(chart.yearTotals.get("2024"), undefined);
  assert.equal(chart.yearTotals.get("2025"), 100);
  assert.equal(chart.yearTotals.get("2026"), 750);
  const latest = rows[rows.length - 1];
  const totals = context.stkRealizedTotals(latest, rows);
  assert.equal(totals.yearMain + totals.yearEdu, chart.yearTotals.get("2026"));
  assert.equal(totals.totalMain + totals.totalEdu, 850);
  const legacy = rows.find((r) => r.closingTransactionId === "close");
  assert.match(context.stkForumPostContent(legacy, rows), /2026年度收益 200元/);
  assert.equal(context.stkRealizedTotals(rows.find((r) => r.transactionId === "z-sale"), rows).yearMain, 200);

  let topic = null, posts = [], writes = 0;
  Object.assign(context, {
    getToken: async () => "test-token",
    forumResolveFolder: async () => {},
    forumReadIndex: async () => ({ topics: topic ? [topic] : [], etag: "index-etag" }),
    forumReadTopic: async () => ({ posts, etag: "topic-etag" }),
    forumContentUrl: (name) => name,
    forumCmp: () => 0,
    fetch: async (url, options) => {
      writes++;
      const body = JSON.parse(options.body);
      if (body.posts) { topic = body.topic; posts = body.posts; }
      return { ok: true, status: 200, json: async () => ({ eTag: "updated-etag" }) };
    },
  });
  await context.stkReconcileForum();
  assert.equal(writes, 2);
  await context.stkReconcileForum();
  assert.equal(writes, 2, "unchanged data must not rewrite the topic");
  assert.equal(posts.find((p) => p.source.closingTransactionId === "close").source.date, "2026-01-03");
  const sale = posts.find((p) => p.source.transactionId === "a-sale");
  assert.equal(sale.source.realizationOrder, 2);
  // A posting/editing timestamp must not override the actual sale date.
  posts.find((p) => p.source.closingTransactionId === "old-close").created = "2027-01-01T00:00:00.000Z";
  const layout = context.forumPostLayout(posts, topic.id, topic);
  assert.equal(layout.fixedPost.source.type, "topic-intro");
  assert.deepEqual(Array.from(layout.replies, (p) => p.source.transactionId || p.source.closingTransactionId),
    ["dividend", "a-sale", "z-sale", "close", "old-close"]);
  context.forumCurPosts = posts;
  context.forumCurTopicId = topic.id;
  context.forumTopics = [topic];
  assert.equal(context.forumPageForPost(sale.id), 0);
  assert.equal(context.forumPageForPost(posts.find((p) => p.source.closingTransactionId === "old-close").id), 2);
  const ordinary = context.forumPostLayout([
    { id: "op", created: "2026-01-01" },
    { id: "r1", created: "2026-01-02" },
    { id: "r2", created: "2026-01-03" },
  ], "ordinary", {});
  assert.equal(ordinary.fixedPost.id, "op");
  assert.deepEqual(Array.from(ordinary.replies, (p) => p.id), ["r2", "r1"]);

  let fetched = 0;
  Object.assign(context, {
    stkResolveFolder: async () => {},
    stkReadETag: async () => "new-stock-etag",
    idbGet: async () => ({ etag: "stale-etag", records: [] }),
    stkReadJson: async () => {
      fetched++;
      return { exists: true, etag: "new-stock-etag", data: { records: [trade("fresh", "2026-05-01", 0, 25)] } };
    },
    idbSet: () => {},
    STOCK_RECORDS_FILE: "stocks.json",
  });
  await context.stkReadLatestRecords("test-token");
  assert.equal(fetched, 1);
  assert.equal(context.stockRecords[0].id, "fresh");
  context.idbGet = async () => ({ etag: "new-stock-etag", records: context.stockRecords });
  await context.stkReadLatestRecords("test-token");
  assert.equal(fetched, 1, "matching ETag uses the validated cache");

  const calls = [];
  Object.assign(context, {
    forumOpenRequestId: 0, stockLoaded: false,
    history: { replaceState: () => {} }, deepLinkUrl: () => "test-url",
    forumSwitchTab: () => {}, forumResetReplyEditor: () => {},
    formatBeijingTime: (s) => s,
    forumIsProtectedTopic: () => true, forumCannotDeleteTopic: () => true,
    forumIsAuthor: () => false,
    els: Object.fromEntries(["forumViewTitle", "forumViewMeta", "forumEditBtn", "forumDeleteBtn",
      "forumPosts", "forumPostPager"].map((key) => [key, { classList: { toggle() {}, add() {} } }])),
    stkReadLatestRecords: async () => { calls.push("read-stock"); },
    stkReconcileForum: async () => { calls.push("sync"); },
    forumReadTopic: async () => { calls.push("read-topic"); return { posts, etag: "etag" }; },
    forumRenderPosts: async () => { calls.push("render"); },
    setStatus: (message) => { calls.push(message); },
  });
  await context.forumOpenTopic(topic.id);
  assert.deepEqual(calls, ["read-stock", "sync", "read-topic", "render"]);
  calls.length = 0;
  context.stkReconcileForum = async () => { throw new Error("offline"); };
  await context.forumOpenTopic(topic.id);
  assert.match(calls[1], /同步失败.*offline/);
  assert.deepEqual(calls.slice(2), ["read-topic", "render"]);
  console.log("stock forum consistency, sorting, pagination and sync tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
