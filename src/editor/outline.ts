import type { Text } from "@codemirror/state";

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
/** Avoid flooding the outline panel / Solid DOM on huge docs. */
export const MAX_OUTLINE_ITEMS = 800;

/** 从 Markdown 源码提取 ATX 标题。行号从 1 开始。 */
export function parseOutline(markdown: string, maxItems = MAX_OUTLINE_ITEMS): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING.exec(line);
    if (!match) continue;
    items.push({
      level: match[1].length,
      text: match[2].trim() || "无标题",
      line: i + 1,
    });
    if (items.length >= maxItems) break;
  }
  return items;
}

/** Prefer this for large buffers — no full-document string allocation. */
export function parseOutlineDoc(doc: Text, maxItems = MAX_OUTLINE_ITEMS): OutlineItem[] {
  const items: OutlineItem[] = [];
  let inFence = false;

  for (let n = 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (/^(`{3,}|~{3,})/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING.exec(text);
    if (!match) continue;
    items.push({
      level: match[1].length,
      text: match[2].trim() || "无标题",
      line: n,
    });
    if (items.length >= maxItems) break;
  }
  return items;
}

/** 当前阅读位置：最后一条 line <= 视口首行的标题。 */
export function activeOutlineIndex(items: OutlineItem[], firstVisibleLine: number): number {
  let active = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].line <= firstVisibleLine) active = i;
    else break;
  }
  return active;
}
