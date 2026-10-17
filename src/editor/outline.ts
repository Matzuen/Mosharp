import type { Text } from "@codemirror/state";
import { TocScan } from "./preview/toc.ts";

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

/**
 * Heading scanning lives in one place (`TocScan`, shared with `[TOC]`), so the
 * sidebar outline and the in-document table of contents can never disagree
 * about what counts as a heading.
 */
function push(items: OutlineItem[], entry: { level: number; text: string; line: number }) {
  items.push({ level: entry.level, text: entry.text || "无标题", line: entry.line });
}

/**
 * Pure safety valve, not a product limit: 50 000 headings is far beyond any real
 * document, and the panel renders rows lazily (`content-visibility`), so hitting
 * it would mean the file is pathological rather than just long.
 */
export const MAX_OUTLINE_ITEMS = 50_000;

/** 从 Markdown 源码提取 ATX 标题。行号从 1 开始。 */
export function parseOutline(markdown: string, maxItems = MAX_OUTLINE_ITEMS): OutlineItem[] {
  const scan = new TocScan();
  const items: OutlineItem[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const entry = scan.push(lines[index], index + 1);
    if (entry) push(items, entry);
    if (items.length >= maxItems) break;
  }
  return items;
}

/** Prefer this for large buffers — no full-document string allocation. */
export function parseOutlineDoc(doc: Text, maxItems = MAX_OUTLINE_ITEMS): OutlineItem[] {
  const scan = new TocScan();
  const items: OutlineItem[] = [];
  let line = 0;
  for (const text of doc.iterLines(1, doc.lines)) {
    line += 1;
    const entry = scan.push(text, line);
    if (entry) push(items, entry);
    if (items.length >= maxItems) break;
  }
  return items;
}

/** 当前阅读位置：最后一条 line <= 视口首行的标题。 */
export function activeOutlineIndex(items: OutlineItem[], firstVisibleLine: number): number {
  let found = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].line <= firstVisibleLine) found = index;
    else break;
  }
  return found;
}
