import type { Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
const MAX_TEX = 4_000;
const MAX_BLOCK_LINES = 80;

let pandocMath = true;

/** `\(...\)` and `\[...\]` stay off until the Markdown preference turns them on. */
export function setPandocMath(enabled: boolean) {
  pandocMath = enabled;
}

interface MathBuild {
  decos: Range<Decoration>[];
  atomic: Range<Decoration>[];
  covered: Array<{ from: number; to: number }>;
  hidden: number[];
  lineClasses: Map<number, Set<string>>;
}

let katexLoader: Promise<typeof import("katex").default> | null = null;

function loadKatex() {
  katexLoader ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([mod]) => mod.default,
  );
  return katexLoader;
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return this.tex === other.tex && this.display === other.display;
  }

  get estimatedHeight() {
    return this.display ? 56 : -1;
  }

  toDOM() {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-md-math cm-md-math-block" : "cm-md-math";
    el.textContent = this.tex;
    const tex = this.tex.slice(0, MAX_TEX);
    const display = this.display;
    void loadKatex()
      .then((katex) => {
        if (!el.isConnected) return;
        katex.render(tex, el, { throwOnError: false, displayMode: display, output: "html" });
      })
      .catch(() => {
        el.textContent = tex;
      });
    return el;
  }

  destroy(dom: HTMLElement) {
    dom.replaceChildren();
  }
}

function rangeHasCursor(view: EditorView, from: number, to: number) {
  for (const range of view.state.selection.ranges) {
    if (range.head >= from && range.head <= to) return true;
  }
  return false;
}

function covered(build: MathBuild, from: number, to: number) {
  return build.covered.some((range) => from >= range.from && to <= range.to);
}

function sinkLine(build: MathBuild, lineNo: number, from: number, to: number) {
  const deco = Decoration.replace({ widget: collapse }).range(from, to);
  build.decos.push(deco);
  build.atomic.push(deco);
  let set = build.lineClasses.get(lineNo);
  if (!set) {
    set = new Set();
    build.lineClasses.set(lineNo, set);
  }
  set.add("cm-md-sink");
  build.hidden.push(from);
}

class Collapse extends WidgetType {
  eq() {
    return true;
  }
  get estimatedHeight() {
    return 0;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-collapse";
    return span;
  }
}

const collapse = new Collapse();

function hideMath(build: MathBuild, from: number, to: number, tex: string, display: boolean) {
  const deco = Decoration.replace({ widget: new MathWidget(tex, display) }).range(from, to);
  build.decos.push(deco);
  build.atomic.push(deco);
  build.covered.push({ from, to });
}

function maskCode(line: string): boolean[] {
  const mask = Array<boolean>(line.length).fill(false);
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let ticks = 0;
    while (line[i + ticks] === "`") ticks += 1;
    const close = line.indexOf("`".repeat(ticks), i + ticks);
    const end = close < 0 ? line.length : close + ticks;
    for (let n = i; n < end && n < line.length; n += 1) mask[n] = true;
    i = end;
  }
  return mask;
}

function decoratePandocInline(view: EditorView, lineFrom: number, text: string, build: MathBuild) {
  const mask = maskCode(text);
  for (const match of text.matchAll(/\\\((.+?)\\\)|\\\[(.+?)\\\]/g)) {
    if (match.index == null || mask[match.index]) continue;
    const tex = (match[1] || match[2] || "").trim();
    if (!tex || tex.length > MAX_TEX) continue;
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    if (covered(build, from, to) || rangeHasCursor(view, from, to)) continue;
    hideMath(build, from, to, tex, match[0].startsWith("\\["));
  }
}

function decorateInline(view: EditorView, lineFrom: number, text: string, build: MathBuild) {
  const mask = maskCode(text);
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "$" || mask[i] || text[i + 1] === "$") {
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next == null || next === " " || next === "\t" || (next >= "0" && next <= "9")) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let found = -1;
    while (j < text.length) {
      if (mask[j]) break;
      if (text[j] === "$" && text[j - 1] !== "\\") {
        if (text[j - 1] !== " " && j > i + 1) found = j;
        break;
      }
      j += 1;
    }
    if (found < 0) {
      i += 1;
      continue;
    }
    const from = lineFrom + i;
    const to = lineFrom + found + 1;
    const tex = text.slice(i + 1, found);
    if (!covered(build, from, to) && !rangeHasCursor(view, from, to) && tex.length <= MAX_TEX) {
      hideMath(build, from, to, tex, false);
    }
    i = found + 1;
  }
}

/** Viewport-only math. Unclosed `$` / `$$` stay as source so the marks can be checked. */
export function decorateMath(
  view: EditorView,
  viewportFrom: number,
  viewportTo: number,
  build: MathBuild,
) {
  const doc = view.state.doc;
  const startLine = Math.max(1, doc.lineAt(viewportFrom).number - 40);
  const endLine = doc.lineAt(Math.min(viewportTo, doc.length)).number;
  let n = startLine;
  while (n <= endLine) {
    const line = doc.line(n);
    if (covered(build, line.from, line.to)) {
      n += 1;
      continue;
    }
    const trimmed = line.text.trim();
    const single = /^ {0,3}\$\$(.+)\$\$\s*$/.exec(line.text);
    if (single && line.to >= viewportFrom && line.from <= viewportTo) {
      const tex = single[1].trim();
      if (tex && !rangeHasCursor(view, line.from, line.to)) {
        hideMath(build, line.from, line.to, tex, true);
      }
      n += 1;
      continue;
    }
    if (trimmed === "$$") {
      let close = -1;
      const limit = Math.min(doc.lines, n + MAX_BLOCK_LINES);
      for (let j = n + 1; j <= limit; j += 1) {
        if (doc.line(j).text.trim() === "$$") {
          close = j;
          break;
        }
      }
      if (close > 0) {
        const blockFrom = line.from;
        const blockTo = doc.line(close).to;
        const overlaps = blockTo >= viewportFrom && blockFrom <= viewportTo;
        if (overlaps && !rangeHasCursor(view, blockFrom, blockTo)) {
          const tex = doc.sliceString(doc.line(n + 1).from, doc.line(close).from).replace(/\n$/, "");
          if (tex.length <= MAX_TEX) {
            hideMath(build, line.from, line.to, tex, true);
            for (let j = n + 1; j <= close; j += 1) {
              const extra = doc.line(j);
              sinkLine(build, j, extra.from, extra.to);
            }
            build.covered.push({ from: blockFrom, to: blockTo });
          }
        }
        n = close + 1;
        continue;
      }
    }
    if (line.to >= viewportFrom && line.from <= viewportTo && line.text.includes("$")) {
      decorateInline(view, line.from, line.text, build);
    }
    if (
      pandocMath &&
      line.to >= viewportFrom &&
      line.from <= viewportTo &&
      line.text.includes("\\")
    ) {
      decoratePandocInline(view, line.from, line.text, build);
    }
    n += 1;
  }
}
