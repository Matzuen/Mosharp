import { splitFrontmatter, toLineFeed } from "../editor/fidelity.ts";

const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const RULE_LINE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function occupiedLines(text: string): string[] {
  if (!text) return [];
  const parts = text.split("\n");
  if (text.endsWith("\n")) parts.pop();
  return parts;
}

export interface Deck {
  pages: string[];
  /** Page index that contains the cursor. */
  start: number;
}

/**
 * One thematic break is one slide. Frontmatter, fences, setext underlines
 * and table rows are not page breaks. A break with no text on either side
 * does not create an empty slide.
 */
export function splitDeck(markdown: string, cursorLine: number): Deck {
  const split = splitFrontmatter(toLineFeed(markdown));
  const frontLines = occupiedLines(split.frontmatter).length;
  const lines = occupiedLines(split.body);
  const pages: string[] = [];
  const ranges: Array<{ from: number; to: number }> = [];
  let chunk: string[] = [];
  let chunkStart = 0;
  let inFence = false;

  const close = (nextStart: number) => {
    const text = chunk.join("\n").trim();
    if (text) {
      pages.push(chunk.join("\n"));
      ranges.push({ from: chunkStart, to: nextStart - 1 });
    }
    chunk = [];
    chunkStart = nextStart;
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_LINE.test(lines[i])) {
      inFence = !inFence;
      chunk.push(lines[i]);
      continue;
    }
    if (!inFence) {
      const rule = RULE_LINE.exec(lines[i]);
      const setext = rule?.[1] === "-" && i > 0 && lines[i - 1].trim() !== "";
      if (rule && !setext) {
        close(i + 1);
        continue;
      }
    }
    if (chunk.length === 0) chunkStart = i;
    chunk.push(lines[i]);
  }
  close(lines.length);

  if (pages.length === 0) return { pages: [split.body], start: 0 };

  const bodyLine = cursorLine - frontLines - 1;
  let start = 0;
  if (bodyLine >= 0) {
    const found = ranges.findIndex((range) => bodyLine >= range.from && bodyLine <= range.to);
    if (found >= 0) start = found;
  }
  return { pages, start };
}
