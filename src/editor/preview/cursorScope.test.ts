import { insideOrTouching, insideStrictly } from "./cursorScope.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Inline markers: strictly inside only.
assert(insideStrictly(5, 4, 10), "inside the range");
assert(!insideStrictly(4, 4, 10), "the opening boundary is outside");
assert(!insideStrictly(10, 4, 10), "the closing boundary is outside");
assert(!insideStrictly(3, 4, 10), "before the range");
assert(!insideStrictly(11, 4, 10), "after the range");

// Line markers such as `#`: touching counts, so the marker stays editable when
// the caret sits at the very start of the heading.
assert(insideOrTouching(4, 4, 10), "opening boundary counts");
assert(insideOrTouching(10, 4, 10), "closing boundary counts");
assert(!insideOrTouching(3, 4, 10), "before the line");
assert(!insideOrTouching(11, 4, 10), "after the line");

console.log("cursorScope ok");
