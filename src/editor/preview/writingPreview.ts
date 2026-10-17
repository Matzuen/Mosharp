import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  Facet,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { emojiGlyph, searchEmoji } from "../emoji";
import {
  buildIndex,
  emptyIndex,
  isDefinitionLine,
  scanLine,
  type InlineSpan,
  type WritingIndex,
} from "../writing";
import { flashEffect } from "./flash";
import { imageDisplaySrc, ImageWidget } from "./images";
import { mathRegions } from "./math";
import { sourceModeField } from "./modes";

const INDEX_LIMIT = 4000;

export interface WritingOptions {
  footnotes: boolean;
  emoji: boolean;
  superSub: boolean;
  customWords: string;
}

export const defaultWritingOptions: WritingOptions = {
  footnotes: true,
  emoji: true,
  superSub: true,
  customWords: "",
};

export const writingConfig = Facet.define<WritingOptions, WritingOptions>({
  combine: (values) => values[values.length - 1] ?? defaultWritingOptions,
});

const setWritingIndex = StateEffect.define<WritingIndex>();

export const writingIndexField = StateField.define<WritingIndex>({
  create(state) {
    if (state.doc.lines > INDEX_LIMIT) return emptyIndex();
    return buildIndex(state.doc);
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWritingIndex)) return effect.value;
    }
    if (!tr.docChanged || tr.state.doc.lines > INDEX_LIMIT) return value;
    return buildIndex(tr.state.doc);
  },
});

class FootnoteWidget extends WidgetType {
  constructor(readonly id: string) {
    super();
  }

  eq(other: FootnoteWidget) {
    return other.id === this.id;
  }

  toDOM() {
    const el = document.createElement("sup");
    el.className = "cm-fn-ref";
    el.dataset.fn = this.id;
    el.textContent = this.id;
    return el;
  }
}

class ScriptWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: "sup" | "sub",
  ) {
    super();
  }

  eq(other: ScriptWidget) {
    return other.text === this.text && other.kind === this.kind;
  }

  toDOM() {
    const el = document.createElement(this.kind);
    el.className = "cm-script";
    el.textContent = this.text;
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

class EmojiWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly glyph: string,
  ) {
    super();
  }

  eq(other: EmojiWidget) {
    return other.name === this.name;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-emoji";
    el.textContent = this.glyph;
    el.title = `:${this.name}:`;
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

function blocked(view: EditorView, pos: number): string | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
  for (let depth = 0; node && depth < 12; depth += 1) {
    if (
      node.name === "FencedCode" ||
      node.name === "CodeBlock" ||
      node.name === "InlineCode" ||
      node.name === "Table"
    ) {
      return node.name;
    }
    if (node.name === "Link" || node.name === "Image") return node.name;
    node = node.parent;
  }
  return null;
}

function cursorInside(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => range.from < to && range.to > from);
}

function compact(list: Range<Decoration>[]): DecorationSet {
  list.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept: Range<Decoration>[] = [];
  let end = -1;
  for (const item of list) {
    if (item.from < end) continue;
    kept.push(item);
    if (item.to > end) end = item.to;
  }
  return Decoration.set(kept, true);
}

function buildDecorations(view: EditorView): DecorationSet {
  if (view.state.field(sourceModeField)) return Decoration.none;
  const options = view.state.facet(writingConfig);
  const index = view.state.field(writingIndexField);
  const words = options.customWords
    .split(/[\s,，;；]+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0 && word.length <= 40)
    .slice(0, 200);
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;

  for (const visible of view.visibleRanges) {
    const start = doc.lineAt(visible.from).number;
    const endLine = doc.lineAt(Math.min(visible.to, doc.length)).number;
    // Raw TeX must stay literal, otherwise `a^2` turns into a superscript while
    // the user is editing the `$$` block and the source no longer matches.
    const lines: Array<{ from: number; text: string }> = [];
    for (let n = start; n <= endLine; n += 1) {
      const line = doc.line(n);
      lines.push({ from: line.from, text: line.text });
    }
    const math = mathRegions(lines);
    for (let n = start; n <= endLine; n += 1) {
      const line = doc.line(n);
      if (isDefinitionLine(line.text)) {
        ranges.push(Decoration.line({ class: "cm-def-list" }).range(line.from));
      }
      const block = blocked(view, line.from);
      if (block === "FencedCode" || block === "CodeBlock" || block === "Table") continue;
      const spans = scanLine(line.text);
      for (const span of spans) {
        const host = blocked(view, Math.min(line.from + span.from + 1, line.to));
        const from = line.from + span.from;
        const to = line.from + span.to;
        const inMath = math.some((range) => from >= range.from && to <= range.to);
        addSpan(view, line.from, span, host, options, index, ranges, inMath);
      }
      if (words.length > 0) addCustomWords(line.text, line.from, words, ranges);
    }
  }
  return compact(ranges);
}

function addSpan(
  view: EditorView,
  lineFrom: number,
  span: InlineSpan,
  host: string | null,
  options: WritingOptions,
  index: WritingIndex,
  ranges: Range<Decoration>[],
  inMath: boolean,
) {
  if (host === "InlineCode") return;
  // No inline decoration inside maths: the TeX has to read as written.
  if (inMath) return;
  const from = lineFrom + span.from;
  const to = lineFrom + span.to;
  const revealed = cursorInside(view, from, to);

  if (span.kind === "emoji" && options.emoji && !revealed) {
    const glyph = emojiGlyph(span.id);
    if (!glyph) return;
    ranges.push(Decoration.replace({ widget: new EmojiWidget(span.id, glyph) }).range(from, to));
    return;
  }
  if ((span.kind === "sup" || span.kind === "sub") && options.superSub && !revealed) {
    ranges.push(
      Decoration.replace({ widget: new ScriptWidget(span.text, span.kind) }).range(from, to),
    );
    return;
  }
  if (span.kind === "footnote" && options.footnotes && !revealed) {
    if (host === "Link") {
      if (span.to - span.from > 3) {
        ranges.push(Decoration.replace({}).range(from + 1, from + 2));
        ranges.push(
          Decoration.mark({ class: "cm-fn-ref", attributes: { "data-fn": span.id } }).range(from + 2, to - 1),
        );
      }
      return;
    }
    ranges.push(Decoration.replace({ widget: new FootnoteWidget(span.id) }).range(from, to));
    return;
  }
  if (span.kind === "ref" || span.kind === "ref-image") {
    const def = index.links.get(span.id.toLowerCase());
    if (span.kind === "ref-image" && def && !revealed && imageDisplaySrc(def.url)) {
      ranges.push(
        Decoration.replace({ widget: new ImageWidget(def.url, span.text, null) }).range(from, to),
      );
      return;
    }
    ranges.push(
      Decoration.mark({
        class: "cm-md-link",
        attributes: { title: def?.url ?? "" },
      }).range(from, to),
    );
  }
}

function addCustomWords(
  text: string,
  lineFrom: number,
  words: string[],
  ranges: Range<Decoration>[],
) {
  const lower = text.toLowerCase();
  for (const word of words) {
    let at = 0;
    while (at < lower.length) {
      const hit = lower.indexOf(word, at);
      if (hit < 0) break;
      const before = hit === 0 || /[^\p{L}\p{N}_]/u.test(text[hit - 1] ?? "");
      const afterAt = hit + word.length;
      const after = afterAt >= text.length || /[^\p{L}\p{N}_]/u.test(text[afterAt] ?? "");
      if (before && after) {
        ranges.push(
          Decoration.mark({ attributes: { spellcheck: "false" } }).range(
            lineFrom + hit,
            lineFrom + afterAt,
          ),
        );
      }
      at = hit + Math.max(1, word.length);
    }
  }
}

class WritingPreviewPlugin {
  decorations = Decoration.none;
  private indexed = false;
  private timer = 0;
  private card: HTMLDivElement;
  private menu: HTMLDivElement;
  private menuOpen = false;
  private triggerFrom = -1;
  private active = 0;
  private items: ReturnType<typeof searchEmoji> = [];
  private readonly onKey: (event: KeyboardEvent) => void;
  private readonly onOver: (event: MouseEvent) => void;
  private readonly onOut: (event: MouseEvent) => void;

  constructor(readonly view: EditorView) {
    this.card = document.createElement("div");
    this.card.className = "cm-fn-card";
    this.card.style.display = "none";
    this.menu = document.createElement("div");
    this.menu.className = "cm-emoji-menu";
    this.menu.style.display = "none";
    view.dom.appendChild(this.card);
    view.dom.appendChild(this.menu);
    this.onKey = (event) => this.onMenuKey(event);
    this.onOver = (event) => this.showFootnote(event);
    this.onOut = (event) => this.hideFootnote(event);
    view.contentDOM.addEventListener("keydown", this.onKey, true);
    view.dom.addEventListener("mouseover", this.onOver);
    view.dom.addEventListener("mouseout", this.onOut);
    this.rebuild();
    if (view.state.doc.lines > INDEX_LIMIT) this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.state.field(sourceModeField)) {
      this.decorations = Decoration.none;
      this.hideMenu();
      this.card.style.display = "none";
    } else {
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        treeChanged ||
        update.transactions.some((tr) => tr.effects.length > 0)
      ) {
        this.rebuild();
      }
    }
    if (update.docChanged && update.state.doc.lines > INDEX_LIMIT && this.shouldReindex(update)) {
      this.schedule();
    }
    if (update.docChanged || update.selectionSet || update.focusChanged) this.syncMenu(update);
  }

  destroy() {
    window.clearTimeout(this.timer);
    this.view.contentDOM.removeEventListener("keydown", this.onKey, true);
    this.view.dom.removeEventListener("mouseover", this.onOver);
    this.view.dom.removeEventListener("mouseout", this.onOut);
    this.card.remove();
    this.menu.remove();
  }

  private rebuild() {
    this.decorations = buildDecorations(this.view);
  }

  private shouldReindex(update: ViewUpdate): boolean {
    if (!this.indexed) return true;
    let interesting = false;
    update.changes.iterChanges((fromA, toA, fromB, toB) => {
      const before = update.startState.doc.sliceString(fromA, toA);
      const after = update.state.doc.sliceString(fromB, toB);
      if (before.includes("[") || before.includes("]") || after.includes("[") || after.includes("]")) {
        interesting = true;
      }
    });
    return interesting;
  }

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.view.dom.isConnected) return;
      const index = buildIndex(this.view.state.doc);
      this.indexed = true;
      this.view.dispatch({ effects: setWritingIndex.of(index) });
    }, 240);
  }

  private showFootnote(event: MouseEvent) {
    const el = (event.target as HTMLElement | null)?.closest?.(".cm-fn-ref");
    if (!el || !this.view.dom.contains(el)) {
      return;
    }
    const id = el.getAttribute("data-fn");
    if (!id) return;
    const def = this.view.state.field(writingIndexField).footnotes.get(id);
    this.card.textContent = def ? def.text || "（还没有内容）" : "（未找到这条脚注）";
    const rect = el.getBoundingClientRect();
    const host = this.view.dom.getBoundingClientRect();
    this.card.style.display = "block";
    this.card.style.top = `${rect.bottom - host.top + 6}px`;
    this.card.style.left = `${Math.max(8, rect.left - host.left)}px`;
  }

  private hideFootnote(event: MouseEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && this.card.contains(next)) return;
    this.card.style.display = "none";
  }

  private syncMenu(update: ViewUpdate) {
    if (update.state.field(sourceModeField) || !update.state.facet(writingConfig).emoji) {
      this.hideMenu();
      return;
    }
    const selection = update.state.selection.main;
    if (!selection.empty) {
      this.hideMenu();
      return;
    }
    const line = update.state.doc.lineAt(selection.head);
    const before = line.text.slice(0, selection.head - line.from);
    const match = /(^|[\s([{]):([a-z0-9_+-]*)$/.exec(before);
    if (!match) {
      this.hideMenu();
      return;
    }
    const items = searchEmoji(match[2]);
    if (items.length === 0) {
      this.hideMenu();
      return;
    }
    this.triggerFrom = selection.head - match[2].length - 1;
    if (!this.menuOpen || this.items.length !== items.length) this.active = 0;
    this.items = items;
    this.menuOpen = true;
    this.renderMenu();
    const head = selection.head;
    this.view.requestMeasure({
      read: (measured) => {
        const coords = measured.coordsAtPos(head);
        if (!coords) return null;
        const editorRect = measured.dom.getBoundingClientRect();
        return {
          top: coords.bottom - editorRect.top + 6,
          left: coords.left - editorRect.left,
        };
      },
      write: (measure) => {
        if (!this.menuOpen || !measure) return;
        this.menu.style.display = "block";
        this.menu.style.top = `${measure.top}px`;
        this.menu.style.left = `${Math.max(8, measure.left)}px`;
      },
    });
  }

  private renderMenu() {
    this.menu.textContent = "";
    this.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === this.active ? "cm-emoji-item active" : "cm-emoji-item";
      button.textContent = `${item.glyph}  :${item.name}:`;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("mouseenter", () => {
        this.active = index;
        this.renderMenu();
      });
      button.addEventListener("click", () => this.choose(index));
      this.menu.appendChild(button);
    });
  }

  private choose(index: number) {
    const item = this.items[index];
    if (!item) return;
    const head = this.view.state.selection.main.head;
    const from = Math.min(this.triggerFrom, head);
    this.view.dispatch({
      changes: { from, to: head, insert: `:${item.name}:` },
      selection: { anchor: from + item.name.length + 2 },
    });
    this.hideMenu();
    this.view.focus();
  }

  private onMenuKey(event: KeyboardEvent) {
    if (!this.menuOpen) return;
    // Never steal keys the IME needs to commit a composition (CJK input).
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + step + this.items.length) % this.items.length;
      this.renderMenu();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      this.choose(this.active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.hideMenu();
    }
  }

  private hideMenu() {
    this.menu.style.display = "none";
    this.menuOpen = false;
    this.triggerFrom = -1;
    this.items = [];
    this.active = 0;
  }
}

const writingPreviewPlugin = ViewPlugin.fromClass(WritingPreviewPlugin, {
  decorations: (value) => value.decorations,
});

export const writingPreviewTheme = EditorView.baseTheme({
  ".cm-fn-ref": {
    color: "var(--accent)",
    cursor: "pointer",
    fontSize: "0.75em",
    verticalAlign: "super",
  },
  ".cm-script": {
    fontSize: "0.75em",
  },
  ".cm-emoji": {
    fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", sans-serif',
  },
  ".cm-def-list": {
    borderLeft: "2px solid var(--accent)",
    paddingLeft: "0.35em",
  },
  ".cm-fn-card, .cm-emoji-menu": {
    position: "absolute",
    zIndex: "24",
    maxWidth: "280px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--line)",
    background: "var(--menu)",
    color: "var(--ink)",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
    fontSize: "12px",
    lineHeight: "1.45",
  },
  ".cm-emoji-menu": {
    minWidth: "180px",
    padding: "4px",
  },
  ".cm-emoji-item": {
    display: "block",
    width: "100%",
    height: "30px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    textAlign: "left",
    padding: "0 10px",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-emoji-item.active, .cm-emoji-item:hover": {
    background: "var(--hover)",
  },
});

export const writingPreview = [
  writingIndexField,
  writingPreviewPlugin,
  writingPreviewTheme,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const el = (event.target as HTMLElement | null)?.closest?.(".cm-fn-ref");
      if (!el) return false;
      const id = el.getAttribute("data-fn");
      if (!id) return false;
      const def = view.state.field(writingIndexField).footnotes.get(id);
      if (!def) return false;
      event.preventDefault();
      const line = view.state.doc.line(Math.min(def.line, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: [
          EditorView.scrollIntoView(line.from, { y: "center" }),
          flashEffect.of(line.number),
        ],
      });
      window.setTimeout(() => {
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: flashEffect.of(null) });
      }, 900);
      return true;
    },
  }),
];
