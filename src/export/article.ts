import katex from "katex";
import { marked, type Token, type Tokens, type TokenizerThis } from "marked";
import { diagramKind, type DiagramKind } from "../editor/preview/diagramKind.ts";
import { splitFrontmatter, toLineFeed } from "../editor/fidelity.ts";

export interface ThemeColors {
  paper: string;
  ink: string;
  accent: string;
  line: string;
  muted: string;
  link?: string;
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  h1Size?: string;
  h2Size?: string;
  h3Size?: string;
  h4Size?: string;
  tableBorder?: string;
  tableHead?: string;
  tableHeadInk?: string;
  tableStripe?: string;
  math?: string;
  mathBg?: string;
  rule?: string;
  quote?: string;
  quoteBorder?: string;
  highlight?: string;
  codeBg?: string;
  codeInk?: string;
  codeBlock?: string;
  codeBlockInk?: string;
  strong?: string;
  em?: string;
}

export interface MathSlot {
  display: boolean;
  tex: string;
}

export interface DiagramSlot {
  source: string;
  kind: DiagramKind;
}

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "highlight",
      level: "inline",
      start(src: string) {
        return src.indexOf("==");
      },
      tokenizer(this: TokenizerThis, src: string) {
        const match = /^==([^=\n]+)==/.exec(src);
        if (!match) return undefined;
        return {
          type: "highlight",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
      },
    },
  ],
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shieldMath(body: string, slots: MathSlot[]): string {
  const lines = body.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(lines[i])) {
      inFence = !inFence;
      out.push(lines[i]);
      continue;
    }
    if (inFence) {
      out.push(lines[i]);
      continue;
    }
    if (/^[ \t]{0,3}\$\$[ \t]*$/.test(lines[i])) {
      const tex: string[] = [];
      i += 1;
      while (i < lines.length && !/^[ \t]{0,3}\$\$[ \t]*$/.test(lines[i])) {
        tex.push(lines[i]);
        i += 1;
      }
      const id = slots.length;
      slots.push({ display: true, tex: tex.join("\n") });
      out.push(`MOSHMATH${id}END`);
      continue;
    }
    out.push(
      lines[i].replace(/(?<!\$)\$(?!\$|\s|\d)([^\n$]*?[^\s$])\$(?!\$)/g, (_raw: string, tex: string) => {
        const id = slots.length;
        slots.push({ display: false, tex });
        return `MOSHMATH${id}END`;
      }),
    );
  }
  return out.join("\n");
}

function katexHtml(slot: MathSlot): string {
  return katex.renderToString(slot.tex, { throwOnError: false, displayMode: slot.display });
}

function htmlWithMath(text: string, slots: MathSlot[]): string {
  return text
    .split(/(MOSHMATH\d+END)/)
    .map((part) => {
      const match = /^MOSHMATH(\d+)END$/.exec(part);
      if (!match) return escapeHtml(part);
      const slot = slots[Number(match[1])];
      return slot ? katexHtml(slot) : escapeHtml(part);
    })
    .join("");
}

function inlineHtml(tokens: Token[] | undefined, slots: MathSlot[]): string {
  if (!tokens) return "";
  let html = "";
  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape":
        html += htmlWithMath(token.text, slots);
        break;
      case "br":
        html += "<br>";
        break;
      case "strong":
        html += `<strong>${inlineHtml(token.tokens, slots)}</strong>`;
        break;
      case "em":
        html += `<em>${inlineHtml(token.tokens, slots)}</em>`;
        break;
      case "del":
        html += `<del>${inlineHtml(token.tokens, slots)}</del>`;
        break;
      case "codespan":
        html += `<code>${escapeHtml(token.text)}</code>`;
        break;
      case "link":
        html += `<a href="${escapeHtml(token.href)}">${inlineHtml(token.tokens, slots)}</a>`;
        break;
      case "image":
        html += `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}">`;
        break;
      case "highlight":
        html += `<mark>${inlineHtml((token as Tokens.Generic).tokens, slots)}</mark>`;
        break;
      default:
        if ("tokens" in token && token.tokens) html += inlineHtml(token.tokens, slots);
        else if ("text" in token && typeof token.text === "string") html += htmlWithMath(token.text, slots);
    }
  }
  return html;
}

function blockHtml(tokens: Token[], slots: MathSlot[], diagrams: DiagramSlot[]): string {
  let html = "";
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading":
        html += `<h${token.depth}>${inlineHtml(token.tokens, slots)}</h${token.depth}>`;
        break;
      case "paragraph":
        html += `<p>${inlineHtml(token.tokens, slots)}</p>`;
        break;
      case "text": {
        const inline = token.tokens?.length ? inlineHtml(token.tokens, slots) : "";
        html += inline || htmlWithMath(token.text, slots);
        break;
      }
      case "blockquote":
        html += `<blockquote>${blockHtml(token.tokens ?? [], slots, diagrams)}</blockquote>`;
        break;
      case "list":
        html += listHtml(token as Tokens.List, slots, diagrams);
        break;
      case "code": {
        const kind = diagramKind(token.lang);
        if (kind) {
          const index = diagrams.length;
          diagrams.push({ source: token.text, kind });
          html += `<div class="diagram diagram-${kind}" data-diagram="${index}"></div>`;
        } else {
          const lang = token.lang ? ` class="language-${escapeHtml(token.lang)}"` : "";
          html += `<pre><code${lang}>${escapeHtml(token.text)}</code></pre>`;
        }
        break;
      }
      case "table":
        html += tableHtml(token as Tokens.Table, slots);
        break;
      case "hr":
        html += "<hr>";
        break;
      case "html":
        html += token.text;
        break;
      default:
        break;
    }
  }
  return html;
}

function listHtml(token: Tokens.List, slots: MathSlot[], diagrams: DiagramSlot[]): string {
  const tag = token.ordered ? "ol" : "ul";
  const start = token.ordered && token.start ? ` start="${token.start}"` : "";
  const items = token.items
    .map((item) => {
      const box = item.task
        ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> `
        : "";
      return `<li>${box}${blockHtml(item.tokens, slots, diagrams)}</li>`;
    })
    .join("");
  return `<${tag}${start}>${items}</${tag}>`;
}

function tableHtml(token: Tokens.Table, slots: MathSlot[]): string {
  const head = token.header.map((cell) => `<th>${inlineHtml(cell.tokens, slots)}</th>`).join("");
  const rows = token.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell.tokens, slots)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export interface Article {
  html: string;
  diagrams: DiagramSlot[];
}

/** Body HTML for one markdown chunk. Frontmatter is omitted by the caller. */
export function renderArticle(markdown: string): Article {
  const slots: MathSlot[] = [];
  const diagrams: DiagramSlot[] = [];
  const shielded = shieldMath(toLineFeed(markdown), slots);
  const tokens = marked.lexer(shielded);
  return { html: blockHtml(tokens, slots, diagrams), diagrams };
}

export function prepareBody(markdown: string): { tokens: Token[]; slots: MathSlot[] } {
  const slots: MathSlot[] = [];
  const split = splitFrontmatter(toLineFeed(markdown));
  return { tokens: marked.lexer(shieldMath(split.body, slots)), slots };
}

export function renderDocument(markdown: string): Article {
  const split = splitFrontmatter(toLineFeed(markdown));
  return renderArticle(split.body);
}

function tone(colors: ThemeColors, key: keyof ThemeColors, fallback: string): string {
  const value = colors[key];
  return typeof value === "string" && value ? value : fallback;
}

export function articleCss(colors: ThemeColors, width: number): string {
  const h1 = tone(colors, "h1", colors.accent);
  const h2 = tone(colors, "h2", h1);
  const h3 = tone(colors, "h3", h1);
  const h4 = tone(colors, "h4", h3);
  const tableBorder = tone(colors, "tableBorder", colors.line);
  const tableHead = tone(colors, "tableHead", "transparent");
  const tableHeadInk = tone(colors, "tableHeadInk", colors.ink);
  const tableStripe = tone(colors, "tableStripe", "transparent");
  const math = tone(colors, "math", colors.ink);
  const mathBg = tone(colors, "mathBg", "transparent");
  const rule = tone(colors, "rule", colors.line);
  const quote = tone(colors, "quote", colors.muted);
  const quoteBorder = tone(colors, "quoteBorder", colors.line);
  const link = tone(colors, "link", colors.accent);
  const highlight = tone(colors, "highlight", "#fde68a");
  const codeBg = tone(colors, "codeBg", "transparent");
  const codeInk = tone(colors, "codeInk", colors.ink);
  const codeBlock = tone(colors, "codeBlock", "transparent");
  const codeBlockInk = tone(colors, "codeBlockInk", colors.ink);
  const strong = tone(colors, "strong", colors.ink);
  const em = tone(colors, "em", colors.ink);
  return `html, body { background: ${colors.paper}; color: ${colors.ink}; }
.mosharp-doc {
  box-sizing: border-box;
  width: 100%;
  max-width: ${width}px;
  margin: 0 auto;
  color: ${colors.ink};
  font-family: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  font-size: 17px;
  line-height: 1.7;
}
.mosharp-doc h1, .mosharp-doc h2, .mosharp-doc h3, .mosharp-doc h4, .mosharp-doc h5, .mosharp-doc h6 { line-height: 1.35; }
.mosharp-doc h1 { color: ${h1}; font-size: ${tone(colors, "h1Size", "1.7em")}; }
.mosharp-doc h2 { color: ${h2}; font-size: ${tone(colors, "h2Size", "1.4em")}; }
.mosharp-doc h3 { color: ${h3}; font-size: ${tone(colors, "h3Size", "1.2em")}; }
.mosharp-doc h4, .mosharp-doc h5, .mosharp-doc h6 { color: ${h4}; font-size: ${tone(colors, "h4Size", "1.05em")}; }
.mosharp-doc strong { color: ${strong}; }
.mosharp-doc em { color: ${em}; }
.mosharp-doc a { color: ${link}; }
.mosharp-doc mark { background: ${highlight}; }
.mosharp-doc code { font-family: Consolas, "Courier New", monospace; font-size: 0.92em; color: ${codeInk}; background: ${codeBg}; }
.mosharp-doc pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: ${codeBlock};
  color: ${codeBlockInk};
  padding: 12px 14px;
  border-radius: 8px;
}
.mosharp-doc pre code { color: inherit; background: transparent; }
.mosharp-doc hr { border: none; border-top: 1px solid ${rule}; }
.mosharp-doc table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.mosharp-doc th, .mosharp-doc td {
  border: 1px solid ${tableBorder};
  padding: 6px 8px;
  overflow-wrap: anywhere;
  word-break: break-word;
  vertical-align: top;
}
.mosharp-doc th { background: ${tableHead}; color: ${tableHeadInk}; }
.mosharp-doc tbody tr:nth-child(even) td { background: ${tableStripe}; }
.mosharp-doc blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid ${quoteBorder}; color: ${quote}; }
.mosharp-doc img, .mosharp-doc svg { max-width: 100%; height: auto; }
.mosharp-doc .katex { color: ${math}; }
.mosharp-doc .katex-display { overflow-wrap: anywhere; background: ${mathBg}; border-radius: 8px; }
@page { margin: 16mm 14mm; background: ${colors.paper}; size: A4; }
@media print {
  html, body { background: ${colors.paper} !important; }
}`;
}

export function standaloneHtml(title: string, article: string, css: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.min.css">
  <style>${css}</style>
</head>
<body>
  <article class="mosharp-doc">${article}</article>
</body>
</html>`;
}
