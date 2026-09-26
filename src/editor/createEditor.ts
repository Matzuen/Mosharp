import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { markdownHighlightStyle } from "./highlight";
import { HighlightExtension } from "./preview/highlightExt";
import { linkClickHandler } from "./preview/links";
import { livePreviewPlugin, livePreviewTheme } from "./preview/livePreview";
import {
  focusModeField,
  setFocusMode,
  setSourceMode,
  setTypewriterMode,
  sourceModeField,
  typewriterModeField,
  type PreviewModes,
} from "./preview/modes";
import {
  paragraphGutter,
  paragraphGutterRefresh,
  paragraphMenuTheme,
} from "./preview/paragraphMenu";
import { formatKeymap } from "./preview/formatCommands";
import { richCopyHandler } from "./preview/richCopy";
import { slashMenuPlugin, slashMenuTheme } from "./preview/slashMenu";
import { formatToolbarPlugin, formatToolbarTheme } from "./preview/toolbar";
import { typewriterPlugin } from "./preview/typewriter";
import { editorTheme } from "./theme";

export const INITIAL_DOCUMENT = `# 未命名

在这里开始写。**加粗**、*斜体*、\`行内代码\`、==高亮== 和 [链接](https://example.com) 都会按排版显示。

- 列表项
- [ ] 待办（点复选框或 Ctrl+Enter）
- [x] 已完成

> 引用段落

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

选中文字会出现浮动格式条；行首输入 \`/\` 打开插入菜单。

\`\`\`js
const hello = "world"
\`\`\`
`;

export interface EditorStats {
  lines: number;
  chars: number;
}

export interface EditorController {
  destroy: () => void;
  focus: () => void;
  text: () => string;
  stats: () => EditorStats;
  getState: () => EditorState;
  setState: (state: EditorState) => void;
  createState: (text: string) => EditorState;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  getSelection: () => { anchor: number; head: number };
  setSelection: (anchor: number, head: number) => void;
  firstVisibleLine: () => number;
  jumpToLine: (line: number) => void;
  onScroll: (listener: () => void) => () => void;
  onUpdate: (listener: () => void) => () => void;
  replace: (text: string) => number;
  measureInput: () => number[];
  measureScroll: () => Promise<number>;
  getModes: () => PreviewModes;
  setModes: (partial: Partial<PreviewModes>) => void;
}

const fenceLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "ts", "typescript", "jsx", "tsx"],
    support: javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    support: html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    support: css(),
  }),
];

const flashEffect = StateEffect.define<number | null>();

const flashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(flashEffect)) {
        if (effect.value == null) return Decoration.none;
        const line = transaction.state.doc.line(effect.value);
        return Decoration.set([
          Decoration.line({ class: "cm-heading-flash" }).range(line.from),
        ]);
      }
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildExtensions(hooks: {
  onEdit: () => void;
  shouldIgnoreEdit: () => boolean;
}): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    indentOnInput(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    EditorState.allowMultipleSelections.of(true),
    bracketMatching(),
    markdown({
      base: markdownLanguage,
      codeLanguages: fenceLanguages,
      extensions: [HighlightExtension],
    }),
    syntaxHighlighting(markdownHighlightStyle),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    search({ top: true }),
    highlightSelectionMatches({ wholeWords: false }),
    keymap.of([
      indentWithTab,
      ...formatKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    sourceModeField,
    typewriterModeField,
    focusModeField,
    livePreviewPlugin,
    livePreviewTheme,
    typewriterPlugin,
    formatToolbarPlugin,
    formatToolbarTheme,
    slashMenuPlugin,
    slashMenuTheme,
    paragraphGutter,
    paragraphGutterRefresh,
    paragraphMenuTheme,
    linkClickHandler,
    richCopyHandler,
    editorTheme,
    flashField,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    EditorView.updateListener.of((update) => {
      if (hooks.shouldIgnoreEdit() || !update.docChanged) return;
      hooks.onEdit();
    }),
  ];
}

export function createEditor(
  parent: HTMLElement,
  hooks: { onEdit: () => void; initialModes?: PreviewModes },
): EditorController {
  let applying = false;
  const modes: PreviewModes = {
    sourceMode: hooks.initialModes?.sourceMode ?? false,
    typewriter: hooks.initialModes?.typewriter ?? false,
    focus: hooks.initialModes?.focus ?? false,
  };

  const extensions = buildExtensions({
    onEdit: hooks.onEdit,
    shouldIgnoreEdit: () => applying,
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: INITIAL_DOCUMENT,
      extensions,
    }),
  });

  function syncModeEffects() {
    view.dispatch({
      effects: [
        setSourceMode.of(modes.sourceMode),
        setTypewriterMode.of(modes.typewriter),
        setFocusMode.of(modes.focus),
      ],
    });
  }

  syncModeEffects();

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  const scrollListeners = new Set<() => void>();
  const updateListeners = new Set<() => void>();

  const onScroll = () => {
    for (const listener of scrollListeners) listener();
  };
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

  function createState(text: string): EditorState {
    return EditorState.create({ doc: text, extensions });
  }

  function notifyUpdate(): void {
    for (const listener of updateListeners) listener();
  }

  function replace(text: string): number {
    const started = performance.now();
    applying = true;
    view.setState(createState(text));
    applying = false;
    syncModeEffects();
    notifyUpdate();
    return performance.now() - started;
  }

  function measureInput(): number[] {
    const samples: number[] = [];
    const length = view.state.doc.length;
    const points = [0, Math.floor(length / 2), length];
    applying = true;
    try {
      for (const at of points) {
        const started = performance.now();
        view.dispatch({ changes: { from: at, insert: "x" } });
        samples.push(performance.now() - started);
        undo(view);
      }
    } finally {
      applying = false;
    }
    return samples;
  }

  async function measureScroll(): Promise<number> {
    const scroller = view.scrollDOM;
    const jumpTo = (pos: number) => {
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
    };
    const atEnd = () =>
      scroller.scrollTop > scroller.scrollHeight - scroller.clientHeight - 8;

    const started = performance.now();
    jumpTo(view.state.doc.length);
    for (let i = 0; i < 12 && !atEnd(); i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const elapsed = performance.now() - started;
    jumpTo(0);
    for (let i = 0; i < 12 && scroller.scrollTop > 64; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return elapsed;
  }

  function firstVisibleLine(): number {
    const rect = view.scrollDOM.getBoundingClientRect();
    const pos = view.posAtCoords({ x: rect.left + 24, y: rect.top + 8 });
    if (pos == null) return 1;
    return view.state.doc.lineAt(pos).number;
  }

  function jumpToLine(line: number): void {
    const safe = Math.min(Math.max(1, line), view.state.doc.lines);
    const target = view.state.doc.line(safe);
    view.dispatch({
      selection: { anchor: target.from },
      effects: [
        EditorView.scrollIntoView(target.from, { y: "start" }),
        flashEffect.of(safe),
      ],
    });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      view.dispatch({ effects: flashEffect.of(null) });
      flashTimer = null;
    }, 900);
    view.focus();
  }

  return {
    destroy: () => {
      if (flashTimer) clearTimeout(flashTimer);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
    },
    focus: () => view.focus(),
    text: () => view.state.doc.toString(),
    stats: () => ({
      lines: view.state.doc.lines,
      chars: view.state.doc.length,
    }),
    getState: () => view.state,
    setState: (state) => {
      applying = true;
      view.setState(state);
      applying = false;
      syncModeEffects();
      notifyUpdate();
    },
    createState,
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (top) => {
      view.scrollDOM.scrollTop = top;
    },
    getSelection: () => {
      const main = view.state.selection.main;
      return { anchor: main.anchor, head: main.head };
    },
    setSelection: (anchor, head) => {
      const max = view.state.doc.length;
      view.dispatch({
        selection: {
          anchor: Math.max(0, Math.min(anchor, max)),
          head: Math.max(0, Math.min(head, max)),
        },
      });
    },
    firstVisibleLine,
    jumpToLine,
    onScroll: (listener) => {
      scrollListeners.add(listener);
      return () => {
        scrollListeners.delete(listener);
      };
    },
    onUpdate: (listener) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },
    replace,
    measureInput,
    measureScroll,
    getModes: () => ({ ...modes }),
    setModes: (partial) => {
      if (partial.sourceMode != null) modes.sourceMode = partial.sourceMode;
      if (partial.typewriter != null) modes.typewriter = partial.typewriter;
      if (partial.focus != null) modes.focus = partial.focus;
      syncModeEffects();
    },
  };
}
