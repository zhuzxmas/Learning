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
 *        Name:  WECOM_BOT_TOKEN        Value: <智能机器人 Token>        (Encrypt)
 *        Name:  WECOM_BOT_AES_KEY      Value: <智能机器人 EncodingAESKey> (Encrypt)
 *        Name:  WECOM_ALLOWED_USERIDS  Value: <comma-separated userids>  (optional)
 *        Name:  WECOM_ALLOWED_CHATIDS  Value: <comma-separated chatids>  (optional)
 *          The bot callback is https://api.cnmas.top/wecom-bot and accepts
 *          "wallpaper" from authorized group members. At least one of the
 *          two allow-lists must be configured; otherwise every command is
 *          rejected with the caller's userid/chatid so they can be added.
 *        Name:  PODCAST_INGEST_SECRET  Value: <random long string>       (Encrypt)
 *          Shared secret used by the iPhone Shortcut when it posts an Apple
 *          Podcasts episode URL to /podcast. Browser submissions from
 *          a.cnmas.top use the Microsoft Graph bearer token instead.
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
// Official DeepSeek Anthropic-compatible Messages API. Used by the official
// chat page so server tools such as deepseek_web_search/deepseek_read_url and
// the title extension remain available without exposing the provider key.
const DEEPSEEK_ANTHROPIC_URL = "https://api.deepseek.com/anthropic/v1/messages";
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Podcast-Ingest-Key",
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
const GH_DETAIL_MAIL_EVENT = "stock-detail-mail-event";
const GH_WALLPAPER_DISPATCH_EVENT = "ms-power-automate-event";
const GH_PODCAST_EVENT = "podcast-completed-event";
const STOCK_ADMIN_EMAIL = "zhuzx2006@outlook.com";

const PODCAST_PATH = "/podcast";
const DEEPSEEK_CHAT_PATH = "/deepseek-chat";
const DEEPSEEK_ANTHROPIC_PATH = "/deepseek-anthropic";
const PODCAST_MAX_BODY_BYTES = 8192;

const WECOM_BOT_PATH = "/wecom-bot";
const WECOM_COMMANDS = {
  "wallpaper": {
    eventType: GH_WALLPAPER_DISPATCH_EVENT,
    label: "Bing WallPaper action",
    url: "https://github.com/" + GH_DISPATCH_REPO + "/actions/workflows/BingWallPaper.yml",
  },
};

function workerLog(level, event, fields) {
  const entry = { event, ...fields };
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](entry);
}

// ---------------------------------------------------------------------------
// Enterprise WeChat "智能机器人" API callback support
// ---------------------------------------------------------------------------
const WECOM_TEXT = new TextEncoder();
const WECOM_TEXT_DECODER = new TextDecoder();

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function csvList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function loadWeComAes(env) {
  if (!env.WECOM_BOT_AES_KEY) throw new Error("WECOM_BOT_AES_KEY is not configured");
  const raw = String(env.WECOM_BOT_AES_KEY);
  const padded = raw + "=".repeat((4 - raw.length % 4) % 4);
  const keyBytes = base64ToBytes(padded);
  if (keyBytes.length !== 32) throw new Error("WECOM_BOT_AES_KEY must decode to 32 bytes");
  return {
    key: await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]),
    iv: keyBytes.slice(0, 16),
  };
}

function wecomSignature(token, timestamp, nonce, encrypted) {
  const raw = [String(token), String(timestamp), String(nonce), String(encrypted)].sort().join("");
  return crypto.subtle.digest("SHA-1", WECOM_TEXT.encode(raw)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

async function aesBlockEncrypt(key, block) {
  const output = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) }, key, block));
  return output.slice(0, 16);
}

// WebCrypto always applies PKCS#7 padding, while WeCom pads to 32 bytes.
// Decrypt one raw AES block by appending a crafted block that decrypts to a
// valid full padding block; WebCrypto then strips only that extra block.
async function aesBlockDecrypt(key, block) {
  const extra = await aesBlockEncrypt(key, xorBytes(block, new Uint8Array(16).fill(16)));
  const output = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) }, key, concatBytes(block, extra)));
  return output.slice(0, 16);
}

async function wecomAesDecrypt(key, iv, ciphertext) {
  if (!ciphertext.length || ciphertext.length % 16 !== 0) throw new Error("invalid ciphertext length");
  const blocks = [];
  let previous = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const block = ciphertext.slice(offset, offset + 16);
    blocks.push(xorBytes(await aesBlockDecrypt(key, block), previous));
    previous = block;
  }
  const padded = concatBytes(...blocks);
  const pad = padded[padded.length - 1];
  if (pad < 1 || pad > 32 || pad > padded.length) throw new Error("invalid padding");
  for (let i = padded.length - pad; i < padded.length; i++) {
    if (padded[i] !== pad) throw new Error("invalid padding");
  }
  return padded.slice(0, padded.length - pad);
}

async function wecomAesEncrypt(key, iv, plaintext) {
  const pad = 32 - (plaintext.length % 32);
  const padded = concatBytes(plaintext, new Uint8Array(pad).fill(pad));
  const output = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-CBC", iv }, key, padded));
  // Drop WebCrypto's own extra PKCS#7 block.
  return output.slice(0, padded.length);
}

async function wecomDecryptMessage(env, encrypted) {
  const { key, iv } = await loadWeComAes(env);
  const plain = await wecomAesDecrypt(key, iv, base64ToBytes(encrypted));
  if (plain.length < 20) throw new Error("decrypted message too short");
  const messageLength = ((plain[16] << 24) | (plain[17] << 16) | (plain[18] << 8) | plain[19]) >>> 0;
  if (messageLength > plain.length - 20) throw new Error("invalid message length");
  const message = plain.slice(20, 20 + messageLength);
  const receiveId = WECOM_TEXT_DECODER.decode(plain.slice(20 + messageLength));
  if (receiveId !== "") throw new Error("unexpected receiveid");
  return WECOM_TEXT_DECODER.decode(message);
}

function wecomEnvelope(plaintext) {
  const message = WECOM_TEXT.encode(plaintext);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, message.length, false);
  return concatBytes(crypto.getRandomValues(new Uint8Array(16)), length, message);
}

async function wecomEncryptedReply(env, plaintext, nonce) {
  if (!env.WECOM_BOT_TOKEN) throw new Error("WECOM_BOT_TOKEN is not configured");
  const { key, iv } = await loadWeComAes(env);
  const encrypted = bytesToBase64(await wecomAesEncrypt(key, iv, wecomEnvelope(plaintext)));
  const timestamp = Math.floor(Date.now() / 1000);
  const replyNonce = nonce || String(Math.floor(Math.random() * 1e9));
  const signature = await wecomSignature(env.WECOM_BOT_TOKEN, timestamp, replyNonce, encrypted);
  return new Response(JSON.stringify({
    encrypt: encrypted, msgsignature: signature, timestamp, nonce: replyNonce,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function wecomCommand(text) {
  return String(text || "").replace(/@\S+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function wecomAuthorization(env, message) {
  const users = csvList(env.WECOM_ALLOWED_USERIDS);
  const chats = csvList(env.WECOM_ALLOWED_CHATIDS);
  const userid = String((message.from && message.from.userid) || "");
  const chatid = String(message.chatid || "");
  const userOk = users.length === 0 ? chatid !== "" : users.includes("*") || users.includes(userid);
  const chatOk = chats.length === 0 ? true : chats.includes("*") || chats.includes(chatid);
  return {
    ok: (users.length > 0 || chats.length > 0) && userOk && chatOk,
    userid, chatid,
  };
}

async function wecomSeenMessage(msgid) {
  if (!msgid || typeof caches === "undefined" || !caches.default) return false;
  try {
    const key = new Request("https://wecom-bot-dedupe.internal/" + encodeURIComponent(msgid));
    return !!(await caches.default.match(key));
  } catch {
    return false;
  }
}

async function wecomMarkMessage(msgid) {
  if (!msgid || typeof caches === "undefined" || !caches.default) return;
  try {
    await caches.default.put(
      new Request("https://wecom-bot-dedupe.internal/" + encodeURIComponent(msgid)),
      new Response("1", { headers: { "Cache-Control": "max-age=600" } }));
  } catch {
    // Dedupe is best-effort; GitHub dispatch already succeeded.
  }
}

function wecomTextReply(id, content) {
  return JSON.stringify({
    msgtype: "stream",
    stream: { id: String(id || "wecom-bot"), finish: true, content },
  });
}

async function handleWeComBot(request, env, ctx) {
  const url = new URL(request.url);
  const params = {
    signature: url.searchParams.get("msg_signature") || "",
    timestamp: url.searchParams.get("timestamp") || "",
    nonce: url.searchParams.get("nonce") || "",
    echostr: url.searchParams.get("echostr") || "",
  };
  if (!env.WECOM_BOT_TOKEN || !env.WECOM_BOT_AES_KEY) {
    workerLog("error", "wecom_bot", { status: "configuration_error" });
    return new Response("WeCom bot is not configured", { status: 500 });
  }
  if (!params.signature || !params.timestamp || !params.nonce) {
    workerLog("warn", "wecom_bot", { status: "missing_signature_parameters", method: request.method });
    return new Response("Missing signature parameters", { status: 400 });
  }
  workerLog("info", "wecom_bot", {
    status: "received", method: request.method,
    phase: request.method === "GET" ? "verify_url" : "message",
  });

  try {
    if (request.method === "GET") {
      if (!params.echostr) return new Response("Missing echostr", { status: 400 });
      const expected = await wecomSignature(
        env.WECOM_BOT_TOKEN, params.timestamp, params.nonce, params.echostr);
      if (!safeEqual(expected, params.signature)) {
        workerLog("warn", "wecom_bot", { status: "signature_rejected", phase: "verify_url" });
        return new Response("Invalid signature", { status: 403 });
      }
      const plaintext = await wecomDecryptMessage(env, params.echostr);
      return new Response(plaintext, {
        status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const rawBody = await request.text();
    if (rawBody.length > 65536) return new Response("Payload too large", { status: 413 });
    let body;
    try { body = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!body || typeof body.encrypt !== "string") {
      return new Response("Missing encrypt", { status: 400 });
    }
    const expected = await wecomSignature(
      env.WECOM_BOT_TOKEN, params.timestamp, params.nonce, body.encrypt);
    if (!safeEqual(expected, params.signature)) {
      workerLog("warn", "wecom_bot", { status: "signature_rejected", phase: "message" });
      return new Response("Invalid signature", { status: 403 });
    }

    const plaintext = await wecomDecryptMessage(env, body.encrypt);
    let message;
    try { message = JSON.parse(plaintext); } catch { return new Response("Invalid message", { status: 400 }); }
    if (!message) return new Response("Invalid message", { status: 400 });
    if (message.msgtype !== "text") {
      // Events such as enter_chat and template-card clicks have no command.
      // Acknowledge without replying so WeCom does not treat it as an error.
      return new Response(null, { status: 204 });
    }

    const command = wecomCommand(message.text && message.text.content).slice(0, 80);
    const auth = wecomAuthorization(env, message);
    if (!auth.ok) {
      workerLog("warn", "wecom_bot", {
        status: "authorization_denied", command,
        configured: !!(env.WECOM_ALLOWED_USERIDS || env.WECOM_ALLOWED_CHATIDS),
      });
      return wecomEncryptedReply(env, wecomTextReply(message.msgid,
        "未授权。\nuserid: " + (auth.userid || "(empty)") +
        "\nchatid: " + (auth.chatid || "(empty)") +
        "\n请把上面的 userid 或 chatid 加入 Worker 的 WECOM_ALLOWED_USERIDS / WECOM_ALLOWED_CHATIDS。"),
        params.nonce);
    }

    if (await wecomSeenMessage(message.msgid)) {
      return wecomEncryptedReply(env, wecomTextReply(message.msgid, "该请求已处理，请勿重复发送。"), params.nonce);
    }

    const action = WECOM_COMMANDS[command];
    if (!action) {
      workerLog("info", "wecom_bot", { status: "unknown_command", command });
      return wecomEncryptedReply(env, wecomTextReply(message.msgid,
        "可用命令：\nwallpaper"), params.nonce);
    }

    try {
      await dispatchGitHub(env, action.eventType, { source: "wecom-bot" });
      await wecomMarkMessage(message.msgid);
      workerLog("info", "wecom_bot", {
        status: "dispatched", command, dispatch_type: "wallpaper",
      });
      return wecomEncryptedReply(env, wecomTextReply(message.msgid,
        "已提交 " + action.label + "。\n" + action.url), params.nonce);
    } catch (error) {
      workerLog("error", "wecom_bot", {
        status: "dispatch_failed", command, dispatch_type: "wallpaper",
      });
      return wecomEncryptedReply(env, wecomTextReply(message.msgid,
        "触发失败：" + ((error && error.message) || error)), params.nonce);
    }
  } catch (error) {
    workerLog("error", "wecom_bot", { status: "error", message: String(error && error.message || error).slice(0, 200) });
    return new Response("WeCom bot error", { status: 500 });
  }
}

function dispatchLogFields(eventType, payload) {
  if (eventType === GH_WALLPAPER_DISPATCH_EVENT && payload.source === "wecom-bot") {
    return { dispatch_type: "wallpaper" };
  }
  if (eventType === GH_PODCAST_EVENT) {
    return {
      dispatch_type: "podcast",
      source: payload.source,
    };
  }
  if (eventType === GH_STOCK_DISPATCH_EVENT || eventType === GH_DETAIL_MAIL_EVENT) {
    return {
      dispatch_type: eventType === GH_DETAIL_MAIL_EVENT ? "stock_detail_mail" : "stock",
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

function parseApplePodcastUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase() !== "podcasts.apple.com") return null;
  if (url.username || url.password) return null;
  const episodeId = String(url.searchParams.get("i") || "").trim();
  if (!/^\d{1,20}$/.test(episodeId)) return null;
  url.hash = "";
  return { episodeUrl: url.toString(), episodeId };
}

function normalizeCompletedAt(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function readPodcastBody(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > PODCAST_MAX_BODY_BYTES) {
    return { error: "请求体过大。", status: 413 };
  }
  let text;
  try { text = await request.text(); } catch { return { error: "无法读取请求体。", status: 400 }; }
  if (new TextEncoder().encode(text).length > PODCAST_MAX_BODY_BYTES) {
    return { error: "请求体过大。", status: 413 };
  }
  let body;
  try { body = JSON.parse(text); } catch { return { error: "请求体不是合法 JSON。", status: 400 }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "请求体必须是 JSON 对象。", status: 400 };
  }
  return { body };
}

async function authorizePodcast(request, env) {
  const ingestKey = request.headers.get("X-Podcast-Ingest-Key") || "";
  if (ingestKey) {
    if (!env.PODCAST_INGEST_SECRET) {
      return { ok: false, status: 500, message: "服务端未配置 PODCAST_INGEST_SECRET。" };
    }
    if (!safeEqual(ingestKey, env.PODCAST_INGEST_SECRET)) {
      return { ok: false, status: 403, message: "未授权：Podcast 记录密钥无效。" };
    }
    return { ok: true, via: "secret" };
  }
  const auth = request.headers.get("Authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const email = await authorize(token);
  if (!email) {
    return { ok: false, status: 403, message: "未授权：此账号无权记录 Podcast。" };
  }
  return { ok: true, via: "graph", email };
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

// Proxy the official Anthropic-compatible Messages stream. The browser sends
// its Graph token for authorization; DeepSeek receives only the Worker secret.
async function handleDeepSeekAnthropic(request, env, ctx, origin) {
  if (!env.DEEPSEEK_API_KEY) {
    return jsonError(500, "服务端未配置 DEEPSEEK_API_KEY。", origin);
  }
  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return jsonError(400, "无法读取请求体。", origin);
  }
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonError(400, "请求体不是合法 JSON。", origin);
  }
  if (!payload || !Array.isArray(payload.messages)) {
    return jsonError(400, "缺少 messages。", origin);
  }

  const started = Date.now();
  const { readable, writable } = new TransformStream();
  const headers = new Headers(corsHeaders(origin));
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Connection", "keep-alive");

  const pump = (async () => {
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    try {
      const upstream = await fetch(DEEPSEEK_ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.DEEPSEEK_API_KEY,
        },
        body: bodyText,
      });
      if (!upstream.ok || !upstream.body) {
        let detail = "";
        try { detail = await upstream.text(); } catch {}
        const message = "DeepSeek 返回错误 " + upstream.status +
          (detail ? "：" + detail.slice(0, 500) : "");
        workerLog("error", "ai_chat", {
          status: "upstream_error", provider: "deepseek-anthropic",
          upstream_status: upstream.status, duration_ms: Date.now() - started,
        });
        await writer.write(enc.encode(
          "data: " + JSON.stringify({ type: "error", error: { message } }) + "\n\n"));
        await writer.close();
        return;
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) await writer.write(value);
      }
      await writer.close();
      workerLog("info", "ai_chat", {
        status: "completed", provider: "deepseek-anthropic",
        upstream_status: upstream.status, duration_ms: Date.now() - started,
      });
    } catch (error) {
      const message = "代理流出错：" + ((error && error.message) || error);
      workerLog("error", "ai_chat", {
        status: "stream_error", provider: "deepseek-anthropic",
        duration_ms: Date.now() - started,
      });
      try {
        await writer.write(enc.encode(
          "data: " + JSON.stringify({ type: "error", error: { message } }) + "\n\n"));
      } catch {}
      try { await writer.close(); } catch {}
    }
  })();
  ctx.waitUntil(pump);

  return new Response(readable, { status: 200, headers });
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
    const pathname = new URL(request.url).pathname;

    // Enterprise WeChat intelligent-bot callback: authenticated by WeCom's
    // encrypted signature, not by the Microsoft Graph bearer token below.
    if (pathname === WECOM_BOT_PATH) {
      return handleWeComBot(request, env, ctx);
    }

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed", origin);
    }

    if (pathname === PODCAST_PATH) {
      const caller = await authorizePodcast(request, env);
      if (!caller.ok) {
        workerLog("warn", "authorization", { status: "denied", route: PODCAST_PATH });
        return jsonError(caller.status || 403, caller.message || "未授权。", origin);
      }
      const parsedBody = await readPodcastBody(request);
      if (parsedBody.error) {
        return jsonError(parsedBody.status || 400, parsedBody.error, origin);
      }
      const body = parsedBody.body;
      const episode = parseApplePodcastUrl(body.episode_url);
      if (!episode) {
        return jsonError(400, "请提供包含数字 i 单集编号的 https://podcasts.apple.com 链接。", origin);
      }
      if (body.episode_id != null && String(body.episode_id).trim() !== episode.episodeId) {
        return jsonError(400, "episode_id 与链接中的 i 参数不一致。", origin);
      }
      const completedAt = normalizeCompletedAt(body.completed_at);
      if (!completedAt) {
        return jsonError(400, "completed_at 不是合法时间。", origin);
      }
      const source = String(body.source || "ios-shortcut").trim().toLowerCase();
      if (!/^[a-z0-9-]{1,32}$/.test(source)) {
        return jsonError(400, "source 格式不合法。", origin);
      }
      try {
        await dispatchGitHub(env, GH_PODCAST_EVENT, {
          episode_url: episode.episodeUrl,
          episode_id: episode.episodeId,
          completed_at: completedAt,
          source,
        });
      } catch (e) {
        return jsonError(502, "GitHub 触发失败：" + ((e && e.message) || e), origin);
      }
      return new Response(JSON.stringify({
        ok: true, episode_id: episode.episodeId, dispatched: true,
      }), {
        status: 202,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Extract the bearer token and authorize the caller.
    const auth = request.headers.get("Authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const email = await authorize(token);
    if (!email) {
      workerLog("warn", "authorization", { status: "denied", route: new URL(request.url).pathname });
      return jsonError(403, "未授权：此账号无权使用 AI 对话。", origin);
    }

    if (pathname === DEEPSEEK_ANTHROPIC_PATH) {
      return handleDeepSeekAnthropic(request, env, ctx, origin);
    }

    if (pathname !== DEEPSEEK_CHAT_PATH && pathname !== "/" &&
        pathname !== "/trigger-stock" && pathname !== "/send-stock-detail-email") {
      return jsonError(404, "Not found", origin);
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

    if (new URL(request.url).pathname === "/send-stock-detail-email") {
      if (email !== STOCK_ADMIN_EMAIL) {
        workerLog("warn", "authorization", { status: "denied", route: "/send-stock-detail-email" });
        return jsonError(403, "仅管理员可发送股票详情邮件。", origin);
      }
      let body;
      try { body = await request.json(); } catch { body = null; }
      let stock = body ? String(body.stock || "").trim().toUpperCase() : "";
      if (/^H\d{1,5}$/.test(stock)) stock = stock.slice(1).padStart(5, "0") + ".HK";
      else if (/^\d{5}\.HK$/.test(stock)) stock = stock;
      else if (/^\d{6}\.(SH|SZ)$/.test(stock)) stock = stock;
      else return jsonError(400, "缺少合法的股票代码。", origin);
      try {
        await dispatchGitHub(env, GH_DETAIL_MAIL_EVENT, { stock });
      } catch (error) {
        return jsonError(502, "GitHub 邮件任务触发失败：" + ((error && error.message) || error), origin);
      }
      return new Response(JSON.stringify({ ok: true }), {
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
