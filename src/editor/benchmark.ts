const PARAGRAPH =
  "这是基准正文，用来测量大文档下的打开、输入和滚动。The quick brown fox jumps over the lazy dog.";

export function generateBenchmark(lineCount = 100_000): string {
  const lines = new Array<string>(lineCount);
  for (let i = 0; i < lineCount; i += 1) {
    const n = i + 1;
    const slot = i % 32;
    if (slot === 0) lines[i] = `# 第 ${n} 节`;
    else if (slot === 8) lines[i] = `## 小节 ${n}`;
    else if (slot === 16) lines[i] = `- 列表项 ${n}`;
    else if (slot === 24) lines[i] = "```ts";
    else if (slot === 25) lines[i] = `const line = ${n}`;
    else if (slot === 26) lines[i] = "```";
    else lines[i] = `${PARAGRAPH} (${n})`;
  }
  return lines.join("\n");
}
