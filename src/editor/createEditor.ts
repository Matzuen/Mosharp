import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { lineChanges } from "./fidelity";
import { markdownHighlightStyle } from "./highlight";
import { searchPhrases, type EditorLocale } from "./phrases";
import { flashEffect, flashField } from "./preview/flash";
import { HighlightExtension } from "./preview/highlightExt";
import { linkClickHandler, linkModCursor } from "./preview/links";
import { setActiveDocumentPath } from "./preview/docPath";
import { pasteImageHandler } from "./preview/images";
import { setPandocMath } from "./preview/math";
import {
  hiddenLineNumberField,
  livePreviewPlugin,
  livePreviewTheme,
  refreshPreview,
} from "./preview/livePreview";
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
import { formatKeymapFrom } from "./preview/formatCommands";
import {
  defaultWritingOptions,
  writingConfig,
  writingPreview,
  type WritingOptions,
} from "./preview/writingPreview";
import { DEFAULT_SHORTCUTS, type ShortcutMap } from "../shell/preferences";
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

[跳到中文标题](#中文标题)。选中文字会出现浮动格式条；行首输入 \`/\` 打开插入菜单。

## 中文标题

标题锚点可以跳到这里。行内公式 $E=mc^2$。

$$
a^2+b^2=c^2
$$

![色块](data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2280%22%20height=%2224%22%3E%3Crect%20width=%2280%22%20height=%2224%22%20fill=%22%239a3412%22/%3E%3C/svg%3E)

\`\`\`mermaid
graph LR
  写作 --> 预览
\`\`\`

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
  /** Apply a fidelity rewrite without marking the document dirty. */
  rewrite: (text: string) => void;
  measureInput: () => number[];
  measureScroll: () => Promise<number>;
  getModes: () => PreviewModes;
  setModes: (partial: Partial<PreviewModes>) => void;
  setPhrases: (locale: EditorLocale) => void;
  refreshDecorations: () => void;
  remeasure: () => void;
  setDocumentPath: (path: string | null) => void;
  setSpellcheck: (enabled: boolean, lang: string) => void;
  setWriting: (options: WritingOptions, pandocMath: boolean) => void;
  setFormatKeys: (shortcuts: ShortcutMap) => void;
  run: (action: (view: EditorView) => void) => void;
}

function buildExtensions(
  hooks: {
    onEdit: () => void;
    shouldIgnoreEdit: () => boolean;
  },
  phraseCompartment: Compartment,
  spellCompartment: Compartment,
  keyCompartment: Compartment,
  writingCompartment: Compartment,
  locale: EditorLocale,
): Extension[] {
  return [
    phraseCompartment.of(EditorState.phrases.of(searchPhrases(locale))),
    lineNumbers(),
    hiddenLineNumberField,
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
      codeLanguages: languages,
      extensions: [HighlightExtension],
    }),
    syntaxHighlighting(markdownHighlightStyle),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    search({ top: true }),
    highlightSelectionMatches({ wholeWords: false }),
    keyCompartment.of(keymap.of(formatKeymapFrom(DEFAULT_SHORTCUTS))),
    keymap.of([
      indentWithTab,
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
    linkModCursor,
    ...writingPreview,
    writingCompartment.of(writingConfig.of(defaultWritingOptions)),
    richCopyHandler,
    editorTheme,
    flashField,
    EditorView.lineWrapping,
    EditorView.domEventHandlers({
      paste: pasteImageHandler,
    }),
    spellCompartment.of(
      EditorView.contentAttributes.of({
        spellcheck: "true",
        lang: "zh-CN",
        autocorrect: "off",
        autocapitalize: "off",
      }),
    ),
    EditorView.updateListener.of((update) => {
      if (hooks.shouldIgnoreEdit() || !update.docChanged) return;
      hooks.onEdit();
    }),
  ];
}

export function createEditor(
  parent: HTMLElement,
  hooks: { onEdit: () => void; initialModes?: PreviewModes; locale?: EditorLocale },
): EditorController {
  let applying = false;
  const phraseCompartment = new Compartment();
  const spellCompartment = new Compartment();
  const keyCompartment = new Compartment();
  const writingCompartment = new Compartment();
  const modes: PreviewModes = {
    sourceMode: hooks.initialModes?.sourceMode ?? false,
    typewriter: hooks.initialModes?.typewriter ?? false,
    focus: hooks.initialModes?.focus ?? false,
  };

  const extensions = buildExtensions(
    {
      onEdit: hooks.onEdit,
      shouldIgnoreEdit: () => applying,
    },
    phraseCompartment,
    spellCompartment,
    keyCompartment,
    writingCompartment,
    hooks.locale ?? "zh-CN",
  );

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

  function rewrite(text: string): void {
    const current = view.state.doc.toString();
    const changes = lineChanges(current, text);
    if (changes.length === 0) return;
    applying = true;
    view.dispatch({
      changes,
      annotations: Transaction.addToHistory.of(false),
    });
    applying = false;
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
    rewrite,
    measureInput,
    measureScroll,
    getModes: () => ({ ...modes }),
    setModes: (partial) => {
      if (partial.sourceMode != null) modes.sourceMode = partial.sourceMode;
      if (partial.typewriter != null) modes.typewriter = partial.typewriter;
      if (partial.focus != null) modes.focus = partial.focus;
      syncModeEffects();
    },
    setPhrases: (locale) => {
      view.dispatch({
        effects: phraseCompartment.reconfigure(EditorState.phrases.of(searchPhrases(locale))),
      });
    },
    refreshDecorations: () => {
      view.dispatch({ effects: refreshPreview.of(null) });
    },
    remeasure: () => {
      view.requestMeasure();
    },
    setDocumentPath: (path) => {
      setActiveDocumentPath(path);
      view.dispatch({ effects: refreshPreview.of(null) });
    },
    setSpellcheck: (enabled, lang) => {
      view.dispatch({
        effects: spellCompartment.reconfigure(
          EditorView.contentAttributes.of({
            spellcheck: enabled ? "true" : "false",
            lang: enabled ? lang : "",
            autocorrect: "off",
            autocapitalize: "off",
          }),
        ),
      });
    },
    setWriting: (options, pandocMath) => {
      setPandocMath(pandocMath);
      view.dispatch({
        effects: [
          writingCompartment.reconfigure(writingConfig.of(options)),
          refreshPreview.of(null),
        ],
      });
    },
    setFormatKeys: (shortcuts) => {
      view.dispatch({
        effects: keyCompartment.reconfigure(keymap.of(formatKeymapFrom(shortcuts))),
      });
    },
    run: (action) => {
      action(view);
    },
  };
}
