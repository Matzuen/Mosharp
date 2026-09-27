import { articleCss, renderDocument } from "./article.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
import { markdownToDocx } from "./docx.ts";
import { cursorLine, numberedExportName } from "./pages.ts";
import { splitDeck } from "./slides.ts";

const colors = {
  paper: "#f7f5f0",
  ink: "#1c1917",
  accent: "#9a3412",
  line: "#e7e5e4",
  muted: "#78716c",
};

const article = renderDocument(`---
title: Keep
---

# Body

==mark==

| left | right |
| --- | --- |
| 1 | 2 |
`);

const listed = renderDocument("- 列表项\n- [ ] 待办\n- [x] 已完成\n").html;
assert(listed.includes("列表项"), "bullet text");
assert(listed.includes("待办"), "task text");
assert(listed.includes("已完成"), "checked task text");
assert(listed.includes('type="checkbox"'), "task checkbox");

assert(!article.html.includes("Keep"), "frontmatter omitted");
assert(article.html.includes("<h1>Body</h1>"), "heading");
assert(article.html.includes("<mark>mark</mark>"), "highlight");
assert(article.html.includes("<td>2</td>"), "table cell");

const charted = renderDocument(
  "```vega-lite\n{\"mark\":\"bar\"}\n```\n\n```vega\n{\"marks\":[]}\n```\n\n```plantuml\nAlice -> Bob\n```\n",
);
assert(charted.diagrams.map((item) => item.kind).join(",") === "vega-lite,vega,plantuml", "diagram kinds");
assert(charted.html.includes('data-diagram="0"') && charted.html.includes("diagram-plantuml"), "diagram slots");
assert(!charted.html.includes("Alice -> Bob"), "plantuml source is not dumped as code");

const css = articleCss(colors, 780);
assert(css.includes("max-width: 780px"), "width");
assert(css.includes("table-layout: fixed"), "table layout");
assert(css.includes("overflow-wrap: anywhere"), "wrap");
assert(css.includes("background: #f7f5f0"), "paper");
assert(css.includes(".mosharp-doc"), "article class");

const setext = splitDeck("Title\n---\n\nbody\n", 1);
assert(setext.pages.length === 1, "setext is not a slide");

const table = splitDeck("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 2);
assert(table.pages.length === 1, "table rule is not a slide");

const fenced = splitDeck("```\n---\n```\n\n# after\n", 1);
assert(fenced.pages.length === 1, "fence is not a slide");

const deckSource = "---\ntitle: x\n---\n\n# A\n\n---\n\n# B\n";
const deck = splitDeck(deckSource, cursorLine(deckSource, deckSource.indexOf("# B")));
assert(deck.pages.length === 2, "two slides");
assert(deck.pages[0].includes("# A"), "first slide");
assert(deck.pages[1].includes("# B"), "second slide");
assert(deck.start === 1, "cursor page");

const doubled = splitDeck("# A\n\n---\n\n---\n\n# B\n", 1);
assert(doubled.pages.length === 2, "empty slide dropped");

assert(numberedExportName("D:/notes/页.png", 0, 3) === "D:/notes/页.png", "first page name");
assert(numberedExportName("D:/notes/页.png", 1, 3) === "D:/notes/页-02.png", "second page name");

const listedDoc = new TextDecoder().decode(markdownToDocx("- 列表项\n- [ ] 待办\n- [x] 已完成\n", []));
assert(listedDoc.includes("列表项") && listedDoc.includes("待办") && listedDoc.includes("已完成"), "word list text");
const linked = new TextDecoder().decode(markdownToDocx("[链接](https://example.com)\n", []));
assert(linked.includes("https://example.com") && linked.includes("hyperlink"), "word link");
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const pictured = new TextDecoder().decode(
  markdownToDocx("![色块](data:image/png;base64,AA)\n", [], [{ bytes: png, width: 80, height: 24 }]),
);
assert(pictured.includes("media/image1.png"), "word picture");
assert(!pictured.includes("[色块]"), "word picture is not a placeholder");

const docx = markdownToDocx("# Hello\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", []);
assert(docx[0] === 0x50 && docx[1] === 0x4b, "zip");
const xml = new TextDecoder().decode(docx);
assert(xml.includes("Hello"), "docx heading");
assert(xml.includes(">a<") && xml.includes(">2<"), "docx table");

console.log("export ok");
