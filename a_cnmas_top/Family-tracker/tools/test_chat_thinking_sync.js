const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ChatPreferences = require("../public/chat-preferences.js");

const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const start = appSource.indexOf("function chatThinkingUsername");
const end = appSource.indexOf("// ---- index JSON read/write", start);
if (start < 0 || end < 0) throw new Error("Could not locate chat thinking preference functions");
const thinkingSource = appSource.slice(start, end);

function response(status, data, etag) {
  const headers = { "Content-Type": "application/json" };
  if (etag) headers.ETag = etag;
  return new Response(data == null ? null : JSON.stringify(data), { status, headers });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(username = "a@example.com") {
  const values = new Map();
  const requests = [];
  const warnings = [];
  let fetchImpl = async () => response(404);
  const context = {
    ChatPreferences,
    account: { username },
    els: { aiThinking: { checked: false } },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
    },
    console: { warn(...args) { warnings.push(args); } },
    Date, JSON, Promise,
    fetch(...args) { requests.push(args); return fetchImpl(...args); },
    getToken: async (accountValue) => "token:" + accountValue.username,
    chatResolveFolder: async () => {},
    chatContentUrl: (file) => "https://graph.example/" + file,
  };
  vm.createContext(context);
  vm.runInContext(
    "var chatThinkingEtag=null; var chatThinkingRevision=0; " +
    "var chatThinkingSaveQueue=Promise.resolve();\n" + thinkingSource,
    context,
  );
  return {
    context, values, requests, warnings,
    setFetch(fn) { fetchImpl = fn; },
    local(user = username) {
      const raw = values.get(ChatPreferences.localKey(user));
      return ChatPreferences.normalize(raw ? JSON.parse(raw) : null);
    },
    setLocal(value, user = username) {
      values.set(ChatPreferences.localKey(user), JSON.stringify(value));
    },
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await context.chatThinkingSaveQueue;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function testRefreshRestore() {
  const h = harness();
  h.setLocal({ thinking: true, pending: false, modified: "2026-09-01T00:00:00Z" });
  h.context.chatRestoreLocalThinking();
  assert.equal(h.context.els.aiThinking.checked, true);
  assert.equal(h.requests.length, 0);
}

async function testCrossDeviceCloudLoad() {
  const h = harness();
  h.setFetch(async () => response(200,
    { version: 1, thinking: true, modified: "2026-09-02T00:00:00Z" }, '"cloud-1"'));
  await h.context.chatLoadThinking("token", h.context.account);
  assert.equal(h.context.els.aiThinking.checked, true);
  assert.deepEqual(h.local(), {
    version: 1, thinking: true, pending: false, modified: "2026-09-02T00:00:00Z",
  });
}

async function testAccountIsolation() {
  const h = harness("a@example.com");
  h.setLocal({ thinking: true, pending: false }, "a@example.com");
  h.setLocal({ thinking: false, pending: false }, "b@example.com");
  h.context.chatRestoreLocalThinking();
  assert.equal(h.context.els.aiThinking.checked, true);
  h.context.account = { username: "b@example.com" };
  h.context.chatRestoreLocalThinking();
  assert.equal(h.context.els.aiThinking.checked, false);
  assert.notEqual(ChatPreferences.fileName("a@example.com"), ChatPreferences.fileName("b@example.com"));
}

async function testDelayedCloudCannotOverwriteToggle() {
  const h = harness();
  const cloudRead = deferred();
  h.setFetch(async (_url, options) => {
    if (!options || !options.method) return cloudRead.promise;
    return response(200, { eTag: '"saved"' });
  });
  const load = h.context.chatLoadThinking("token", h.context.account);
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  cloudRead.resolve(response(200,
    { thinking: false, modified: "2026-09-02T00:00:00Z" }, '"old"'));
  await load;
  await h.settle();
  assert.equal(h.context.els.aiThinking.checked, true);
  assert.equal(h.local().thinking, true);
  assert.equal(h.local().pending, false);
}

async function testRapidTogglesPersistFinalValue() {
  const h = harness();
  const writes = [];
  h.setFetch(async (_url, options) => {
    writes.push({ headers: options.headers, body: JSON.parse(options.body) });
    return response(200, { eTag: '"etag-' + writes.length + '"' });
  });
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  h.context.els.aiThinking.checked = false;
  h.context.chatQueueThinkingSave(false, "2026-09-03T00:00:01Z");
  await h.settle();
  assert.deepEqual(writes.map((write) => write.body.thinking), [true, false]);
  assert.equal(h.local().thinking, false);
  assert.equal(h.local().pending, false);
}

async function testConflictRetry(conflictStatus = 412) {
  const h = harness();
  const calls = [];
  h.setFetch(async (_url, options) => {
    calls.push(options || {});
    if (calls.length === 1) return response(conflictStatus);
    if (calls.length === 2) return response(200,
      { thinking: false, modified: "2026-09-01T00:00:00Z" }, '"remote"');
    return response(200, { eTag: '"saved"' });
  });
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  await h.settle();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers["If-None-Match"], "*");
  assert.equal(calls[2].headers["If-Match"], '"remote"');
  assert.equal(h.local().pending, false);
}

async function testRemoteNewerWinsConflict(conflictStatus = 412) {
  const h = harness();
  const calls = [];
  h.setFetch(async (_url, options) => {
    calls.push(options || {});
    if (calls.length === 1) return response(conflictStatus);
    return response(200,
      { thinking: false, modified: "2026-09-04T00:00:00Z" }, '"remote-newer"');
  });
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  await h.settle();
  assert.equal(calls.length, 2);
  assert.equal(h.context.els.aiThinking.checked, false);
  assert.equal(h.local().thinking, false);
  assert.equal(h.local().pending, false);
  assert.equal(h.local().modified, "2026-09-04T00:00:00Z");
}

async function testOfflinePendingRetriesViaMissingCloudFile() {
  const h = harness();
  h.setFetch(async () => { throw new Error("offline"); });
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  await h.settle();
  assert.equal(h.local().pending, true);

  const calls = [];
  h.setFetch(async (_url, options) => {
    calls.push(options || {});
    if (!options || !options.method) return response(404);
    return response(200, { eTag: '"created"' });
  });
  h.context.chatRetryThinkingPreference();
  await h.settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["If-None-Match"], "*");
  assert.equal(JSON.parse(calls[1].body).thinking, true);
  assert.equal(h.local().pending, false);
}

async function testAccountSwitchCancelsOldWork() {
  const h = harness("a@example.com");
  h.context.els.aiThinking.checked = true;
  h.context.chatQueueThinkingSave(true, "2026-09-03T00:00:00Z");
  h.context.account = { username: "b@example.com" };
  h.context.els.aiThinking.checked = false;
  await h.settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.local("a@example.com").pending, true);
  assert.equal(h.local("b@example.com").thinking, false);
}

async function testAccountSwitchDuringCloudReadDoesNotLeakState() {
  const h = harness("a@example.com");
  const read = deferred();
  h.setFetch(async () => read.promise);
  const load = h.context.chatLoadThinking("token:a@example.com", h.context.account);
  h.context.account = { username: "b@example.com" };
  h.context.els.aiThinking.checked = false;
  read.resolve(response(200,
    { thinking: true, modified: "2026-09-03T00:00:00Z" }, '"account-a"'));
  await load;
  assert.equal(h.context.els.aiThinking.checked, false);
  assert.equal(h.local("b@example.com").thinking, false);
  assert.equal(h.context.chatThinkingEtag, null);
}

(async () => {
  await testRefreshRestore();
  await testCrossDeviceCloudLoad();
  await testAccountIsolation();
  await testDelayedCloudCannotOverwriteToggle();
  await testRapidTogglesPersistFinalValue();
  await testConflictRetry();
  await testConflictRetry(409);
  await testRemoteNewerWinsConflict();
  await testRemoteNewerWinsConflict(409);
  await testOfflinePendingRetriesViaMissingCloudFile();
  await testAccountSwitchCancelsOldWork();
  await testAccountSwitchDuringCloudReadDoesNotLeakState();
  console.log("chat thinking sync tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
