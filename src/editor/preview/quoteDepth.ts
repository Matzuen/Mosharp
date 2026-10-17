/**
 * How many `>` markers a source line starts with.
 *
 * Used to give nested blockquotes distinct indentation: `> a` is 1, `> > a` is 2.
 * Lazy continuation lines have no marker and return 0, so callers fall back to
 * the depth of the block's first line.
 */
export function quoteDepth(text: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    let s = i;
    let spaces = 0;
    while (text[s] === " " && spaces < 3) {
      s += 1;
      spaces += 1;
    }
    if (text[s] !== ">") break;
    depth += 1;
    i = s + 1;
    if (text[i] === " ") i += 1;
  }
  return depth;
}
