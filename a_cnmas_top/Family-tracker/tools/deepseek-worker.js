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

export default {
  async fetch(request, env) {
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
      return jsonError(403, "未授权：此账号无权使用 AI 对话。", origin);
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

    // Background pump: never await this before returning the Response.
    (async () => {
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      try {
        let dsRes;
        try {
          dsRes = await fetch(DEEPSEEK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
            },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          const msg = "无法连接 DeepSeek：" + ((e && e.message) || e);
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        if (!dsRes.ok || !dsRes.body) {
          let detail = "";
          try { detail = await dsRes.text(); } catch {}
          const msg = "DeepSeek 返回错误 " + dsRes.status + (detail ? "：" + detail.slice(0, 500) : "");
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        // Passthrough: copy DeepSeek's SSE bytes straight to the browser.
        const reader = dsRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
        await writer.close();
      } catch (e) {
        try {
          const msg = "代理流出错：" + ((e && e.message) || e);
          await writer.write(enc.encode("data: " + JSON.stringify({ error: msg }) + "\n\n"));
          await writer.write(enc.encode("data: [DONE]\n\n"));
        } catch {}
        try { await writer.close(); } catch {}
      }
    })();

    return new Response(readable, { status: 200, headers });
  },
};
