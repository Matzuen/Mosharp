import { emojiGlyph } from "./emoji.ts";

export interface LineSource {
  lines: number;
  line(n: number): { text: string };
}

export interface FootnoteDef {
  id: string;
  line: number;
  text: string;
}

export interface LinkDef {
  id: string;
  url: string;
  title: string;
  line: number;
}

export interface WritingIndex {
  footnotes: Map<string, FootnoteDef>;
  links: Map<string, LinkDef>;
}

export type InlineKind = "emoji" | "sup" | "sub" | "footnote" | "ref" | "ref-image";

export interface InlineSpan {
  from: number;
  to: number;
  kind: InlineKind;
  text: string;
  id: string;
}

export function emptyIndex(): WritingIndex {
  return { footnotes: new Map(), links: new Map() };
}

const FN_DEF = /^ {0,3}\[\^([^\]]+)\]:[ \t]?(.*)$/;
const LINK_DEF =
  /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'))?\s*$/;

/** Footnote definitions and reference-style link targets. Skips lines without `[`. */
export function buildIndex(doc: LineSource): WritingIndex {
  const footnotes = new Map<string, FootnoteDef>();
  const links = new Map<string, LinkDef>();
  for (let n = 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (!text.includes("[")) continue;
    const footnote = FN_DEF.exec(text);
    if (footnote) {
      const parts = [footnote[2].trim()];
      let next = n + 1;
      while (next <= doc.lines && parts.length < 6) {
        const line = doc.line(next).text;
        if (!/^(?: {4,}|\t)\S/.test(line)) break;
        parts.push(line.trim());
        next += 1;
      }
      footnotes.set(footnote[1], { id: footnote[1], line: n, text: parts.join(" ").trim() });
      continue;
    }
    const link = LINK_DEF.exec(text);
    if (!link || link[1].startsWith("^")) continue;
    links.set(link[1].toLowerCase(), {
      id: link[1],
      url: link[2],
      title: link[3] || link[4] || "",
      line: n,
    });
  }
  return { footnotes, links };
}

export function isDefinitionLine(text: string): boolean {
  return /^ {0,3}:\s+\S/.test(text);
}

function skipMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      const end = close < 0 ? text.length : close + 1;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (ch === "$") {
      const close = text.indexOf("$", i + 1);
      const end = close < 0 ? i + 1 : close + 1;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (ch === "\\" && (text[i + 1] === "(" || text[i + 1] === "[")) {
      const close = text[i + 1] === "(" ? "\\)" : "\\]";
      const at = text.indexOf(close, i + 2);
      const end = at < 0 ? i + 2 : at + close.length;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    i += 1;
  }
  return mask;
}

function clear(mask: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (mask[i]) return false;
  return true;
}

/** Viewport-line scan for emoji, scripts, footnote refs, and reference links. */
export function scanLine(text: string): InlineSpan[] {
  const mask = skipMask(text);
  const spans: InlineSpan[] = [];
  const take = (from: number, to: number, span: InlineSpan) => {
    if (from < 0 || to > text.length || from >= to) return;
    if (!clear(mask, from, to)) return;
    if (spans.some((item) => from < item.to && to > item.from)) return;
    spans.push(span);
  };

  for (const match of text.matchAll(/:([a-z0-9_+-]+):/g)) {
    const name = match[1];
    if (!emojiGlyph(name) || match.index == null) continue;
    take(match.index, match.index + match[0].length, {
      from: match.index,
      to: match.index + match[0].length,
      kind: "emoji",
      text: name,
      id: name,
    });
  }
  for (const match of text.matchAll(/\^([^^\s][^^\n]{0,40})\^/g)) {
    if (match.index == null) continue;
    take(match.index, match.index + match[0].length, {
      from: match.index,
      to: match.index + match[0].length,
      kind: "sup",
      text: match[1],
      id: "",
    });
  }
  for (const match of text.matchAll(/(?<!~)~([^~\s][^~\n]{0,40})~(?!~)/g)) {
    if (match.index == null) continue;
    take(match.index, match.index + match[0].length, {
      from: match.index,
      to: match.index + match[0].length,
      kind: "sub",
      text: match[1],
      id: "",
    });
  }
  for (const match of text.matchAll(/\[\^([^\]]+)\](?!:)/g)) {
    if (match.index == null) continue;
    take(match.index, match.index + match[0].length, {
      from: match.index,
      to: match.index + match[0].length,
      kind: "footnote",
      text: match[1],
      id: match[1],
    });
  }
  for (const match of text.matchAll(/(!?)\[([^\]]*)\]\[([^\]]+)\]/g)) {
    if (match.index == null || match[3].startsWith("^")) continue;
    take(match.index, match.index + match[0].length, {
      from: match.index,
      to: match.index + match[0].length,
      kind: match[1] === "!" ? "ref-image" : "ref",
      text: match[2],
      id: match[3],
    });
  }
  spans.sort((a, b) => a.from - b.from);
  return spans;
}

export function referenceAt(
  text: string,
  offset: number,
): { id: string; image: boolean; from: number; to: number } | null {
  for (const span of scanLine(text)) {
    if (span.kind !== "ref" && span.kind !== "ref-image") continue;
    if (offset >= span.from && offset <= span.to) {
      return { id: span.id, image: span.kind === "ref-image", from: span.from, to: span.to };
    }
  }
  return null;
}
