const assert = require("node:assert/strict");
const Ranking = require("../public/stock-ranking.js");

assert.equal(Ranking.canonicalCode("H01548金斯瑞"), "01548.HK");
assert.equal(Ranking.canonicalCode("02249.HK"), "02249.HK");
assert.equal(Ranking.canonicalCode("东方电气600875"), "600875.SH");
assert.equal(Ranking.canonicalCode("000999华润三九"), "000999.SZ");
assert.equal(Ranking.canonicalCode("invalid"), null);

const held = Ranking.heldCodes([
  { code: "H01548金斯瑞", account: "a", shares: -100 },
  { code: "01548.HK", account: "b", shares: 40 },
  { code: "000999华润三九", shares: -50 },
  { code: "000999华润三九", shares: 50 },
  { code: "600875东方电气", shares: 0 },
]);
assert.deepEqual([...held], ["01548.HK"]);

const rows = [
  { stock_cn: "000003.SZ", is_held: false, potential_opportunity: true, profit_ratio: 0.1 },
  { stock_cn: "000006.SZ", is_held: false, potential_opportunity: true, profit_ratio: null },
  { stock_cn: "000002.SZ", is_held: true, potential_opportunity: false, profit_ratio: 0.3 },
  { stock_cn: "000001.SZ", is_held: true, potential_opportunity: true, profit_ratio: 0.2 },
  { stock_cn: "000004.SZ", is_held: true, potential_opportunity: true, profit_ratio: 0.1 },
  { stock_cn: "000005.SZ", is_held: false, potential_opportunity: null, profit_ratio: null },
];
assert.deepEqual(rows.slice().sort(Ranking.defaultCompare).map((row) => row.stock_cn),
  ["000004.SZ", "000001.SZ", "000002.SZ", "000003.SZ", "000006.SZ", "000005.SZ"]);

const baseline = Ranking.opportunityForm("true", "10.00", " 原因 ");
assert.equal(Ranking.sameOpportunity(baseline, Ranking.opportunityForm("true", "10", "原因")), true);
assert.equal(Ranking.sameOpportunity(baseline, Ranking.opportunityForm("false", "10", "原因")), false);
assert.equal(Ranking.opportunityForm("", "-1", "").valid, false);
assert.equal(Ranking.opportunityForm("", "", "").valid, true);
assert.equal(Ranking.opportunityForm("true", "", "").valid, false);
assert.equal(Ranking.opportunityForm("true", "10", "").valid, true);
assert.equal(Ranking.opportunityForm("false", "", "").valid, true);

console.log("stock ranking tests passed");
