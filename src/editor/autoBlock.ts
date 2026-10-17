/**
 * Input-time block starters: typing the closing half of a block marker opens the
 * block immediately instead of waiting for the user to type the closing fence.
 *
 * Pure on purpose — the editor's input handler only has to dispatch the result.
 */

export interface BlockStarter {
  /** Text to insert in place of the typed character. */
  insert: string;
  /** Caret offset relative to the insertion point. */
  caret: number;
  /**
   * Fences must be preceded by a blank line: without one, an HTML block or a
   * paragraph above swallows them and nothing below renders.
   */
  fence: boolean;
}

/**
 * `before` is the text between the line start and the caret, `after` the rest of
 * the line. Returning null means "let the normal insertion happen".
 */
export function blockStarter(before: string, after: string, text: string): BlockStarter | null {
  // Never hijack typing in the middle of existing line content.
  if (after.trim().length > 0) return null;
  if (text === "$" && before === "$") return { insert: "$\n\n$$", caret: 3, fence: false };
  if (text === "`" && before === "``") return { insert: "`\n\n```", caret: 3, fence: true };
  if (text === "~" && before === "~~") return { insert: "~\n\n~~~", caret: 3, fence: true };
  return null;
}
