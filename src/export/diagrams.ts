import type { DiagramKind } from "../editor/preview/diagramKind.ts";
import { encodePlantuml, plantumlSvgUrl } from "../editor/preview/plantuml.ts";

const MAX_SOURCE = 20_000;

export interface DiagramColors {
  paper: string;
  ink: string;
  accent: string;
  scheme?: "light" | "dark";
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then((mod) => mod.default);
  return mermaidLoader;
}

let nonce = 0;

/** SVG for one diagram. Word always asks for a light palette. */
export async function drawMermaid(source: string, colors: DiagramColors): Promise<string> {
  if (source.length > MAX_SOURCE) return "";
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
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
  const id = `mosharp-export-mermaid-${++nonce}`;
  const drawn = await mermaid.render(id, source);
  return drawn.svg;
}

function safeSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) return "";
  svg.querySelectorAll("script").forEach((node) => node.remove());
  return svg.outerHTML;
}

export async function drawVega(source: string, colors: DiagramColors): Promise<string> {
  if (source.length > MAX_SOURCE) return "";
  const spec = JSON.parse(source) as object;
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-10000px";
  host.style.top = "0";
  document.body.appendChild(host);
  try {
    const { default: embed } = await import("vega-embed");
    const scheme =
      colors.scheme ??
      (getComputedStyle(document.documentElement).colorScheme === "dark" ? "dark" : "light");
    const result = await embed(host, spec, {
      actions: false,
      renderer: "svg",
      tooltip: false,
      ast: true,
      theme: scheme === "dark" ? "dark" : undefined,
      config: {
        background: colors.paper,
        axis: { labelColor: colors.ink, titleColor: colors.ink },
        legend: { labelColor: colors.ink, titleColor: colors.ink },
        title: { color: colors.ink },
      },
    });
    const markup = host.querySelector("svg")?.outerHTML ?? "";
    result.finalize();
    return markup;
  } finally {
    host.remove();
  }
}

export async function drawPlantuml(source: string): Promise<string> {
  if (source.length > MAX_SOURCE) return "";
  const encoded = await encodePlantuml(source);
  const response = await fetch(plantumlSvgUrl(encoded));
  if (!response.ok) return "";
  return safeSvg(await response.text());
}

export async function drawDiagram(kind: DiagramKind, source: string, colors: DiagramColors): Promise<string> {
  if (kind === "mermaid") return drawMermaid(source, colors);
  if (kind === "plantuml") return drawPlantuml(source);
  return drawVega(source, colors);
}

export interface RasterImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Draw a data-URI image to PNG. Used so Word can keep the same picture as HTML. */
export async function dataImageToPng(href: string): Promise<RasterImage | null> {
  if (!href.startsWith("data:image/")) return null;
  try {
    const image = new Image();
    image.src = href;
    await image.decode();
    const width = image.naturalWidth || 1;
    const height = image.naturalHeight || 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const data = canvas.toDataURL("image/png");
    const binary = atob(data.slice(data.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, width, height };
  } catch {
    return null;
  }
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  const plain = svg.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/g, "");
  const blob = new Blob([plain], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || 640;
    const height = image.naturalHeight || 360;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return new Uint8Array();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const data = canvas.toDataURL("image/png");
    const binary = atob(data.slice(data.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } finally {
    URL.revokeObjectURL(url);
  }
}
