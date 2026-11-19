const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const nodeCrypto = require("node:crypto");

const TOKEN = "wecom-test-token";
const AES_KEY_BASE64 = nodeCrypto.randomBytes(32).toString("base64");
const AES_KEY = AES_KEY_BASE64.replace(/=+$/, "");
const KEY_BYTES = Buffer.from(AES_KEY_BASE64, "base64");
const IV = KEY_BYTES.subarray(0, 16);

const source = fs.readFileSync(path.join(__dirname, "deepseek-worker.js"), "utf8")
  .replace("export default {", "globalThis.worker = {");
const requests = [];
const logs = [];
const context = {
  console: {
    log(value) { logs.push({ level: "info", value }); },
    warn(value) { logs.push({ level: "warn", value }); },
    error(value) { logs.push({ level: "error", value }); },
  },
  crypto: nodeCrypto.webcrypto,
  atob,
  btoa,
  TextEncoder,
  TextDecoder,
  Date,
  JSON,
  Response,
  Request,
  TransformStream,
  Headers,
  URL,
  setTimeout,
  fetch: async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  },
};
vm.createContext(context);
vm.runInContext(source, context);

function pad32(buffer) {
  const pad = 32 - (buffer.length % 32);
  return Buffer.concat([buffer, Buffer.alloc(pad, pad)]);
}

function encryptPayload(plaintext) {
  const cipher = nodeCrypto.createCipheriv("aes-256-cbc", KEY_BYTES, IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(pad32(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]).toString("base64");
}

function decryptBytes(encrypted) {
  const decipher = nodeCrypto.createDecipheriv("aes-256-cbc", KEY_BYTES, IV);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  const pad = plain[plain.length - 1];
  assert.ok(pad >= 1 && pad <= 32);
  return plain.subarray(0, plain.length - pad);
}

function decryptPayload(encrypted) {
  const plain = decryptBytes(encrypted);
  assert.ok(plain.length >= 20);
  const length = plain.readUInt32BE(16);
  assert.ok(length <= plain.length - 20);
  assert.equal(plain.subarray(20 + length).toString("utf8"), "");
  return plain.subarray(20, 20 + length).toString("utf8");
}

function wrapMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return encryptPayload(Buffer.concat([nodeCrypto.randomBytes(16), length, body]));
}

function wrapEchostr(text) {
  const body = Buffer.from(text, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return encryptPayload(Buffer.concat([nodeCrypto.randomBytes(16), length, body]));
}

function signature(timestamp, nonce, encrypted) {
  return nodeCrypto.createHash("sha1")
    .update([TOKEN, String(timestamp), String(nonce), encrypted].sort().join(""))
    .digest("hex");
}

function callbackUrl(timestamp, nonce, encrypted, extra) {
  const url = new URL("https://api.cnmas.top/wecom-bot");
  url.searchParams.set("msg_signature", signature(timestamp, nonce, encrypted));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("nonce", nonce);
  if (extra) url.searchParams.set("echostr", extra);
  return url.toString();
}

function env(overrides) {
  return {
    GH_DISPATCH_TOKEN: "github-token",
    WECOM_BOT_TOKEN: TOKEN,
    WECOM_BOT_AES_KEY: AES_KEY,
    WECOM_ALLOWED_USERIDS: "zhuzx",
    WECOM_ALLOWED_CHATIDS: "chat-1",
    ...(overrides || {}),
  };
}

async function postMessage(message, options) {
  requests.length = 0;
  const encrypted = wrapMessage(message);
  const timestamp = 1700000000;
  const nonce = "nonce-1";
  const response = await context.worker.fetch(new Request(
    callbackUrl(timestamp, nonce, encrypted), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypt: encrypted }),
    }), env(options && options.env), { waitUntil() {} });
  return { response, encrypted };
}

(async () => {
  const verifyText = "verify-ok";
  const echo = wrapEchostr(verifyText);
  const verifyResponse = await context.worker.fetch(new Request(
    callbackUrl(1700000000, "nonce-verify", echo, echo),
  ), env(), { waitUntil() {} });
  assert.equal(verifyResponse.status, 200);
  assert.equal(await verifyResponse.text(), verifyText);

  const badVerify = await context.worker.fetch(new Request(
    callbackUrl(1700000000, "nonce-verify", echo, echo)
      .replace("msg_signature=", "msg_signature=bad"),
  ), env(), { waitUntil() {} });
  assert.equal(badVerify.status, 403);

  const wallpaper = await postMessage({
    msgid: "msg-wallpaper", aibotid: "bot", chatid: "chat-1", chattype: "group",
    from: { userid: "zhuzx" }, msgtype: "text",
    text: { content: "@Robot wallpaper" },
  });
  assert.equal(wallpaper.response.status, 200);
  const replyEnvelope = await wallpaper.response.json();
  assert.equal(replyEnvelope.nonce, "nonce-1");
  assert.equal(replyEnvelope.msgsignature,
    signature(replyEnvelope.timestamp, replyEnvelope.nonce, replyEnvelope.encrypt));
  const reply = JSON.parse(decryptPayload(replyEnvelope.encrypt));
  assert.equal(reply.msgtype, "stream");
  assert.equal(reply.stream.finish, true);
  assert.match(reply.stream.content, /已提交 Bing WallPaper action/);
  assert.equal(requests.length, 1);
  const dispatch = requests[0];
  assert.ok(String(dispatch.url).includes("api.github.com/repos/zhuzxmas/Learning/dispatches"));
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    event_type: "ms-power-automate-event",
    client_payload: { source: "wecom-bot" },
  });
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  assert.equal(JSON.stringify(logs).includes("github-token"), false);

  const denied = await postMessage({
    msgid: "msg-denied", aibotid: "bot", chatid: "chat-1", chattype: "group",
    from: { userid: "intruder" }, msgtype: "text",
    text: { content: "wallpaper" },
  });
  const deniedReply = JSON.parse(decryptPayload((await denied.response.json()).encrypt));
  assert.match(deniedReply.stream.content, /未授权/);
  assert.equal(requests.length, 0);

  const unknown = await postMessage({
    msgid: "msg-unknown", aibotid: "bot", chatid: "chat-1", chattype: "group",
    from: { userid: "zhuzx" }, msgtype: "text",
    text: { content: "/run wallpaper" },
  });
  const unknownReply = JSON.parse(decryptPayload((await unknown.response.json()).encrypt));
  assert.match(unknownReply.stream.content, /wallpaper/);
  assert.equal(requests.length, 0);

  // Exercise every WeCom 32-byte padding length so the WebCrypto raw-block
  // workaround is covered for padding both below and above 16 bytes.
  for (let length = 0; length < 32; length++) {
    const varied = await postMessage({
      msgid: "msg-pad-" + length, aibotid: "bot", chatid: "chat-1", chattype: "group",
      from: { userid: "zhuzx" }, msgtype: "text",
      text: { content: "x".repeat(length) || "/unknown" },
    });
    assert.equal(varied.response.status, 200);
    const variedEnvelope = await varied.response.json();
    assert.equal(variedEnvelope.msgsignature,
      signature(variedEnvelope.timestamp, variedEnvelope.nonce, variedEnvelope.encrypt));
    JSON.parse(decryptPayload(variedEnvelope.encrypt));
  }
  assert.equal(requests.length, 0);

  const encrypted = wrapMessage({
    msgid: "msg-bad-sig", chatid: "chat-1", chattype: "group",
    from: { userid: "zhuzx" }, msgtype: "text",
    text: { content: "wallpaper" },
  });
  const badSignature = await context.worker.fetch(new Request(
    callbackUrl(1700000000, "nonce-2", encrypted).replace("msg_signature=", "msg_signature=bad"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypt: encrypted }),
    }), env(), { waitUntil() {} });
  assert.equal(badSignature.status, 403);
  assert.equal(requests.length, 0);

  console.log("worker wecom bot tests passed");
})().catch((error) => {
  console.error(JSON.stringify(logs, null, 2));
  console.error(error);
  process.exitCode = 1;
});
