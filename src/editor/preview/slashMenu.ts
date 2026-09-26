import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { slashItems } from "./toolbar";
import { sourceModeField } from "./modes";

class SlashMenu implements PluginValue {
  dom: HTMLDivElement;
  open = false;
  triggerFrom = -1;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-slash-menu";
    this.dom.style.display = "none";
    view.dom.appendChild(this.dom);
  }

  update(update: ViewUpdate) {
    if (update.state.field(sourceModeField)) {
      this.hide();
      return;
    }
    if (!update.docChanged && !update.selectionSet) return;
    const selection = update.state.selection.main;
    if (!selection.empty) {
      this.hide();
      return;
    }
    const line = update.state.doc.lineAt(selection.head);
    const before = line.text.slice(0, selection.head - line.from);
    const match = /(^|\s)\/([^\s]*)$/.exec(before);
    if (!match) {
      this.hide();
      return;
    }
    const query = match[2].toLowerCase();
    const items = slashItems.filter((item) => item.label.toLowerCase().includes(query));
    if (items.length === 0) {
      this.hide();
      return;
    }
    this.triggerFrom = selection.head - match[2].length - 1;
    this.render(items);
    const coords = this.view.coordsAtPos(selection.head);
    const editorRect = this.view.dom.getBoundingClientRect();
    if (!coords) return;
    this.dom.style.display = "block";
    this.dom.style.top = `${coords.bottom - editorRect.top + 6}px`;
    this.dom.style.left = `${coords.left - editorRect.left}px`;
    this.open = true;
  }

  render(items: typeof slashItems) {
    this.dom.textContent = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-slash-item";
      btn.textContent = item.label;
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", () => {
        const view = this.view;
        const head = view.state.selection.main.head;
        view.dispatch({
          changes: { from: this.triggerFrom, to: head, insert: "" },
        });
        item.run(view);
        this.hide();
        view.focus();
      });
      this.dom.appendChild(btn);
    }
  }

  hide() {
    this.dom.style.display = "none";
    this.open = false;
    this.triggerFrom = -1;
  }

  destroy() {
    this.dom.remove();
  }
}

export const slashMenuPlugin = ViewPlugin.fromClass(SlashMenu);

export const slashMenuTheme = EditorView.baseTheme({
  ".cm-slash-menu": {
    position: "absolute",
    zIndex: "21",
    minWidth: "160px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid #e7e5e4",
    background: "#fff",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
  },
  ".cm-slash-item": {
    display: "block",
    width: "100%",
    height: "30px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    textAlign: "left",
    padding: "0 10px",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-slash-item:hover": {
    background: "#eceae6",
  },
});
