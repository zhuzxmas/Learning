const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ChatModels = require("../public/chat-models.js");

const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const start = source.indexOf("async function chatReadCustomModelsFile");
const end = source.indexOf("// Built-in models", start);
if (start < 0 || end < 0) throw new Error("Could not locate model sync functions");

function response(status, data, etag) {
  const headers = { "Content-Type": "application/json" };
  if (etag) headers.ETag = etag;
  return new Response(data == null ? null : JSON.stringify(data), { status, headers });
}

function deferred() {
  let resolve;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

function harness(localCustom, localRemoved, steps) {
  let custom = localCustom.slice(), removed = localRemoved.slice();
  const writes = [];
  const storage = new Map();
  const account = { username: "a@example.com" };
  const context = {
    ChatModels,
    ChatPreferences: { accountId: (value) => String(value).replace(/@/g, "_at_") },
    CHAT_MODELS_FILE: "chat-models.json",
    chatModelsEtag: null,
    chatModelsSaveQueue: Promise.resolve(),
    account,
    chatThinkingUsername: (value) => value.username,
    chatContentUrl: (file) => "https://graph.example/" + file,
    chatGetCustomModels: () => custom.slice(),
    chatSaveCustomModels: (value) => { custom = value.slice(); },
    chatGetRemovedModels: () => removed.slice(),
    chatSaveRemovedModels: (value) => { removed = value.slice(); },
    chatThinkingAccountIsActive: (username) => context.account.username === username,
    chatRenderModels: () => {},
    chatLastModel: "",
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    getToken: async () => "token",
    chatResolveFolder: async () => {},
    console: { warn() {} },
    fetch: async (_url, options) => {
      const step = steps.shift();
      if (!step) throw new Error("Unexpected request");
      if (options && options.method === "PUT") {
        writes.push({ headers: options.headers, body: JSON.parse(options.body) });
      }
      return response(step.status, step.data, step.etag);
    },
    Response, JSON, Promise, Date, Math,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return {
    context, writes, storage,
    custom: () => custom, removed: () => removed,
    pending: (username = "a@example.com") => {
      const raw = storage.get("chatModelOps:" + username.replace(/@/g, "_at_"));
      return raw ? JSON.parse(raw) : [];
    },
    async settle() {
      await context.chatModelsSaveQueue;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

(async () => {
  // Deletion starts from fresh cloud state; stale local models are not uploaded.
  const deletion = harness(["deleted", "stale-local"], [], [
    { status: 200, data: { custom: ["keep", "deleted"], removed: [] }, etag: '"v1"' },
    { status: 200, data: { eTag: '"v2"' } },
  ]);
  await deletion.context.chatSyncCustomModelsChange("token", {
    type: "delete-custom", name: "deleted",
  }, "a@example.com");
  assert.deepEqual(deletion.writes[0].body, { custom: ["keep"], removed: [] });
  assert.equal(deletion.writes[0].headers["If-Match"], '"v1"');
  assert.deepEqual(deletion.custom(), ["keep"]);

  // A conflict re-reads current cloud state and reapplies only the requested add.
  const conflict = harness(["stale-local"], [], [
    { status: 200, data: { custom: ["keep"], removed: [] }, etag: '"v1"' },
    { status: 412 },
    { status: 200, data: { custom: ["keep", "other-device"], removed: [] }, etag: '"v2"' },
    { status: 200, data: { eTag: '"v3"' } },
  ]);
  await conflict.context.chatSyncCustomModelsChange("token", {
    type: "add-custom", name: "new-model",
  }, "a@example.com");
  assert.deepEqual(conflict.writes[1].body, {
    custom: ["keep", "other-device", "new-model"], removed: [],
  });
  assert.equal(conflict.writes[1].headers["If-Match"], '"v2"');
  assert.deepEqual(conflict.custom(), ["keep", "other-device", "new-model"]);

  // A missing cloud file bootstraps once from this device's local state.
  const bootstrap = harness(["first-device"], ["hidden-built-in"], [
    { status: 404 },
    { status: 200, data: { eTag: '"created"' } },
  ]);
  await bootstrap.context.chatSyncCustomModelsChange(
    "token", { type: "bootstrap" }, "a@example.com");
  assert.deepEqual(bootstrap.writes[0].body, {
    custom: ["first-device"], removed: ["hidden-built-in"],
  });
  assert.equal(bootstrap.writes[0].headers["If-None-Match"], "*");

  // Failed writes remain pending and are retried later without restoring stale models.
  const retrySteps = [
    { status: 200, data: { custom: ["keep"], removed: [] }, etag: '"v1"' },
    { status: 503 },
  ];
  const retry = harness(["stale-local"], [], retrySteps);
  retry.context.chatQueueCustomModelChange({ type: "add-custom", name: "new" });
  await retry.settle();
  assert.equal(retry.pending().length, 1);
  retrySteps.push(
    { status: 200, data: { custom: ["keep"], removed: [] }, etag: '"v1"' },
    { status: 200, data: { eTag: '"v2"' } },
  );
  retry.context.chatRetryCustomModelChanges(retry.context.account);
  await retry.settle();
  assert.equal(retry.pending().length, 0);
  assert.deepEqual(retry.custom(), ["keep", "new"]);

  // Rapid opposite operations are serialized and retain the user's final intent.
  const rapid = harness(["model"], [], [
    { status: 200, data: { custom: ["model"], removed: [] }, etag: '"v1"' },
    { status: 200, data: { eTag: '"v2"' } },
    { status: 200, data: { custom: [], removed: [] }, etag: '"v2"' },
    { status: 200, data: { eTag: '"v3"' } },
  ]);
  rapid.context.chatQueueCustomModelChange({ type: "delete-custom", name: "model" });
  rapid.context.chatQueueCustomModelChange({ type: "add-custom", name: "model" });
  await rapid.settle();
  assert.equal(rapid.pending().length, 0);
  assert.deepEqual(rapid.custom(), ["model"]);

  // An account switch prevents the old account operation from reaching Graph.
  const switched = harness(["old"], [], []);
  switched.context.chatQueueCustomModelChange({ type: "delete-custom", name: "old" });
  switched.context.account = { username: "b@example.com" };
  await switched.settle();
  assert.equal(switched.writes.length, 0);
  assert.equal(switched.pending().length, 1);

  // Switching accounts during the cloud read prevents the old account PUT.
  const read = deferred();
  const duringRead = harness(["old"], [], []);
  duringRead.context.fetch = async (_url, options) => {
    if (options && options.method === "PUT") {
      duringRead.writes.push({ headers: options.headers, body: JSON.parse(options.body) });
      return response(200, { eTag: '"saved"' });
    }
    return read.promise;
  };
  duringRead.context.chatQueueCustomModelChange({ type: "delete-custom", name: "old" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  duringRead.context.account = { username: "b@example.com" };
  read.resolve(response(200, { custom: ["old"], removed: [] }, '"v1"'));
  await duringRead.settle();
  assert.equal(duringRead.writes.length, 0);
  assert.equal(duringRead.pending().length, 1);

  // A malformed removed field is rejected instead of clearing hidden models.
  const malformed = harness([], ["hidden"], [
    { status: 200, data: { custom: [], removed: "bad" }, etag: '"v1"' },
  ]);
  await assert.rejects(
    malformed.context.chatSyncCustomModelsChange(
      "token", { type: "bootstrap" }, "a@example.com"),
    /结构无效/,
  );
  assert.deepEqual(malformed.removed(), ["hidden"]);

  console.log("chat model integration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
