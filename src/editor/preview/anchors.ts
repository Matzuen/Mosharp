import type { Text } from "@codemirror/state";

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingText(line: string): { level: number; text: string } | null {
  const atx = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  if (atx) return { level: atx[1].length, text: atx[2].trim() };
  return null;
}

/** Walk the buffer so anchors work for headings that are not in the parsed viewport. */
export function findHeadingLine(doc: Text, slug: string): number | null {
  const target = decodeURIComponent(slug).trim().toLowerCase();
  if (!target) return null;
  const seen = new Map<string, number>();
  let inFence = false;

  for (let n = 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (/^(`{3,}|~{3,})/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = headingText(text);
    if (!heading || !heading.text) continue;
    const base = slugify(heading.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const full = count === 0 ? base : `${base}-${count}`;
    if (full === target || base === target || heading.text.toLowerCase() === target) return n;
  }
  return null;
}
