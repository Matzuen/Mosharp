/**
 * Pasting a URL over a selection turns it into a link, the way most editors do.
 * The pure parts live here so the rules can be tested without a DOM.
 */

const URL_ONLY = /^https?:\/\/\S+$/i;

/** The clipboard text is exactly one http(s) URL and nothing else. */
export function isOnlyUrl(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed) && URL_ONLY.test(trimmed);
}

/**
 * Brackets in the label would end the link text early, and a multi-line
 * selection must not put a newline inside `[…]`, so both are normalised.
 */
export function linkMarkdown(label: string, url: string): string {
  const safe = label.replace(/\s+/g, " ").trim().replace(/([[\]])/g, "\\$1");
  return `[${safe}](${url.trim()})`;
}

/** Caret offset right after the finished link, in the replacement string. */
export function caretAfterLink(label: string, url: string): number {
  return linkMarkdown(label, url).length;
}
