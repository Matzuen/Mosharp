/**
 * Caret behaviour around hidden inline markers.
 *
 * Markers such as `**` or `# ` are replaced by zero-width decorations and
 * registered as atomic ranges, so arrow keys skip over them. Two edges remain:
 *
 * - the character *next to* the caret can still be a marker character, so
 *   Backspace would delete half of it and leave a stray `*`;
 * - Home would land in front of the hidden `# `, where typing changes the
 *   line's structure instead of its text.
 *
 * Both are pure functions over ranges, so they can be tested without a DOM.
 */

export interface Range {
  from: number;
  to: number;
}

/**
 * Range that should be removed instead of the single character next to `pos`.
 *
 * `forward` selects Delete (true) or Backspace (false). Returns null when the
 * character next to the caret is ordinary text.
 */
export function extendDeletion(
  markers: readonly Range[],
  pos: number,
  forward: boolean,
): Range | null {
  // Backspace looks at the character before the caret, Delete at the one after.
  const probe = forward ? pos : pos - 1;
  if (probe < 0) return null;
  for (const marker of markers) {
    if (probe >= marker.from && probe < marker.to) {
      // Only extend when the caret touches the marker, not when it sits deep
      // inside a block the user is editing.
      if (forward ? marker.from !== pos : marker.to !== pos) return null;
      return { from: marker.from, to: marker.to };
    }
  }
  return null;
}
