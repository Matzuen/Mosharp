import {
  EditorView,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import {
  insertFence,
  insertHeading,
  insertLink,
  insertQuote,
  toggleBold,
  toggleCode,
  toggleHighlight,
  toggleItalic,
  toggleTask,
} from "./formatCommands";
import { sourceModeField } from "./modes";

function button(label: string, title: string, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "cm-format-btn";
  el.textContent = label;
  el.title = title;
  el.addEventListener("mousedown", (event) => event.preventDefault());
  el.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}

class FormatToolbar implements PluginValue {
  dom: HTMLDivElement;
  visible = false;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-format-toolbar";
    this.dom.style.display = "none";
    this.dom.append(
      button("B", "加粗 Ctrl+B", () => toggleBold(view)),
      button("I", "斜体 Ctrl+I", () => toggleItalic(view)),
      button("<>", "行内代码 Ctrl+E", () => toggleCode(view)),
      button("==", "高亮 Ctrl+Shift+H", () => toggleHighlight(view)),
      button("链接", "链接 Ctrl+K", () => insertLink(view)),
      button("任务", "任务 Ctrl+Enter", () => toggleTask(view)),
    );
    view.dom.appendChild(this.dom);
  }

  update(update: ViewUpdate) {
    if (update.state.field(sourceModeField)) {
      this.hide();
      return;
    }
    if (!update.selectionSet && !update.docChanged && !update.geometryChanged) return;
    this.sync();
  }

  sync() {
    const selection = this.view.state.selection.main;
    if (selection.empty) {
      this.hide();
      return;
    }
    const start = this.view.coordsAtPos(selection.from);
    const end = this.view.coordsAtPos(selection.to);
    if (!start || !end) {
      this.hide();
      return;
    }
    const editorRect = this.view.dom.getBoundingClientRect();
    const top = Math.min(start.top, end.top) - editorRect.top - 40;
    const left =
      (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2 -
      editorRect.left;
    this.dom.style.display = "flex";
    this.dom.style.top = `${Math.max(4, top)}px`;
    this.dom.style.left = `${Math.max(8, left)}px`;
    this.dom.style.transform = "translateX(-50%)";
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    this.dom.style.display = "none";
    this.visible = false;
  }

  destroy() {
    this.dom.remove();
  }
}

export const formatToolbarPlugin = ViewPlugin.fromClass(FormatToolbar);

export const formatToolbarTheme = EditorView.baseTheme({
  ".cm-format-toolbar": {
    position: "absolute",
    zIndex: "20",
    display: "flex",
    gap: "2px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid #e7e5e4",
    background: "#fff",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
  },
  ".cm-format-btn": {
    height: "28px",
    minWidth: "28px",
    padding: "0 8px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "#1c1917",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "600",
  },
  ".cm-format-btn:hover": {
    background: "#eceae6",
  },
});

export const slashItems = [
  { label: "标题 1", run: (view: EditorView) => insertHeading(view, 1) },
  { label: "标题 2", run: (view: EditorView) => insertHeading(view, 2) },
  { label: "标题 3", run: (view: EditorView) => insertHeading(view, 3) },
  { label: "任务列表", run: toggleTask },
  { label: "引用", run: insertQuote },
  { label: "代码块", run: insertFence },
  { label: "链接", run: insertLink },
];
