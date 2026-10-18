/**
 * Pure geometry for table mouse interaction.
 *
 * Kept free of DOM and CodeMirror so the arithmetic (column widths, hit testing,
 * cell ranges) can be tested in Node, which is the only automated harness this
 * project has.
 */

export interface ColumnWidths {
  /** Width of each column, in CSS pixels. */
  widths: number[];
  /** Sum of `widths`, cached because it is read on every pointer move. */
  total: number;
}

export const MIN_COLUMN_WIDTH = 48;

/** Equal widths that add up to `total`. */
export function evenWidths(count: number, total: number): ColumnWidths {
  if (count <= 0) return { widths: [], total: 0 };
  const each = Math.max(MIN_COLUMN_WIDTH, total / count);
  const widths = Array.from({ length: count }, () => each);
  return { widths, total: each * count };
}

/**
 * Drag the border to the right of column `index` by `delta` pixels.
 *
 * Only that column changes: the table grows or shrinks, which is what a fixed
 * layout with explicit widths does. Clamped so a column cannot vanish.
 */
export function dragColumn(
  current: ColumnWidths,
  index: number,
  delta: number,
  min = MIN_COLUMN_WIDTH,
): ColumnWidths {
  if (index < 0 || index >= current.widths.length) return current;
  const widths = current.widths.slice();
  const next = Math.max(min, widths[index] + delta);
  if (next === widths[index]) return current;
  widths[index] = next;
  return { widths, total: widths.reduce((sum, width) => sum + width, 0) };
}

/** Widths are reset when the column count changes (the layout no longer applies). */
export function fitsCount(widths: ColumnWidths, count: number): boolean {
  return widths.widths.length === count && widths.widths.every((width) => width > 0);
}

/**
 * Stable key for remembering widths across widget rebuilds.
 *
 * The column count plus the header text identifies a table well enough in
 * practice; a table whose header is edited loses its custom widths, which is
 * better than applying them to an unrelated table.
 */
export function tableKey(headerCells: string[], columnCount: number): string {
  const header = headerCells.map((cell) => cell.trim()).join("|");
  return `${columnCount}#${header}`;
}
