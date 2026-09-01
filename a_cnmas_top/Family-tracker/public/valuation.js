(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ValueInvesting = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const defaults = {
    cash: 1, securities: 1, receivables: .85, inventory: .70,
    fixed_assets: .50, intangibles: 0, goodwill: 0, other_assets: .50,
    capitalization_rate: .10, fallback_tax_rate: .25,
  };
  const number = (value) => value === null || value === undefined || value === ""
    ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const median = (values) => {
    const rows = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  };
  const round2 = (value) => value == null ? null : Math.round(value * 100) / 100;

  function calculate(periods, overrides) {
    const assumptions = Object.assign({}, defaults, overrides || {});
    const rows = Array.isArray(periods) ? periods.slice(0, 7) : [];
    if (!rows.length) return { complete: false, missing: ["annual_periods"] };
    const latest = rows[0];
    const requiredAsset = ["shares", "total_assets", "total_liabilities", "cash",
      "securities", "receivables", "inventory", "fixed_assets", "intangibles",
      "goodwill", "minority_interest"];
    const assetMissing = requiredAsset.filter((key) => number(latest[key]) == null);
    if (number(latest.shares) != null && number(latest.shares) <= 0) assetMissing.push("shares");
    let assetValue = null;
    if (!assetMissing.length && number(latest.shares) > 0) {
      const known = ["cash", "securities", "receivables", "inventory", "fixed_assets",
        "intangibles", "goodwill"].reduce((sum, key) => sum + number(latest[key]), 0);
      const other = Math.max(0, number(latest.total_assets) - known);
      if (known - number(latest.total_assets) > Math.max(number(latest.total_assets) * .01, 1)) {
        assetMissing.push("overlapping_asset_categories");
      }
      if (!assetMissing.length) {
        const adjusted = number(latest.cash) * assumptions.cash
        + number(latest.securities) * assumptions.securities
        + number(latest.receivables) * assumptions.receivables
        + number(latest.inventory) * assumptions.inventory
        + number(latest.fixed_assets) * assumptions.fixed_assets
        + number(latest.intangibles) * assumptions.intangibles
        + number(latest.goodwill) * assumptions.goodwill
        + other * assumptions.other_assets;
        const equity = adjusted - number(latest.total_liabilities)
          - number(latest.minority_interest);
        assetValue = { adjusted_assets: round2(adjusted), equity_value: round2(equity),
          per_share: round2(equity / number(latest.shares)), other_assets: round2(other) };
      }
    }
    const margins = [], taxes = [], depreciation = [];
    rows.forEach((row) => {
      const revenue = number(row.revenue), ebit = number(row.ebit);
      const pretax = number(row.pretax_profit), tax = number(row.income_tax);
      const da = number(row.depreciation_amortization);
      if (revenue > 0 && ebit != null) margins.push(ebit / revenue);
      if (pretax > 0 && tax != null && tax / pretax >= 0 && tax / pretax <= .60) taxes.push(tax / pretax);
      if (da != null && da >= 0) depreciation.push(da);
    });
    const margin = median(margins), taxRate = median(taxes) ?? assumptions.fallback_tax_rate;
    const normalizedDa = median(depreciation), capRate = number(assumptions.capitalization_rate);
    const debt = number(latest.interest_bearing_debt), revenue = number(latest.revenue);
    const epvMissing = [];
    [["shares", number(latest.shares)], ["revenue", revenue], ["normalized_ebit_margin", margin],
      ["capitalization_rate", capRate], ["cash", number(latest.cash)],
      ["interest_bearing_debt", debt], ["securities", number(latest.securities)],
      ["minority_interest", number(latest.minority_interest)],
      ["normalized_depreciation_amortization", normalizedDa]]
      .forEach(([key, value]) => { if (value == null || (["shares", "capitalization_rate"].includes(key) && value <= 0)) epvMissing.push(key); });
    let epv = null;
    if (!epvMissing.length) {
      const ebit = revenue * margin;
      const earnings = ebit * (1 - taxRate);
      const operatingValue = earnings / capRate;
      const equity = operatingValue + number(latest.cash) + number(latest.securities)
        - debt - number(latest.minority_interest);
      epv = { normalized_ebit_margin: margin, normalized_ebit: round2(ebit),
        effective_tax_rate: taxRate, normalized_depreciation_amortization: round2(normalizedDa),
        maintenance_capex: round2(normalizedDa), normalized_operating_earnings: round2(earnings),
        operating_value: round2(operatingValue), equity_value: round2(equity),
        per_share: round2(equity / number(latest.shares)) };
    }
    return { complete: !!assetValue && !!epv, missing: [...new Set(assetMissing.concat(epvMissing))],
      assumptions, asset_value: assetValue, epv };
  }
  return { defaults, calculate };
});
