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
 * layout with explicit widths does. Clamped so a column cannot vanish, and so
 * the table does not grow past the content width.
 */
export function dragColumn(
  current: ColumnWidths,
  index: number,
  delta: number,
  {
    min = MIN_COLUMN_WIDTH,
    maxTotal = Number.POSITIVE_INFINITY,
  }: { min?: number; maxTotal?: number } = {},
): ColumnWidths {
  if (index < 0 || index >= current.widths.length) return current;
  const widths = current.widths.slice();
  const next = Math.max(min, widths[index] + delta);
  if (next === widths[index]) return current;
  widths[index] = next;
  const total = widths.reduce((sum, width) => sum + width, 0);
  // `maxTotal` is the available content width, not the table's current width:
  // clamping to the current width would make a column impossible to widen again
  // after it has been shrunk.
  if (total > maxTotal) return current;
  return { widths, total };
}

/** Widths are reset when the column count changes (the layout no longer applies). */
export function fitsCount(widths: ColumnWidths, count: number): boolean {
  return widths.widths.length === count && widths.widths.every((width) => width > 0);
}

/**
 * Session memory for dragged column widths.
 *
 * Widths are keyed by table header, but the header text changes when the user
 * renames a column or reorders columns — the same table would then lose its
 * widths. `last` remembers where the previous table was drawn, so a table found
 * at the same document position is recognised as "the same table, new key" and
 * its widths are migrated instead of dropped.
 */
export interface WidthMemory {
  byKey: Map<string, ColumnWidths>;
  last: { from: number; widths: ColumnWidths } | null;
}

export function createWidthMemory(): WidthMemory {
  return { byKey: new Map(), last: null };
}

/** Widths to use for the table at `from`, or null to fall back to even columns. */
export function pickWidths(
  memory: WidthMemory,
  key: string,
  from: number,
  columns: number,
): ColumnWidths | null {
  const direct = memory.byKey.get(key);
  if (direct && fitsCount(direct, columns)) return direct;
  // Same position as the last table we knew about: its header changed, but the
  // layout still belongs to this table.
  if (memory.last && memory.last.from === from && fitsCount(memory.last.widths, columns)) {
    memory.byKey.set(key, memory.last.widths);
    return memory.last.widths;
  }
  return null;
}

export function storeWidths(
  memory: WidthMemory,
  key: string,
  from: number,
  widths: ColumnWidths,
): void {
  memory.byKey.set(key, widths);
  memory.last = { from, widths };
}

/**
 * Key for remembering widths, derived from the column count and header text.
 * It is only an index: the same table keeps its widths across header edits and
 * column reordering through `WidthMemory.last`.
 */
export function tableKey(headerCells: string[], columnCount: number): string {
  const header = headerCells.map((cell) => cell.trim()).join("|");
  return `${columnCount}#${header}`;
}

/**
 * Scroll step while dragging near the top or bottom edge of a scroller.
 *
 * Returns a signed pixel amount: negative scrolls up. `edge` is the band that
 * starts the auto-scroll, and the amount grows with how far past it the pointer
 * is, capped at `max` so the view does not run away.
 */
export function scrollStep(
  top: number,
  bottom: number,
  y: number,
  edge = 28,
  max = 24,
): number {
  if (bottom - top <= edge * 2) return 0;
  if (y < top + edge) {
    const depth = Math.min(top + edge - y, edge * 2);
    return -Math.min(max, Math.max(2, (depth / edge) * 8));
  }
  if (y > bottom - edge) {
    const depth = Math.min(y - (bottom - edge), edge * 2);
    return Math.min(max, Math.max(2, (depth / edge) * 8));
  }
  return 0;
}
