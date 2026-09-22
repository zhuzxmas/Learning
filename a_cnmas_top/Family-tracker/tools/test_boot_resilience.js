const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

assert.ok(app.includes('if (els.sbtDetailMailBtn) els.sbtDetailMailBtn.onclick'));
assert.ok(app.includes('if (els.brwRemovePersonBtn) els.brwRemovePersonBtn.onclick'));
assert.ok(app.includes('if (typeof BorrowPeople !== "undefined")'));
assert.match(app, /try \{ sbtWireEvents\(\); \}[\s\S]*?catch \(e\)/);
assert.match(app, /try \{[\s\S]*?brwWireEvents\(\);[\s\S]*?brwResetForm\(\);[\s\S]*?catch \(e\)/);

console.log("boot resilience tests passed");
