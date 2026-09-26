import { EditorView } from "@codemirror/view";
import { typewriterModeField } from "./modes";

/** Keep the cursor line near the vertical center when typewriter mode is on. */
export const typewriterPlugin = EditorView.updateListener.of((update) => {
  if (!update.state.field(typewriterModeField)) return;
  if (!update.selectionSet && !update.docChanged) return;
  const view = update.view;
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (!coords) return;
  const rect = view.scrollDOM.getBoundingClientRect();
  const target = rect.top + rect.height * 0.42;
  const delta = coords.top - target;
  if (Math.abs(delta) > 8) {
    view.scrollDOM.scrollTop += delta;
  }
});
