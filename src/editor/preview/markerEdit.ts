/**
 * Deletion at the edge of a hidden marker.
 *
 * Markers such as `**` or `# ` are replaced by zero-width decorations and
 * registered as atomic ranges, so the caret skips over them. The character
 * immediately next to the caret can still fall *inside* such a range, which
 * makes Backspace delete half a marker: the text then looks unchanged to the
 * user, or a stray `*` appears. Extending the deletion to the whole marker is
 * what the user meant.
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
