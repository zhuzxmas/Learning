const assert = require("node:assert/strict");
const Models = require("../public/chat-models.js");

const staleLocal = ["deleted-on-other-device", "local-only-old"];
assert.deepEqual(Models.loadState(Models.cloud({ custom: [] }, true), staleLocal, []).custom, []);
assert.deepEqual(Models.loadState(Models.cloud({ custom: ["cloud-model"], removed: [] }, true),
  staleLocal, []).custom, ["cloud-model"]);

const missing = Models.loadState(Models.cloud(null, false), ["first-device-model"], ["built-in-a"]);
assert.deepEqual(missing, {
  custom: ["first-device-model"], removed: ["built-in-a"], needsWrite: true,
});

const legacy = Models.loadState(Models.cloud({ custom: ["cloud-model"] }, true),
  staleLocal, ["hidden-built-in"]);
assert.deepEqual(legacy, {
  custom: ["cloud-model"], removed: ["hidden-built-in"], needsWrite: true,
});

const remote = Models.cloud({ custom: ["keep", "remove"], removed: [] }, true);
assert.deepEqual(Models.applyChange(remote, { type: "delete-custom", name: "remove" },
  ["stale", "remove"], []).custom, ["keep"]);
assert.deepEqual(Models.applyChange(remote, { type: "add-custom", name: "new" },
  ["stale"], []).custom, ["keep", "remove", "new"]);
assert.deepEqual(Models.applyChange(remote, { type: "hide-built-in", name: "built-in" },
  [], []).removed, ["built-in"]);
assert.deepEqual(Models.applyChange(Models.cloud({ custom: [], removed: ["built-in"] }, true),
  { type: "unhide-built-in", name: "built-in" }, [], []).removed, []);

console.log("chat model sync tests passed");
