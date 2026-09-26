import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/** `==高亮==`，与 ColaMD 一致。 */
export const HighlightExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Highlight",
      style: { "Highlight/...": tags.special(tags.meta) },
    },
    {
      name: "HighlightMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) {
          return -1;
        }
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^`{|}~\u00A1-\u00BF]/.test(before);
        const pAfter = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^`{|}~\u00A1-\u00BF]/.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};
