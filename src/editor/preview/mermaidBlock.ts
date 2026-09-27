import { EditorView, WidgetType } from "@codemirror/view";

const MAX_SOURCE = 20_000;

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;
let renderNonce = 0;

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then((mod) => mod.default);
  return mermaidLoader;
}

function themeVariables() {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const paper = pick("--paper", "#f7f5f0");
  const ink = pick("--ink", "#1c1917");
  const accent = pick("--accent", "#9a3412");
  const line = pick("--line", "#e7e5e4");
  return { paper, ink, accent, line };
}

export class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: MermaidWidget) {
    return this.source === other.source;
  }

  get estimatedHeight() {
    return 180;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-md-mermaid";
    el.title = "点击编辑源码";
    const token = {};
    (el as HTMLElement & { _token?: object })._token = token;
    if (this.source.length > MAX_SOURCE) {
      el.textContent = "图表太大，滚到源码模式再看";
      return el;
    }
    const source = this.source;
    const colors = themeVariables();
    void loadMermaid()
      .then(async (mermaid) => {
        if ((el as HTMLElement & { _token?: object })._token !== token || !el.isConnected) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
          themeVariables: {
            background: colors.paper,
            primaryColor: colors.paper,
            primaryTextColor: colors.ink,
            primaryBorderColor: colors.accent,
            lineColor: colors.ink,
            textColor: colors.ink,
            secondaryColor: colors.paper,
            tertiaryColor: colors.paper,
            clusterBkg: colors.paper,
            edgeLabelBackground: colors.paper,
            nodeTextColor: colors.ink,
          },
        });
        const id = `mosharp-mermaid-${++renderNonce}`;
        const drawn = await mermaid.render(id, source);
        if ((el as HTMLElement & { _token?: object })._token !== token || !el.isConnected) {
          drawn.bindFunctions?.(document.createElement("div"));
          return;
        }
        el.innerHTML = drawn.svg;
      })
      .catch(() => {
        if ((el as HTMLElement & { _token?: object })._token !== token) return;
        el.textContent = "图表还画不出来，点这里改源码";
      });
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(el);
      if (pos == null) return;
      const line = view.state.doc.lineAt(pos);
      const nextNo = Math.min(view.state.doc.lines, line.number + 1);
      const anchor = view.state.doc.line(nextNo).from;
      view.dispatch({ selection: { anchor } });
      view.focus();
    });
    return el;
  }

  destroy(dom: HTMLElement) {
    (dom as HTMLElement & { _token?: object })._token = undefined;
    dom.replaceChildren();
  }

  ignoreEvent() {
    return true;
  }
}
