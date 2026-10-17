import { syntaxTree } from "@codemirror/language";
import { EditorView, WidgetType } from "@codemirror/view";
import { notify } from "./notify";

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

/** Body of the fenced block that starts at `pos`, or null if there is none. */
function fencedSource(view: EditorView, pos: number): string | null {
  let node = syntaxTree(view.state).resolveInner(pos, 1);
  while (node && node.name !== "FencedCode") node = node.parent as typeof node;
  if (!node) return null;
  const first = view.state.doc.lineAt(node.from).number;
  const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
  const lines: string[] = [];
  for (let n = first + 1; n < last; n += 1) lines.push(view.state.doc.line(n).text);
  return lines.join("\n");
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
    const wrap = document.createElement("span");
    wrap.className = "cm-md-fence-wrap";

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
    wrap.appendChild(button);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-md-fence-copy";
    copy.textContent = "复制";
    copy.title = "复制代码";
    copy.setAttribute("aria-label", "复制代码");
    copy.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    copy.addEventListener("click", () => {
      const pos = view.posAtDOM(wrap);
      if (pos == null) return;
      const code = fencedSource(view, pos);
      if (code == null) return;
      navigator.clipboard?.writeText(code).then(
        () => notify("已复制代码"),
        () => notify("复制失败：剪贴板不可用"),
      );
    });
    wrap.appendChild(copy);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}
