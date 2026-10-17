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
    fontFamily: "var(--active-font)",
    fontSize: "var(--active-size)",
    lineHeight: "1.7",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--faint) transparent",
  },
  ".cm-scroller::-webkit-scrollbar": {
    width: "10px",
    height: "10px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    backgroundColor: "var(--faint)",
    borderRadius: "999px",
    border: "2px solid transparent",
    backgroundClip: "padding-box",
  },
  ".cm-scroller::-webkit-scrollbar-track": {
    backgroundColor: "transparent",
  },
  ".cm-content": {
    maxWidth: "var(--content-width, 780px)",
    margin: "0 auto",
    // `vh` is not scaled by the window zoom while `zoom` is, so divide to keep
    // the bottom breathing room proportional at every zoom level.
    padding: "32px 28px calc(40vh / var(--ui-zoom, 1))",
    caretColor: "var(--ink)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--paper)",
    color: "var(--faint)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--ink) 5%, transparent)",
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
      backgroundColor: "var(--selection)",
    },
  ".cm-heading-flash": {
    backgroundColor: "color-mix(in srgb, var(--h1) 22%, transparent)",
    transition: "background-color 0.8s ease",
  },
});
