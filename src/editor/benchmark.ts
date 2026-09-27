const SWATCH =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2280%22%20height=%2224%22%3E%3Crect%20width=%2280%22%20height=%2224%22%20fill=%22%239a3412%22/%3E%3C/svg%3E";

/** One pass of every Markdown construct the editor renders. The benchmark repeats this until the line budget is full. */
function specimen(n: number): string[] {
  const id = String(n);
  return [
    `# 第 ${n} 节`,
    `## 小节 ${n}`,
    `### 三级 ${n}`,
    `#### 四级 ${n}`,
    `##### 五级 ${n}`,
    `###### 六级 ${n}`,
    "",
    `Setext 一级 ${n}`,
    "===",
    "",
    `Setext 二级 ${n}`,
    "---",
    "",
    `**加粗** __加粗__ *斜体* _斜体_ ***粗斜体*** \`代码\` ==高亮== ~~删除线~~ :smile: x^2^ H~2~O \\*转义\\* (${n})`,
    `硬换行 ${n}  `,
    `仍是这段 (${n})`,
    "",
    `- 列表项 ${n}`,
    `  - 嵌套 ${n}`,
    `- [ ] 待办 ${n}`,
    `- [x] 已完成 ${n}`,
    "",
    `1. 有序 ${n}`,
    `2. 其次 ${n}`,
    "",
    `> 引用 ${n}`,
    ">",
    `> > 嵌套引用 ${n}`,
    "",
    "---",
    "",
    "***",
    "",
    "| 左 | 中 | 右 |",
    "| :--- | :---: | ---: |",
    `| ${n} | 值 | 末 |`,
    "",
    "```ts",
    `const line = ${n}`,
    "```",
    "",
    `    缩进代码 ${n}`,
    "",
    `行内 $E=mc^2$ 与 \\(a+b\\) (${n})`,
    "",
    "$$",
    "a^2+b^2=c^2",
    "$$",
    "",
    `\\[a+b\\] (${n})`,
    "",
    "```mermaid",
    "graph LR",
    "  写作 --> 预览",
    "```",
    "",
    "```vega-lite",
    `{"data":{"values":[{"name":"甲","value":${n}}]},"mark":"bar","encoding":{"x":{"field":"name","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}`,
    "```",
    "",
    "```vega",
    `{"marks":[{"type":"text","encode":{"update":{"text":{"value":"${n}"},"x":{"value":8},"y":{"value":12}}}}]}`,
    "```",
    "",
    "```plantuml",
    "@startuml",
    `Alice -> Bob: ${n}`,
    "@enduml",
    "```",
    "",
    `![色块](${SWATCH} "色块")`,
    "",
    `见脚注[^${id}]。`,
    "",
    `[^${id}]: 注释 ${n}`,
    `    脚注续行 ${n}`,
    "",
    `[示例][home${id}]`,
    "",
    `[home${id}]: https://example.com/${n} "首页"`,
    "",
    `![色块][pic${id}]`,
    "",
    `[pic${id}]: ${SWATCH}`,
    "",
    `[链接](https://example.com) 与 [跳到本节](#第-${n}-节) 与 <https://example.com/${n}>`,
    "",
    `术语 ${n}`,
    `: 定义 ${n}`,
    "",
    `<div>HTML ${n}</div>`,
    "",
  ];
}

/** Exactly `lineCount` lines. Front matter once, then the syntax specimen repeats until the file is full. */
export function generateBenchmark(lineCount = 100_000): string {
  const lines: string[] = [];
  const push = (row: string) => {
    if (lines.length < lineCount) lines.push(row);
  };

  for (const row of ["---", "title: 10 万行基准", "---", ""]) push(row);

  let section = 1;
  while (lines.length < lineCount) {
    for (const row of specimen(section)) {
      if (lines.length >= lineCount) break;
      lines.push(row);
    }
    section += 1;
  }
  return lines.join("\n");
}
