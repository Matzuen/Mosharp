import type { SyntaxNode } from "@lezer/common";
import { redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  lineNumberMarkers,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { FenceLangWidget } from "./codeLang";
import { imageSuffix, imageUrl, ImageWidget } from "./images";
import { decorateMath } from "./math";
import { DiagramWidget } from "./diagramFence";
import { diagramKind } from "./diagramKind";
import { notify } from "./notify";
import { insideStrictly } from "./cursorScope";
import { frontMatterLines } from "./frontMatter";
import { MAX_ENTRIES, TocScan, type TocEntry } from "./toc";
import { sanitizeHtml } from "../../export/sanitize";
import { focusModeField, sourceModeField } from "./modes";
import { quoteDepth } from "./quoteDepth";
import {
  alignment,
  applyTableOp,
  isDelimiterRow,
  joinCells,
  splitCells,
  TABLE_MENU,
  TABLE_MENU_KEYS,
  type TableOp,
} from "./tableOps";

/** Shared attributes for the small inline toolbar icons. */
const ICON_ATTRS =
  'viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"';

const ICON_ALIGN_LEFT = `<svg ${ICON_ATTRS}><path d="M2 4h12M2 8h8M2 12h12"/></svg>`;
const ICON_ALIGN_CENTER = `<svg ${ICON_ATTRS}><path d="M2 4h12M4 8h8M2 12h12"/></svg>`;
const ICON_ALIGN_RIGHT = `<svg ${ICON_ATTRS}><path d="M2 4h12M6 8h8M2 12h12"/></svg>`;
const ICON_TRASH = `<svg ${ICON_ATTRS}><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.7 7v4M9.3 7v4"/></svg>`;

/** Order of the alignment buttons, matching their `TableOp` values. */
const ALIGN_ORDER = ["left", "center", "right"] as const;

/** Cell to focus once the table widget at `from` has been rebuilt. */
let pendingCellFocus: { from: number; row: number; col: number } | null = null;

/** Docs at/above this line count: decorate only after scroll settles. */
const LARGE_DOC_LINES = 8_000;
/** Wait after last scroll before rebuilding preview on large docs. */
const SCROLL_IDLE_MS = 72;

const MARK_NAMES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "TableDelimiter",
  "CodeInfo",
]);

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    box.tabIndex = -1;
    box.setAttribute("aria-label", "任务");
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = this.checked ? "[ ]" : "[x]";
      const max = view.state.doc.length;
      const from = Math.min(this.from, max);
      const to = Math.min(this.to, max);
      if (from >= to) return;
      view.dispatch({
        changes: { from, to, insert: next },
      });
    });
    return box;
  }

  ignoreEvent(event: Event) {
    return event.type === "mousedown" || event.type === "click";
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly label: string, readonly kind: "bullet" | "ordered") {
    super();
  }

  eq(other: BulletWidget) {
    return this.label === other.label && this.kind === other.kind;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.kind === "ordered" ? "cm-md-ol" : "cm-md-bullet";
    span.textContent = this.label;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr-widget";
    return hr;
  }
}

const hrWidget = new HrWidget();

class CollapseWidget extends WidgetType {
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

const collapseWidget = new CollapseWidget();

/**
 * ```html fence rendered for real, through the allow-list sanitizer.
 *
 * A click outside a link puts the caret back in the fence so the source can be
 * edited; the block is otherwise inert.
 */
class HtmlBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly caretAt: number,
  ) {
    super();
  }

  eq(other: HtmlBlockWidget) {
    return other.source === this.source && other.caretAt === this.caretAt;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-html-block";
    wrap.innerHTML = sanitizeHtml(this.source);
    wrap.addEventListener("mousedown", (event) => {
      if (!(event instanceof MouseEvent) || event.button !== 0) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      // A link inside rendered HTML must never navigate the app window; open
      // http(s) externally and treat everything else as "show me the source".
      if (anchor && /^https?:\/\//i.test(href)) {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const at = Math.min(this.caretAt, view.state.doc.length);
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

/** Plain fallback rendering for a fence swallowed by an HTML block. */
class CodeBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly info: string,
  ) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return other.source === this.source && other.info === this.info;
  }

  toDOM() {
    const pre = document.createElement("pre");
    pre.className = "cm-md-code-fallback";
    const code = document.createElement("code");
    code.textContent = this.source;
    pre.appendChild(code);
    return pre;
  }
}

/**
 * `@lezer/markdown` follows CommonMark here: a block-level HTML tag opens an
 * HTML block that runs until a blank line, so
 *
 *     <div>x</div>
 *     ```mermaid
 *     ...
 *     ```
 *
 * parses as a single HTML block and the fence never becomes a fence. Recover the
 * fences inside such a block so a missing blank line does not silently disable
 * rendering for everything below it.
 */
function recoverFencesInHtmlBlock(
  view: EditorView,
  build: PreviewBuild,
  start: { number: number; from: number },
  end: { number: number; to: number },
): boolean {
  const doc = view.state.doc;
  let recovered = false;
  for (let n = start.number; n <= end.number; n += 1) {
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(doc.line(n).text);
    if (!open) continue;
    const fence = open[1];
    const info = (open[2] ?? "").trim();
    let close = -1;
    for (let k = n + 1; k <= end.number; k += 1) {
      const text = doc.line(k).text.trim();
      if (text.length >= fence.length && text.startsWith(fence[0].repeat(fence.length))) {
        close = k;
        break;
      }
    }
    if (close < 0) break;

    const opener = doc.line(n);
    const closer = doc.line(close);
    const source = doc
      .sliceString(doc.line(n + 1).from, closer.from)
      .replace(/\n$/, "");
    const kind = diagramKind(info);
    const widget: WidgetType = kind
      ? new DiagramWidget(kind, source)
      : new CodeBlockWidget(source, info);

    const deco = Decoration.replace({ widget }).range(opener.from, opener.to);
    build.decos.push(deco);
    build.atomic.push(deco);
    for (let k = n + 1; k <= close; k += 1) {
      const line = doc.line(k);
      const sink = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
      build.decos.push(sink);
      build.atomic.push(sink);
      addLineClass(build, k, "cm-md-sink");
      build.hidden.push(line.from);
    }
    build.covered.push({ from: opener.from, to: closer.to });
    recovered = true;
    n = close;
  }
  return recovered;
}

/** Folded YAML header: one chip instead of the whole block. */class FrontMatterWidget extends WidgetType {
  constructor(
    readonly rows: number,
    readonly from: number,
  ) {
    super();
  }

  eq(other: FrontMatterWidget) {
    return other.rows === this.rows && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const chip = document.createElement("span");
    chip.className = "cm-md-frontmatter";
    chip.textContent = `YAML · ${this.rows}`;
    chip.title = "front matter（点击编辑）";
    chip.addEventListener("mousedown", (event) => {
      if (!(event instanceof MouseEvent) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // Land inside the opening fence so the block unfolds for editing.
      const at = Math.min(this.from + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    });
    return chip;
  }
}

/** `[TOC]` rendered as a clickable outline of the document's headings. */
class TocWidget extends WidgetType {
  constructor(
    readonly from: number,
    /** Document size at build time; any edit of that size invalidates the DOM. */
    readonly size: number,
  ) {
    super();
  }

  eq(other: TocWidget) {
    // `from` alone is not enough: editing a heading must refresh the rendered
    // list, and a changed document always changes its length.
    return other.from === this.from && other.size === this.size;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-md-toc";
    const scan = new TocScan();
    const entries: TocEntry[] = [];
    const doc = view.state.doc;
    let lineNo = 0;
    for (const text of doc.iterLines(1, doc.lines)) {
      lineNo += 1;
      const entry = scan.push(text, lineNo);
      if (entry) entries.push(entry);
      if (entries.length >= MAX_ENTRIES) break;
    }
    if (entries.length === 0) {
      box.textContent = "目录：暂无标题";
      return box;
    }
    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `cm-md-toc-item level-${entry.level}`;
      item.style.paddingLeft = `${(entry.level - 1) * 14}px`;
      item.textContent = entry.text;
      item.addEventListener("mousedown", (event) => {
        if (!(event instanceof MouseEvent) || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const pos = view.state.doc.line(entry.line).from;
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "start" }),
        });
        view.focus();
      });
      box.appendChild(item);
    }
    return box;
  }
}

class TableWidget extends WidgetType {
  dom: HTMLElement | null = null;
  /** Visual cell the last interaction happened in; row 0 is the header. */
  private activeRow = 0;
  private activeCol = 0;
  /** Lets `destroy` drop the document listeners of an open menu. */
  private closeMenu: (() => void) | null = null;

  constructor(
    readonly source: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget) {
    if (this.source === other.source) return true;
    // Keep the live cells when a commit rewrites the row under the caret.
    return this.dom != null && this.dom.contains(document.activeElement);
  }

  get estimatedHeight() {
    return Math.max(48, this.source.split("\n").length * 34);
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-md-table-widget";
    const lines = this.source.split("\n").filter((line) => line.trim().length > 0);
    const header = splitCells(lines[0] ?? "");
    const aligns = lines[1] && isDelimiterRow(lines[1]) ? splitCells(lines[1]).map(alignment) : [];
    const bodyStart = lines[1] && isDelimiterRow(lines[1]) ? 2 : 1;

    const commitAt = (row: number, col: number, text: string) => {
      const pos = this.from;
      queueMicrotask(() => commitCell(view, pos, row, col, text));
    };
    const activateAt = (row: number, col: number) => {
      this.activeRow = row;
      this.activeCol = col;
      syncActive();
    };

    // Declared before the rows are built so `renderRow` can bind it; `run` is
    // only reached when Tab is pressed, by which point it exists.
    const handleTab = (delta: number) => {
      const cells = Array.from(table.querySelectorAll<HTMLElement>(".cm-md-cell"));
      const index = cells.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? undefined : cells[index + delta];
      if (next) {
        next.focus();
        return;
      }
      if (delta < 0) return;
      const lastRow = table.querySelectorAll("tr").length - 1;
      this.activeRow = lastRow;
      this.activeCol = 0;
      pendingCellFocus = { from: this.from, row: lastRow + 1, col: 0 };
      run("row-below");
    };

    const thead = document.createElement("thead");
    thead.appendChild(renderRow(header, aligns, "th", 0, commitAt, activateAt, view, handleTab));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    let visualRow = 1;
    for (let i = bodyStart; i < lines.length; i += 1) {
      if (isDelimiterRow(lines[i])) continue;
      tbody.appendChild(
        renderRow(splitCells(lines[i]), aligns, "td", visualRow, commitAt, activateAt, view, handleTab),
      );
      visualRow += 1;
    }
    table.appendChild(tbody);

    // Mirror the active column's alignment on the toolbar.
    const alignButtons: HTMLButtonElement[] = [];
    const syncActive = () => {
      // The column is no longer tinted: the toolbar only appears once a cell is
      // focused, and that focused cell already tells you which column it is.
      const current = aligns[this.activeCol] ?? "left";
      alignButtons.forEach((button, index) => {
        const on = ALIGN_ORDER[index] === current;
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };

    // Inline SVG rather than an icon font: the reference UI renders glyphs as
    // tofu boxes when the font lacks them, and a missing icon is worse than no
    // icon.
    const iconButton = (className: string, svg: string, title: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.innerHTML = svg;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      return button;
    };

    const left = document.createElement("div");
    left.className = "cm-md-table-left";
    const alignments: Array<[string, TableOp, string]> = [
      [ICON_ALIGN_LEFT, "align-left", "本列左对齐"],
      [ICON_ALIGN_CENTER, "align-center", "本列居中"],
      [ICON_ALIGN_RIGHT, "align-right", "本列右对齐"],
    ];
    for (const [svg, op, title] of alignments) {
      const button = iconButton("cm-md-table-align", svg, title);
      button.addEventListener("click", () => run(op));
      alignButtons.push(button);
      left.appendChild(button);
    }

    const chrome = document.createElement("div");
    chrome.className = "cm-md-table-chrome";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "cm-md-table-more";
    more.title = "更多操作";
    more.textContent = "更多操作 ⋮";
    chrome.appendChild(more);

    const removeTable = iconButton("cm-md-table-action", ICON_TRASH, "删除整个表格");
    removeTable.addEventListener("click", () => run("delete"));
    chrome.appendChild(removeTable);

    const menu = document.createElement("div");
    menu.className = "cm-md-table-menu";
    menu.style.display = "none";

    const closeMenu = () => {
      menu.style.display = "none";
      wrap.classList.remove("cm-md-table-open");
      window.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("mousedown", onOutside, true);
    };
    // Escape closes the menu. Capture on window so it runs before the cell's own
    // keydown handler (which stops propagation on every key).
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    };
    const onOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && wrap.contains(event.target)) return;
      closeMenu();
    };
    const openMenu = () => {
      menu.style.display = "block";
      wrap.classList.add("cm-md-table-open");
      window.addEventListener("keydown", onEscape, true);
      document.addEventListener("mousedown", onOutside, true);
    };
    this.closeMenu = closeMenu;
    const run = (op: TableOp) => {
      closeMenu();
      // Capture the coordinates before the widget is rebuilt.
      const row = this.activeRow;
      const col = this.activeCol;
      const pos = view.posAtDOM(wrap);
      if (pos == null) return;
      // `eq` keeps the current DOM alive while a cell holds focus (so typing in
      // a cell is not interrupted by its own commit). A structural change would
      // then leave the old table on screen even though the document changed —
      // the click looked like a no-op and had to be repeated. Drop the DOM
      // reference so the next comparison forces a rebuild, and put it back if
      // the operation turned out to be a no-op.
      const previousDom = this.dom;
      this.dom = null;
      queueMicrotask(() => {
        if (!runTableOp(view, pos, op, row, col)) this.dom = previousDom;
      });
    };

    for (const entry of TABLE_MENU) {
      if (entry.sep) {
        const rule = document.createElement("hr");
        rule.className = "cm-md-table-menu-sep";
        menu.appendChild(rule);
        continue;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-md-table-menu-item";
      const label = document.createElement("span");
      label.textContent = entry.label ?? "";
      item.appendChild(label);
      if (entry.keys) {
        const keys = document.createElement("span");
        keys.className = "cm-md-table-menu-keys";
        keys.textContent = entry.keys;
        item.appendChild(keys);
      }
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      item.addEventListener("click", () => {
        if (entry.op) run(entry.op);
      });
      menu.appendChild(item);
    }

    more.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    more.addEventListener("click", () => {
      const open = menu.style.display === "block";
      if (open) closeMenu();
      else openMenu();
    });

    // Ctrl+Enter and Alt+Arrow are advertised in the menu, so wire them up.
    // Capture phase: the cell handler below stops propagation on every key.
    wrap.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("cm-md-cell")) return;
        if (event.ctrlKey && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          run("row-below");
          return;
        }
        if (!event.altKey) return;
        const op = TABLE_MENU_KEYS[event.key];
        if (!op) return;
        event.preventDefault();
        event.stopPropagation();
        run(op);
      },
      true,
    );

    chrome.appendChild(menu);
    wrap.append(table, left, chrome);
    syncActive();
    this.dom = wrap;
    // A Tab on the last cell appends a row; the rebuild is what creates its
    // cells, so the focus has to be restored after it lands.
    if (pendingCellFocus?.from === this.from) {
      const target = pendingCellFocus;
      pendingCellFocus = null;
      requestAnimationFrame(() => {
        const rows = wrap.querySelectorAll("tr");
        const cell = rows[target.row]?.children[target.col];
        if (cell instanceof HTMLElement) cell.focus();
      });
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }

  destroy() {
    // The widget can be scrolled out / rebuilt while its menu is open.
    this.closeMenu?.();
    this.closeMenu = null;
  }
}

function renderRow(
  cells: string[],
  aligns: Array<"left" | "center" | "right">,
  tag: "th" | "td",
  visualRow: number,
  onCommit: (row: number, col: number, text: string) => void,
  onActivate: (row: number, col: number) => void,
  view: EditorView,
  onTab: (delta: number) => void,
) {
  const row = document.createElement("tr");
  for (let i = 0; i < cells.length; i += 1) {
    const cell = document.createElement(tag);
    // Mutable: it tracks the last committed value so "dirty" stays meaningful.
    let original = cells[i];
    cell.className = "cm-md-cell";
    // A cell cannot hold a real newline, so a line break is stored as `<br>`.
    const lines = original.split(/<br\s*\/?>/i);
    cell.textContent = lines[0] ?? "";
    for (const line of lines.slice(1)) {
      cell.appendChild(document.createElement("br"));
      cell.appendChild(document.createTextNode(line));
    }
    cell.contentEditable = "true";
    cell.spellcheck = false;
    cell.style.textAlign = aligns[i] ?? "left";
    cell.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      onActivate(visualRow, i);
    });
    cell.addEventListener("focusin", () => onActivate(visualRow, i));
    /** Read the cell back, turning DOM line breaks into `<br>`. */
    const cellText = () => {
      let text = "";
      for (const node of Array.from(cell.childNodes)) {
        text += node.nodeName === "BR" ? "<br>" : (node.textContent ?? "");
      }
      return text.replace(/\r?\n/g, " ").trim();
    };
    const commit = () => {
      // Cell text is unescaped here; `joinCells` adds the `\|` escaping when the
      // row is written back, so a pipe survives a round trip.
      const next = cellText();
      if (next === original) return;
      original = next;
      onCommit(visualRow, i, next);
    };
    cell.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        // Native undo only covers the in-cell edit. Once committed, the edit
        // lives in the document, so route undo/redo to the editor history —
        // otherwise the cell and the source silently diverge.
        if (cellText() !== original) return;
        event.preventDefault();
        if (event.shiftKey) redo(view);
        else undo(view);
        return;
      }
      if (event.key === "Tab") {
        // Tab walks the cells instead of leaving the table on the first press.
        event.preventDefault();
        onTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        // Shift+Enter inserts a line break inside the cell instead of committing.
        event.preventDefault();
        document.execCommand("insertLineBreak");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        cell.blur();
      }
    });
    cell.addEventListener("blur", commit);
    row.appendChild(cell);
  }
  return row;
}

function tableLinesAt(view: EditorView, pos: number) {
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let lineNo = view.state.doc.lineAt(pos).number;
  while (lineNo <= view.state.doc.lines && lines.length < 200) {
    const line = view.state.doc.line(lineNo);
    if (lines.length > 0 && !line.text.includes("|")) break;
    if (!line.text.includes("|")) break;
    lines.push({ from: line.from, to: line.to, text: line.text });
    lineNo += 1;
  }
  return lines;
}

/**
 * Apply one table operation to the source text that backs the widget.
 *
 * `activeRow`/`activeCol` are visual coordinates inside the widget: row 0 is the
 * header, rows 1+ are body rows. They are mapped back to source line indexes
 * because the delimiter row is not a visual row.
 */
/** Returns true when the document was actually rewritten. */
function runTableOp(
  view: EditorView,
  pos: number,
  op: TableOp,
  activeRow: number,
  activeCol: number,
): boolean {
  const lines = tableLinesAt(view, pos);
  if (lines.length === 0) return false;
  const tableFrom = lines[0].from;
  const tableTo = lines[lines.length - 1].to;

  if (op === "copy") {
    const text = view.state.doc.sliceString(tableFrom, tableTo);
    navigator.clipboard?.writeText(text).then(
      () => notify("已复制表格"),
      () => notify("复制失败：剪贴板不可用"),
    );
    return false;
  }

  if (op === "delete") {
    let from = tableFrom;
    let to = tableTo;
    // Take the following newline with it so no empty line is left behind.
    if (to < view.state.doc.length) to += 1;
    else if (from > 0) from -= 1;
    view.dispatch({ changes: { from, to, insert: "" } });
    return true;
  }

  const source = lines.map((line) => line.text).join("\n");
  const insert = applyTableOp(source, op, activeRow, activeCol);
  if (insert == null) return false;
  view.dispatch({ changes: { from: tableFrom, to: tableTo, insert } });
  return true;
}

function commitCell(view: EditorView, pos: number, visualRow: number, col: number, text: string) {
  if (pos < 0 || pos > view.state.doc.length) return;
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let lineNo = view.state.doc.lineAt(pos).number;
  while (lineNo <= view.state.doc.lines && lines.length < 200) {
    const line = view.state.doc.line(lineNo);
    if (lines.length > 0 && !line.text.includes("|")) break;
    if (!line.text.includes("|")) break;
    lines.push({ from: line.from, to: line.to, text: line.text });
    lineNo += 1;
  }
  const hasDelimiter = lines[1] != null && isDelimiterRow(lines[1].text);
  const sourceIndex = !hasDelimiter || visualRow === 0 ? visualRow : visualRow + 1;
  const target = lines[sourceIndex];
  if (!target || isDelimiterRow(target.text)) return;
  const cells = splitCells(target.text);
  while (cells.length <= col) cells.push("");
  if (cells[col] === text) return;
  cells[col] = text;
  // `joinCells` escapes any pipe the cell text contains, so the row is written
  // exactly once with the escaping in a single place.
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: joinCells(cells) },
  });
}

function listItemHasTask(node: { node: SyntaxNode }) {
  const parent = node.node.parent;
  if (!parent || parent.name !== "ListItem") return false;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.name === "Task") return true;
  }
  return false;
}

class HiddenLineNumber extends GutterMarker {
  eq() {
    return true;
  }

  toDOM() {
    return document.createTextNode("");
  }
}

/**
 * Gutter label for a block that swallows several source lines (setext headings,
 * tables, diagram fences, `$$` blocks).
 *
 * The alternate — blanking the digits of the swallowed lines — leaves holes in
 * the number column (1576, then 1578), which reads as a misaligned gutter.
 * Showing the source range keeps every line accounted for.
 */
class SpanLabel extends GutterMarker {
  constructor(readonly label: string) {
    super();
  }

  eq(other: SpanLabel) {
    return other.label === this.label;
  }

  toDOM() {
    return document.createTextNode(this.label);
  }
}

const hiddenLineNumber = new HiddenLineNumber();
const setHiddenLineNumbers = StateEffect.define<RangeSet<GutterMarker>>();

/** Ask the preview to rebuild, for example after the file path changes. */
export const refreshPreview = StateEffect.define<null>();

/** Replaces the digits on collapsed table/setext lines so they cannot stack. */
export const hiddenLineNumberField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHiddenLineNumbers)) next = effect.value;
    }
    return next;
  },
  provide: (field) => lineNumberMarkers.from(field),
});

interface PreviewBuild {
  decos: Range<Decoration>[];
  atomic: Range<Decoration>[];
  lineClasses: Map<number, Set<string>>;
  covered: Array<{ from: number; to: number }>;
  hidden: number[];
  /** Gutter labels keyed by the position of the block's first source line. */
  labels: Map<number, string>;
}

function isCovered(build: PreviewBuild, from: number, to: number) {
  return build.covered.some((range) => from >= range.from && to <= range.to);
}

function addLineClass(build: PreviewBuild, line: number, className: string) {
  let set = build.lineClasses.get(line);
  if (!set) {
    set = new Set();
    build.lineClasses.set(line, set);
  }
  set.add(className);
}

function hide(build: PreviewBuild, from: number, to: number, widget?: WidgetType) {
  if (to <= from) return;
  const deco = Decoration.replace(widget ? { widget } : {}).range(from, to);
  build.decos.push(deco);
  build.atomic.push(deco);
}

/** Cursor is inside the range, including either edge, so a mark just typed stays visible. */
function rangeHasCursor(view: EditorView, from: number, to: number) {
  for (const range of view.state.selection.ranges) {
    if (range.head >= from && range.head <= to) return true;
  }
  return false;
}

function lineHasCursor(view: EditorView, lineNo: number) {
  const line = view.state.doc.line(lineNo);
  return rangeHasCursor(view, line.from, line.to);
}

/** Inline delimiter stays visible while the caret is in that span, not on the rest of the line. */
function parentHoldsCursor(view: EditorView, node: SyntaxNode) {
  const parent = node.parent;
  if (!parent) return rangeHasCursor(view, node.from, node.to);
  return rangeHasCursor(view, parent.from, parent.to);
}

/**
 * Same idea for inline markers, but the boundaries do not count: a caret right
 * after `**bold**` is already writing outside the emphasis, so revealing the
 * markers there made them flash as the caret moved past the end.
 */
function parentStrictlyHoldsCursor(view: EditorView, node: SyntaxNode) {
  const parent = node.parent;
  const from = parent ? parent.from : node.from;
  const to = parent ? parent.to : node.to;
  return view.state.selection.ranges.some((range) => insideStrictly(range.head, from, to));
}

function showSyntax(build: PreviewBuild, from: number, to: number) {
  if (to <= from) return;
  build.decos.push(Decoration.mark({ class: "cm-md-syntax" }).range(from, to));
}

function markSpan(build: PreviewBuild, from: number, to: number, className: string) {
  if (to <= from) return;
  build.decos.push(Decoration.mark({ class: className }).range(from, to));
}

function decorateRange(
  view: EditorView,
  from: number,
  to: number,
  focusMode: boolean,
  activeBlock: { from: number; to: number } | null,
  build: PreviewBuild,
) {
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (isCovered(build, node.from, node.to)) return false;
      const name = node.name;

      if (/^ATXHeading\d$/.test(name) || /^SetextHeading\d$/.test(name)) {
        const line = view.state.doc.lineAt(node.from);
        addLineClass(build, line.number, `cm-md-heading cm-md-${name}`);
      }

      if (name === "Blockquote") {
        const start = view.state.doc.lineAt(node.from).number;
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        // Lazy continuation lines carry no `>` of their own, so fall back to the
        // depth of the block's first line.
        const blockDepth = quoteDepth(view.state.doc.line(start).text);
        for (let n = start; n <= end; n += 1) {
          const depth = quoteDepth(view.state.doc.line(n).text) || blockDepth;
          addLineClass(
            build,
            n,
            depth >= 2 ? `cm-md-quote cm-md-quote-${Math.min(depth, 6)}` : "cm-md-quote",
          );
        }
      }

      if (name === "FencedCode" || name === "IndentedCode") {
        const start = view.state.doc.lineAt(node.from);
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        const info = start.text.replace(/^ {0,3}`{3,}/, "").trim().split(/\s+/)[0] ?? "";
        const cursorIn = rangeHasCursor(view, node.from, node.to);
        const kind = diagramKind(info);
        if (name === "FencedCode" && kind && !cursorIn) {          const bodyFrom = start.number < end.number ? view.state.doc.line(start.number + 1).from : start.to;
          const bodyTo = end.number > start.number ? view.state.doc.line(end.number).from : end.to;
          const source = view.state.doc.sliceString(bodyFrom, Math.max(bodyFrom, bodyTo)).replace(/\n$/, "");
          const deco = Decoration.replace({ widget: new DiagramWidget(kind, source) }).range(start.from, start.to);
          build.decos.push(deco);
          build.atomic.push(deco);
          for (let n = start.number + 1; n <= end.number; n += 1) {
            const line = view.state.doc.line(n);
            const sink = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
            build.decos.push(sink);
            build.atomic.push(sink);
            addLineClass(build, n, "cm-md-sink");
            build.hidden.push(line.from);
          }
          build.covered.push({ from: start.from, to: end.to });
          spanLabel(build, view.state.doc, start.number, end.number);
          return false;
        }
        // Editing a diagram fence keeps the source and shows the rendered result
        // underneath, the same way an edited `$$` block does.
        if (name === "FencedCode" && kind && cursorIn) {
          const bodyFrom = start.number < end.number ? view.state.doc.line(start.number + 1).from : start.to;
          const bodyTo = end.number > start.number ? view.state.doc.line(end.number).from : end.to;
          const source = view.state.doc.sliceString(bodyFrom, Math.max(bodyFrom, bodyTo)).replace(/\n$/, "");
          if (source.trim().length > 0) {
            // Inline widget: block widgets may not come from a view plugin.
            build.decos.push(
              Decoration.widget({
                widget: new DiagramWidget(kind, source, true, bodyFrom),
                side: 1,
              }).range(end.to),
            );
          }
        }
        // ```html stays a code block: the author asked for its source. Only tags
        // written directly in the document are rendered (see the HTMLBlock arm).
        
        for (let n = start.number; n <= end.number; n += 1) {
          const line = view.state.doc.line(n);
          if (line.from > to || line.to < from) continue;
          addLineClass(build, n, "cm-md-codeblock");
          if (name === "FencedCode" && /^`{3,}/.test(line.text.trim()) && !lineHasCursor(view, n)) {
            const widget = n === start.number ? new FenceLangWidget(info) : collapseWidget;
            const deco = Decoration.replace({ widget }).range(line.from, line.to);
            build.decos.push(deco);
            build.atomic.push(deco);
            build.covered.push({ from: line.from, to: line.to });
          }
        }
        build.covered.push({ from: node.from, to: node.to });
      }

      if (name === "Table") {
        const start = view.state.doc.lineAt(node.from);
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        const source = view.state.doc.sliceString(start.from, end.to);
        const head = Decoration.replace({
          widget: new TableWidget(source, start.from),
        }).range(start.from, start.to);
        build.decos.push(head);
        build.atomic.push(head);
        for (let n = start.number + 1; n <= end.number; n += 1) {
          const line = view.state.doc.line(n);
          const deco = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
          build.decos.push(deco);
          build.atomic.push(deco);
          addLineClass(build, n, "cm-md-sink");
          build.hidden.push(line.from);
        }
        build.covered.push({ from: start.from, to: end.to });
        spanLabel(build, view.state.doc, start.number, end.number);
        return false;
      }

      if (name === "HTMLBlock") {
        // A missing blank line makes the HTML block swallow the fences below it;
        // render whatever can be recovered instead of leaving raw text.
        const doc = view.state.doc;
        const startLine = doc.lineAt(node.from);
        const endLine = doc.lineAt(Math.min(node.to, doc.length));
        const recovered = recoverFencesInHtmlBlock(view, build, startLine, endLine);
        if (recovered) {
          addLineClass(build, startLine.number, "cm-md-html-source");
        } else if (!rangeHasCursor(view, node.from, node.to)) {
          // Raw tags written directly in the document render for real, through
          // the allow-list sanitizer. Nothing that sanitizes down to empty (a
          // comment, an unknown tag) is replaced, or the block would vanish.
          const source = doc.sliceString(startLine.from, endLine.to);
          if (sanitizeHtml(source).trim().length > 0 && source.length <= 20_000) {
            const deco = Decoration.replace({
              widget: new HtmlBlockWidget(source, startLine.from + 1),
            }).range(startLine.from, startLine.to);
            build.decos.push(deco);
            build.atomic.push(deco);
            for (let n = startLine.number + 1; n <= endLine.number; n += 1) {
              const line = doc.line(n);
              const sink = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
              build.decos.push(sink);
              build.atomic.push(sink);
              addLineClass(build, n, "cm-md-sink");
              build.hidden.push(line.from);
            }
            build.covered.push({ from: startLine.from, to: endLine.to });
            spanLabel(build, doc, startLine.number, endLine.number);
          }
        }
      }

      if (name === "HorizontalRule") {
        const line = view.state.doc.lineAt(node.from);
        if (!lineHasCursor(view, line.number)) {
          const deco = Decoration.replace({ widget: hrWidget }).range(line.from, line.to);
          build.decos.push(deco);
          build.atomic.push(deco);
          build.covered.push({ from: line.from, to: line.to });
          return false;
        }
      }

      if (name === "HeaderMark") {
        const line = view.state.doc.lineAt(node.from);
        if (/^\s*[-=]+\s*$/.test(line.text)) {
          if (!lineHasCursor(view, line.number)) {
            const deco = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
            build.decos.push(deco);
            build.atomic.push(deco);
            addLineClass(build, line.number, "cm-md-sink");
            build.hidden.push(line.from);
            // A setext heading eats its underline line; label the text line
            // with the whole source span so the gutter has no hole.
            spanLabel(build, view.state.doc, line.number - 1, line.number);
          }
        } else {
          let end = node.to;
          while (view.state.doc.sliceString(end, end + 1) === " ") end += 1;
          if (parentHoldsCursor(view, node.node)) showSyntax(build, node.from, end);
          else hide(build, node.from, end);
        }
      }

      if (name === "QuoteMark") {
        let end = node.to;
        if (view.state.doc.sliceString(end, end + 1) === " ") end += 1;
        const lineNo = view.state.doc.lineAt(node.from).number;
        if (lineHasCursor(view, lineNo)) showSyntax(build, node.from, end);
        else hide(build, node.from, end);
      }

      if (name === "ListMark") {
        const text = view.state.doc.sliceString(node.from, node.to);
        let end = node.to;
        if (view.state.doc.sliceString(end, end + 1) === " ") end += 1;
        if (rangeHasCursor(view, node.from, end)) {
          showSyntax(build, node.from, end);
        } else if (listItemHasTask(node)) {
          hide(build, node.from, end);
        } else if (/^\d/.test(text)) {
          hide(build, node.from, node.to, new BulletWidget(text, "ordered"));
        } else {
          hide(build, node.from, node.to, new BulletWidget("•", "bullet"));
        }
      }

      if (
        name === "EmphasisMark" ||
        name === "StrikethroughMark" ||
        name === "HighlightMark" ||
        name === "CodeMark" ||
        name === "LinkMark" ||
        name === "CodeInfo"
      ) {
        if (parentStrictlyHoldsCursor(view, node.node)) showSyntax(build, node.from, node.to);
        else hide(build, node.from, node.to);
      }

      if (name === "URL") {
        if (parentHoldsCursor(view, node.node)) showSyntax(build, node.from, node.to);
        else hide(build, node.from, node.to);
      }

      if (name === "StrongEmphasis") {
        markSpan(build, node.from, node.to, "cm-md-strong");
      }
      if (name === "Emphasis") {
        // `***text***` is a StrongEmphasis wrapping an Emphasis; it must get
        // both marks, otherwise bold-italic rendered as plain bold.
        markSpan(build, node.from, node.to, "cm-md-em");
      }
      if (name === "Strikethrough") {
        markSpan(build, node.from, node.to, "cm-md-strike");
      }
      if (name === "Highlight") {
        markSpan(build, node.from, node.to, "cm-md-highlight");
      }
      if (name === "InlineCode") {
        markSpan(build, node.from, node.to, "cm-md-code");
      }
      if (name === "Link") {
        markSpan(build, node.from, node.to, "cm-md-link");
      }

      if (name === "Image") {
        const suffix = imageSuffix(view.state.doc, node.to);
        if (!rangeHasCursor(view, node.from, suffix.end)) {
          const raw = view.state.doc.sliceString(node.from, node.to);
          const parsed = imageUrl(raw);
          if (parsed.src) {
            const deco = Decoration.replace({
              widget: new ImageWidget(parsed.src, parsed.alt, suffix.width),
            }).range(node.from, suffix.end);
            build.decos.push(deco);
            build.atomic.push(deco);
            build.covered.push({ from: node.from, to: suffix.end });
          }
        }
        return false;
      }

      if (name === "TaskMarker") {
        const text = view.state.doc.sliceString(node.from, node.to);
        const checked = /\[x\]/i.test(text);
        const deco = Decoration.replace({
          widget: new TaskCheckboxWidget(checked, node.from, node.to),
        }).range(node.from, node.to);
        build.decos.push(deco);
        build.atomic.push(deco);
      }

      if (MARK_NAMES.has(name)) return false;
      return true;
    },
  });

  if (focusMode && activeBlock) {
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = startLine; n <= endLine; n += 1) {
      const line = view.state.doc.line(n);
      if (line.to < activeBlock.from || line.from > activeBlock.to) {
        addLineClass(build, n, "cm-md-dim");
      }
    }
  }
}

function gutterMarkers(build: PreviewBuild): RangeSet<GutterMarker> {  const ranges: Range<GutterMarker>[] = [];
  for (const [from, label] of build.labels) {
    ranges.push(new SpanLabel(label).range(from));
  }
  for (const from of new Set(build.hidden)) {
    if (build.labels.has(from)) continue;
    ranges.push(hiddenLineNumber.range(from));
  }
  if (ranges.length === 0) return RangeSet.empty;
  return RangeSet.of(ranges, true);
}

/** Record the source-line range of a collapsed block on its first line. */
function spanLabel(build: PreviewBuild, doc: Text, firstLine: number, lastLine: number) {
  if (lastLine <= firstLine || firstLine < 1) return;
  // The gutter is padded to `digits + 4` characters (see lineNumbers in
  // createEditor). A wider label would be clipped by `overflow: hidden`.
  const budget = String(doc.lines).length + 4;
  const full = `${firstLine}–${lastLine}`;
  // `start+count` stays inside the budget for spans that cross a digit boundary
  // (e.g. 9999–10000), where the full range cannot fit.
  const compact = `${firstLine}+${lastLine - firstLine + 1}`;
  const label = full.length <= budget ? full : compact;
  if (label.length > budget) return;
  build.labels.set(doc.line(firstLine).from, label);
}

const emptyPreview = {
  decorations: Decoration.none,
  atomic: Decoration.none,
  hidden: RangeSet.empty as RangeSet<GutterMarker>,
};

function buildDecorations(view: EditorView): {
  decorations: DecorationSet;
  atomic: DecorationSet;
  hidden: RangeSet<GutterMarker>;
} {
  if (view.state.field(sourceModeField)) return emptyPreview;

  const focusMode = view.state.field(focusModeField);
  const activeBlock = focusMode ? findActiveBlock(view) : null;
  const build: PreviewBuild = {
    decos: [],
    atomic: [],
    lineClasses: new Map(),
    covered: [],
    hidden: [],
    labels: new Map(),
  };

  const front = frontMatterRange(view);
  // Never decorate inside the front matter: those lines are handled below as a
  // whole, and letting the generic pass touch them produced stray horizontal
  // rules and overlapping decorations.
  const skipTo = front ? front.close.to : -1;
  for (const range of view.visibleRanges) {
    const from = Math.max(range.from, skipTo);
    if (from > range.to) continue;
    decorateRange(view, from, range.to, focusMode, activeBlock, build);
    decorateMath(view, from, range.to, build);
    decorateToc(view, from, range.to, build);
  }
  if (front) decorateFrontMatter(view, build, front);

  for (const [lineNo, classes] of build.lineClasses) {
    const line = view.state.doc.line(lineNo);
    build.decos.push(Decoration.line({ class: [...classes].join(" ") }).range(line.from));
  }

  try {
    return {
      decorations: Decoration.set(build.decos, true),
      atomic: Decoration.set(build.atomic, true),
      hidden: gutterMarkers(build),
    };
  } catch (error) {
    console.error("live preview decorations skipped", error);
    return emptyPreview;
  }
}

/** Locate a leading YAML block, independent of where the caret is. */
function frontMatterRange(view: EditorView) {
  const doc = view.state.doc;
  const limit = Math.min(doc.lines, 101);
  const lines: string[] = [];
  for (let n = 1; n <= limit; n += 1) lines.push(doc.line(n).text);
  const found = frontMatterLines(lines);
  if (!found) return null;
  return { found, open: doc.line(found.open), close: doc.line(found.close) };
}

/**
 * Front matter is metadata, never prose: it is either folded into a chip or
 * shown as raw monospace text while the caret is inside. Either way the rest of
 * the preview never decorates those lines — otherwise the `---` delimiters turn
 * into horizontal rules and YAML lines get heading/bold styling.
 */
function decorateFrontMatter(
  view: EditorView,
  build: PreviewBuild,
  front: NonNullable<ReturnType<typeof frontMatterRange>>,
) {
  const doc = view.state.doc;
  const { found, open, close } = front;
  if (isCovered(build, open.from, close.to)) return;

  if (rangeHasCursor(view, open.from, close.to)) {
    for (let n = found.open; n <= found.close; n += 1) {
      addLineClass(build, n, "cm-md-frontmatter-source");
    }
    build.covered.push({ from: open.from, to: close.to });
    return;
  }

  const head = Decoration.replace({
    widget: new FrontMatterWidget(found.close - found.open - 1, open.from),
  }).range(open.from, open.to);
  build.decos.push(head);
  build.atomic.push(head);
  for (let n = found.open + 1; n <= found.close; n += 1) {
    const line = doc.line(n);
    const sink = Decoration.replace({ widget: collapseWidget }).range(line.from, line.to);
    build.decos.push(sink);
    build.atomic.push(sink);
  }
  build.covered.push({ from: open.from, to: close.to });
  spanLabel(build, doc, found.open, found.close);
}

/** `[TOC]` becomes a clickable outline; the caret on the line keeps the source. */
function decorateToc(view: EditorView, from: number, to: number, build: PreviewBuild) {
  const doc = view.state.doc;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(Math.min(to, doc.length)).number;
  for (let n = first; n <= last; n += 1) {
    const line = doc.line(n);
    if (line.text.trim().toLowerCase() !== "[toc]") continue;
    if (isCovered(build, line.from, line.to)) continue;
    if (rangeHasCursor(view, line.from, line.to)) continue;
    const deco = Decoration.replace({
      widget: new TocWidget(line.from, view.state.doc.length),
    }).range(line.from, line.to);
    build.decos.push(deco);
    build.atomic.push(deco);
    build.covered.push({ from: line.from, to: line.to });
  }
}

function findActiveBlock(view: EditorView): { from: number; to: number } | null {
  const head = view.state.selection.main.head;
  let found: { from: number; to: number } | null = null;
  syntaxTree(view.state).iterate({
    from: head,
    to: head,
    enter(node) {
      if (
        node.name === "Paragraph" ||
        /^ATXHeading/.test(node.name) ||
        /^SetextHeading/.test(node.name) ||
        node.name === "Blockquote" ||
        node.name === "FencedCode" ||
        node.name === "BulletList" ||
        node.name === "OrderedList" ||
        node.name === "ListItem" ||
        node.name === "Table"
      ) {
        found = { from: node.from, to: node.to };
      }
    },
  });
  if (found) return found;
  const line = view.state.doc.lineAt(head);
  return { from: line.from, to: line.to };
}

/**
 * Live preview that stays off the main-thread critical path on huge docs:
 * - never calls forceParsing (that froze 100k-line scroll/close)
 * - on large docs, rebuild only after scroll idle
 * - uses whatever syntax tree CodeMirror already has for the viewport
 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    sinkMarkers: RangeSet<GutterMarker>;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingIdle = false;
    private sinkQueued = false;

    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
      this.sinkMarkers = built.hidden;
      this.scheduleSinkSync(view);
    }

    update(update: ViewUpdate) {
      const source = update.state.field(sourceModeField);
      if (source) {
        this.clearIdle();
        this.decorations = Decoration.none;
        this.atomic = Decoration.none;
        this.sinkMarkers = RangeSet.empty;
        this.scheduleSinkSync(update.view);
        return;
      }

      const modesChanged =
        update.startState.field(sourceModeField) !== source ||
        update.startState.field(focusModeField) !== update.state.field(focusModeField);
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);

      if (this.pendingIdle) {
        this.pendingIdle = false;
        this.apply(update.view);
        return;
      }

      const refreshed = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(refreshPreview)),
      );
      if (update.docChanged || update.selectionSet || modesChanged || treeChanged || refreshed) {
        this.clearIdle();
        this.apply(update.view);
        return;
      }

      if (update.viewportChanged) {
        if (update.state.doc.lines >= LARGE_DOC_LINES) {
          this.scheduleIdle(update.view);
          return;
        }
        this.apply(update.view);
      }
    }

    private apply(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
      this.sinkMarkers = built.hidden;
      this.scheduleSinkSync(view);
    }

    private scheduleSinkSync(view: EditorView) {
      const current = view.state.field(hiddenLineNumberField);
      if (RangeSet.eq([current], [this.sinkMarkers])) return;
      if (this.sinkQueued) return;
      this.sinkQueued = true;
      queueMicrotask(() => {
        this.sinkQueued = false;
        if (!view.dom.isConnected) return;
        const latest = view.state.field(hiddenLineNumberField);
        if (RangeSet.eq([latest], [this.sinkMarkers])) return;
        view.dispatch({ effects: setHiddenLineNumbers.of(this.sinkMarkers) });
      });
    }

    private scheduleIdle(view: EditorView) {
      if (this.idleTimer != null) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.pendingIdle = true;
        view.dispatch({});
      }, SCROLL_IDLE_MS);
    }

    private clearIdle() {
      if (this.idleTimer != null) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      this.pendingIdle = false;
    }

    destroy() {
      this.clearIdle();
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/** Inner quote bars, one per 12px period; the outermost bar is the border. */
const QUOTE_BARS =
  "repeating-linear-gradient(to right, var(--quote-border) 0 3px, transparent 3px 12px)";

export const livePreviewTheme = EditorView.baseTheme({
  ".cm-md-heading": { fontWeight: "700", lineHeight: "1.35" },
  ".cm-md-ATXHeading1, .cm-md-SetextHeading1": {
    color: "var(--h1)",
    fontSize: "var(--h1-size)",
    paddingTop: "0.45em",
    paddingBottom: "0.1em",
  },
  ".cm-md-ATXHeading2, .cm-md-SetextHeading2": {
    color: "var(--h2)",
    fontSize: "var(--h2-size)",
    paddingTop: "0.4em",
  },
  ".cm-md-ATXHeading3": { color: "var(--h3)", fontSize: "var(--h3-size)", paddingTop: "0.3em" },
  ".cm-md-ATXHeading4, .cm-md-ATXHeading5, .cm-md-ATXHeading6": {
    color: "var(--h4)",
    fontSize: "var(--h4-size)",
  },
  ".cm-md-strong": { color: "var(--strong)", fontWeight: "700" },
  // CJK text has no true italic face, so `italic` falls back to a ~14deg
  // synthetic slant that reads as barely slanted. Ask for a stronger angle; if
  // `oblique <angle>` is unsupported the declaration is dropped at parse time
  // and the plain `italic` above still applies.
  ".cm-md-em": { color: "var(--em)", fontStyle: "italic" },
  ".cm-md-em.cm-md-em": { fontStyle: "oblique 20deg" },
  ".cm-md-strike": { textDecoration: "line-through", color: "var(--muted)" },
  ".cm-md-highlight": {
    backgroundColor: "var(--highlight)",
    borderRadius: "2px",
  },
  ".cm-md-code": {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
    backgroundColor: "var(--code-bg)",
    color: "var(--code-ink)",
    borderRadius: "3px",
    padding: "0 3px",
  },
  ".cm-md-syntax": {
    color: "var(--faint)",
    fontWeight: "500",
    fontSize: "0.72em",
    fontFamily: 'Consolas, "Courier New", monospace',
  },
  ".cm-md-link": { color: "var(--link)", textDecoration: "underline" },
  ".cm-mod-held .cm-md-link": { cursor: "pointer" },
  ".cm-md-quote": {
    color: "var(--quote)",
    borderLeft: "3px solid var(--quote-border)",
    paddingLeft: "12px",
  },
  // One bar per nesting level: the border is the outermost bar and the gradient
  // tile draws the inner ones, so `> > a` no longer looks like `> a`.
  ".cm-md-quote-2": {
    paddingLeft: "24px",
    backgroundImage: QUOTE_BARS,
    backgroundSize: "12px 100%",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-md-quote-3": {
    paddingLeft: "36px",
    backgroundImage: QUOTE_BARS,
    backgroundSize: "24px 100%",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-md-quote-4": {
    paddingLeft: "48px",
    backgroundImage: QUOTE_BARS,
    backgroundSize: "36px 100%",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-md-quote-5": {
    paddingLeft: "60px",
    backgroundImage: QUOTE_BARS,
    backgroundSize: "48px 100%",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-md-quote-6": {
    paddingLeft: "72px",
    backgroundImage: QUOTE_BARS,
    backgroundSize: "60px 100%",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-md-codeblock": {
    backgroundColor: "var(--code-block)",
    color: "var(--code-block-ink)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
  },
  ".cm-md-table-source": {
    fontFamily: 'Consolas, "Courier New", ui-monospace, monospace',
    fontSize: "0.92em",
    backgroundColor: "var(--table-stripe)",
  },
  ".cm-md-table-widget": {
    display: "inline-table",
    width: "100%",
    borderCollapse: "collapse",
    margin: "0.45em 0",
    fontSize: "0.95em",
    verticalAlign: "top",
  },
  ".cm-md-table-widget th, .cm-md-table-widget td": {
    border: "1px solid var(--table-border)",
    padding: "6px 10px",
    verticalAlign: "top",
  },
  ".cm-md-table-widget th": {
    backgroundColor: "var(--table-head)",
    color: "var(--table-head-ink)",
    fontWeight: "650",
  },
  ".cm-md-table-widget tbody tr:nth-child(even) td": {
    backgroundColor: "var(--table-stripe)",
  },
  ".cm-md-table-widget th:focus, .cm-md-table-widget td:focus": {
    outline: "2px solid var(--accent)",
    backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
  },
  ".cm-md-hr-widget": {
    display: "block",
    border: "none",
    borderTop: "1px solid var(--rule)",
    margin: "0.9em 0",
  },
  ".cm-md-sink": {
    display: "block",
    height: "0",
    minHeight: "0",
    overflow: "hidden",
    lineHeight: "0",
    fontSize: "0",
    padding: "0",
    margin: "0",
  },
  ".cm-md-sink .cm-widgetBuffer, .cm-md-sink .cm-md-collapse": {
    display: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    overflow: "hidden",
  },
  ".cm-md-collapse": {
    display: "inline-block",
    width: "0",
    height: "0",
    overflow: "hidden",
  },
  ".cm-md-bullet, .cm-md-ol": {
    color: "var(--marker)",
    fontWeight: "700",
  },
  ".cm-md-ol": { fontVariantNumeric: "tabular-nums" },
  ".cm-md-fence-wrap": {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  },
  ".cm-md-fence-copy": {
    color: "var(--faint)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "11px",
    border: "none",
    background: "transparent",
    padding: "0 4px",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms ease",
  },
  ".cm-md-fence-wrap:hover .cm-md-fence-copy, .cm-md-fence-wrap:focus-within .cm-md-fence-copy":
    {
      opacity: "1",
    },
  ".cm-md-fence": {
    color: "var(--faint)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "12px",
    border: "none",
    background: "transparent",
    padding: "0 4px",
    cursor: "pointer",
  },
  ".cm-md-lang-menu": {
    position: "absolute",
    zIndex: "30",
    maxHeight: "240px",
    overflow: "auto",
    background: "var(--menu)",
    border: "1px solid var(--line)",
    borderRadius: "8px",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
    padding: "4px",
    minWidth: "140px",
  },
  ".cm-md-lang-item": {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: "4px 10px",
    cursor: "pointer",
    color: "var(--ink)",
    fontSize: "13px",
  },
  ".cm-md-lang-item:hover": { background: "var(--hover)" },
  ".cm-md-math": { color: "var(--math)", cursor: "text" },
  // Source of the `$$` block being edited: a monospace card that visually pairs
  // with the rendered preview shown right below it.
  ".cm-md-math-source": {
    backgroundColor: "var(--math-bg)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
  },
  // The live preview of a `$$` block being edited rides at the end of the
  // closing fence; display:block makes it occupy its own row there.
  ".cm-md-math-preview": {
    display: "block",
    marginTop: "0.35em",
  },
  // Bubble under an inline formula being edited: zero-sized anchor, absolutely
  // positioned body, so the line never reflows.
  ".cm-md-math-bubble": {
    position: "relative",
    display: "inline-block",
    width: "0",
    height: "0",
    verticalAlign: "baseline",
  },
  ".cm-md-math-bubble-body": {
    position: "absolute",
    left: "0",
    top: "1.1em",
    zIndex: 20,
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "8px",
    background: "var(--ink)",
    color: "var(--paper)",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.28)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    fontSize: "0.95em",
  },
  ".cm-md-math-bubble-body .katex": { color: "inherit" },
  // Folded YAML header
  ".cm-md-frontmatter": {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 8px",
    borderRadius: "999px",
    border: "1px solid var(--line)",
    background: "var(--code-block)",
    color: "var(--muted)",
    fontSize: "11px",
    cursor: "text",
  },
  // While the caret is inside the block, the metadata reads as plain text: no
  // heading sizes, no thematic-break rules.
  ".cm-md-frontmatter-source": {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
    color: "var(--muted)",
    backgroundColor: "var(--code-block)",
  },
  // Rendered ```html block: plain document content, no frame of its own.
  ".cm-md-html-block": {
    display: "block",
    margin: "0.2em 0",
  },
  // Rendered diagram shown under a fence that is being edited.
  ".cm-md-diagram-preview": {
    display: "block",
    marginTop: "0.35em",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "var(--math-bg)",
  },
  // Fence recovered from inside an HTML block (missing blank line): plain code
  // styling, since the normal highlighted path cannot be reused there.
  ".cm-md-code-fallback": {
    margin: "0.2em 0",
    padding: "8px 10px",
    borderRadius: "6px",
    background: "var(--code-block)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  },
  // `[TOC]`
  ".cm-md-toc": {
    display: "block",
    margin: "0.4em 0",
    padding: "6px 8px",
    border: "1px solid var(--line)",
    borderRadius: "8px",
    background: "var(--code-block)",
  },
  ".cm-md-toc-item": {
    display: "block",
    width: "100%",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--ink)",
    textAlign: "left",
    fontSize: "12px",
    lineHeight: "1.9",
    cursor: "pointer",
  },
  ".cm-md-toc-item:hover": { background: "var(--hover)" },
  ".cm-md-math .katex": { color: "inherit" },
  ".cm-md-math-block": {
    display: "block",
    overflowX: "auto",
    margin: "0.35em 0",
    padding: "0.35em 0.7em",
    borderRadius: "8px",
    backgroundColor: "var(--math-bg)",
  },
  ".cm-md-image": {
    display: "inline-block",
    position: "relative",
    maxWidth: "100%",
    margin: "0.35em 0",
    verticalAlign: "top",
  },
  ".cm-md-image img": {
    display: "block",
    maxWidth: "100%",
    height: "auto",
  },
  ".cm-md-image-missing": {
    color: "var(--faint)",
    fontSize: "13px",
  },
  ".cm-md-image-handle": {
    position: "absolute",
    right: "0",
    bottom: "0",
    width: "14px",
    height: "14px",
    borderRadius: "3px",
    background: "var(--accent, #9a3412)",
    cursor: "ew-resize",
  },
  ".cm-md-mermaid": {
    display: "block",
    margin: "0.5em 0",
    padding: "8px",
    overflowX: "auto",
    background: "var(--paper, #f7f5f0)",
    cursor: "pointer",
  },
  ".cm-md-mermaid svg, .cm-md-mermaid img": { maxWidth: "100%", height: "auto" },
  ".cm-md-mermaid .vega-embed": { width: "100%" },
  ".cm-md-diagram-note": {
    marginTop: "4px",
    color: "var(--faint)",
    fontSize: "11px",
    lineHeight: "1.4",
  },
  ".cm-md-table-wrap": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "top",
    // Anchor for the floating toolbar.
    position: "relative",
  },
  // Both toolbars float above the block instead of taking part in the layout:
  // an in-flow bar made the whole table grow the moment the caret entered it,
  // shifting everything below.
  //
  // They stay rendered but invisible instead of `display: none` so the buttons
  // remain in the Tab order; `:focus-within` then reveals them for keyboard
  // users, who cannot hover.
  ".cm-md-table-left, .cm-md-table-chrome": {
    display: "flex",
    opacity: "0",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    // Sit entirely above the table rather than straddling its top border.
    transform: "translateY(-100%)",
    // Hover bridge: keeps the toolbar reachable across the gap between the
    // buttons and the table's top edge (it is part of the wrap's box).
    paddingBottom: "4px",
    zIndex: "14",
    gap: "4px",
    alignItems: "center",
    transition: "opacity 120ms ease",
  },
  ".cm-md-table-left": { left: "0" },
  ".cm-md-table-chrome": { right: "8px" },
  // Revealed only while a cell has focus (or the menu is open) — hovering must
  // not pop them up, because that made an idle table look busy and left it
  // unclear which column the alignment buttons would apply to.
  ".cm-md-table-wrap:focus-within .cm-md-table-left, .cm-md-table-wrap.cm-md-table-open .cm-md-table-left, .cm-md-table-wrap:focus-within .cm-md-table-chrome, .cm-md-table-wrap.cm-md-table-open .cm-md-table-chrome":
    {
      opacity: "1",
      pointerEvents: "auto",
    },
  ".cm-md-table-align, .cm-md-table-action": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "24px",
    padding: "0",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    background: "var(--menu)",
    color: "var(--muted)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(28,25,23,0.10)",
  },
  ".cm-md-table-align.active": {
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
  ".cm-md-table-align svg, .cm-md-table-action svg": { display: "block" },
  ".cm-md-table-align:focus-visible, .cm-md-table-action:focus-visible, .cm-md-table-more:focus-visible, .cm-md-table-menu-item:focus-visible, .cm-md-cell:focus-visible":
    {
      outline: "2px solid var(--accent)",
      outlineOffset: "1px",
    },
  ".cm-md-table-align:hover, .cm-md-table-action:hover, .cm-md-table-more:hover": {
    color: "var(--ink)",
    background: "var(--hover)",
  },
  ".cm-md-table-more": {
    height: "24px",
    padding: "0 8px",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    background: "var(--menu)",
    color: "var(--muted)",
    cursor: "pointer",
    fontSize: "11px",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(28,25,23,0.10)",
  },
  ".cm-md-table-menu": {
    position: "absolute",
    top: "100%",
    right: "0",
    marginTop: "2px",
    minWidth: "216px",
    padding: "4px",
    border: "1px solid var(--line)",
    borderRadius: "8px",
    background: "var(--menu)",
    boxShadow: "0 10px 24px rgba(28,25,23,0.16)",
    zIndex: "15",
  },
  ".cm-md-table-menu-item": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    width: "100%",
    height: "28px",
    padding: "0 8px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--ink)",
    fontSize: "12px",
    textAlign: "left",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ".cm-md-table-menu-item:hover": { background: "var(--hover)" },
  ".cm-md-table-menu-keys": { color: "var(--faint)", fontSize: "11px" },
  ".cm-md-table-menu-sep": {
    border: "none",
    borderTop: "1px solid var(--line)",
    margin: "4px 2px",
  },
  ".cm-task-checkbox": {
    width: "14px",
    height: "14px",
    margin: "0 6px 0 0",
    verticalAlign: "middle",
    cursor: "pointer",
  },
  ".cm-md-dim": { opacity: "0.28" },
});
