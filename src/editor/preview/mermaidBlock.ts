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

export const DIAGRAM_TOO_BIG = "图表太大，滚到源码模式再看";
export const DIAGRAM_FAILED = "图表还画不出来，点这里改源码";

export function mountMermaid(el: HTMLElement, source: string, alive: () => boolean): void {
  if (source.length > MAX_SOURCE) {
    el.textContent = DIAGRAM_TOO_BIG;
    return;
  }
  const colors = themeVariables();
  void loadMermaid()
    .then(async (mermaid) => {
      if (!alive() || !el.isConnected) return;
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
      if (!alive() || !el.isConnected) {
        drawn.bindFunctions?.(document.createElement("div"));
        return;
      }
      el.innerHTML = drawn.svg;
    })
    .catch(() => {
      if (!alive()) return;
      el.textContent = DIAGRAM_FAILED;
    });
}
