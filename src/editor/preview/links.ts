import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { findHeadingAtSlug } from "./anchors";

export const linkClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    let linkFrom = -1;
    let linkTo = -1;
    syntaxTree(view.state).iterate({
      from: Math.max(0, pos - 1),
      to: pos + 1,
      enter(node) {
        if (node.name === "Link") {
          linkFrom = node.from;
          linkTo = node.to;
        }
      },
    });
    if (linkFrom < 0) return false;
    const raw = view.state.doc.sliceString(linkFrom, linkTo);
    const match = /\[[^\]]*\]\(([^)]+)\)/.exec(raw);
    if (!match) return false;
    const href = match[1].trim();
    if (href.startsWith("#")) {
      const line = findHeadingAtSlug(view, href.slice(1));
      if (line != null) {
        event.preventDefault();
        const targetLine = view.state.doc.line(line);
        view.dispatch({
          selection: { anchor: targetLine.from },
          effects: EditorView.scrollIntoView(targetLine.from, { y: "start" }),
        });
        return true;
      }
    }
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  },
});
