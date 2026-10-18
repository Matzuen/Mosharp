import {
  getWidths,
  parseStore,
  serialize,
  setWidths,
  type WidthRecord,
} from "./tableWidthStore.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(Object.keys(parseStore(null)).length === 0, "no stored value, empty store");
assert(Object.keys(parseStore("broken")).length === 0, "broken json is ignored");
assert(Object.keys(parseStore("[1,2]")).length === 0, "an array is not a store");
assert(Object.keys(parseStore('{"a":"x"}')).length === 0, "a non-object scope is dropped");

const empty = parseStore("{}");
assert(getWidths(empty, "doc", "2#a|b") === null, "nothing stored for the table");

const one = setWidths(empty, "doc", "2#a|b", [120, 80]);
assert(getWidths(one, "doc", "2#a|b")?.join(",") === "120,80", "widths round-trip");
assert(getWidths(one, "other", "2#a|b") === null, "another document has none");

const roundTripped = parseStore(serialize(one));
assert(
  getWidths(roundTripped, "doc", "2#a|b")?.join(",") === "120,80",
  "serialize and parse keep the widths",
);

// Damaged numbers are dropped rather than poisoning the layout.
const dirty = parseStore('{"doc":{"k":[0,-5,100,1e9]}}');
assert(getWidths(dirty, "doc", "k") === null, "negative or absurd widths are ignored");
const partial = parseStore('{"doc":{"k":[100,"x"]}}');
assert(getWidths(partial, "doc", "k") === null, "a non-numeric width invalidates the entry");

// Widths are rounded so fractional drag deltas do not accumulate.
const rounded = setWidths(empty, "doc", "k", [100.6, 60.4]);
assert(getWidths(rounded, "doc", "k")?.join(",") === "101,60", "widths are rounded");

// Old tables and old documents are trimmed so the store cannot grow forever.
let many: WidthRecord = {};
for (let index = 0; index < 70; index += 1) many = setWidths(many, "doc", `t${index}`, [100]);
assert(Object.keys(many.doc).length === 64, `a document keeps 64 tables (got ${Object.keys(many.doc).length})`);

let scopes: WidthRecord = {};
for (let index = 0; index < 70; index += 1) scopes = setWidths(scopes, `doc${index}`, "k", [100]);
assert(Object.keys(scopes).length === 64, `the store keeps 64 documents (got ${Object.keys(scopes).length})`);

assert(setWidths(empty, "doc", "k", []) === empty, "an empty width list is ignored");

console.log("tableWidthStore ok");
