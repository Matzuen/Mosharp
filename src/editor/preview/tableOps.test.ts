import { applyTableOp, isDelimiterRow, joinCells, splitCells } from "./tableOps.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function eq(actual: string | null, expected: string | null, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const lines = (rows: string[]) => rows.join("\n");
const blank = "|   |   |";

assert(splitCells("| A | B |").join("|") === "A|B", "splitCells drops outer pipes");
assert(joinCells(["A", "B"]) === "| A | B |", "joinCells restores the shape");
assert(isDelimiterRow("| --- | :-: |"), "delimiter row detected");
assert(!isDelimiterRow("| A | B |"), "header is not a delimiter");

// An escaped pipe is cell content, not a separator.
assert(
  splitCells("| a \\| b | c |").join("|") === "a | b|c",
  "escaped pipe stays inside its cell",
);
assert(joinCells(["a|b", "c"]) === "| a\\|b | c |", "joinCells re-escapes a pipe");
assert(
  joinCells(splitCells("| a \\| b | c |")) === "| a \\| b | c |",
  "escaped pipe round-trips unchanged",
);

const table = lines(["| A | B |", "| --- | --- |", "| 1 | 2 |"]);

// Header row: inserting below must land after the delimiter, above is impossible.
eq(
  applyTableOp(table, "row-below", 0, 0),
  lines(["| A | B |", "| --- | --- |", blank, "| 1 | 2 |"]),
  "row below the header goes after the delimiter",
);
eq(applyTableOp(table, "row-above", 0, 0), null, "nothing can go above the header");

// Body row: above inserts before it, below appends.
eq(
  applyTableOp(table, "row-above", 1, 0),
  lines(["| A | B |", "| --- | --- |", blank, "| 1 | 2 |"]),
  "row above the first body row",
);
eq(
  applyTableOp(table, "row-below", 1, 0),
  lines(["| A | B |", "| --- | --- |", "| 1 | 2 |", blank]),
  "row below the last body row",
);

// Columns: every row grows, and the delimiter row gets a dashed cell.
eq(
  applyTableOp(table, "col-right", 1, 1),
  lines(["| A | B |  |", "| --- | --- | --- |", "| 1 | 2 |  |"]),
  "insert a column on the right",
);
eq(
  applyTableOp(table, "col-left", 1, 0),
  lines(["|  | A | B |", "| --- | --- | --- |", "|  | 1 | 2 |"]),
  "insert a column on the left",
);
eq(
  applyTableOp(table, "col-delete", 1, 0),
  lines(["| B |", "| --- |", "| 2 |"]),
  "delete a column from every row",
);

// Moves refuse to leave the table.
eq(applyTableOp(table, "row-move-up", 1, 0), null, "first body row cannot move up");
eq(applyTableOp(table, "row-move-down", 1, 0), null, "last body row cannot move down");
eq(
  applyTableOp(
    lines(["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"]),
    "row-move-down",
    1,
    0,
  ),
  lines(["| A | B |", "| --- | --- |", "| 3 | 4 |", "| 1 | 2 |"]),
  "move a body row down",
);
eq(applyTableOp(table, "col-move-left", 1, 0), null, "first column cannot move left");
eq(
  applyTableOp(table, "col-move-right", 1, 0),
  lines(["| B | A |", "| --- | --- |", "| 2 | 1 |"]),
  "move a column right",
);

// Format normalizes spacing and pads short rows.
eq(
  applyTableOp(lines(["|A|B|", "|  --- |  ---  |", "|  1  |"]), "format", 1, 0),
  lines(["| A | B |", "| --- | --- |", "| 1 |  |"]),
  "format normalizes the source",
);

// A single column cannot be deleted.
eq(applyTableOp(lines(["| A |", "| --- |", "| 1 |"]), "col-delete", 1, 0), null, "keep at least one column");

// Column alignment rewrites only the delimiter row.
eq(
  applyTableOp(table, "align-center", 1, 0),
  lines(["| A | B |", "| :---: | --- |", "| 1 | 2 |"]),
  "center the first column",
);
eq(
  applyTableOp(table, "align-right", 1, 1),
  lines(["| A | B |", "| --- | ---: |", "| 1 | 2 |"]),
  "right align the second column",
);
eq(
  applyTableOp(lines(["| A |", "| :--- |", "| 1 |"]), "align-left", 1, 0),
  null,
  "left align is a no-op when the column is already left aligned",
);
eq(
  applyTableOp(lines(["| A |", "| 1 |"]), "align-center", 1, 0),
  null,
  "alignment needs a delimiter row",
);

// Handled at the document level, not here.
eq(applyTableOp(table, "copy", 1, 0), null, "copy is not a source rewrite");
eq(applyTableOp(table, "delete", 1, 0), null, "delete is not a source rewrite");

console.log("tableOps ok");
