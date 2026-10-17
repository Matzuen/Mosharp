/**
 * A leading YAML block (`---` … `---`) is metadata, not prose: it should fold
 * into a chip instead of taking up the top of the screen. Detection lives here
 * so it can be tested without a DOM.
 */

const OPEN = /^\uFEFF?---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
/** Same bound the save path uses, so both agree on what counts as metadata. */
const LIMIT = 100;

/** 1-based line numbers of the block, or null when there is none. */
export function frontMatterLines(lines: string[]): { open: number; close: number } | null {
  if (lines.length === 0 || !OPEN.test(lines[0])) return null;
  const limit = Math.min(lines.length, LIMIT + 1);
  for (let index = 1; index < limit; index += 1) {
    if (CLOSE.test(lines[index])) {
      // `---` immediately followed by `---` (or a blank line) is a plain rule,
      // not metadata — `splitFrontmatter` treats it the same way.
      if (index === 1) return null;
      return { open: 1, close: index + 1 };
    }
  }
  return null;
}
