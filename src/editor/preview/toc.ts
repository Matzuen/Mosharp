/** Table of contents built from the document's ATX headings. */

export interface TocEntry {
  level: number;
  text: string;
  /** 1-based line number. */
  line: number;
}

/** Guard against pathological documents; beyond this the TOC stops growing. */
export const MAX_ENTRIES = 300;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * Streaming heading scanner: documents are fed one line at a time, so a
 * 100k-line file never has to be turned into an array of strings just to build
 * its table of contents.
 */
export class TocScan {
  private fence: string | null = null;

  /** Returns the entry for this line, or null when it is not a heading. */
  push(text: string, line: number): TocEntry | null {
    const marker = FENCE.exec(text);
    if (marker) {
      const char = marker[1][0];
      if (this.fence === null) this.fence = char;
      else if (this.fence === char) this.fence = null;
      return null;
    }
    if (this.fence !== null) return null;
    const heading = HEADING.exec(text);
    if (!heading) return null;
    return { level: heading[1].length, text: heading[2].trim(), line };
  }
}

export function tocEntries(lines: string[]): TocEntry[] {
  const scan = new TocScan();
  const out: TocEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const entry = scan.push(lines[index], index + 1);
    if (entry) out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
