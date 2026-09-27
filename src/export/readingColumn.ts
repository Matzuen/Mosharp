import type { ContentWidth } from "../shell/preferences";

/**
 * One column for the source buffer, a standalone HTML article (`.mosharp-doc`),
 * and print/PDF. The three presets are 640 / 780 / 1080.
 */
export function readingColumnCss(width: ContentWidth): string {
  return `.cm-content,
.mosharp-doc {
  max-width: ${width}px;
  margin-left: auto;
  margin-right: auto;
}
@media print {
  .cm-content,
  .mosharp-doc {
    max-width: ${width}px !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
}`;
}
