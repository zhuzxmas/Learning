const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SECRET = "podcast-ingest-secret";
const SOURCE = fs.readFileSync(path.join(__dirname, "deepseek-worker.js"), "utf8")
  .replace("export default {", "globalThis.worker = {");
const requests = [];
const logs = [];
const context = {
  console: {
    log(value) { logs.push({ level: "info", value }); },
    warn(value) { logs.push({ level: "warn", value }); },
    error(value) { logs.push({ level: "error", value }); },
  },
  crypto: crypto.webcrypto,
  atob,
  btoa,
  Date,
  JSON,
  Response,
  Request,
  TransformStream,
  Headers,
  TextEncoder,
  TextDecoder,
  URL,
  setTimeout,
  fetch: async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  },
};
vm.createContext(context);
vm.runInContext(SOURCE, context);

function env(overrides) {
  return {
    GH_DISPATCH_TOKEN: "github-token",
    PODCAST_INGEST_SECRET: SECRET,
    ...(overrides || {}),
  };
}

function payload(overrides) {
  return {
    episode_url: "https://podcasts.apple.com/us/podcast/example/id123?i=456789",
    episode_id: "456789",
    completed_at: "2026-11-19T12:30:00Z",
    source: "ios-shortcut",
    ...(overrides || {}),
  };
}

async function post(body, options) {
  requests.length = 0;
  logs.length = 0;
  const headers = { "Content-Type": "application/json" };
  const opts = options || {};
  if (opts.ingestKey !== null) headers["X-Podcast-Ingest-Key"] = opts.ingestKey || SECRET;
  if (opts.token) headers.Authorization = "Bearer " + opts.token;
  const method = opts.method || "POST";
  const requestBody = body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body));
  const response = await context.worker.fetch(new Request("https://api.cnmas.top/podcast", {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : requestBody,
  }), env(opts.env), { waitUntil() {} });
  return response;
}

(async () => {
  const direct = await post(payload());
  assert.equal(direct.status, 202);
  assert.equal(direct.headers.get("Access-Control-Allow-Origin"), "https://a.cnmas.top");
  assert.match(direct.headers.get("Access-Control-Allow-Headers"), /X-Podcast-Ingest-Key/);
  assert.equal(requests.length, 1);
  const dispatch = requests[0];
  assert.ok(String(dispatch.url).includes("api.github.com/repos/zhuzxmas/Learning/dispatches"));
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    event_type: "podcast-completed-event",
    client_payload: {
      episode_url: "https://podcasts.apple.com/us/podcast/example/id123?i=456789",
      episode_id: "456789",
      completed_at: "2026-11-19T12:30:00.000Z",
      source: "ios-shortcut",
    },
  });
  const directLog = logs.find((entry) => entry.value.event === "github_dispatch").value;
  assert.equal(directLog.dispatch_type, "podcast");
  assert.equal(JSON.stringify(logs).includes(SECRET), false);
  assert.equal(JSON.stringify(logs).includes("github-token"), false);
  assert.equal(JSON.stringify(logs).includes("456789"), false);

  requests.length = 0;
  context.fetch = async (url) => {
    requests.push({ url });
    if (String(url).includes("graph.microsoft.com")) {
      return new Response(JSON.stringify({ mail: "zhuzx2006@outlook.com" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  };
  const graph = await post(payload({ source: "website" }), { ingestKey: null, token: "graph-token" });
  assert.equal(graph.status, 202);
  assert.equal(requests.length, 2);
  assert.ok(String(requests[0].url).includes("graph.microsoft.com"));
  assert.ok(String(requests[1].url).includes("api.github.com"));

  requests.length = 0;
  context.fetch = async (url) => {
    requests.push({ url });
    return new Response(JSON.stringify({ mail: "intruder@example.com" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  const deniedGraph = await post(payload(), { ingestKey: null, token: "graph-token" });
  assert.equal(deniedGraph.status, 403);
  assert.equal(requests.length, 1);

  const badKey = await post(payload(), { ingestKey: "wrong" });
  assert.equal(badKey.status, 403);
  assert.equal(requests.length, 0);

  const missingAuth = await post(payload(), { ingestKey: null });
  assert.equal(missingAuth.status, 403);
  assert.equal(requests.length, 0);

  const invalidBodies = [
    payload({ episode_url: "http://podcasts.apple.com/us/podcast/x/id1?i=2" }),
    payload({ episode_url: "https://example.com/us/podcast/x/id1?i=2" }),
    payload({ episode_url: "https://podcasts.apple.com/us/podcast/x/id1" }),
    payload({ episode_url: "https://podcasts.apple.com/us/podcast/x/id1?i=abc" }),
    payload({ episode_id: "999" }),
  ];
  for (const body of invalidBodies) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const tooLarge = await post(JSON.stringify({ ...payload(), padding: "x".repeat(9000) }));
  assert.equal(tooLarge.status, 413);

  requests.length = 0;
  context.fetch = async (url) => {
    requests.push({ url });
    return new Response("no", { status: 403 });
  };
  const githubFailure = await post(payload());
  assert.equal(githubFailure.status, 502);
  assert.equal(requests.length, 1);

  const method = await post(payload(), { method: "GET" });
  assert.equal(method.status, 405);

  console.log("worker podcast tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
