import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { sourceModeField } from "./modes";
import { slashItems } from "./toolbar";

class SlashMenu implements PluginValue {
  dom: HTMLDivElement;
  open = false;
  triggerFrom = -1;
  active = 0;
  items: typeof slashItems = [];
  private onKey: (event: KeyboardEvent) => void;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-slash-menu";
    this.dom.style.display = "none";
    view.dom.appendChild(this.dom);
    this.onKey = (event) => {
      if (!this.open) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.active = (this.active + 1) % this.items.length;
        this.render(this.items);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.active = (this.active - 1 + this.items.length) % this.items.length;
        this.render(this.items);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.choose(this.active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      }
    };
    view.contentDOM.addEventListener("keydown", this.onKey, true);
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
    if (!this.open || this.items.length !== items.length) this.active = 0;
    this.items = items;
    this.render(items);
    this.open = true;
    this.dom.style.display = "block";
    const head = selection.head;
    this.view.requestMeasure({
      read: (view) => {
        const coords = view.coordsAtPos(head);
        if (!coords) return null;
        const editorRect = view.dom.getBoundingClientRect();
        return {
          top: coords.bottom - editorRect.top + 6,
          left: coords.left - editorRect.left,
        };
      },
      write: (measure) => {
        if (!this.open || !measure) return;
        this.dom.style.top = `${measure.top}px`;
        this.dom.style.left = `${Math.max(8, measure.left)}px`;
      },
    });
  }

  render(items: typeof slashItems) {
    this.dom.textContent = "";
    items.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = index === this.active ? "cm-slash-item active" : "cm-slash-item";
      btn.textContent = item.label;
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("mouseenter", () => {
        this.active = index;
        const buttons = this.dom.querySelectorAll(".cm-slash-item");
        buttons.forEach((el, itemIndex) => {
          el.className = itemIndex === index ? "cm-slash-item active" : "cm-slash-item";
        });
      });
      btn.addEventListener("click", () => this.choose(index));
      this.dom.appendChild(btn);
    });
  }

  choose(index: number) {
    const item = this.items[index];
    if (!item) return;
    const view = this.view;
    const head = view.state.selection.main.head;
    const from = Math.min(this.triggerFrom, head);
    view.dispatch({
      changes: { from, to: head, insert: "" },
    });
    item.run(view);
    this.hide();
    view.focus();
  }

  hide() {
    this.dom.style.display = "none";
    this.open = false;
    this.triggerFrom = -1;
    this.items = [];
    this.active = 0;
  }

  destroy() {
    this.view.contentDOM.removeEventListener("keydown", this.onKey, true);
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
    border: "1px solid var(--line)",
    background: "var(--menu)",
    color: "var(--ink)",
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
  ".cm-slash-item.active, .cm-slash-item:hover": {
    background: "var(--hover)",
  },
});
