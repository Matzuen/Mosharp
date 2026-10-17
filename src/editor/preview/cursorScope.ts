/**
 * Where a caret sits relative to a syntax node's range.
 *
 * Inline markers (`**`, `~~`, `` ` ``) should only appear while the caret is
 * *strictly* inside the element. An inclusive test made them flash on the
 * position just after the closing marker, where the user is already writing
 * outside the emphasis.
 */
export function insideStrictly(head: number, from: number, to: number): boolean {
  return head > from && head < to;
}

/** Inclusive test, needed for line-level markers such as `#` on a heading. */
export function insideOrTouching(head: number, from: number, to: number): boolean {
  return head >= from && head <= to;
}
