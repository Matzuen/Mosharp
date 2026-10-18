/**
 * Rectangular cell ranges over a Markdown table.
 *
 * The widget renders a table without the delimiter row, so "visual row 0" is the
 * header and row >= 1 maps to source line row + 1. Everything here works on the
 * Markdown source, which keeps copy/clear testable without a DOM.
 */

export interface CellPos {
  /** Visual row: 0 is the header. */
  row: number;
  col: number;
}

export interface CellRange {
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

function escapeCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").trim();
}

export function normalizeRange(anchor: CellPos, focus: CellPos): CellRange {
  return {
    rowFrom: Math.min(anchor.row, focus.row),
    rowTo: Math.max(anchor.row, focus.row),
    colFrom: Math.min(anchor.col, focus.col),
    colTo: Math.max(anchor.col, focus.col),
  };
}

export function rangeSize(range: CellRange): number {
  return (range.rowTo - range.rowFrom + 1) * (range.colTo - range.colFrom + 1);
}

export function isSingleCell(range: CellRange): boolean {
  return range.rowFrom === range.rowTo && range.colFrom === range.colTo;
}

/** Source line index for a visual row (the delimiter line is skipped). */
export function sourceLineForRow(row: number): number {
  return row <= 0 ? 0 : row + 1;
}

/** Split a table row into trimmed cells, honouring `\|` escapes. */
export function rowCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function gridOf(source: string): { header: string[]; rows: string[][] } {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  const header = rowCells(lines[0] ?? "");
  const rows = lines
    .slice(1)
    .filter((line) => !/^\s*\|?\s*:?-{2,}/.test(line))
    .map(rowCells);
  return { header, rows };
}

function cellAt(source: string, pos: CellPos): string {
  const { header, rows } = gridOf(source);
  if (pos.row === 0) return header[pos.col] ?? "";
  return rows[pos.row - 1]?.[pos.col] ?? "";
}

/** Copy payload: rows of the range joined by tabs. */
export function rangeToTsv(source: string, range: CellRange): string {
  const out: string[] = [];
  for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
    const cells: string[] = [];
    for (let col = range.colFrom; col <= range.colTo; col += 1) {
      cells.push(cellAt(source, { row, col }));
    }
    out.push(cells.join("\t"));
  }
  return out.join("\n");
}

/**
 * Empty every selected body cell. The header row is left alone: a table whose
 * header cells are all empty no longer parses as a table.
 */
export function clearRange(source: string, range: CellRange): string {
  const lines = source.split("\n");
  const from = Math.max(1, range.rowFrom);
  for (let row = from; row <= range.rowTo; row += 1) {
    const lineIndex = sourceLineForRow(row);
    if (lineIndex >= lines.length) break;
    const cells = rowCells(lines[lineIndex]);
    if (cells.length === 0) continue;
    const width = cells.length;
    for (let col = range.colFrom; col <= range.colTo && col < width; col += 1) {
      cells[col] = "";
    }
    lines[lineIndex] = `| ${cells.map(escapeCell).join(" | ")} |`;
  }
  return lines.join("\n");
}
