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
