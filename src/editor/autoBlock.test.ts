import { blockStarter } from "./autoBlock.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const dollar = blockStarter("$", "", "$");
assert(dollar?.insert === "$\n\n$$", "second dollar opens a math block");
assert(dollar?.caret === 3, "caret lands on the empty line inside the block");
assert(dollar?.fence === false, "maths does not need a leading blank line");

const fence = blockStarter("``", "", "`");
assert(fence?.insert === "`\n\n```", "third backtick opens a fence");
assert(fence?.caret === 3, "caret lands inside the fence");
assert(fence?.fence === true, "fences are flagged so a blank line can be added");

const tilde = blockStarter("~~", "", "~");
assert(tilde?.insert === "~\n\n~~~", "third tilde opens a tilde fence");

assert(blockStarter("", "", "$") === null, "a single dollar is just text");
assert(blockStarter("$", "", "x") === null, "only the marker character triggers");
assert(blockStarter("$", "abc", "$") === null, "never split existing line content");
assert(blockStarter("$", "   ", "$")?.insert === "$\n\n$$", "trailing spaces are fine");
assert(blockStarter("x$", "", "$") === null, "only at the start of a line");
assert(blockStarter("~~~", "", "~") === null, "four tildes are not a starter");

console.log("autoBlock ok");
