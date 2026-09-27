import { EditorView, WidgetType } from "@codemirror/view";

/** Languages offered on the fence chip. Mermaid is a diagram, not a highlighter. */
export const FENCE_LANGS = [
  "",
  "js",
  "ts",
  "jsx",
  "tsx",
  "json",
  "html",
  "css",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "sql",
  "bash",
  "yaml",
  "xml",
  "markdown",
  "mermaid",
  "vega",
  "vega-lite",
  "plantuml",
];

const LABELS: Record<string, string> = {
  "": "纯文本",
  js: "JavaScript",
  ts: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
  sql: "SQL",
  bash: "Shell",
  yaml: "YAML",
  xml: "XML",
  markdown: "Markdown",
  mermaid: "Mermaid",
  vega: "Vega",
  "vega-lite": "Vega-Lite",
  plantuml: "PlantUML",
};

let openMenu: HTMLElement | null = null;

function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

function rewriteFence(view: EditorView, lineFrom: number, lang: string) {
  if (lineFrom < 0 || lineFrom > view.state.doc.length) return;
  const line = view.state.doc.lineAt(lineFrom);
  const match = /^( {0,3})(`{3,})(.*)$/.exec(line.text);
  if (!match) return;
  const next = `${match[1]}${match[2]}${lang ? lang : ""}`;
  if (next === line.text) {
    closeMenu();
    return;
  }
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  closeMenu();
}

function openLangMenu(view: EditorView, anchor: HTMLElement, lineFrom: number) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "cm-md-lang-menu";
  const rect = anchor.getBoundingClientRect();
  const host = view.dom.getBoundingClientRect();
  menu.style.top = `${rect.bottom - host.top + 4}px`;
  menu.style.left = `${Math.max(8, rect.left - host.left)}px`;
  for (const lang of FENCE_LANGS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cm-md-lang-item";
    item.textContent = LABELS[lang] ?? lang;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      rewriteFence(view, lineFrom, lang);
    });
    menu.appendChild(item);
  }
  view.dom.appendChild(menu);
  openMenu = menu;
  const onPointer = (event: Event) => {
    if (menu.contains(event.target as Node)) return;
    closeMenu();
    window.removeEventListener("mousedown", onPointer, true);
  };
  window.addEventListener("mousedown", onPointer, true);
}

/** Language chip on a fence line. The code itself stays editable and highlighted. */
export class FenceLangWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: FenceLangWidget) {
    return this.label === other.label;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-md-fence";
    const key = this.label.trim().toLowerCase();
    button.textContent = LABELS[key] ?? (this.label || "纯文本");
    button.title = "选择语言";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(button);
      const lineFrom = pos == null ? view.state.selection.main.head : view.state.doc.lineAt(pos).from;
      openLangMenu(view, button, lineFrom);
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}
