import { EditorView } from "@codemirror/view";

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--paper)",
    color: "var(--ink)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    fontSize: "17px",
    lineHeight: "1.7",
  },
  ".cm-content": {
    maxWidth: "var(--content-width, 780px)",
    margin: "0 auto",
    padding: "32px 28px 40vh",
    caretColor: "var(--ink)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--paper)",
    color: "var(--faint)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(28, 25, 23, 0.035)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--muted)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ink)",
  },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
    {
      backgroundColor: "#d6d3d1",
    },
  ".cm-heading-flash": {
    backgroundColor: "rgba(194, 65, 12, 0.18)",
    transition: "background-color 0.8s ease",
  },
});
