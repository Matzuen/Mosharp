import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Markdown 源码高亮。颜色来自主题变量，切换主题时不用重建编辑器。 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "var(--h1)", fontWeight: "700", fontSize: "var(--h1-size)", lineHeight: "1.35" },
  { tag: t.heading2, color: "var(--h2)", fontWeight: "700", fontSize: "var(--h2-size)", lineHeight: "1.4" },
  { tag: t.heading3, color: "var(--h3)", fontWeight: "650", fontSize: "var(--h3-size)" },
  { tag: t.heading4, color: "var(--h4)", fontWeight: "650", fontSize: "var(--h4-size)" },
  { tag: t.heading5, color: "var(--h4)", fontWeight: "600", fontSize: "var(--h4-size)" },
  { tag: t.heading6, color: "var(--h4)", fontWeight: "600", fontSize: "var(--h4-size)" },
  { tag: t.heading, color: "var(--h2)", fontWeight: "650" },

  { tag: t.strong, color: "var(--strong)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--em)", fontStyle: "italic" },
  { tag: t.strikethrough, color: "var(--muted)", textDecoration: "line-through" },

  { tag: t.link, color: "var(--link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--link)" },
  { tag: t.labelName, color: "var(--link)" },

  { tag: t.monospace, color: "var(--code-ink)", backgroundColor: "var(--code-bg)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },

  { tag: t.quote, color: "var(--quote)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--rule)" },

  { tag: t.meta, color: "var(--faint)" },
  { tag: t.special(t.meta), color: "var(--ink)", backgroundColor: "var(--highlight)" },
  { tag: t.processingInstruction, color: "var(--faint)" },
  { tag: t.punctuation, color: "var(--faint)" },

  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: t.atom, color: "var(--syn-number)" },
  { tag: t.bool, color: "var(--syn-number)" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: t.operator, color: "var(--muted)" },
  { tag: t.typeName, color: "var(--syn-keyword)" },
  { tag: t.propertyName, color: "var(--link)" },
  { tag: t.variableName, color: "var(--ink)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: t.invalid, color: "var(--danger)" },
]);
