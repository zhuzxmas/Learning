(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BorrowPeople = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function names(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim())));
  }

  function normalize(data) {
    const value = data && typeof data === "object" ? data : {};
    const people = value.people && typeof value.people === "object" ? value.people : {};
    return {
      records: Array.isArray(value.records) ? value.records.slice() : [],
      people: { custom: names(people.custom), hidden: names(people.hidden) },
    };
  }

  function apply(doc, op) {
    if (op && op.type === "batch") {
      return (Array.isArray(op.operations) ? op.operations : [])
        .reduce((current, item) => apply(current, item), normalize(doc));
    }
    const value = normalize(doc);
    const records = value.records.slice();
    const people = { custom: value.people.custom.slice(), hidden: value.people.hidden.slice() };
    const recordIndex = (id) => records.findIndex((record) => record.id === id);
    const name = String(op && op.name || "").trim();
    switch (op && op.type) {
      case "delete": {
        const index = recordIndex(op.id);
        if (index >= 0) records.splice(index, 1);
        break;
      }
      case "add":
      case "edit": {
        const index = recordIndex(op.rec.id);
        if (index >= 0) records[index] = op.rec;
        else records.push(op.rec);
        break;
      }
      case "add-custom-person":
        if (name && !people.custom.includes(name)) people.custom.push(name);
        people.hidden = people.hidden.filter((item) => item !== name);
        break;
      case "hide-person":
        if (name && !people.hidden.includes(name)) people.hidden.push(name);
        break;
      case "restore-person":
        people.hidden = people.hidden.filter((item) => item !== name);
        if (name && !people.custom.includes(name)) people.custom.push(name);
        break;
      default:
        throw new Error("Unknown borrow operation");
    }
    return normalize({ records, people });
  }

  function visible(doc, keep) {
    const value = normalize(doc);
    const hidden = new Set(value.people.hidden);
    const output = names(value.records.map((record) => record && record.person)
      .concat(value.people.custom));
    const result = output.filter((name) => !hidden.has(name) || name === keep);
    return result.sort((a, b) => a.localeCompare(b, "zh"));
  }

  return { names, normalize, apply, visible };
});
