import { blockStarter, emptyFenceRange, fenceCloseText, fenceOpener } from "./autoBlock.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// `$$` still opens a math block immediately.
const dollar = blockStarter("$", "", "$");
assert(dollar?.insert === "$\n\n$$", "second dollar opens a math block");
assert(dollar?.caret === 3, "caret lands on the empty line inside the block");
assert(blockStarter("", "", "$") === null, "a single dollar is just text");
assert(blockStarter("$", "abc", "$") === null, "never split existing line content");
assert(blockStarter("$", "   ", "$")?.insert === "$\n\n$$", "trailing spaces are fine");
assert(blockStarter("x$", "", "$") === null, "only at the start of a line");

// Fences are no longer completed while typing backticks.
assert(blockStarter("``", "", "`") === null, "typing a fence does not close it");
assert(blockStarter("~~", "", "~") === null, "typing a tilde fence does not close it");

// An opener only counts once it carries a language.
assert(fenceOpener("```html")?.lang === "html", "a fence with a language is complete");
assert(fenceOpener("```js")?.fence === "```", "the fence characters are kept");
assert(fenceOpener("~~~mermaid")?.fence === "~~~", "tilde fences work too");
assert(fenceOpener("  ```rust  ")?.lang === "rust", "indent and trailing spaces are fine");
assert(fenceOpener("```") === null, "no language yet, so Enter is a plain newline");
assert(fenceOpener("```   ") === null, "whitespace is still not a language");
assert(fenceOpener("```js extra") === null, "an info string with spaces is not an opener");
assert(fenceOpener("text ```js") === null, "not at the start of the line");

assert(fenceCloseText("```") === "\n\n```", "Enter leaves a blank body line then closes");
assert(fenceCloseText("~~~") === "\n\n~~~", "the closing fence matches the opener");

// Backspace inside an empty fence removes the whole block.
function slice(texts: string[]): { from: number; to: number; text: string }[] {
  let offset = 0;
  return texts.map((text) => {
    const from = offset;
    offset += text.length + 1;
    return { from, to: from + text.length, text };
  });
}

const emptyBlock = slice(["```js", "", "```"]);
const range = emptyFenceRange(emptyBlock, 1);
assert(range?.from === 0, "deletion starts at the opener");
assert(range?.to === emptyBlock[2].to, "deletion ends at the closing fence");

// Extra blank lines are deleted one at a time, like anywhere else.
const twoBlanks = slice(["```js", "", "", "```"]);
assert(emptyFenceRange(twoBlanks, 1) === null, "an extra blank line is left to normal Backspace");
assert(emptyFenceRange(twoBlanks, 2) === null, "the second blank line is too");
// After those are gone the block itself is removed.
assert(emptyFenceRange(slice(["```js", "", "```"]), 1) !== null, "the empty block goes next");

// Content means normal Backspace.
const withCode = slice(["```js", "const x = 1", "```"]);
assert(emptyFenceRange(withCode, 1) === null, "a block with code is left alone");
assert(
  emptyFenceRange(slice(["```js", "const x = 1", "", "```"]), 2) === null,
  "the blank line after code is ordinary",
);
assert(emptyFenceRange(slice(["text", "", "text"]), 1) === null, "ordinary blank lines are not a fence");
assert(emptyFenceRange(slice(["```js", "", "```"]), 0) === null, "not on a fence line itself");
assert(emptyFenceRange(slice(["~~~", "", "```"]), 1) === null, "mismatched fences do not count");

console.log("autoBlock ok");
