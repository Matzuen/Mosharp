export const DIAGRAM_LANGS = ["mermaid", "vega", "vega-lite", "plantuml"] as const;

export type DiagramKind = (typeof DIAGRAM_LANGS)[number];

export function diagramKind(lang: string | undefined): DiagramKind | null {
  const name = (lang ?? "").trim().toLowerCase();
  return (DIAGRAM_LANGS as readonly string[]).includes(name) ? (name as DiagramKind) : null;
}
