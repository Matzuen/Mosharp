import {
  detectLineEnding,
  majorityRuleLine,
  prepareForSave,
  savedBuffer,
  sameText,
  splitFrontmatter,
} from "./fidelity.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const yaml = "---\ntitle: 墨\ntags:\n  - 笔记\n  - 草稿\n---\n\n";
const mixed = `${yaml}第一段\n\n***\n\n第二段\n\n---\n\n***\n`;

const saved = prepareForSave(mixed.replace(/\n/g, "\r\n"), "\r\n");
assert(saved.startsWith("---\r\ntitle: 墨\r\ntags:\r\n  - 笔记\r\n  - 草稿\r\n---\r\n\r\n"), "frontmatter stays in order");
assert(!saved.includes("---\r\n\r\n第二段") || saved.includes("***"), "majority rules");
assert(saved.split("***").length === 4, "three star rules");
assert(!/(^|\r\n)---(\r\n|$)/.test(saved.slice(yaml.replace(/\n/g, "\r\n").length)), "body dashes became stars");
assert(!saved.replace(/\r\n/g, "").includes("\n"), "CRLF file stays CRLF");
assert(!saved.includes("\r\r\n"), "no doubled CR");

const breaks = "甲\n\n<br>\n\n乙\n<br />\n\n```\n<br>\n```\n";
const broken = savedBuffer(breaks);
assert(broken === "甲\n\n\n\n乙\n\n\n```\n<br>\n```\n", "blank lines stay blank, fenced br stays");
assert(!broken.includes("<br>") || broken.includes("```\n<br>\n```"), "no br leaked outside the fence");

const heading = "标题\n---\n\n***\n\n***\n";
assert(prepareForSave(heading, "\n") === heading, "setext underline is not a rule");

const tied = "\n---\n\n***\n";
assert(prepareForSave(tied, "\n") === tied, "a tie keeps both spellings");

const onlyDashes = "\n---\n\n- - -\n";
assert(prepareForSave(onlyDashes, "\n") === onlyDashes, "same marker is not rewritten");

assert(detectLineEnding("a\r\nb") === "\r\n", "detect crlf");
assert(detectLineEnding("a\nb") === "\n", "detect lf");
assert(sameText("a\r\nb", "a\nb"), "same text ignores endings");
assert(majorityRuleLine(mixed) === "***", "insert follows the majority");
assert(majorityRuleLine("hello") === "---", "default rule");

const split = splitFrontmatter("---\n\nhello");
assert(split.frontmatter === "" && split.body.startsWith("---"), "a leading rule is not frontmatter");

const twice = prepareForSave(saved, "\r\n");
assert(twice === saved, "save is idempotent");

console.log("fidelity ok");
