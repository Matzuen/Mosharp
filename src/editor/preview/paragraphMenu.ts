import {
  EditorView,
  ViewPlugin,
  GutterMarker,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";
import {
  insertFence,
  insertHeading,
  insertHr,
  insertQuote,
  insertTable,
  toggleTask,
} from "./formatCommands";
import { sourceModeField } from "./modes";

class ParaMarker extends GutterMarker {
  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-para-handle";
    btn.textContent = "⋮";
    btn.title = "段落操作";
    return btn;
  }
}

const paraMarker = new ParaMarker();

function activeLineFrom(view: EditorView) {
  return view.state.doc.lineAt(view.state.selection.main.head).from;
}

export const paragraphGutter = gutter({
  class: "cm-para-gutter",
  lineMarker(view, line) {
    if (view.state.field(sourceModeField)) return null;
    return line.from === activeLineFrom(view) ? paraMarker : null;
  },
  domEventHandlers: {
    mousedown(view, line, event) {
      event.preventDefault();
      openParagraphMenu(view, line.from, event as MouseEvent);
      return true;
    },
  },
});

function openParagraphMenu(view: EditorView, lineFrom: number, event: MouseEvent) {
  const existing = view.dom.querySelector(".cm-para-menu");
  existing?.remove();
  const menu = document.createElement("div");
  menu.className = "cm-para-menu";
  const actions = [
    { label: "标题 1", run: () => insertHeading(view, 1) },
    { label: "标题 2", run: () => insertHeading(view, 2) },
    { label: "任务列表", run: () => toggleTask(view) },
    { label: "引用", run: () => insertQuote(view) },
    { label: "代码块", run: () => insertFence(view) },
    { label: "分隔线", run: () => insertHr(view) },
    { label: "表格", run: () => insertTable(view) },
  ];
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: lineFrom } });
      action.run();
      menu.remove();
      view.focus();
    });
    menu.appendChild(btn);
  }
  const editorRect = view.dom.getBoundingClientRect();
  menu.style.left = `${event.clientX - editorRect.left}px`;
  menu.style.top = `${event.clientY - editorRect.top}px`;
  view.dom.appendChild(menu);
  const close = () => {
    menu.remove();
    window.removeEventListener("mousedown", close);
  };
  setTimeout(() => window.addEventListener("mousedown", close), 0);
}

export const paragraphMenuTheme = EditorView.baseTheme({
  ".cm-para-gutter": {
    width: "16px",
  },
  ".cm-para-handle": {
    width: "14px",
    height: "18px",
    border: "none",
    background: "transparent",
    color: "#a8a29e",
    cursor: "pointer",
    padding: "0",
    fontSize: "12px",
    lineHeight: "18px",
  },
  ".cm-para-handle:hover": {
    color: "#1c1917",
  },
  ".cm-para-menu": {
    position: "absolute",
    zIndex: "22",
    minWidth: "120px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid #e7e5e4",
    background: "#fff",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
  },
  ".cm-para-menu button": {
    display: "block",
    width: "100%",
    height: "28px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    textAlign: "left",
    padding: "0 8px",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-para-menu button:hover": {
    background: "#eceae6",
  },
});

/** Keep gutter marker in sync when selection moves. */
export const paragraphGutterRefresh = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        update.view.requestMeasure();
      }
    }
  },
);
