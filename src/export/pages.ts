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
