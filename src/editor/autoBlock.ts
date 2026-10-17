/**
 * Block helpers for typing.
 *
 * Fences are deliberately *not* closed when the third backtick is typed: the
 * author still has to type a language (` ```html `), and closing earlier turned
 * the block into an empty "plain text" fence. The closing fence is added when
 * Enter is pressed on a complete opener line instead.
 */

export interface BlockStarter {
  /** Text to insert in place of the typed character. */
  insert: string;
  /** Caret offset relative to the insertion point. */
  caret: number;
}

/**
 * `before` is the text between the line start and the caret, `after` the rest of
 * the line. Returning null means "let the normal insertion happen".
 */
export function blockStarter(before: string, after: string, text: string): BlockStarter | null {
  // Never hijack typing in the middle of existing line content.
  if (after.trim().length > 0) return null;
  if (text === "$" && before === "$") return { insert: "$\n\n$$", caret: 3 };
  return null;
}

/**
 * A line that is exactly a fence opener **with a language**, e.g. ` ```html `.
 * ` ``` ` on its own does not count: the author may still be typing the info
 * string, and closing the block now would produce an empty plain-text fence.
 */
export function fenceOpener(text: string): { fence: string; lang: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`~]+)[ \t]*$/.exec(text);
  if (!match) return null;
  return { fence: match[1], lang: match[2] };
}

/** What Enter should insert after a complete opener line. */
export function fenceCloseText(fence: string): string {
  // Blank line for the body, then the matching closing fence.
  return `\n\n${fence}`;
}
