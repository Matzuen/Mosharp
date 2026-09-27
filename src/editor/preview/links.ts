import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { findHeadingLine } from "./anchors";
import { flashEffect } from "./flash";

function modHeld(event: MouseEvent | KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

/** Pointer cursor on links only while Ctrl is held, so a plain click just moves the caret. */
export const linkModCursor = ViewPlugin.fromClass(
  class {
    private readonly onKey = (event: KeyboardEvent) => {
      this.view.dom.classList.toggle("cm-mod-held", modHeld(event));
    };
    private readonly onBlur = () => {
      this.view.dom.classList.remove("cm-mod-held");
    };

    constructor(private readonly view: EditorView) {
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.onBlur);
    }

    destroy() {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
    }
  },
);

export const linkClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    if (!modHeld(event)) return false;
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
      const line = findHeadingLine(view.state.doc, href.slice(1));
      if (line != null) {
        event.preventDefault();
        const targetLine = view.state.doc.line(line);
        view.dispatch({
          selection: { anchor: targetLine.from },
          effects: [
            EditorView.scrollIntoView(targetLine.from, { y: "start" }),
            flashEffect.of(line),
          ],
        });
        window.setTimeout(() => {
          if (!view.dom.isConnected) return;
          view.dispatch({ effects: flashEffect.of(null) });
        }, 900);
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
