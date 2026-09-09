(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChatPreferences = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function accountId(username) {
    return encodeURIComponent(String(username || "unknown").trim().toLowerCase()).replace(/%/g, "_");
  }

  function localKey(username) {
    return "chatThinking:" + accountId(username);
  }

  function fileName(username) {
    return "chat-settings-" + accountId(username) + ".json";
  }

  function normalize(value) {
    const data = value && typeof value === "object" ? value : {};
    return {
      version: 1,
      thinking: data.thinking === true,
      pending: data.pending === true,
      modified: typeof data.modified === "string" ? data.modified : "",
    };
  }

  function cloudIsNewer(local, cloud) {
    const localValue = normalize(local), cloudValue = normalize(cloud);
    return !!cloudValue.modified && !!localValue.modified &&
      cloudValue.modified > localValue.modified;
  }

  return { accountId, localKey, fileName, normalize, cloudIsNewer };
});
