import { frontMatterLines } from "./frontMatter.ts";
import { tocEntries } from "./toc.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Front matter
assert(frontMatterLines(["---", "title: x", "---", "", "body"])?.close === 3, "yaml block detected");
assert(frontMatterLines(["---", "a: 1", "...", "body"])?.close === 3, "… also closes the block");
assert(frontMatterLines(["---", "---"]) === null, "an empty block is a plain rule");
assert(frontMatterLines(["---", "", "text"]) === null, "an unclosed block is not metadata");
assert(frontMatterLines(["# Title", "---", "a: 1", "---"]) === null, "must be at the very top");
assert(frontMatterLines(["\uFEFF---", "a: 1", "---"]) !== null, "a BOM does not hide the block");
assert(frontMatterLines([]) === null, "empty document");
const deep = ["---", ...Array.from({ length: 120 }, (_, i) => `k${i}: ${i}`), "---"];
assert(frontMatterLines(deep) === null, "beyond the 100-line limit it is not metadata");

// Table of contents
const toc = tocEntries(["# One", "text", "## Two", "### Three"]);
assert(toc.length === 3, "three headings");
assert(toc[0].level === 1 && toc[0].line === 1 && toc[0].text === "One", "first heading");
assert(toc[2].level === 3 && toc[2].line === 4, "level and line of the last heading");
assert(tocEntries(["## Closed ##"])[0].text === "Closed", "trailing hashes are stripped");
assert(tocEntries(["#NoSpace"]).length === 0, "a hash needs a space");
assert(tocEntries(["```", "# not a heading", "```", "# Real"]).length === 1, "fenced code is skipped");
assert(
  tocEntries(["~~~", "# hidden", "~~~", "# shown"]).map((entry) => entry.text).join() === "shown",
  "tilde fences are skipped too",
);
assert(tocEntries(Array.from({ length: 400 }, () => "# x")).length === 300, "entries are capped");

console.log("extras ok");
