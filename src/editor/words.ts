/**
 * Word count that behaves sensibly for mixed Chinese/English text.
 *
 * CJK ideographs and kana count as one word each, while runs of Latin letters
 * and digits count as one word. Cheap enough to run on every document change:
 * a single pass with char-code comparisons, no regex or allocation.
 */
export function countWords(text: string): number {
  let words = 0;
  let inLatin = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) || // hiragana + katakana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
      (code >= 0xf900 && code <= 0xfaff) || // compatibility ideographs
      (code >= 0xac00 && code <= 0xd7af); // hangul syllables
    if (isCjk) {
      words += 1;
      inLatin = false;
      continue;
    }
    const isWordChar =
      (code >= 0x30 && code <= 0x39) || // 0-9
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      code === 0x27 || // apostrophe inside a word
      (code >= 0x00c0 && code <= 0x024f); // accented Latin
    if (isWordChar) {
      if (!inLatin) words += 1;
      inLatin = true;
    } else {
      inLatin = false;
    }
  }
  return words;
}

/** Fenced blocks (``` / ~~~), including an unterminated one that runs to the end. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;
const UNCLOSED_FENCE = /^ {0,3}(`{3,}|~{3,})[\s\S]*$/m;
const INLINE_CODE = /`[^`\n]*`/g;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * Word count for prose: fenced code, inline code and YAML front matter are
 * excluded, since neither is "writing" and both inflate the number badly.
 */
export function countProseWords(text: string): number {
  if (!text) return 0;
  const prose = text
    .replace(FRONTMATTER, "")
    .replace(FENCE, " ")
    .replace(UNCLOSED_FENCE, " ")
    .replace(INLINE_CODE, " ");
  return countWords(prose);
}
