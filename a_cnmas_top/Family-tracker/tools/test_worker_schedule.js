const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "deepseek-worker.js"), "utf8")
  .replace("export default {", "globalThis.worker = {");
const requests = [];
const logs = [];
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = {
  console: {
    log(value) { logs.push({ level: "info", value }); },
    warn(value) { logs.push({ level: "warn", value }); },
    error(value) { logs.push({ level: "error", value }); },
  },
  Date,
  JSON,
  Response,
  Request,
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
  logs.length = 0;
  let promise;
  context.worker.scheduled(
    { scheduledTime: Date.parse(isoTime) },
    { GH_DISPATCH_TOKEN: "test-token" },
    { waitUntil(value) { promise = value; } },
  );
  await promise;
  assert.equal(requests.length, 1);
  return { body: JSON.parse(requests[0].options.body), logs: logs.slice() };
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
  assert.equal(monday.body.event_type, "finance-batch-scheduled-event");
  assert.deepEqual(monday.body.client_payload, {
    beijing_date: "2026-09-07", light_mode: false, scheduled: true,
  });
  assert.deepEqual(plain(monday.logs[0].value),
    { event: "scheduled_finance", status: "started", beijing_date: "2026-09-07", mode: "full" });
  assert.deepEqual(Object.assign({}, plain(monday.logs[1].value), { duration_ms: 0 }),
    { event: "github_dispatch", dispatch_type: "scheduled", beijing_date: "2026-09-07",
      mode: "full", status: "accepted", github_status: 204, attempts: 1, duration_ms: 0 });
  assert.ok(monday.logs[1].value.duration_ms >= 0);
  assert.equal(JSON.stringify(monday.logs).includes("test-token"), false);

  const tuesday = await run("2026-09-08T08:00:00Z");
  assert.deepEqual(tuesday.body.client_payload, {
    beijing_date: "2026-09-08", light_mode: true, scheduled: true,
  });
  for (const day of ["09", "10", "11"]) {
    assert.equal((await run(`2026-09-${day}T08:00:00Z`)).body.client_payload.light_mode, true);
  }
  await runWeekend("2026-09-12T08:00:00Z");
  await runWeekend("2026-09-13T08:00:00Z");

  requests.length = 0;
  logs.length = 0;
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    if (String(url).includes("graph.microsoft.com")) {
      return new Response(JSON.stringify({ mail: "zhuzx2006@outlook.com" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  };
  const stockResponse = await context.worker.fetch(new Request("https://api.cnmas.top/trigger-stock", {
    method: "POST",
    headers: { Authorization: "Bearer graph-token", "Content-Type": "application/json" },
    body: JSON.stringify({ stock: "H02249", force_reports: true, force_dividends: false }),
  }), { GH_DISPATCH_TOKEN: "github-token" }, { waitUntil() {} });
  assert.equal(stockResponse.status, 200);
  const stockLog = logs.find((entry) => entry.value.event === "github_dispatch").value;
  assert.equal(stockLog.status, "accepted");
  assert.equal(stockLog.dispatch_type, "stock");
  assert.equal(stockLog.force_reports, true);
  assert.equal(stockLog.force_dividends, false);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("H02249"), false);
  assert.equal(serializedLogs.includes("graph-token"), false);
  assert.equal(serializedLogs.includes("github-token"), false);

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
