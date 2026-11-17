const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

assert.ok(app.includes('if (els.sbtDetailMailBtn) els.sbtDetailMailBtn.onclick'));
assert.ok(app.includes('if (els.brwRemovePersonBtn) els.brwRemovePersonBtn.onclick'));
assert.ok(app.includes('if (typeof BorrowPeople !== "undefined")'));
assert.match(app, /case "stocks": sbtWireEvents\(\);/);
assert.match(app, /case "borrow": brwWireEvents\(\); brwResetForm\(\);/);

// Never reset a category selection the user made while data was still loading.
assert.ok(app.includes("let formTouched"));
assert.ok(app.includes("function sanitizeCategoryTriple"));
assert.ok(app.includes('els.form.addEventListener("input", markFormTouched)'));
assert.ok(app.includes('els.form.addEventListener("change", markFormTouched)'));
assert.ok(app.includes("formTouched = false;"));
assert.ok(app.includes("sanitizeCategoryTriple(cur.i, cur.ii, cur.iii)"));
assert.match(app, /if \(els\.editId\.value\) \{[\s\S]*?setCategoryValues\(els\.iCat\.value/);
assert.match(app, /!formTouched && !els\.amount\.value && !els\.note\.value\.trim\(\)/);
assert.match(app, /isHiddenL3\(rec\.i_cat, rec\.ii_cat, rec\.iii_cat\)/);

console.log("boot resilience tests passed");
