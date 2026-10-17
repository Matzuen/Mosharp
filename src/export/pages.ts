/** First page keeps the chosen name. Later pages are `name-02.png`. */
export function numberedExportName(path: string, index: number, total: number): string {
  if (total <= 1 || index === 0) return path;
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : "";
  return `${stem}-${String(index + 1).padStart(2, "0")}${ext}`;
}

export function cursorLine(text: string, offset: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Page start offsets for a PNG export, snapped to block boundaries.
 *
 * Cutting every `pageHeight` pixels slices tables, code blocks and images in
 * half. Blocks are packed greedily instead; only a block taller than a whole
 * page still gets cut, since there is no alternative.
 */
export function pageStarts(
  blocks: Array<{ top: number; bottom: number }>,
  pageHeight: number,
  total: number,
): number[] {
  if (pageHeight <= 0 || total <= 0) return [0];
  const starts = [0];
  let pageTop = 0;
  for (const block of blocks) {
    if (block.bottom <= pageTop || block.bottom - pageTop <= pageHeight) continue;
    if (block.bottom > total) continue;
    if (block.top > pageTop) {
      // Start a fresh page at the block rather than mid-block.
      starts.push(block.top);
      pageTop = block.top;
    }
    // A block taller than one page has to be sliced anyway.
    while (block.bottom - pageTop > pageHeight) {
      pageTop += pageHeight;
      starts.push(pageTop);
    }
  }
  return starts.filter((value, index) => index === 0 || value > starts[index - 1]);
}
