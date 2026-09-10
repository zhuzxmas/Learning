(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChatModels = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function list(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim())));
  }

  function cloud(data, exists) {
    const value = data && typeof data === "object" ? data : {};
    return {
      exists: exists !== false,
      custom: list(value.custom),
      removed: list(value.removed),
      hasRemoved: Object.prototype.hasOwnProperty.call(value, "removed"),
    };
  }

  function loadState(remote, localCustom, localRemoved) {
    const source = remote || cloud(null, false);
    if (!source.exists) {
      return { custom: list(localCustom), removed: list(localRemoved), needsWrite: true };
    }
    return {
      custom: list(source.custom),
      removed: source.hasRemoved ? list(source.removed) : list(localRemoved),
      needsWrite: !source.hasRemoved,
    };
  }

  function applyChange(remote, change, localCustom, localRemoved) {
    const state = loadState(remote, localCustom, localRemoved);
    let custom = state.custom.slice(), removed = state.removed.slice();
    const name = String(change && change.name || "").trim();
    switch (change && change.type) {
      case "add-custom":
        if (name && !custom.includes(name)) custom.push(name);
        removed = removed.filter((item) => item !== name);
        break;
      case "delete-custom":
        custom = custom.filter((item) => item !== name);
        removed = removed.filter((item) => item !== name);
        break;
      case "hide-built-in":
        if (name && !removed.includes(name)) removed.push(name);
        break;
      case "unhide-built-in":
        removed = removed.filter((item) => item !== name);
        break;
      case "bootstrap":
        break;
      default:
        throw new Error("Unknown model change");
    }
    return { custom: list(custom), removed: list(removed) };
  }

  return { list, cloud, loadState, applyChange };
});
