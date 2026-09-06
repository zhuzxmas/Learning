(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StockRanking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function canonicalCode(value) {
    const text = String(value || "").trim().toUpperCase();
    const canonical = text.match(/(?:^|[^0-9])(\d{5})\.HK(?:$|[^A-Z0-9])/);
    if (canonical) return canonical[1] + ".HK";
    const hk = text.match(/H\s*0*(\d{1,5})/);
    if (hk) return hk[1].padStart(5, "0") + ".HK";
    const a = text.match(/(?:^|\D)(\d{6})(?:\D|$)/);
    if (!a) return null;
    return a[1] + (a[1][0] === "6" ? ".SH" : ".SZ");
  }

  function heldCodes(records) {
    const totals = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const code = canonicalCode(record && record.code);
      const shares = Number(record && record.shares);
      if (!code || !isFinite(shares)) continue;
      totals.set(code, (totals.get(code) || 0) + shares);
    }
    return new Set(Array.from(totals).filter(([, shares]) => shares < -0.5).map(([code]) => code));
  }

  function opportunityRank(value) {
    return value === true ? 0 : value === false ? 1 : 2;
  }

  function defaultCompare(a, b) {
    const held = Number(!a.is_held) - Number(!b.is_held);
    if (held) return held;
    const opportunity = opportunityRank(a.potential_opportunity) - opportunityRank(b.potential_opportunity);
    if (opportunity) return opportunity;
    const aRaw = a.profit_ratio, bRaw = b.profit_ratio;
    const av = Number(aRaw), bv = Number(bRaw);
    const aValid = aRaw != null && aRaw !== "" && isFinite(av);
    const bValid = bRaw != null && bRaw !== "" && isFinite(bv);
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (aValid && av !== bv) return av - bv;
    return String(a.stock_cn || "").localeCompare(String(b.stock_cn || ""));
  }

  function opportunityForm(status, targetText, reason) {
    const rawTarget = String(targetText == null ? "" : targetText).trim();
    const target = rawTarget === "" ? null : Number(rawTarget);
    return {
      status: status === "true" || status === "false" ? status : "",
      target,
      reason: String(reason || "").trim(),
      valid: target == null || (isFinite(target) && target >= 0),
    };
  }

  function sameOpportunity(a, b) {
    return !!a && !!b && a.status === b.status && a.target === b.target && a.reason === b.reason;
  }

  return { canonicalCode, heldCodes, defaultCompare, opportunityForm, sameOpportunity };
});
