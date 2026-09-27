import { EditorView, WidgetType } from "@codemirror/view";
import type { DiagramKind } from "./diagramKind";
import { DIAGRAM_FAILED, DIAGRAM_TOO_BIG, mountMermaid } from "./mermaidBlock";
import { encodePlantuml, plantumlSvgUrl } from "./plantuml";

const MAX_SOURCE = 20_000;

type DiagramHost = HTMLElement & {
  _token?: object;
  _vega?: { finalize: () => void };
};

function alive(el: HTMLElement, token: object): boolean {
  return (el as DiagramHost)._token === token && el.isConnected;
}

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: pick("--paper", "#f7f5f0"),
    ink: pick("--ink", "#1c1917"),
    accent: pick("--accent", "#9a3412"),
    scheme: style.colorScheme === "dark" ? ("dark" as const) : ("light" as const),
  };
}

function fail(el: HTMLElement, token: object) {
  if (!alive(el, token)) return;
  el.textContent = DIAGRAM_FAILED;
}

async function mountVega(el: HTMLElement, source: string, token: object) {
  if (source.length > MAX_SOURCE) {
    el.textContent = DIAGRAM_TOO_BIG;
    return;
  }
  let spec: unknown;
  try {
    spec = JSON.parse(source);
  } catch {
    fail(el, token);
    return;
  }
  if (!spec || typeof spec !== "object") {
    fail(el, token);
    return;
  }
  try {
    const { default: embed } = await import("vega-embed");
    if (!alive(el, token)) return;
    const colors = themeColors();
    const result = await embed(el, spec as never, {
      actions: false,
      renderer: "svg",
      tooltip: false,
      ast: true,
      theme: colors.scheme === "dark" ? "dark" : undefined,
      config: {
        background: colors.paper,
        axis: { labelColor: colors.ink, titleColor: colors.ink },
        legend: { labelColor: colors.ink, titleColor: colors.ink },
        title: { color: colors.ink },
      },
    });
    if (!alive(el, token)) {
      result.finalize();
      return;
    }
    (el as DiagramHost)._vega = result;
  } catch {
    fail(el, token);
  }
}

async function mountPlantuml(el: HTMLElement, source: string, token: object) {
  if (source.length > MAX_SOURCE) {
    el.textContent = DIAGRAM_TOO_BIG;
    return;
  }
  try {
    const encoded = await encodePlantuml(source);
    if (!alive(el, token)) return;
    const img = document.createElement("img");
    img.alt = "PlantUML";
    img.src = plantumlSvgUrl(encoded);
    img.addEventListener("error", () => fail(el, token));
    el.replaceChildren(img);
  } catch {
    fail(el, token);
  }
}

/** Viewport diagram. The live preview only constructs this for a fence inside visibleRanges. */
export class DiagramWidget extends WidgetType {
  constructor(
    readonly kind: DiagramKind,
    readonly source: string,
  ) {
    super();
  }

  eq(other: DiagramWidget) {
    return this.kind === other.kind && this.source === other.source;
  }

  get estimatedHeight() {
    return this.kind === "vega" || this.kind === "vega-lite" ? 220 : 180;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-md-mermaid";
    el.title = "点击编辑源码";
    const token = {};
    (el as DiagramHost)._token = token;
    if (this.kind === "mermaid") mountMermaid(el, this.source, () => alive(el, token));
    else if (this.kind === "plantuml") void mountPlantuml(el, this.source, token);
    else void mountVega(el, this.source, token);
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
    const host = dom as DiagramHost;
    host._token = undefined;
    host._vega?.finalize();
    host._vega = undefined;
    dom.replaceChildren();
  }

  ignoreEvent() {
    return true;
  }
}
