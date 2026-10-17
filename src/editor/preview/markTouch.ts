export interface TouchRange {
  from: number;
  to: number;
  head: number;
}

/**
 * inside: caret is in the delimiter, not on the character after it.
 * edge: also the leading edge, so a block marker can be opened from the left.
 * inclusive: the whole span, including both edges. Used for a URL or comment
 * once the caret is editing that span.
 */
export type TouchMode = "inside" | "edge" | "inclusive";

/** Whether this delimiter should be shown instead of hidden. */
export function syntaxTouched(
  ranges: readonly TouchRange[],
  from: number,
  to: number,
  mode: TouchMode,
): boolean {
  if (to <= from) return false;
  for (const range of ranges) {
    if (range.from !== range.to && range.from < to && range.to > from) return true;
    const head = range.head;
    if (mode === "inside" && head > from && head < to) return true;
    if (mode === "edge" && head >= from && head < to) return true;
    if (mode === "inclusive" && head >= from && head <= to) return true;
  }
  return false;
}
