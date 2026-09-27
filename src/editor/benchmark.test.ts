import { generateBenchmark } from "./benchmark.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const text = generateBenchmark(100_000);
const lines = text.split("\n");
assert(lines.length === 100_000, `line count ${lines.length}`);
assert(lines[0] === "---" && lines[1] === "title: 10 万行基准" && lines[2] === "---", "frontmatter");

const markers = [
  "# 第 1 节",
  "## 小节 1",
  "### 三级 1",
  "**加粗**",
  "==高亮==",
  "~~删除线~~",
  ":smile:",
  "x^2^",
  "H~2~O",
  "- [ ] 待办 1",
  "- [x] 已完成 1",
  "1. 有序 1",
  "> 引用 1",
  "\n---\n",
  "\n***\n",
  "| 左 | 中 | 右 |",
  "```ts",
  "$E=mc^2$",
  "\\(a+b\\)",
  "\n$$\n",
  "\\[a+b\\]",
  "```mermaid",
  "写作 --> 预览",
  "![色块](data:image/svg+xml",
  "[^1]: 注释 1",
  "[示例][home1]",
  "[home1]: https://example.com/1",
  "![色块][pic1]",
  "[pic1]: data:image/svg+xml",
  "[链接](https://example.com)",
  "[跳到本节](#第-1-节)",
  ": 定义 1",
  "#### 四级 1",
  "##### 五级 1",
  "###### 六级 1",
  "Setext 一级 1\n===",
  "Setext 二级 1\n---",
  "__加粗__",
  "***粗斜体***",
  "  - 嵌套 1",
  "> > 嵌套引用 1",
  "| :--- | :---: | ---: |",
  "    缩进代码 1",
  "硬换行 1  \n仍是这段",
  "```vega-lite",
  "```vega\n",
  "```plantuml",
  "Alice -> Bob: 1",
  "    脚注续行 1",
  "<https://example.com/1>",
  "<div>HTML 1</div>",
];
for (const marker of markers) {
  assert(text.includes(marker), `missing ${marker}`);
}

const second = text.indexOf("# 第 2 节");
assert(second > text.indexOf("# 第 1 节"), "samples repeat");
const sections = lines.filter((line) => /^# 第 \d+ 节$/.test(line)).length;
assert(sections > 100, `syntax keeps cycling, saw ${sections}`);
assert(!text.includes("这是基准正文"), "no prose filler");
const tail = lines.slice(-8).join("\n");
assert(!tail.includes("这是基准正文"), "the end is still the syntax cycle");

console.log("benchmark ok");
