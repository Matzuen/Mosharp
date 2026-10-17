/**
 * Literal replace across files. Kept separate from the UI so the counting and
 * case rules can be tested without touching the file system.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ReplaceResult {
  text: string;
  count: number;
}

/**
 * Replaces every occurrence of `query`. The replacement is inserted verbatim
 * (no `$1` expansion), which is what a non-regex search should do.
 */
export function replaceAllText(
  text: string,
  query: string,
  replacement: string,
  caseSensitive = false,
): ReplaceResult {
  if (!query) return { text, count: 0 };
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  let count = 0;
  const next = text.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return { text: next, count };
}
