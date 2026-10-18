import { bodyRowOf, moveColumn, moveRow, slotAt } from "./tableReorder.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const table = [
  "| 名称 | 数量 | 备注 |",
  "| --- | :--: | --- |",
  "| 苹果 | 3 | 红 |",
  "| 梨 | 5 | 黄 |",
].join("\n");

const swapped = moveRow(table, 1, 2);
assert(swapped.includes("| 梨 | 5 | 黄 |\n| 苹果 | 3 | 红 |"), `rows swap (got ${swapped})`);
assert(swapped.includes("| 名称 | 数量 | 备注 |"), "the header stays first");
assert(swapped.includes("| --- | :--: | --- |"), "the delimiter stays second");

assert(moveRow(table, 0, 1) === table, "the header cannot be moved");
assert(moveRow(table, 1, 1) === table, "moving onto itself is a no-op");
assert(moveRow(table, 1, 9) === table, "out of range is a no-op");
assert(moveRow(table, 2, 1) === swapped, "moving backwards works too");

const columns = moveColumn(table, 1, 2);
assert(columns.includes("| 名称 | 备注 | 数量 |"), `columns swap (got ${columns})`);
assert(columns.includes("| --- | --- | :--: |"), "the alignment moves with the column");
assert(columns.includes("| 苹果 | 红 | 3 |"), "body cells move too");

assert(moveColumn(table, 0, 0) === table, "moving onto itself is a no-op");
assert(moveColumn(table, 0, 9) === table, "out of range is a no-op");

const short = ["| a | b | c |", "| --- | --- | --- |", "| 1 | 2 |"].join("\n");
const padded = moveColumn(short, 2, 0);
assert(padded.includes("| c | a | b |"), `short rows are padded (got ${padded})`);
assert(padded.includes("|  | 1 | 2 |"), "missing cells become empty");

assert(slotAt([], 10) === -1, "no slots, no target");
const slots = [
  { start: 0, end: 20 },
  { start: 21, end: 40 },
];
assert(slotAt(slots, 5) === 0, "inside the first slot");
assert(slotAt(slots, 30) === 1, "inside the second slot");
assert(slotAt(slots, -5) === 0, "before the first slot clamps to first");
assert(slotAt(slots, 99) === 1, "past the last slot clamps to last");

// The drag hit test measures body rows only; the header is visual row 0.
assert(bodyRowOf(0) === 1, "the first body slot is visual row 1");
assert(bodyRowOf(1) === 2, "the second body slot is visual row 2");
const viaSlots = moveRow(table, bodyRowOf(0), bodyRowOf(1));
assert(
  viaSlots === moveRow(table, 1, 2),
  "dropping slot 0 on slot 1 swaps the first two body rows",
);

console.log("tableReorder ok");
