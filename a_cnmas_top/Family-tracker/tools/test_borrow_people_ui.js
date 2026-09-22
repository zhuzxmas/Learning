const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");

assert.match(html, /id="brwRemovePersonBtn"/);
assert.ok(app.includes('!!els.brwEditId.value'));
assert.ok(app.includes('已有借还款记录、搜索和图表不会删除'));
assert.ok(app.includes('brwPersist({ type: "hide-person", name })'));
assert.ok(app.includes('wasHidden ? "restore-person" : "add-custom-person"'));
assert.ok(app.includes('() => brwDocument()'));
assert.ok(app.includes('brwUseDocument(snap)'));
assert.match(app, /function brwResetForm\(\) \{[\s\S]*?brwRebuildPersonOptions\(""\)/);

console.log("borrow people UI tests passed");
