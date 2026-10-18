/**
 * Matching for inline HTML written in a paragraph.
 *
 * `@lezer/markdown` reports the opening and closing tag as two separate
 * `HTMLTag` nodes with the text between them as ordinary content, so rendering a
 * construct like `<b>粗</b>` means finding the partner tag ourselves. Pure, so it
 * can be tested without a DOM.
 */

/** Tags that have no closing partner. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Longest inline construct worth turning into a widget. */
const MAX_SPAN = 2000;

export interface InlineTagMatch {
  tag: string;
  /** Offset just past the opening tag, or past the whole construct when it pairs. */
  end: number;
  /** True for `<br>`, `<img …>`: nothing to pair with. */
  void: boolean;
  /** The complete construct, exactly as written. */
  raw: string;
}

const OPEN = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"])*)>/;

/**
 * Text starting at `offset` in `line`. Returns null when it is not an opening
 * tag, or when no partner is found on the same line.
 */
export function matchInlineTag(line: string, offset: number): InlineTagMatch | null {
  const rest = line.slice(offset);
  const open = OPEN.exec(rest);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const openLength = open[0].length;
  if (VOID_TAGS.has(tag)) {
    return { tag, end: offset + openLength, void: true, raw: open[0] };
  }
  if (open[0].endsWith("/>")) {
    return { tag, end: offset + openLength, void: true, raw: open[0] };
  }

  // Find the partner tag, skipping anything quoted so `title="</b>"` cannot
  // terminate the construct early.
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  close.lastIndex = offset + openLength;
  const found = close.exec(line);
  if (!found) return null;
  const end = found.index + found[0].length;
  if (end - offset > MAX_SPAN) return null;
  return { tag, end, void: false, raw: line.slice(offset, end) };
}
