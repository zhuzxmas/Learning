const assert = require("node:assert/strict");
const Preferences = require("../public/chat-preferences.js");

assert.equal(Preferences.accountId(" User@Example.COM "), "user_40example.com");
assert.equal(Preferences.localKey("a@example.com"), "chatThinking:a_40example.com");
assert.equal(Preferences.fileName("a@example.com"), "chat-settings-a_40example.com.json");
assert.deepEqual(Preferences.normalize(null), {
  version: 1, thinking: false, pending: false, modified: "",
});
assert.deepEqual(Preferences.normalize({ thinking: true, pending: true, modified: "now", extra: 1 }), {
  version: 1, thinking: true, pending: true, modified: "now",
});
assert.equal(Preferences.localKey("a@example.com") === Preferences.localKey("b@example.com"), false);
assert.equal(Preferences.cloudIsNewer(
  { modified: "2026-09-01T00:00:00Z" }, { modified: "2026-09-02T00:00:00Z" }), true);
assert.equal(Preferences.cloudIsNewer(
  { modified: "2026-09-03T00:00:00Z" }, { modified: "2026-09-02T00:00:00Z" }), false);
assert.equal(Preferences.cloudIsNewer({ modified: "" }, { modified: "2026-09-02T00:00:00Z" }), false);

console.log("chat preference tests passed");
