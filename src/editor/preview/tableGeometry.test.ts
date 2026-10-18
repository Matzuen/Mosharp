import {
  MIN_COLUMN_WIDTH,
  dragColumn,
  evenWidths,
  fitsCount,
  tableKey,
} from "./tableGeometry.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const even = evenWidths(4, 400);
assert(even.widths.length === 4, "one width per column");
assert(even.total === 400, "widths add up to the requested total");
assert(even.widths.every((width) => width === 100), "columns start equal");

const narrow = evenWidths(2, 40);
assert(
  narrow.widths.every((width) => width === MIN_COLUMN_WIDTH),
  "a tiny table still gets usable columns",
);

const widened = dragColumn(even, 1, 60);
assert(widened.widths[1] === 160, "the dragged column grows by the delta");
assert(widened.widths[0] === 100 && widened.widths[2] === 100, "other columns keep their width");
assert(widened.total === 460, "the total follows");

const narrowed = dragColumn(even, 1, -30);
assert(narrowed.widths[1] === 70, "dragging left shrinks the column");

const clamped = dragColumn(even, 1, -500);
assert(clamped.widths[1] === MIN_COLUMN_WIDTH, "a column cannot collapse");

assert(dragColumn(even, 9, 10) === even, "an out-of-range index is ignored");
assert(dragColumn(even, 1, 0) === even, "a zero delta returns the same object");

assert(fitsCount(even, 4), "matching counts fit");
assert(!fitsCount(even, 3), "a different column count does not fit");

const key = tableKey([" 名称 ", "数量", "备注"], 3);
assert(tableKey(["名称", "数量", "备注"], 3) === key, "whitespace does not change the key");
assert(tableKey(["名称", "数量", "备注"], 4) !== key, "the column count is part of the key");
assert(tableKey(["名称", "数量"], 3) !== key, "a different header is a different table");

console.log("tableGeometry ok");
