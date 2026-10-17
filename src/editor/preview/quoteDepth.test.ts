import { quoteDepth } from "./quoteDepth.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(quoteDepth("plain text") === 0, "no markers means no quote");
assert(quoteDepth("> one") === 1, "single quote");
assert(quoteDepth("> > two") === 2, "nested quote");
assert(quoteDepth("> > > three") === 3, "triple quote");
assert(quoteDepth(">one") === 1, "marker without a space");
assert(quoteDepth("> >") === 2, "nested marker with no text");
assert(quoteDepth("   > indented") === 1, "up to three leading spaces");
assert(quoteDepth("    > four spaces") === 0, "four spaces is not a quote marker");
assert(quoteDepth("") === 0, "empty line");
assert(quoteDepth(">text > not a marker") === 1, "only the prefix counts");

console.log("quoteDepth ok");
