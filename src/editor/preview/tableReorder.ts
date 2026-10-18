/**
 * Row and column reordering for a Markdown table, plus the pure hit test used by
 * the drag interaction. Working on the source keeps reordering testable without
 * a DOM.
 */

/** Split a row into cells, honouring `\|` escapes; mirrors tableRange. */
function rowCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += trimmed[i];
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiter(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}/.test(line) && /[-:]/.test(line);
}

function joinRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
}

/** Move a body row (visual row >= 1). The header and delimiter stay put. */
export function moveRow(source: string, from: number, to: number): string {
  const lines = source.split("\n");
  const body = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim().length > 0 && !isDelimiter(entry.line));
  // body[0] is the header.
  const fromIndex = from;
  const toIndex = to;
  if (fromIndex < 1 || toIndex < 1) return source;
  if (fromIndex >= body.length || toIndex >= body.length) return source;
  if (fromIndex === toIndex) return source;
  const moved = body.slice();
  const [item] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, item);
  let cursor = 0;
  const next = lines.map((line) => {
    if (line.trim().length === 0 || isDelimiter(line)) return line;
    const replacement = moved[cursor].line;
    cursor += 1;
    return replacement;
  });
  return next.join("\n");
}

/**
 * Move a whole column, including its delimiter cell so the alignment travels
 * with the data. Rows shorter than the header are padded first.
 */
export function moveColumn(source: string, from: number, to: number): string {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return source;
  const width = Math.max(...lines.map((line) => rowCells(line).length));
  if (from < 0 || to < 0 || from >= width || to >= width) return source;
  if (from === to) return source;
  const moved = lines.map((line) => {
    const cells = rowCells(line);
    while (cells.length < width) cells.push(isDelimiter(line) ? "---" : "");
    const next = cells.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return joinRow(next);
  });
  // Keep the original trailing newline behaviour of the source.
  const trailing = source.endsWith("\n") ? "\n" : "";
  return moved.join("\n") + trailing;
}

export interface Slot {
  start: number;
  end: number;
}

/**
 * Visual row of a body-row slot.
 *
 * The drag hit test measures only body rows, so slot 0 is visual row 1 (the
 * header owns row 0). Kept as a function so the offset is stated once and tested.
 */
export function bodyRowOf(slot: number): number {
  return slot + 1;
}

/**
 * Index of the slot the pointer is over, or the nearest one when it sits past
 * the last slot. Used for both row (Y) and column (X) dragging.
 */
export function slotAt(slots: Slot[], position: number): number {
  if (slots.length === 0) return -1;
  for (let index = 0; index < slots.length; index += 1) {
    if (position >= slots[index].start && position <= slots[index].end) return index;
  }
  return position < slots[0].start ? 0 : slots.length - 1;
}
