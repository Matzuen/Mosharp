import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { focusModeField, sourceModeField } from "./modes";

/** Docs at/above this line count: decorate only after scroll settles. */
const LARGE_DOC_LINES = 8_000;
/** Wait after last scroll before rebuilding preview on large docs. */
const SCROLL_IDLE_MS = 72;

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
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      const next = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: next },
        selection: { anchor: Math.min(this.from + next.length, view.state.doc.length) },
      });
      view.focus();
    });
    return box;
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

function lineOf(state: EditorState, pos: number) {
  return state.doc.lineAt(pos).number;
}

function hideRange(
  from: number,
  to: number,
  cursorLines: Set<number>,
  state: EditorState,
  out: Range<Decoration>[],
) {
  if (to <= from) return;
  if (cursorLines.has(lineOf(state, from)) || cursorLines.has(lineOf(state, to - 1))) return;
  out.push(Decoration.replace({}).range(from, to));
}

function decorateRange(
  view: EditorView,
  from: number,
  to: number,
  cursorLines: Set<number>,
  focusMode: boolean,
  activeBlock: { from: number; to: number } | null,
  decos: Range<Decoration>[],
  seenLines: Set<number>,
) {
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      const name = node.name;

      if (/^ATXHeading\d$/.test(name) || /^SetextHeading\d$/.test(name)) {
        const line = view.state.doc.lineAt(node.from);
        if (!seenLines.has(line.number)) {
          seenLines.add(line.number);
          decos.push(
            Decoration.line({
              class: `cm-md-heading cm-md-${name}`,
            }).range(line.from),
          );
        }
      }

      if (name === "Blockquote") {
        const line = view.state.doc.lineAt(node.from);
        decos.push(Decoration.line({ class: "cm-md-quote" }).range(line.from));
      }

      if (name === "FencedCode" || name === "IndentedCode") {
        const start = view.state.doc.lineAt(node.from);
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        for (let n = start.number; n <= end.number; n += 1) {
          const line = view.state.doc.line(n);
          if (line.from > to || line.to < from) continue;
          decos.push(Decoration.line({ class: "cm-md-codeblock" }).range(line.from));
        }
      }

      if (name === "Table") {
        const start = view.state.doc.lineAt(node.from);
        const end = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        for (let n = start.number; n <= end.number; n += 1) {
          const line = view.state.doc.line(n);
          if (line.from > to || line.to < from) continue;
          decos.push(Decoration.line({ class: "cm-md-table" }).range(line.from));
        }
      }

      if (name === "HorizontalRule") {
        const line = view.state.doc.lineAt(node.from);
        decos.push(Decoration.line({ class: "cm-md-hr" }).range(line.from));
        if (!cursorLines.has(line.number)) {
          decos.push(Decoration.replace({ widget: hrWidget }).range(node.from, node.to));
        }
      }

      if (name === "HeaderMark") {
        let end = node.to;
        if (view.state.doc.sliceString(end, end + 1) === " ") end += 1;
        hideRange(node.from, end, cursorLines, view.state, decos);
      }

      if (
        name === "EmphasisMark" ||
        name === "StrikethroughMark" ||
        name === "HighlightMark" ||
        name === "CodeMark" ||
        name === "QuoteMark" ||
        name === "ListMark" ||
        name === "LinkMark" ||
        name === "TableDelimiter" ||
        name === "CodeInfo"
      ) {
        hideRange(node.from, node.to, cursorLines, view.state, decos);
      }

      if (name === "URL") {
        hideRange(node.from, node.to, cursorLines, view.state, decos);
      }

      if (name === "StrongEmphasis") {
        decos.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
      }
      if (name === "Emphasis" && node.node.parent?.name !== "StrongEmphasis") {
        decos.push(Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to));
      }
      if (name === "Strikethrough") {
        decos.push(Decoration.mark({ class: "cm-md-strike" }).range(node.from, node.to));
      }
      if (name === "Highlight") {
        decos.push(Decoration.mark({ class: "cm-md-highlight" }).range(node.from, node.to));
      }
      if (name === "InlineCode") {
        decos.push(Decoration.mark({ class: "cm-md-code" }).range(node.from, node.to));
      }
      if (name === "Link") {
        decos.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
      }

      if (name === "TaskMarker") {
        const text = view.state.doc.sliceString(node.from, node.to);
        const checked = /\[x\]/i.test(text);
        if (!cursorLines.has(lineOf(view.state, node.from))) {
          decos.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked, node.from, node.to),
            }).range(node.from, node.to),
          );
        }
      }

      return true;
    },
  });

  if (focusMode && activeBlock) {
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = startLine; n <= endLine; n += 1) {
      const line = view.state.doc.line(n);
      if (line.to < activeBlock.from || line.from > activeBlock.to) {
        decos.push(Decoration.line({ class: "cm-md-dim" }).range(line.from));
      }
    }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  if (view.state.field(sourceModeField)) return Decoration.none;

  const cursorLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    cursorLines.add(lineOf(view.state, range.head));
    cursorLines.add(lineOf(view.state, range.anchor));
  }

  const focusMode = view.state.field(focusModeField);
  const activeBlock = focusMode ? findActiveBlock(view) : null;
  const decos: Range<Decoration>[] = [];
  const seenLines = new Set<number>();

  // Only the visible ranges — never force-parse ahead of the language package.
  for (const { from, to } of view.visibleRanges) {
    decorateRange(view, from, to, cursorLines, focusMode, activeBlock, decos, seenLines);
  }

  return Decoration.set(decos, true);
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
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingIdle = false;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const source = update.state.field(sourceModeField);
      if (source) {
        this.clearIdle();
        this.decorations = Decoration.none;
        return;
      }

      const modesChanged =
        update.startState.field(sourceModeField) !== source ||
        update.startState.field(focusModeField) !== update.state.field(focusModeField);

      if (this.pendingIdle) {
        this.pendingIdle = false;
        this.decorations = buildDecorations(update.view);
        return;
      }

      if (update.docChanged) {
        this.clearIdle();
        this.decorations = this.decorations.map(update.changes);
        this.decorations = buildDecorations(update.view);
        return;
      }

      if (update.selectionSet || modesChanged) {
        this.clearIdle();
        this.decorations = buildDecorations(update.view);
        return;
      }

      if (update.viewportChanged) {
        if (update.state.doc.lines >= LARGE_DOC_LINES) {
          // Keep scrolling free; decorate once the thumb stops.
          this.scheduleIdle(update.view);
          return;
        }
        this.decorations = buildDecorations(update.view);
      }
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
  },
);

export const livePreviewTheme = EditorView.baseTheme({
  ".cm-md-heading": { fontWeight: "700", lineHeight: "1.35" },
  ".cm-md-ATXHeading1": { fontSize: "1.55em" },
  ".cm-md-ATXHeading2": { fontSize: "1.35em" },
  ".cm-md-ATXHeading3": { fontSize: "1.18em" },
  ".cm-md-ATXHeading4,.cm-md-ATXHeading5,.cm-md-ATXHeading6": { fontSize: "1.05em" },
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: "#78716c" },
  ".cm-md-highlight": {
    backgroundColor: "rgba(250, 204, 21, 0.45)",
    borderRadius: "2px",
  },
  ".cm-md-code": {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
    backgroundColor: "rgba(159, 18, 57, 0.08)",
    borderRadius: "3px",
  },
  ".cm-md-link": { color: "#1d4ed8", textDecoration: "underline" },
  ".cm-md-quote": {
    color: "#57534e",
    borderLeft: "3px solid #d6d3d1",
    paddingLeft: "10px",
  },
  ".cm-md-codeblock": {
    backgroundColor: "rgba(28, 25, 23, 0.04)",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.92em",
  },
  ".cm-md-table": {
    fontVariantNumeric: "tabular-nums",
    fontFamily: 'Consolas, "Courier New", ui-monospace, monospace',
    fontSize: "0.95em",
    backgroundColor: "rgba(28, 25, 23, 0.03)",
  },
  ".cm-md-hr-widget": {
    border: "none",
    borderTop: "1px solid #d6d3d1",
    margin: "0.8em 0",
  },
  ".cm-task-checkbox": {
    width: "14px",
    height: "14px",
    margin: "0 6px 0 0",
    verticalAlign: "middle",
    cursor: "pointer",
  },
  ".cm-md-dim": { opacity: 0.28 },
});
