const assert = require("node:assert/strict");
const { calculate } = require("../public/valuation.js");
const periods = Array.from({ length: 7 }, (_, index) => ({
  date: String(2025 - index), shares: 100, total_assets: 1000,
  total_liabilities: 300, cash: 100, securities: 50, receivables: 100,
  inventory: 100, fixed_assets: 400, intangibles: 50, goodwill: 20,
  minority_interest: 10, interest_bearing_debt: 120, revenue: 500,
  ebit: 50, pretax_profit: 45, income_tax: 9, depreciation_amortization: 20,
}));
const result = calculate(periods);
assert.equal(result.asset_value.per_share, 6.2);
assert.equal(result.epv.per_share, 4.2);
assert.equal(calculate(periods, { capitalization_rate: .2 }).epv.operating_value, 200);
const missing = periods.map((row) => Object.assign({}, row));
delete missing[0].inventory;
assert.equal(calculate(missing).asset_value, null);
const nullMissing = periods.map((row) => Object.assign({}, row));
nullMissing[0].inventory = null;
assert.equal(calculate(nullMissing).asset_value, null);
const snapshot = Object.assign({}, periods[0], { date: "2026-06-30", cash: 200, total_assets: 1100,
  interest_bearing_debt: 100, revenue: 250 });
const interim = calculate(periods, null, snapshot);
assert.equal(interim.asset_value.per_share, 7.2);
assert.equal(interim.epv.normalized_ebit, 50);
assert.equal(interim.epv.per_share, 5.4);
console.log("valuation browser tests passed");
