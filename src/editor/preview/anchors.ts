import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

export function findHeadingAtSlug(view: EditorView, slug: string): number | null {
  const target = decodeURIComponent(slug).toLowerCase();
  const seen = new Map<string, number>();
  let found: number | null = null;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!/^ATXHeading\d$/.test(node.name) && !/^SetextHeading\d$/.test(node.name)) return;
      const line = view.state.doc.lineAt(node.from);
      const text = line.text.replace(/^#{1,6}\s+/, "").replace(/\s*=+\s*$/, "").replace(/\s*-+\s*$/, "").trim();
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const full = count === 0 ? base : `${base}-${count}`;
      if (full === target || base === target) found = line.number;
    },
  });
  return found;
}

export function listHeadingAnchors(view: EditorView): Array<{ line: number; level: number; text: string; slug: string }> {
  const seen = new Map<string, number>();
  const out: Array<{ line: number; level: number; text: string; slug: string }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      const atx = /^ATXHeading(\d)$/.exec(node.name);
      const setext = /^SetextHeading(\d)$/.exec(node.name);
      const level = atx ? Number(atx[1]) : setext ? Number(setext[1]) : 0;
      if (!level) return;
      const line = view.state.doc.lineAt(node.from);
      const text = line.text.replace(/^#{1,6}\s+/, "").replace(/\s*=+\s*$/, "").replace(/\s*-+\s*$/, "").trim();
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const slug = count === 0 ? base : `${base}-${count}`;
      out.push({ line: line.number, level, text, slug });
    },
  });
  return out;
}
