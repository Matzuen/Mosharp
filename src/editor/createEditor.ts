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
  syntaxTree,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
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
import { countProseWords } from "./words";
import { searchPhrases, type EditorLocale } from "./phrases";
import { flashEffect, flashField } from "./preview/flash";
import { HighlightExtension } from "./preview/highlightExt";
import { linkClickHandler, linkModCursor } from "./preview/links";
import { setActiveDocumentPath } from "./preview/docPath";
import { pasteImageHandler } from "./preview/images";
import { caretAfterLink, isOnlyUrl, linkMarkdown } from "./pasteLink";
import { blockStarter, emptyFenceRange, fenceCloseText, fenceOpener } from "./autoBlock";
import { setPandocMath } from "./preview/math";
import {
  setWidthScope,
  hiddenLineNumberField,
  hiddenMarkersAt,
  livePreviewPlugin,
  livePreviewTheme,
  refreshPreview,
} from "./preview/livePreview";
import { extendDeletion } from "./preview/markerEdit";
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
import { langMenuPlugin } from "./preview/langMenu";
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
  /**
   * Prose word count. Kept separate from `stats()` because it scans the whole
   * document — call it on a debounce, not on every keystroke.
   */
  wordCount: () => number;
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

/**
 * Pasting a URL onto a selection wraps it as a link instead of replacing it.
 * Only a bare http(s) URL qualifies, so ordinary text paste is untouched.
 */
function pasteLinkHandler(event: ClipboardEvent, view: EditorView): boolean {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!isOnlyUrl(text)) return false;
  const range = view.state.selection.main;
  if (range.empty) return false;
  event.preventDefault();
  const label = view.state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: linkMarkdown(label, text) },
    selection: { anchor: range.from + caretAfterLink(label, text) },
    userEvent: "input.paste",
  });
  return true;
}

/**
 * Enter on a complete fence opener (` ```html `) drops in the closing fence.
 * The language comes first, so the block never ends up as an empty "plain text"
 * fence — and an opener that already has content below it is left alone.
 */
function closeFenceOnEnter(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const doc = view.state.doc;
  const line = doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const opener = fenceOpener(line.text);
  if (!opener) return false;
  const next = line.number < doc.lines ? doc.line(line.number + 1).text : "";
  if (next.trim().length > 0) return false;
  view.dispatch({
    changes: { from: range.head, insert: fenceCloseText(opener.fence) },
    selection: { anchor: range.head + 1 },
    userEvent: "input.newline",
  });
  return true;
}

/**
 * Backspace on an empty fence body removes the whole block. Without this, the
 * fence created by the Enter shortcut can only be deleted one character at a
 * time, leaving a stray empty code block behind.
 */
function deleteEmptyFence(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const doc = view.state.doc;
  const line = doc.lineAt(range.head);
  if (line.text.trim().length > 0) return false;
  const first = Math.max(1, line.number - 8);
  const last = Math.min(doc.lines, line.number + 8);
  const lines = [];
  for (let n = first; n <= last; n += 1) {
    const current = doc.line(n);
    lines.push({ from: current.from, to: current.to, text: current.text });
  }
  const found = emptyFenceRange(lines, line.number - first);
  if (!found) return false;
  view.dispatch({
    changes: { from: found.from, to: found.to, insert: "" },
    selection: { anchor: found.from },
    userEvent: "delete.backward",
  });
  return true;
}

/**
 * Backspace/Delete next to a hidden marker removes the whole marker.
 * Deleting one character of `**` leaves a stray asterisk that the user never
 * asked for — the marker is invisible, so it reads as "nothing happened".
 */
function deleteHiddenMarker(view: EditorView, forward: boolean): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const target = extendDeletion(hiddenMarkersAt(view, range.head), range.head, forward);
  if (!target) return false;
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: "" },
    selection: { anchor: target.from },
    userEvent: forward ? "delete.forward" : "delete.backward",
  });
  return true;
}

/**
 * Note: Home and pointer clicks do *not* need to skip line markers.
 *
 * The preview reveals a marker whenever the caret is inside its element, so a
 * line the caret sits on always shows its `#`, `- ` or `> `. A caret in front of
 * a visible marker is a legitimate position — an automated end-to-end check
 * proved that clicking the left edge of `- 项目` inserts before a *visible* `- `,
 * which is exactly what the user sees.
 */

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
    // Reserve room for a "start–end" span label on collapsed blocks (e.g.
    // 11–13). The gutter is sized from `initialSpacer`, so padding every number
    // to `digits + 4` figure spaces widens it without shifting the digits.
    lineNumbers({
      formatNumber: (lineNo: number, state: EditorState) =>
        String(lineNo).padStart(String(state.doc.lines).length + 4, "\u2007"),
    }),
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
    Prec.high(keymap.of([{ key: "Enter", run: closeFenceOnEnter }])),
    Prec.high(
      keymap.of([
        {
          key: "Backspace",
          run: (view) => deleteEmptyFence(view) || deleteHiddenMarker(view, false),
        },
        { key: "Delete", run: (view) => deleteHiddenMarker(view, true) },
      ]),
    ),
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
    langMenuPlugin,
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
      paste: (event, view) => {
        if (pasteImageHandler(event, view)) return true;
        return pasteLinkHandler(event, view);
      },
    }),
    /**
     * Typing the closing half of a block marker opens the block right away:
     * `$$` and ``` produce a fenced block with the caret inside, instead of
     * requiring the user to type the closing fence by hand.
     */
    EditorView.inputHandler.of((view, from, to, text) => {
      if (from !== to || text.length !== 1) return false;
      const line = view.state.doc.lineAt(from);
      // Typing a fence *inside* an existing code block must not spawn another
      // block: only a fence that starts on the current line counts.
      let node = syntaxTree(view.state).resolveInner(from, -1);
      while (node) {
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          if (view.state.doc.lineAt(node.from).number < line.number) return false;
          break;
        }
        node = node.parent as typeof node;
      }
      const before = view.state.sliceDoc(line.from, from);
      const after = view.state.sliceDoc(from, line.to);
      const starter = blockStarter(before, after, text);
      if (!starter) return false;
      view.dispatch({
        changes: { from, to, insert: starter.insert },
        selection: { anchor: from + starter.caret },
        userEvent: "input.type",
      });
      return true;
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
    wordCount: () => countProseWords(view.state.doc.toString()),
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
      // Column widths are remembered per document.
      setWidthScope(path);
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
