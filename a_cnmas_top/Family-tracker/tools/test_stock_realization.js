const assert = require("node:assert/strict");
const { cashEventTotal, derive, deriveHoldings } = require("../public/stock-realization.js");

function trade(id, shares, total, extra) {
  return Object.assign({
    id, code: "000001测试", account: "88--5302", shares, total,
    date: "2026-01-01", tradeOrder: Number(id.replace(/\D/g, "")) || 0,
    incomeSyncEligible: true,
  }, extra || {});
}

{
  assert.equal(cashEventTotal({ amount: 120, stampTax: 12, total: 0 }), 108);
  assert.equal(cashEventTotal({ amount: 120, stampTax: -12, total: 0 }), 108);
  assert.equal(cashEventTotal({ amount: 120, stampTax: 12, total: 95 }), 95);
}

{
  const events = derive([
    trade("b1", -100, -1005),
    Object.assign(trade("d1", 0, 0, { date: "2026-01-02", realizationVersion: 2 }), {
      amount: 120, stampTax: 12,
    }),
  ]);
  assert.equal(events[0].kind, "dividend");
  assert.equal(events[0].pnl, 108);
}

{
  const events = derive([
    trade("b1", -100, -1005),
    trade("b2", -100, -2005, { date: "2026-01-02" }),
    trade("s1", 50, 995, { date: "2026-01-03", realizationVersion: 2 }),
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], Object.assign({}, events[0], {
    kind: "sale", shares: 50, averageCost: 15.05, costBasis: 752.5,
    proceeds: 995, pnl: 242.5, remainingShares: 150,
  }));
}

{
  const events = derive([
    trade("b1", -100, -1005),
    trade("s1", 40, 795, { date: "2026-01-02", realizationVersion: 2 }),
    trade("s2", 60, 1195, { date: "2026-01-03", realizationVersion: 2 }),
  ]);
  assert.deepEqual(events.map((event) => [event.transactionId, event.pnl, event.remainingShares]), [
    ["s1", 393, 60], ["s2", 592, 0],
  ]);
}

{
  const events = derive([
    trade("b1", -100, -1005),
    trade("d1", 0, 80, { date: "2026-01-02", realizationVersion: 2 }),
  ]);
  assert.equal(events[0].kind, "dividend");
  assert.equal(events[0].pnl, 80);
  assert.equal(events[0].averageCost, 10.05);
  assert.equal(events[0].remainingShares, 100);
}

{
  const events = derive([
    trade("b1", -100, -1005),
    trade("legacy-sale", 50, 745, { date: "2025-01-02" }),
    trade("s1", 50, 795, { date: "2026-01-03", realizationVersion: 2 }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].averageCost, 10.05);
  assert.equal(events[0].pnl, 292.5);
}

{
  const events = derive([
    trade("b1", -100, -1005),
    trade("legacy-sale", 100, 1495, { date: "2025-01-02" }),
  ]);
  assert.equal(events.length, 0);
}

{
  const events = derive([
    trade("old-buy", -100, -1005, { date: "2025-01-01" }),
    trade("old-close", 100, 1495, { date: "2025-01-02" }),
    trade("new-buy", -50, -1005, { date: "2026-01-01", realizationVersion: 2 }),
    trade("new-close", 50, 1245, { date: "2026-01-02", realizationVersion: 2 }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].averageCost, 20.1);
  assert.equal(events[0].pnl, 240);
}

{
  const events = derive([
    trade("old-buy", -100, -1005, { date: "2025-01-01" }),
    trade("new-dividend", 0, 50, { date: "2026-01-01", realizationVersion: 2 }),
    trade("old-close", 100, 1495, { date: "2026-01-02" }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "dividend");
}

{
  const rows = deriveHoldings([
    trade("b1", -100, -1005),
    trade("b2", -100, -2005, { date: "2026-01-02" }),
    trade("s1", 50, 995, { date: "2026-01-03", realizationVersion: 2 }),
  ]);
  assert.deepEqual(rows, [{
    code: "000001测试", account: "88--5302", shares: 150,
    costBasis: 2257.5, averageCost: 15.05, startDate: "2026-01-01",
  }]);
}

{
  const rows = deriveHoldings([
    trade("b1", -100, -1005),
    trade("d1", 0, 80, { date: "2026-01-02", realizationVersion: 2 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 100);
  assert.equal(rows[0].costBasis, 1005);
  assert.equal(rows[0].averageCost, 10.05);
}

{
  const rows = deriveHoldings([
    trade("b1", -100, -1005),
    trade("s1", 100, 1495, { date: "2026-01-02", realizationVersion: 2 }),
  ]);
  assert.deepEqual(rows, [], "closed positions disappear");
}

{
  const rows = deriveHoldings([
    trade("old-buy", -100, -1005, { date: "2025-01-01" }),
    trade("old-close", 100, 1495, { date: "2025-01-02" }),
    trade("new-buy", -50, -1005, { date: "2026-01-01", realizationVersion: 2 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 50);
  assert.equal(rows[0].costBasis, 1005);
  assert.equal(rows[0].startDate, "2026-01-01", "reopening starts a new position");
}

{
  const rows = deriveHoldings([
    trade("b1", -100, -1005),
    trade("b2", -100, -2005, { account: "15--7583教" }),
    trade("s1", 40, 600, { realizationVersion: 2, tradeOrder: 2 }),
  ]);
  assert.equal(rows.length, 2);
  const main = rows.find((row) => row.account === "88--5302");
  const edu = rows.find((row) => row.account === "15--7583教");
  assert.equal(main.shares, 60);
  assert.equal(main.costBasis, 603);
  assert.equal(edu.shares, 100);
  assert.equal(edu.costBasis, 2005);
}

{
  const rows = deriveHoldings([
    trade("buy", -100, -1000, { date: "2026-01-01" }),
    trade("rebuy", -100, -1000, { date: "2026-02-01", tradeOrder: 2 }),
    trade("close", 100, 1100, { date: "2026-02-01", tradeOrder: 1, realizationVersion: 2 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 100);
  assert.equal(rows[0].costBasis, 1000, "explicit trade order is respected");
}

console.log("stock realization tests passed");
console.log("stock holdings derivation tests passed");
