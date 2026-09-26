import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Markdown 源码模式下的语法高亮，配色适配纸色背景。 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "#9a3412", fontWeight: "700", fontSize: "1.45em", lineHeight: "1.35" },
  { tag: t.heading2, color: "#9a3412", fontWeight: "700", fontSize: "1.28em", lineHeight: "1.4" },
  { tag: t.heading3, color: "#9a3412", fontWeight: "650", fontSize: "1.14em" },
  { tag: t.heading4, color: "#c2410c", fontWeight: "650" },
  { tag: t.heading5, color: "#c2410c", fontWeight: "600" },
  { tag: t.heading6, color: "#c2410c", fontWeight: "600" },
  { tag: t.heading, color: "#9a3412", fontWeight: "650" },

  { tag: t.strong, color: "#1c1917", fontWeight: "700" },
  { tag: t.emphasis, color: "#44403c", fontStyle: "italic" },
  { tag: t.strikethrough, color: "#78716c", textDecoration: "line-through" },

  { tag: t.link, color: "#1d4ed8", textDecoration: "underline" },
  { tag: t.url, color: "#0369a1" },
  { tag: t.labelName, color: "#0369a1" },

  { tag: t.monospace, color: "#9f1239", backgroundColor: "rgba(159, 18, 57, 0.07)" },
  { tag: [t.string, t.special(t.string)], color: "#9f1239" },

  { tag: t.quote, color: "#57534e", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "#a8a29e" },

  { tag: t.meta, color: "#a8a29e" },
  { tag: t.special(t.meta), color: "#1c1917", backgroundColor: "rgba(250, 204, 21, 0.45)" },
  { tag: t.processingInstruction, color: "#a8a29e" },
  { tag: t.punctuation, color: "#a8a29e" },

  { tag: t.keyword, color: "#7c3aed" },
  { tag: t.atom, color: "#0f766e" },
  { tag: t.bool, color: "#0f766e" },
  { tag: t.number, color: "#b45309" },
  { tag: t.operator, color: "#57534e" },
  { tag: t.typeName, color: "#0e7490" },
  { tag: t.propertyName, color: "#0369a1" },
  { tag: t.variableName, color: "#1c1917" },
  { tag: t.comment, color: "#a8a29e", fontStyle: "italic" },
  { tag: t.invalid, color: "#b91c1c" },
]);
