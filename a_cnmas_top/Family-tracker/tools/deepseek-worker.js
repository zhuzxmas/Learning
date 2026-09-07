/* =============================================================================
 * DeepSeek proxy Worker  (for the family bookkeeping SPA "AI 对话" module)
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS
 *   The DeepSeek API key must never live in the browser (anyone could steal it
 *   from the static site and burn your quota). This Worker keeps the key secret,
 *   proxies chat-completion requests to DeepSeek, and only serves requests that
 *   come from one of the four allowed Microsoft accounts.
 *
 * HOW TO DEPLOY (all in the Cloudflare dashboard, no local tooling needed)
 *   1. Workers & Pages  ->  Create  ->  Create Worker.  Name it e.g. deepseek.
 *   2. Click "Edit code", DELETE the sample, PASTE this whole file, Deploy.
 *   3. Settings -> Variables -> "Add variable" under *Secrets*:
 *        Name:  DEEPSEEK_API_KEY   Value: <your DeepSeek API key>   (Encrypt)
 *        Name:  BAILIAN_API_KEY    Value: <your Aliyun Bailian key> (Encrypt)
 *          (Only needed for the "Qwen-*" models. The browser sends
 *           provider:"bailian" and this Worker proxies to DashScope's
 *           OpenAI-compatible endpoint, translating the thinking params.)
 *        Name:  GH_DISPATCH_TOKEN  Value: <GitHub fine-grained PAT>  (Encrypt)
 *          (PAT scope: repo zhuzxmas/Learning, Contents: Read and write —
 *           this also authorizes repository_dispatch. Used by POST /trigger-stock
 *           to kick off the single-stock finance batch.)
 *   4. Settings -> Triggers -> Custom Domains -> Add  ->  api.cnmas.top
 *        (Cloudflare must be managing the cnmas.top DNS zone.)
 *   5. Done. The SPA talks to https://api.cnmas.top .
 *
 * SECURITY MODEL
 *   The browser sends its Microsoft Graph access token in the Authorization
 *   header. Personal-account Graph tokens are NOT plain JWTs, so instead of
 *   decoding them we simply call Graph /me with the token: if Graph accepts it
 *   AND the returned email is on the allow-list, the request is authorized.
 * ===========================================================================*/

// Only these Microsoft accounts may use the chat. Lower-case, exact match.
const ALLOWED_EMAILS = [
  "zhuzx2006@outlook.com",
  "sandycrystal@msn.com",
  "celinemas@outlook.com",
  "celine_mas@outlook.com",
];

// The static site's origin (used for CORS). Add more origins if needed.
const ALLOWED_ORIGINS = [
  "https://a.cnmas.top",
];

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// Aliyun Bailian (DashScope) OpenAI-compatible endpoint, default workspace.
// Dedicated Bailian workspace gateway. This Worker sends OpenAI-compatible
// chat-completion payloads, so use the compatible-mode base (NOT /api/v1,
// which is the native DashScope protocol) and append /chat/completions.
const BAILIAN_URL = "https://llm-sa9owbvbbcplr8fy.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,otherMails";

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// GitHub repository_dispatch config for single-stock and scheduled finance runs.
// GH_DISPATCH_TOKEN (a fine-grained PAT with Contents:write on this repo, which
// also authorizes dispatch) must be set as an encrypted Worker secret.
const GH_DISPATCH_REPO = "zhuzxmas/Learning";
const GH_STOCK_DISPATCH_EVENT = "finance-batch-stock-event";
const GH_SCHEDULE_DISPATCH_EVENT = "finance-batch-scheduled-event";

function workerLog(level, event, fields) {
  const entry = { event, ...fields };
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](entry);
}

function dispatchLogFields(eventType, payload) {
  if (eventType === GH_STOCK_DISPATCH_EVENT) {
    return {
      dispatch_type: "stock",
      force_reports: payload.force_reports === true,
      force_dividends: payload.force_dividends === true,
    };
  }
  return {
    dispatch_type: "scheduled",
    beijing_date: payload.beijing_date,
    mode: payload.light_mode ? "light" : "full",
  };
}

async function dispatchGitHub(env, eventType, clientPayload) {
  const started = Date.now();
  const logFields = dispatchLogFields(eventType, clientPayload);
  if (!env.GH_DISPATCH_TOKEN) {
    workerLog("error", "github_dispatch", {
      ...logFields, status: "configuration_error", duration_ms: 0,
    });
    throw new Error("GH_DISPATCH_TOKEN is not configured");
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${GH_DISPATCH_REPO}/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.GH_DISPATCH_TOKEN,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "family-tracker-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      });
    } catch (error) {
      // The request may have reached GitHub even when its response was lost.
      // Do not retry this ambiguous case because that can create duplicate runs.
      workerLog("error", "github_dispatch", {
        ...logFields, status: "network_error", duration_ms: Date.now() - started,
      });
      throw error;
    }
    if (response && response.status === 204) {
      workerLog("info", "github_dispatch", {
        ...logFields, status: "accepted", github_status: 204,
        attempts: attempt + 1, duration_ms: Date.now() - started,
      });
      return;
    }
    if (response && response.status !== 429 && response.status < 500) {
      let detail = "";
      try { detail = await response.text(); } catch {}
      workerLog("error", "github_dispatch", {
        ...logFields, status: "rejected", github_status: response.status,
        attempts: attempt + 1, duration_ms: Date.now() - started,
      });
      throw new Error("GitHub dispatch failed " + response.status + (detail ? ": " + detail.slice(0, 300) : ""));
    }
    if (response) lastError = new Error("GitHub dispatch failed " + response.status);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  workerLog("error", "github_dispatch", {
    ...logFields, status: "retry_exhausted", attempts: 3,
    duration_ms: Date.now() - started,
  });
  throw lastError || new Error("GitHub dispatch failed");
}

function beijingSchedule(scheduledTime) {
  const beijing = new Date(Number(scheduledTime) + 8 * 60 * 60 * 1000);
  const weekday = beijing.getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  return {
    beijing_date: beijing.toISOString().slice(0, 10),
    light_mode: weekday >= 2 && weekday <= 5,
    scheduled: true,
  };
}

function jsonError(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// Validate the caller by using their token against Microsoft Graph.
// Returns the lower-cased email if allowed, otherwise null.
async function authorize(token) {
  if (!token) return null;
  let res;
  try {
    res = await fetch(GRAPH_ME, { headers: { Authorization: "Bearer " + token } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let me;
  try { me = await res.json(); } catch { return null; }
  const candidates = [];
  if (me.mail) candidates.push(me.mail);
  if (me.userPrincipalName) candidates.push(me.userPrincipalName);
  if (Array.isArray(me.otherMails)) candidates.push(...me.otherMails);
  const lc = candidates.map((e) => String(e).toLowerCase());
  return lc.find((e) => ALLOWED_EMAILS.includes(e)) || null;
}

// Resolve which upstream (URL + API key) to use and rewrite the request body
// for that provider. The browser sends `provider:"bailian"` for "Qwen-*" models.
//   - DeepSeek official: pass the body through unchanged (thinking:{type:...}).
//   - Bailian (DashScope OpenAI-compatible): the thinking switch is a top-level
//     boolean `enable_thinking`, NOT `thinking:{type:...}`. Translate it.
// Returns { url, key, body } or { error } when the provider key is missing.
function resolveUpstream(payload, env) {
  const provider = String(payload && payload.provider || "deepseek").toLowerCase();
  // Never forward our internal routing field to the upstream API.
  const body = { ...payload };
  delete body.provider;

  if (provider === "bailian") {
    if (!env.BAILIAN_API_KEY) {
      return { error: "服务端未配置 BAILIAN_API_KEY。" };
    }
    // Translate DeepSeek-style thinking control -> Bailian enable_thinking.
    const wantThink = body.thinking && body.thinking.type === "enabled";
    delete body.thinking;
    body.enable_thinking = !!wantThink;
    // reasoning_effort only makes sense when thinking is on.
    if (!wantThink) delete body.reasoning_effort;
    return { url: BAILIAN_URL, key: env.BAILIAN_API_KEY, body };
  }

  // Default: DeepSeek official, body unchanged.
  return { url: DEEPSEEK_URL, key: env.DEEPSEEK_API_KEY, body };
}

export default {
  async scheduled(controller, env, ctx) {
    const payload = beijingSchedule(controller.scheduledTime);
    if (!payload) {
      workerLog("info", "scheduled_finance", { status: "skipped_weekend" });
      return;
    }
    workerLog("info", "scheduled_finance", {
      status: "started", beijing_date: payload.beijing_date,
      mode: payload.light_mode ? "light" : "full",
    });
    ctx.waitUntil(dispatchGitHub(env, GH_SCHEDULE_DISPATCH_EVENT, payload));
  },

  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || ALLOWED_ORIGINS[0];

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed", origin);
    }

    // Extract the bearer token and authorize the caller.
    const auth = request.headers.get("Authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const email = await authorize(token);
    if (!email) {
      workerLog("warn", "authorization", { status: "denied", route: new URL(request.url).pathname });
      return jsonError(403, "未授权：此账号无权使用 AI 对话。", origin);
    }

    // -------- Single-stock finance-batch trigger (GitHub repository_dispatch) --------
    if (new URL(request.url).pathname === "/trigger-stock") {
      let body;
      try { body = await request.json(); } catch { body = null; }
      let stock = body ? String(body.stock || "").trim() : "";
      const forceReports = !!(body && body.force_reports === true);
      const forceDividends = !!(body && body.force_dividends === true);
      // HK codes look like H02018 (or 02018.HK); A-shares are 6 digits.
      if (/^[Hh]\d+$/.test(stock)) {
        stock = "H" + stock.slice(1).padStart(5, "0");
      } else if (/\.HK$/i.test(stock)) {
        stock = "H" + stock.replace(/\D/g, "").padStart(5, "0");
      } else {
        stock = stock.replace(/\D/g, "");
        if (stock.length !== 6) {
          return jsonError(400, "缺少合法的股票代码（A股6位数字或 H+港股代码）。", origin);
        }
      }
      try {
        await dispatchGitHub(env, GH_STOCK_DISPATCH_EVENT, {
          stock,
          force_reports: forceReports,
          force_dividends: forceDividends,
        });
      } catch (e) {
        return jsonError(502, "GitHub 触发失败：" + ((e && e.message) || e), origin);
      }
      return new Response(JSON.stringify({ ok: true, stock }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Read the chat request body from the browser.
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "请求体不是合法 JSON。", origin);
    }
    if (!payload || !Array.isArray(payload.messages)) {
      return jsonError(400, "缺少 messages。", origin);
    }
    const aiStarted = Date.now();
    const aiProvider = String(payload.provider || "deepseek").toLowerCase() === "bailian"
      ? "bailian" : "deepseek";
    workerLog("info", "ai_chat", {
      status: "started", provider: aiProvider,
    });

    // IMPORTANT (thinking-mode fix):
    //   When thinking is enabled, DeepSeek can take many seconds to send its
    //   first byte/response headers while it "reasons". If we `await fetch()`
    //   and only then return, Cloudflare sees the Worker produce nothing for a
    //   while and terminates the connection -> the browser gets
    //   ERR_CONNECTION_CLOSED. To avoid that we return a streaming Response
    //   *immediately* (headers go out right away), then fetch DeepSeek in the
    //   background and pump its bytes into the stream as they arrive.
    const { readable, writable } = new TransformStream();

    const headers = new Headers(corsHeaders(origin));
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    headers.set("Connection", "keep-alive");

    // Return the stream immediately, but keep the pump alive for logging and cleanup.
    const pump = (async () => {
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      let terminalLogged = false;
      const logTerminal = (level, status, fields) => {
        if (terminalLogged) return;
        terminalLogged = true;
        workerLog(level, "ai_chat", {
          status, provider: aiProvider, duration_ms: Date.now() - aiStarted,
          ...(fields || {}),
        });
      };
      try {
        // Pick upstream (DeepSeek official or Bailian) and rewrite the body.
        const up = resolveUpstream(payload, env);
        if (up.error) {
          logTerminal("error", "configuration_error");
          await writer.write(enc.encode("data: " + JSON.stringify({ error: up.error }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }
        const providerName = String(payload.provider || "deepseek").toLowerCase() === "bailian" ? "百炼" : "DeepSeek";

        let dsRes;
        try {
          dsRes = await fetch(up.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + up.key,
            },
            body: JSON.stringify(up.body),
          });
        } catch (e) {
          logTerminal("error", "network_error");
          const msg = "无法连接 " + providerName + "：" + ((e && e.message) || e);
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        if (!dsRes.ok || !dsRes.body) {
          let detail = "";
          try { detail = await dsRes.text(); } catch {}
          const msg = providerName + " 返回错误 " + dsRes.status + (detail ? "：" + detail.slice(0, 500) : "");
          logTerminal("error", "upstream_error", { upstream_status: dsRes.status });
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        // Passthrough: copy the upstream SSE bytes straight to the browser.
        const reader = dsRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
        await writer.close();
        logTerminal("info", "completed", { upstream_status: dsRes.status });
      } catch (e) {
        logTerminal("error", "stream_error");
        try {
          const msg = "代理流出错：" + ((e && e.message) || e);
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
        } catch {}
        try { await writer.close(); } catch {}
      }
    })();
    ctx.waitUntil(pump);

    return new Response(readable, { status: 200, headers });
  },
};
