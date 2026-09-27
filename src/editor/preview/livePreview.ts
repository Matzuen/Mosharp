import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";
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
import { focusModeField, sourceModeField } from "./modes";

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

class TableWidget extends WidgetType {
  dom: HTMLElement | null = null;

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

    const thead = document.createElement("thead");
    thead.appendChild(renderRow(header, aligns, "th", 0, commitAt));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    let visualRow = 1;
    for (let i = bodyStart; i < lines.length; i += 1) {
      if (isDelimiterRow(lines[i])) continue;
      tbody.appendChild(renderRow(splitCells(lines[i]), aligns, "td", visualRow, commitAt));
      visualRow += 1;
    }
    table.appendChild(tbody);
    const chrome = document.createElement("div");
    chrome.className = "cm-md-table-chrome";
    const actions: Array<[string, TableOp]> = [
      ["加一行", "add-row"],
      ["删一行", "del-row"],
      ["加一列", "add-col"],
      ["删一列", "del-col"],
    ];
    for (const [label, op] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-md-table-op";
      button.textContent = label;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pos = view.posAtDOM(wrap);
        if (pos == null) return;
        queueMicrotask(() => mutateTable(view, pos, op));
      });
      chrome.appendChild(button);
    }
    wrap.append(table, chrome);
    this.dom = wrap;
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function splitCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function alignment(cell: string): "left" | "center" | "right" {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function renderRow(
  cells: string[],
  aligns: Array<"left" | "center" | "right">,
  tag: "th" | "td",
  visualRow: number,
  onCommit: (row: number, col: number, text: string) => void,
) {
  const row = document.createElement("tr");
  for (let i = 0; i < cells.length; i += 1) {
    const cell = document.createElement(tag);
    const original = cells[i];
    cell.textContent = original;
    cell.contentEditable = "true";
    cell.spellcheck = false;
    cell.style.textAlign = aligns[i] ?? "left";
    cell.addEventListener("mousedown", (event) => event.stopPropagation());
    const commit = () => {
      const next = (cell.textContent ?? "").replace(/\n/g, " ").replace(/\|/g, "").trim();
      if (next !== original) onCommit(visualRow, i, next);
    };
    cell.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
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

type TableOp = "add-row" | "del-row" | "add-col" | "del-col";

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

function joinCells(cells: string[]) {
  return `| ${cells.join(" | ")} |`;
}

function mutateTable(view: EditorView, pos: number, op: TableOp) {
  const lines = tableLinesAt(view, pos);
  if (lines.length === 0) return;
  const rows = lines.map((line) => line.text);
  const hasDelimiter = rows[1] != null && isDelimiterRow(rows[1]);
  const cols = Math.max(1, splitCells(rows[0]).length);
  let next: string[] | null = null;
  if (op === "add-row") {
    next = [...rows, joinCells(Array.from({ length: cols }, () => " "))];
  } else if (op === "del-row") {
    const bodyStart = hasDelimiter ? 2 : 1;
    if (rows.length > bodyStart) next = rows.slice(0, -1);
  } else if (op === "add-col") {
    next = rows.map((row) => {
      const cells = splitCells(row);
      cells.push(isDelimiterRow(row) ? "---" : " ");
      return joinCells(cells);
    });
  } else if (cols > 1) {
    next = rows.map((row) => {
      const cells = splitCells(row);
      cells.pop();
      return joinCells(cells);
    });
  }
  if (!next) return;
  const insert = next.join("\n");
  const from = lines[0].from;
  const to = lines[lines.length - 1].to;
  if (insert === view.state.doc.sliceString(from, to)) return;
  view.dispatch({ changes: { from, to, insert } });
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
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: `| ${cells.join(" | ")} |` },
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
        for (let n = start; n <= end; n += 1) addLineClass(build, n, "cm-md-quote");
      }

      if (name === "FencedCode" || name === "IndentedCode") {
        const start = view.state.doc.lineAt(node.from);
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        const info = start.text.replace(/^ {0,3}`{3,}/, "").trim().split(/\s+/)[0] ?? "";
        const cursorIn = rangeHasCursor(view, node.from, node.to);
        const kind = diagramKind(info);
        if (name === "FencedCode" && kind && !cursorIn) {
          const bodyFrom = start.number < end.number ? view.state.doc.line(start.number + 1).from : start.to;
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
          return false;
        }
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
        return false;
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
        if (parentHoldsCursor(view, node.node)) showSyntax(build, node.from, node.to);
        else hide(build, node.from, node.to);
      }

      if (name === "URL") {
        if (parentHoldsCursor(view, node.node)) showSyntax(build, node.from, node.to);
        else hide(build, node.from, node.to);
      }

      if (name === "StrongEmphasis") {
        markSpan(build, node.from, node.to, "cm-md-strong");
      }
      if (name === "Emphasis" && node.node.parent?.name !== "StrongEmphasis") {
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

function hiddenMarkers(positions: number[]): RangeSet<GutterMarker> {
  if (positions.length === 0) return RangeSet.empty;
  const unique = [...new Set(positions)].sort((a, b) => a - b);
  return RangeSet.of(
    unique.map((from) => hiddenLineNumber.range(from)),
    true,
  );
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
  };

  for (const range of view.visibleRanges) {
    decorateRange(view, range.from, range.to, focusMode, activeBlock, build);
    decorateMath(view, range.from, range.to, build);
  }

  for (const [lineNo, classes] of build.lineClasses) {
    const line = view.state.doc.line(lineNo);
    build.decos.push(Decoration.line({ class: [...classes].join(" ") }).range(line.from));
  }

  try {
    return {
      decorations: Decoration.set(build.decos, true),
      atomic: Decoration.set(build.atomic, true),
      hidden: hiddenMarkers(build.hidden),
    };
  } catch (error) {
    console.error("live preview decorations skipped", error);
    return emptyPreview;
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
  ".cm-md-em": { color: "var(--em)", fontStyle: "italic" },
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
  ".cm-md-table-wrap": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "top",
  },
  ".cm-md-table-chrome": {
    display: "none",
    gap: "4px",
    marginTop: "4px",
  },
  ".cm-md-table-wrap:hover .cm-md-table-chrome, .cm-md-table-wrap:focus-within .cm-md-table-chrome": {
    display: "flex",
  },
  ".cm-md-table-op": {
    height: "26px",
    padding: "0 8px",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    background: "var(--menu)",
    color: "var(--ink)",
    cursor: "pointer",
    fontSize: "12px",
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
