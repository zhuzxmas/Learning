const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const workflow = fs.readFileSync(path.join(__dirname, "../../../.github/workflows/stock-detail-mail.yml"), "utf8");

assert.match(html, /id="sbtDetailMailBtn"[^>]*>发送邮件<\/button>/);
assert.ok(app.includes('const SBT_DETAIL_MAIL_URL = CHAT_API_URL + "/send-stock-detail-email"'));
assert.ok(app.includes('sbtDetailMailBtn.classList.toggle("hidden", !sbtCanEdit())'));
assert.ok(app.includes('body: JSON.stringify({ stock: code })'));
assert.equal(app.includes('recipient:') && app.includes('SBT_DETAIL_MAIL_URL'), false);
assert.ok(workflow.includes("types: [stock-detail-mail-event]"));
assert.ok(workflow.includes("STOCK_MAIL_FROM: ${{ secrets.STOCK_MAIL_FROM }}"));
assert.ok(workflow.includes("STOCK_MAIL_TO: ${{ secrets.STOCK_MAIL_TO }}"));
assert.ok(workflow.includes("STOCK_DETAIL_CODE: ${{ github.event.client_payload.stock }}"));

console.log("stock detail mail UI tests passed");
