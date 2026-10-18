import {
  MIN_COLUMN_WIDTH,
  createWidthMemory,
  dragColumn,
  evenWidths,
  fitsCount,
  pickWidths,
  scrollStep,
  storeWidths,
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

// Shrinking must not lock the column: widening is bounded by the content width.
const shrunk = dragColumn(even, 1, -40, { maxTotal: 400 });
assert(shrunk.widths[1] === 60 && shrunk.total === 360, `shrink keeps the total (got ${shrunk.total})`);
const regrown = dragColumn(shrunk, 1, 40, { maxTotal: 400 });
assert(regrown.widths[1] === 100, `a shrunk column widens again (got ${regrown.widths[1]})`);
assert(regrown.total === 400, "back to the content width");

const tooWide = dragColumn(even, 1, 80, { maxTotal: 400 });
assert(tooWide === even, "widening past the content width is refused");
const stillRoom = dragColumn(even, 1, 40, { maxTotal: 460 });
assert(stillRoom.widths[1] === 140, "widening is allowed while there is room");

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

// Auto-scroll while dragging near a scroller edge.
assert(scrollStep(0, 800, 400) === 0, "the middle of the scroller does not scroll");
assert(scrollStep(0, 800, 5) < 0, "near the top edge scrolls up");
assert(scrollStep(0, 800, 795) > 0, "near the bottom edge scrolls down");
assert(Math.abs(scrollStep(0, 800, 0)) <= 24, "the step is capped");
assert(Math.abs(scrollStep(0, 800, 2)) >= Math.abs(scrollStep(0, 800, 20)), "deeper past the edge scrolls faster");
assert(scrollStep(0, 40, 20) === 0, "a scroller smaller than two bands does not auto-scroll");

// Width memory survives header edits and column reordering.
const memory = createWidthMemory();
const threeColumns = evenWidths(3, 300);
const custom = dragColumn(threeColumns, 1, 40);
const before = tableKey(["名称", "数量", "备注"], 3);
assert(pickWidths(memory, before, 100, 3) === null, "nothing remembered yet");

storeWidths(memory, before, 100, custom);
assert(pickWidths(memory, before, 100, 3) === custom, "a known table gets its widths back");

// Renaming a header changes the key but not the table position.
const renamed = tableKey(["名称", "数目", "备注"], 3);
assert(pickWidths(memory, renamed, 100, 3) === custom, "a renamed header keeps the widths");

// A different table at a different position gets nothing.
const other = tableKey(["名称", "数量", "备注"], 3);
assert(pickWidths(memory, other, 900, 3) === custom, "the same key is still a hit");
const unrelated = tableKey(["苹果", "香蕉", "梨"], 3);
assert(pickWidths(memory, unrelated, 900, 3) === null, "another table starts from even columns");

// A stored width list that no longer matches the column count is ignored.
assert(pickWidths(memory, before, 100, 5) === null, "a mismatched column count is ignored");

console.log("tableGeometry ok");
