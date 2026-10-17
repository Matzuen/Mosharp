import { blockStarter, fenceCloseText, fenceOpener } from "./autoBlock.ts";

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

console.log("autoBlock ok");
