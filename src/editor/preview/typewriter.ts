import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { typewriterModeField } from "./modes";

/** Keep the cursor line near the vertical center when typewriter mode is on. */
export const typewriterPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.state.field(typewriterModeField)) return;
      if (!update.selectionSet && !update.docChanged) return;
      update.view.requestMeasure({
        read: (view) => {
          const coords = view.coordsAtPos(view.state.selection.main.head);
          if (!coords) return null;
          const rect = view.scrollDOM.getBoundingClientRect();
          return coords.top - (rect.top + rect.height * 0.42);
        },
        write: (delta, view) => {
          if (delta == null || Math.abs(delta) <= 8) return;
          view.scrollDOM.scrollTop += delta;
        },
      });
    }
  },
);
