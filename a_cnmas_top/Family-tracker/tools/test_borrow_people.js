const assert = require("node:assert/strict");
const BorrowPeople = require("../public/borrow-people.js");

const legacy = BorrowPeople.normalize({ records: [{ id: "1", person: "Alice" }] });
assert.deepEqual(legacy.people, { custom: [], hidden: [] });

let doc = BorrowPeople.normalize({
  records: [{ id: "1", person: "Alice" }, { id: "2", person: "Bob" }],
  people: { custom: ["Carol", "Alice"], hidden: ["Bob"] },
});
assert.deepEqual(BorrowPeople.visible(doc), ["Alice", "Carol"]);
assert.deepEqual(BorrowPeople.visible(doc, "Bob"), ["Alice", "Bob", "Carol"]);
assert.deepEqual(BorrowPeople.visible(doc), ["Alice", "Carol"]);

const hidden = BorrowPeople.apply(doc, { type: "hide-person", name: "Alice" });
assert.deepEqual(hidden.records, doc.records);
assert.deepEqual(BorrowPeople.visible(hidden), ["Carol"]);

const restored = BorrowPeople.apply(hidden, { type: "restore-person", name: "Alice" });
assert.deepEqual(BorrowPeople.visible(restored), ["Alice", "Carol"]);
assert.ok(restored.people.custom.includes("Alice"));

const added = BorrowPeople.apply(restored, { type: "add-custom-person", name: "Dave" });
assert.ok(added.people.custom.includes("Dave"));
assert.equal(added.people.hidden.includes("Dave"), false);

const remote = BorrowPeople.apply({
  records: [{ id: "remote", person: "Remote" }],
  people: { custom: ["Remote"], hidden: [] },
}, { type: "hide-person", name: "Remote" });
assert.equal(remote.records.length, 1);
assert.deepEqual(remote.people.hidden, ["Remote"]);

const batched = BorrowPeople.apply({ records: [], people: { custom: [], hidden: ["Dave"] } }, {
  type: "batch",
  operations: [
    { type: "restore-person", name: "Dave" },
    { type: "add", rec: { id: "3", person: "Dave" } },
  ],
});
assert.equal(batched.records[0].person, "Dave");
assert.ok(batched.people.custom.includes("Dave"));
assert.equal(batched.people.hidden.includes("Dave"), false);

console.log("borrow people tests passed");
