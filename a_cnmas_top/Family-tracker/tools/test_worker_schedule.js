const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "deepseek-worker.js"), "utf8")
  .replace("export default {", "globalThis.worker = {");
const requests = [];
const context = {
  console,
  Date,
  JSON,
  Response,
  TransformStream,
  Headers,
  TextEncoder,
  URL,
  setTimeout,
  fetch: async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  },
};
vm.createContext(context);
vm.runInContext(source, context);

async function run(isoTime) {
  requests.length = 0;
  let promise;
  context.worker.scheduled(
    { scheduledTime: Date.parse(isoTime) },
    { GH_DISPATCH_TOKEN: "test-token" },
    { waitUntil(value) { promise = value; } },
  );
  await promise;
  assert.equal(requests.length, 1);
  return JSON.parse(requests[0].options.body);
}

async function runWeekend(isoTime) {
  requests.length = 0;
  let called = false;
  context.worker.scheduled(
    { scheduledTime: Date.parse(isoTime) },
    { GH_DISPATCH_TOKEN: "test-token" },
    { waitUntil() { called = true; } },
  );
  assert.equal(called, false);
  assert.equal(requests.length, 0);
}

(async () => {
  const monday = await run("2026-09-07T08:00:00Z");
  assert.equal(monday.event_type, "finance-batch-scheduled-event");
  assert.deepEqual(monday.client_payload, {
    beijing_date: "2026-09-07", light_mode: false, scheduled: true,
  });

  const tuesday = await run("2026-09-08T08:00:00Z");
  assert.deepEqual(tuesday.client_payload, {
    beijing_date: "2026-09-08", light_mode: true, scheduled: true,
  });
  for (const day of ["09", "10", "11"]) {
    assert.equal((await run(`2026-09-${day}T08:00:00Z`)).client_payload.light_mode, true);
  }
  await runWeekend("2026-09-12T08:00:00Z");
  await runWeekend("2026-09-13T08:00:00Z");

  requests.length = 0;
  let attempts = 0;
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    attempts++;
    return new Response(null, { status: attempts < 3 ? 503 : 204 });
  };
  let retryPromise;
  context.worker.scheduled(
    { scheduledTime: Date.parse("2026-09-07T08:00:00Z") },
    { GH_DISPATCH_TOKEN: "test-token" },
    { waitUntil(value) { retryPromise = value; } },
  );
  await retryPromise;
  assert.equal(attempts, 3);
  console.log("worker schedule tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
