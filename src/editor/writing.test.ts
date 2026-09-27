import { emojiGlyph } from "./emoji.ts";
import { buildIndex, isDefinitionLine, scanLine } from "./writing.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function doc(text: string) {
  const lines = text.split("\n");
  return {
    lines: lines.length,
    line: (n: number) => ({ text: lines[n - 1] ?? "" }),
  };
}

const indexed = buildIndex(
  doc(
    [
      "见脚注[^1]，以及[示例][home]。",
      "",
      "[^1]: 注释正文",
      "    续行",
      "",
      "[home]: https://example.com \"首页\"",
      "[^skip]: 这不是链接",
    ].join("\n"),
  ),
);

assert(indexed.footnotes.get("1")?.text === "注释正文 续行", "footnote text");
assert(indexed.footnotes.get("1")?.line === 3, "footnote line");
assert(indexed.links.get("home")?.url === "https://example.com", "link url");
assert(indexed.links.get("home")?.title === "首页", "link title");
assert(!indexed.links.has("^skip"), "footnote def is not a link");

const spans = scanLine("表情 :smile: 上标 x^2^ 下标 H~2~O 删除 ~~gone~~ 单尖 E=mc^2 未知 :nope:");
assert(spans.some((span) => span.kind === "emoji" && span.id === "smile"), "emoji");
assert(spans.some((span) => span.kind === "sup" && span.text === "2"), "sup");
assert(spans.some((span) => span.kind === "sub" && span.text === "2"), "sub");
assert(!spans.some((span) => span.text.includes("gone")), "strike stays");
assert(!spans.some((span) => span.kind === "sup" && span.text === "2" && span.from > 20), "single caret");
assert(!spans.some((span) => span.id === "nope"), "unknown emoji");
assert(emojiGlyph("smile") === "😄", "glyph");

const refs = scanLine("看 [文字][home] 和 ![色块][pic]");
assert(refs.some((span) => span.kind === "ref" && span.id === "home"), "ref link");
assert(refs.some((span) => span.kind === "ref-image" && span.id === "pic"), "ref image");

const masked = scanLine("代码 `:smile:` 和 $x^2^$ 以及 \\(a^2^\\)");
assert(masked.length === 0, "skip code and math");

assert(isDefinitionLine("  : 定义"), "definition");
assert(!isDefinitionLine("- 列表"), "not a list");

console.log("writing ok");
