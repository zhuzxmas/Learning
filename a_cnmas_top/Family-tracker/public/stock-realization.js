(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StockRealization = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

  function cashEventTotal(record) {
    const stored = Number(record && record.total) || 0;
    if (Math.abs(stored) >= 0.005) return round2(stored);
    const amount = Number(record && record.amount) || 0;
    const fees = Math.abs(Number(record && record.commission) || 0)
      + Math.abs(Number(record && record.stampTax) || 0)
      + Math.abs(Number(record && record.transferFee) || 0);
    return round2(amount - fees);
  }

  function sortTrades(records) {
    return records.map((record, index) => ({ record, index })).sort((a, b) => {
      const byDate = String(a.record.date || "").localeCompare(String(b.record.date || ""));
      if (byDate) return byDate;
      const ao = Number(a.record.tradeOrder), bo = Number(b.record.tradeOrder);
      if (isFinite(ao) && isFinite(bo) && ao !== bo) return ao - bo;
      return a.index - b.index;
    }).map((entry) => entry.record);
  }

  function derive(records) {
    const groups = new Map();
    for (const record of records) {
      const key = String(record.code || "") + "\u0000" + String(record.account || "");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    const events = [];
    for (const [key, rows] of groups) {
      const split = key.indexOf("\u0000");
      const code = key.slice(0, split), account = key.slice(split + 1);
      let heldShares = 0, heldCost = 0, positionStartDate = "";
      for (const record of sortTrades(rows)) {
        const shares = Number(record.shares) || 0;
        const total = shares === 0 ? cashEventTotal(record) : (Number(record.total) || 0);
        const isV2 = Number(record.realizationVersion) >= 2;
        if (shares < 0) {
          if (heldShares < 0.5) positionStartDate = String(record.date || "");
          heldShares += -shares;
          heldCost += -total;
          continue;
        }
        if (shares > 0) {
          const averageCost = heldShares > 0 ? heldCost / heldShares : 0;
          const costBasis = averageCost * shares;
          const remainingShares = Math.max(0, heldShares - shares);
          if (isV2) {
            events.push({
              kind: "sale", transactionId: record.id, code, account,
              date: String(record.date || ""), startDate: positionStartDate,
              realizationOrder: Number(record.tradeOrder) || 0,
              shares, averageCost: round2(averageCost), costBasis: round2(costBasis),
              proceeds: round2(total), pnl: round2(total - costBasis),
              remainingShares: round2(remainingShares), eligible: record.incomeSyncEligible === true,
              modified: record.modified || record.createdAt || "",
            });
          }
          heldShares = remainingShares;
          heldCost = heldShares < 0.5 ? 0 : Math.max(0, heldCost - costBasis);
          if (heldShares < 0.5) positionStartDate = "";
          continue;
        }
        if (isV2) {
          events.push({
            kind: "dividend", transactionId: record.id, code, account,
            date: String(record.date || ""), startDate: positionStartDate,
            realizationOrder: Number(record.tradeOrder) || 0,
            shares: 0, averageCost: round2(heldShares > 0 ? heldCost / heldShares : 0),
            costBasis: 0, proceeds: round2(total), pnl: round2(total),
            remainingShares: round2(heldShares), eligible: record.incomeSyncEligible === true,
            modified: record.modified || record.createdAt || "",
          });
        }
      }
    }
    return events.sort((a, b) => String(a.date).localeCompare(String(b.date)) ||
      Number(a.realizationOrder || 0) - Number(b.realizationOrder || 0) ||
      String(a.transactionId).localeCompare(String(b.transactionId)));
  }

  return { cashEventTotal, derive, sortTrades };
});
