/**
 * Pure source-text operations for the live-preview table widget.
 *
 * Everything here works on the Markdown text of one table block, so it can be
 * tested without a DOM or an editor view.
 */

export type TableOp =
  | "row-above"
  | "row-below"
  | "col-left"
  | "col-right"
  | "row-move-up"
  | "row-move-down"
  | "col-move-left"
  | "col-move-right"
  | "col-delete"
  | "align-left"
  | "align-center"
  | "align-right"
  | "copy"
  | "format"
  | "delete";

export interface TableMenuItem {
  sep?: boolean;
  label?: string;
  op?: TableOp;
  keys?: string;
}

/** Operations offered by the table's “更多操作” menu, in display order. */
export const TABLE_MENU: TableMenuItem[] = [
  { label: "上方插入行", op: "row-above" },
  { label: "下方插入行", op: "row-below", keys: "Ctrl+Enter" },
  { label: "左侧插入列", op: "col-left" },
  { label: "右侧插入列", op: "col-right" },
  { sep: true },
  { label: "上移该行", op: "row-move-up", keys: "Alt+↑" },
  { label: "下移该行", op: "row-move-down", keys: "Alt+↓" },
  { label: "左移该列", op: "col-move-left", keys: "Alt+←" },
  { label: "右移该列", op: "col-move-right", keys: "Alt+→" },
  { sep: true },
  { label: "删除列", op: "col-delete" },
  { sep: true },
  { label: "复制表格", op: "copy" },
  { label: "格式化表格源码", op: "format" },
  { label: "删除表格", op: "delete" },
];

export const TABLE_MENU_KEYS: Record<string, TableOp> = {
  ArrowUp: "row-move-up",
  ArrowDown: "row-move-down",
  ArrowLeft: "col-move-left",
  ArrowRight: "col-move-right",
};

/**
 * Split one table row into cells.
 *
 * `\|` is an escaped pipe (GFM allows it inside a cell), so a naive split on
 * "|" both mis-renders such tables and loses the escape when the row is written
 * back. The returned cells carry the literal character; `joinCells` re-escapes.
 */
export function splitCells(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let current = "";
  let i = text.startsWith("|") ? 1 : 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  // A trailing pipe ends the row; it does not start an empty cell.
  if (current.trim().length > 0 || cells.length === 0) cells.push(current.trim());
  return cells;
}

export function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

export function joinCells(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
}

export function alignment(cell: string): "left" | "center" | "right" {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function blankRow(cols: number) {
  return joinCells(Array.from({ length: cols }, () => " "));
}

/**
 * Rewrite a table block.
 *
 * `activeRow`/`activeCol` are visual coordinates inside the widget: row 0 is the
 * header, rows 1+ are body rows. They are mapped back to source indexes because
 * the delimiter row is not a visual row.
 *
 * Returns the new block text, or null when the operation is a no-op (`copy` and
 * `delete` are also null — the caller handles those at the document level).
 */
export function applyTableOp(
  source: string,
  op: TableOp,
  activeRow: number,
  activeCol: number,
): string | null {
  const rows = source.split("\n");
  if (rows.length === 0) return null;
  const hasDelimiter = rows[1] != null && isDelimiterRow(rows[1]);
  const cols = Math.max(1, splitCells(rows[0]).length);
  const bodyStart = hasDelimiter ? 2 : 1;
  const sourceIndex = !hasDelimiter || activeRow === 0 ? activeRow : activeRow + 1;
  const col = Math.min(Math.max(0, activeCol), cols - 1);

  let next: string[] | null = null;

  if (op === "format") {
    next = rows.map((row) => {
      const cells = splitCells(row);
      if (!isDelimiterRow(row)) while (cells.length < cols) cells.push("");
      return joinCells(cells);
    });
  } else if (op === "row-above") {
    // Nothing can sit above the header without becoming the new header.
    if (activeRow === 0) return null;
    next = [...rows.slice(0, sourceIndex), blankRow(cols), ...rows.slice(sourceIndex)];
  } else if (op === "row-below") {
    const at = activeRow === 0 ? bodyStart : sourceIndex + 1;
    next = [...rows.slice(0, at), blankRow(cols), ...rows.slice(at)];
  } else if (op === "col-left" || op === "col-right") {
    const at = op === "col-left" ? col : col + 1;
    next = rows.map((row) => {
      const cells = splitCells(row);
      while (cells.length < cols) cells.push("");
      cells.splice(at, 0, isDelimiterRow(row) ? "---" : "");
      return joinCells(cells);
    });
  } else if (op === "col-delete") {
    if (cols <= 1) return null;
    next = rows.map((row) => {
      const cells = splitCells(row);
      while (cells.length < cols) cells.push("");
      cells.splice(col, 1);
      return joinCells(cells);
    });
  } else if (op === "align-left" || op === "align-center" || op === "align-right") {
    // Column alignment lives in the delimiter row (`:---`, `:---:`, `---:`).
    if (!hasDelimiter) return null;
    const marker = op === "align-left" ? ":---" : op === "align-center" ? ":---:" : "---:";
    const cells = splitCells(rows[1]);
    while (cells.length < cols) cells.push("---");
    if (cells[col] === marker) return null;
    cells[col] = marker;
    next = [...rows];
    next[1] = joinCells(cells);
  } else if (op === "row-move-up" || op === "row-move-down") {
    if (activeRow === 0) return null;
    const from = sourceIndex;
    const to = op === "row-move-up" ? from - 1 : from + 1;
    if (to < bodyStart || to >= rows.length) return null;
    const copy = [...rows];
    [copy[from], copy[to]] = [copy[to], copy[from]];
    next = copy;
  } else if (op === "col-move-left" || op === "col-move-right") {
    const to = op === "col-move-left" ? col - 1 : col + 1;
    if (to < 0 || to >= cols) return null;
    next = rows.map((row) => {
      const cells = splitCells(row);
      while (cells.length < cols) cells.push("");
      [cells[col], cells[to]] = [cells[to], cells[col]];
      return joinCells(cells);
    });
  }

  if (!next) return null;
  const insert = next.join("\n");
  return insert === source ? null : insert;
}
