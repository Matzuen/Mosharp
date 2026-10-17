import { EditorState } from "@codemirror/state";
import { activeOutlineIndex, MAX_OUTLINE_ITEMS, parseOutline, parseOutlineDoc } from "./outline.ts";
import { tocEntries } from "./preview/toc.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const doc = `# 一级

正文。

  ## 缩进标题

\`\`\`
# 代码里的井号
\`\`\`

~~~md
# 波浪围栏里也不算
~~~

### 三级 ##

#没有空格的不算

####### 七个井号不算
`;

const items = parseOutline(doc);
assert(
  items.map((item) => `${item.level}:${item.text}`).join("|") ===
    "1:一级|2:缩进标题|3:三级",
  `headings: ${JSON.stringify(items)}`,
);
assert(items[0].line === 1 && items[1].line === 5 && items[2].line === 15, "line numbers are 1-based");

// The sidebar outline and the in-document `[TOC]` must never disagree.
const sameAsToc =
  JSON.stringify(items) ===
  JSON.stringify(tocEntries(doc.split("\n")).map((entry) => ({ ...entry })));
assert(sameAsToc, "outline and TOC scan the same headings");

// Same text through the editor buffer path.
const state = EditorState.create({ doc });
assert(
  JSON.stringify(parseOutlineDoc(state.doc)) === JSON.stringify(items),
  "parseOutlineDoc agrees with parseOutline",
);

// The cap is a parameter, so a long book can raise it without editing the loop.
assert(parseOutline("# a\n# b\n# c\n# d\n", 2).length === 2, "maxItems stops the scan");
assert(parseOutline("").length === 0, "empty document has no headings");
assert(parseOutline("## \n").length === 0, "a heading needs text");

// The cap is a safety valve, not a product limit: a real document must never
// hit it.
assert(MAX_OUTLINE_ITEMS === 50_000, `cap is 50k (got ${MAX_OUTLINE_ITEMS})`);
assert(
  parseOutline(Array.from({ length: 60_000 }, () => "# x").join("\n")).length === 50_000,
  "50k headings are all listed",
);

// Current-position highlighting
assert(activeOutlineIndex(items, 1) === 0, "first line selects the first heading");
assert(activeOutlineIndex(items, 5) === 1, "exact heading line selects itself");
assert(activeOutlineIndex(items, 12) === 1, "between headings keeps the previous one");
assert(activeOutlineIndex(items, 15) === 2, "last heading is reachable");
assert(activeOutlineIndex(items, 1) === 0, "before the first heading still selects it");
assert(activeOutlineIndex([], 3) === -1, "no headings means no selection");

console.log("outline ok");
