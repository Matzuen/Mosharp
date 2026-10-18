import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ackClosePrompt, resolveClose, setUnsaved } from "./api/close";
import { placeImage } from "./api/images";
import {
  createDocument,
  createFolder,
  deleteEntry,
  listDirectory,
  normalizeEncoding,
  openFolderPath,
  openMarkdownPath,
  readDocument,
  recoveryFolder,
  renameEntry,
  revealInFolder,
  saveMarkdownPath,
  saveRecoveryCopy,
  suppressFileWatch,
  syncFileWatches,
  takeStartupFiles,
  touchFileWatchBaseline,
  writeDocument,
  type FileEncoding,
  type DirEntryInfo,
} from "./api/files";
import logoUrl from "./assets/logo-mark.png";
import { generateBenchmark } from "./editor/benchmark";
import { replaceAllText } from "./editor/replaceText";
import { createEditor, INITIAL_DOCUMENT, type EditorController } from "./editor/createEditor";
import {
  detectLineEnding,
  prepareForSave,
  sameText,
  savedBuffer,
  type LineEnding,
} from "./editor/fidelity";
import { readingColumnCss } from "./export/readingColumn";
import { runExport, type ExportKind } from "./export/runExport";
import { pendingImagesIn } from "./editor/preview/docPath";
import { setPasteImages } from "./editor/preview/images";
import {
  insertBullet,
  insertFence,
  insertHeading,
  insertHr,
  insertLink,
  insertMathBlock,
  insertMermaid,
  insertPlantuml,
  insertVega,
  insertQuote,
  insertTable,
  insertFootnote,
  toggleBold,
  toggleCode,
  toggleHighlight,
  toggleItalic,
  toggleStrike,
  toggleSub,
  toggleSup,
  toggleTask,
} from "./editor/preview/formatCommands";
import { activeOutlineIndex, parseOutlineDoc, type OutlineItem } from "./editor/outline";
import { LOCALE_LABELS, t, tLines } from "./shell/i18n";
import { searchWorkspace, type WorkspaceSearch } from "./api/search";
import { CommandPalette, type PaletteAction } from "./shell/CommandPalette";
import { MenuBar, type MenuDef, type MenuEntry } from "./shell/MenuBar";
import { SettingsDialog } from "./shell/SettingsDialog";
import { RecoveryDialog } from "./shell/RecoveryDialog";
import { chordFromEvent } from "./shell/shortcuts";
import { ancestorPaths, isInside } from "./shell/treePaths";
import {
  appendRun,
  lastUndoableRun,
  markUndone,
  parseRuns,
  type ReplaceEntry,
  type ReplaceRun,
} from "./shell/replaceLog";
import {
  clampPanelWidth,
  clampZoom,
  CONTENT_WIDTHS,
  defaultPreferencesFor,
  LOCALES,
  loadPreferences,
  MAX_PANEL,
  MAX_ZOOM,
  MIN_PANEL,
  MIN_ZOOM,
  savePreferences,
  ZOOM_STEP,
  type Preferences,
  type ShortcutId,
} from "./shell/preferences";
import { applyAppearance } from "./themes/apply";
import { THEMES, themeLabel } from "./themes/catalog";
import {
  loadRecent,
  loadSession,
  MAX_SESSION_CHARS,
  pushRecent,
  saveSession,
  type RecentEntry,
  type SessionTabSnapshot,
} from "./shell/session";
import "./App.css";

const BENCHMARK_LINES = 100_000;
/** Quiet period after the last keystroke before auto-save writes to disk. */
const AUTO_SAVE_DELAY_MS = 1200;
/** Word counting scans the whole document, so it waits for a typing pause. */
const WORD_COUNT_DELAY_MS = 250;

interface TabRecord {
  id: string;
  path: string | null;
  dirty: boolean;
  /** The file changed on disk while this tab had unsaved edits. */
  conflicted?: boolean;
  state: EditorState | null;
  scrollTop: number;
  lineEnding: LineEnding;
  encoding: FileEncoding;
}

interface MenuState {
  x: number;
  y: number;
  kind: "tab" | "file";
  tabId?: string;
  path?: string;
  /** The right-clicked tree row is a folder. */
  dir?: boolean;
}

interface TreeNode extends DirEntryInfo {
  depth: number;
  expanded?: boolean;
  children?: TreeNode[] | null;
}

function documentName(path: string | null, untitled: string): string {
  if (!path) return untitled;
  return path.split(/[/\\]/).pop() ?? untitled;
}

/** Folder part of a path, keeping the original separators. */
function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? "" : path.slice(0, index);
}

function joinPath(folder: string, name: string): string {
  if (!folder) return name;
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function fileTitle(path: string | null, dirty: boolean, untitled: string): string {
  return `${dirty ? "● " : ""}${documentName(path, untitled)} — Mosharp`;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) =>
    value
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\//, "")
      .replace(/^\/\/\.\//, "")
      .toLowerCase();
  return normalize(left) === normalize(right);
}

function newTabId(): string {
  return `tab-${crypto.randomUUID()}`;
}

/** True when a keystroke should be typed rather than treated as a command. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // The CodeMirror surface is a contenteditable div, not a TEXTAREA.
  return target.isContentEditable;
}

function hasCommandModifier(chord: string): boolean {
  return /^(Ctrl|Alt)\+/.test(chord);
}

/** Keep a fixed-position context menu inside the window. */
function clampMenuToViewport(x: number, y: number): { left: string; top: string } {
  const maxLeft = Math.max(8, window.innerWidth - 208);
  const maxTop = Math.max(8, window.innerHeight - 232);
  return {
    left: `${Math.max(8, Math.min(x, maxLeft))}px`,
    top: `${Math.max(8, Math.min(y, maxTop))}px`,
  };
}

const ENCODING_LABELS: Record<string, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  gbk: "GBK",
};

export default function App() {
  let host!: HTMLDivElement;
  let editor: EditorController | undefined;
  let dirtyFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let treePollTimer: ReturnType<typeof setInterval> | null = null;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollUiTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let wordCountTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against an older search landing after a newer one. */
  let searchSeq = 0;
  let activeId = "";
  let restoringSession = false;
  let lastTreeSignature = "";
  let lastTreeError = "";
  let outlineTimer: ReturnType<typeof setTimeout> | null = null;
  let titleTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  const initialPrefs = loadPreferences();
  const [prefs, setPrefs] = createSignal<Preferences>(initialPrefs);
  const [tabs, setTabs] = createSignal<TabRecord[]>([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const [dirtyBadge, setDirtyBadge] = createSignal(false);
  const [lines, setLines] = createSignal(1);
  const [chars, setChars] = createSignal(0);
  const [words, setWords] = createSignal(0);
  const [notice, setNotice] = createSignal("");
  const [outline, setOutline] = createSignal<OutlineItem[]>([]);
  const [activeHeading, setActiveHeading] = createSignal(-1);
  const [tree, setTree] = createSignal<TreeNode[]>([]);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [recoveryOpen, setRecoveryOpen] = createSignal(false);
  const [dropHover, setDropHover] = createSignal(false);
  const [fileQuery, setFileQuery] = createSignal("");
  const [outlineQuery, setOutlineQuery] = createSignal("");
  /** Path being renamed inline in the file tree, and the text in the box. */
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameText, setRenameText] = createSignal("");
  const [searchHits, setSearchHits] = createSignal<WorkspaceSearch>({
    names: [],
    matches: [],
    truncated: false,
  });
  const [searchBusy, setSearchBusy] = createSignal(false);
  /** Index of the content match the up/down buttons are sitting on. */
  const [matchIndex, setMatchIndex] = createSignal(-1);
  const [replaceText, setReplaceText] = createSignal("");
  const [replacing, setReplacing] = createSignal(false);
  /** Bumped after a workspace replace so the results refresh. */
  const [searchTick, setSearchTick] = createSignal(0);
  const [recent, setRecent] = createSignal<RecentEntry[]>(loadRecent());

  const locale = createMemo(() => prefs().locale);
  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeTabId()) ?? null);
  const fileFormat = createMemo(() => {
    const tab = activeTab();
    if (!tab) return "";
    const encoding = ENCODING_LABELS[tab.encoding] ?? tab.encoding;
    return `${encoding} · ${tab.lineEnding === "\r\n" ? "CRLF" : "LF"}`;
  });

  createEffect(() => {
    const unsaved = tabs().some((tab) => tab.dirty);
    if (isTauri()) void setUnsaved(unsaved).catch(() => {});
  });

  // Status-bar messages must not sit there for the rest of the session.
  createEffect(() => {
    const message = notice();
    if (noticeTimer) clearTimeout(noticeTimer);
    if (!message) return;
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      setNotice("");
    }, 8000);
  });

  // Per-keystroke outline scanning is debounced away, so opening the panel must
  // populate it once explicitly.
  createEffect(() => {
    if (!prefs().panelOpen || prefs().panelMode !== "outline") return;
    if (!editor) return;
    refreshOutline();
  });

  function persistPrefs(next: Preferences) {
    const previous = prefs();
    setPrefs(next);
    savePreferences(next);
    document.documentElement.style.setProperty("--content-width", `${next.contentWidth}px`);
    let columnStyle = document.getElementById("mosharp-reading-column");
    if (!columnStyle) {
      columnStyle = document.createElement("style");
      columnStyle.id = "mosharp-reading-column";
      document.head.appendChild(columnStyle);
    }
    columnStyle.textContent = readingColumnCss(next.contentWidth);
    document.documentElement.style.setProperty("--panel-width", `${next.panelWidth}px`);
    applyAppearance(next);
    if (!editor) return;
    if (next.theme !== previous.theme) editor.refreshDecorations();
    if (
      next.theme !== previous.theme ||
      next.editorFont !== previous.editorFont ||
      next.editorSize !== previous.editorSize
    ) {
      editor.remeasure();
    }
  }

  /** Recently closed buffers, newest last, for Ctrl+Shift+T. */
  const closedTabs: Array<{ path: string | null; text: string }> = [];

  let searchInput: HTMLInputElement | undefined;

  /** Reopen the most recently closed tab (file from disk, untitled from memory). */
  async function reopenTab() {
    const last = closedTabs.pop();
    if (!last) return;
    if (last.path) {
      await openPathInTab(last.path);
      return;
    }
    createTab(null, last.text, false);
  }

  /** Sidebar search is reachable without the mouse. */
  function focusFileSearch() {
    if (!prefs().panelOpen || prefs().panelMode !== "files") {
      patchPrefs({ panelOpen: true, panelMode: "files" });
    }
    requestAnimationFrame(() => {
      searchInput?.focus();
      searchInput?.select();
    });
  }

  function patchPrefs(partial: Partial<Preferences>) {
    persistPrefs({ ...prefs(), ...partial });
  }

  /**
   * Change the window zoom by whole steps. A `delta` of 0 resets to 100%.
   * Persisted, so the next launch opens at the same scale.
   */
  function stepZoom(delta: number) {
    const base = delta === 0 ? 1 : prefs().zoom + delta * ZOOM_STEP;
    const next = clampZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base)));
    if (next === prefs().zoom) return;
    patchPrefs({ zoom: next });
    setNotice(`${Math.round(next * 100)}%`);
  }

  function shortcut(id: ShortcutId): string {
    return prefs().shortcuts[id] || "";
  }

  function applyEditorPrefs() {
    if (!editor) return;
    const current = prefs();
    const modes = editor.getModes();
    if (
      modes.sourceMode !== current.sourceMode ||
      modes.typewriter !== current.typewriter ||
      modes.focus !== current.focusMode
    ) {
      editor.setModes({
        sourceMode: current.sourceMode,
        typewriter: current.typewriter,
        focus: current.focusMode,
      });
    }
    editor.setSpellcheck(current.spellcheck, current.spellLang);
    editor.setWriting(
      {
        footnotes: current.footnotes,
        emoji: current.emoji,
        superSub: current.superSub,
        customWords: current.customWords,
      },
      current.pandocMath,
    );
    editor.setFormatKeys(current.shortcuts);
    editor.setPhrases(current.locale);
    setPasteImages(current.pasteImages);
  }

  function rememberRecent(path: string) {
    setRecent(pushRecent(path, recent()));
  }

  function refreshWatches() {
    if (!isTauri()) return;
    const paths = tabs()
      .map((tab) => tab.path)
      .filter((path): path is string => Boolean(path));
    void syncFileWatches(paths);
  }

  function scheduleSessionSave() {
    if (restoringSession) return;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      sessionTimer = null;
      flushSession();
    }, 400);
  }

  function flushSession() {
    if (!editor || restoringSession) return;
    captureActive();
    const list = tabs();
    if (list.length === 0) return;
    const activeIndex = Math.max(
      0,
      list.findIndex((tab) => tab.id === activeId),
    );
    const snapshots: SessionTabSnapshot[] = list.map((tab) => {
      const isActive = tab.id === activeId;
      const chars = isActive ? editor!.stats().chars : (tab.state?.doc.length ?? 0);
      const tooLarge = chars > MAX_SESSION_CHARS;
      const content = tooLarge
        ? ""
        : isActive
          ? editor!.text()
          : (tab.state?.doc.toString() ?? "");
      const selection = isActive
        ? editor!.getSelection()
        : {
            anchor: tab.state?.selection.main.anchor ?? 0,
            head: tab.state?.selection.main.head ?? 0,
          };
      return {
        path: tab.path,
        content,
        // Keep the dirty flag even when the buffer could not be snapshotted, so
        // the restore path can tell the user instead of reporting "saved".
        dirty: tab.dirty,
        scrollTop: isActive ? editor!.getScrollTop() : tab.scrollTop,
        selection,
        lineEnding: tab.lineEnding,
        encoding: tab.encoding,
        contentDropped: tooLarge,
      };
    });
    saveSession({
      version: 1,
      tabs: snapshots,
      activeIndex,
      savedAt: Date.now(),
    });
  }

  async function backupTab(tab: TabRecord) {
    if (!isTauri() || !tab.dirty) return;
    const content =
      tab.id === activeId && editor
        ? editor.text()
        : (tab.state?.doc.toString() ?? "");
    if (!content.trim()) return;
    const disk = prepareForSave(content, tab.lineEnding);
    // No size cap here: this is the last-resort copy of unsaved work. Session
    // snapshots may drop large buffers, this must not.
    try {
      const savedPath = await saveRecoveryCopy(
        documentName(tab.path, t(locale(), "untitled")),
        disk,
      );
      setNotice(`${t(locale(), "recovered")}：${savedPath}`);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function showDirtyBadge() {
    setDirtyBadge(true);
    if (dirtyFadeTimer) clearTimeout(dirtyFadeTimer);
    dirtyFadeTimer = setTimeout(() => {
      setDirtyBadge(false);
      dirtyFadeTimer = null;
    }, 2400);
  }

  async function syncTitle() {
    const tab = tabs().find((item) => item.id === activeId);
    const title = fileTitle(tab?.path ?? null, tab?.dirty ?? false, t(locale(), "untitled"));
    document.title = title;
    if (isTauri()) await getCurrentWindow().setTitle(title);
  }

  /**
   * Line and character counts are cheap and update immediately; the word count
   * scans the whole document (~10 ms on a 1.6 MB file), so it waits for a pause
   * in typing instead of running on every keystroke.
   */
  function refreshStats() {
    if (!editor) return;
    const stats = editor.stats();
    setLines(stats.lines);
    setChars(stats.chars);
    scheduleWordCount();
  }

  function scheduleWordCount() {
    if (wordCountTimer) clearTimeout(wordCountTimer);
    wordCountTimer = setTimeout(() => {
      wordCountTimer = null;
      if (editor) setWords(editor.wordCount());
    }, WORD_COUNT_DELAY_MS);
  }

  function refreshOutline() {
    if (!editor) return;
    const next = parseOutlineDoc(editor.getState().doc);
    // Keep the objects that did not change: `For` is keyed by identity, so
    // reusing them means a refresh patches only the headings that actually
    // changed instead of rebuilding every row.
    setOutline((previous) =>
      next.map((item, index) => {
        const old = previous[index];
        return old && old.line === item.line && old.level === item.level && old.text === item.text
          ? old
          : item;
      }),
    );
    setActiveHeading(activeOutlineIndex(next, editor.firstVisibleLine()));
  }

  /**
   * Outline + window title are expensive (a full document scan and an IPC call)
   * and must stay off the per-keystroke path.
   */
  function scheduleOutlineRefresh() {
    if (!prefs().panelOpen || prefs().panelMode !== "outline") return;
    if (outlineTimer) clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      outlineTimer = null;
      refreshOutline();
    }, 180);
  }

  function scheduleTitleSync() {
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      titleTimer = null;
      void syncTitle();
    }, 200);
  }

  function markActiveDirty(value: boolean) {
    const id = activeId;
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, dirty: value } : tab)),
    );
    setDirty(value);
    if (value) {
      showDirtyBadge();
      scheduleAutoSave();
    } else {
      setDirtyBadge(false);
    }
    scheduleTitleSync();
    scheduleSessionSave();
  }

  /**
   * Auto-save is opt-in: only when the preference is on, the tab already has a
   * path (an untitled document has nothing to write to), and the edit is on the
   * active tab. The timer restarts on every keystroke so a burst of typing
   * results in one write.
   */
  function scheduleAutoSave() {
    if (!prefs().autoSave) return;
    const tab = activeTab();
    if (!tab?.path || !activeId) return;
    // A tab whose file changed on disk must not be written automatically: the
    // user was just told there is a conflict, and silently overwriting the
    // external edit would lose it.
    if (tab.conflicted) return;
    const id = activeId;
    const path = tab.path;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      // The tab may have been switched, renamed or closed while waiting.
      const current = tabs().find((item) => item.id === id);
      if (!current?.dirty || current.conflicted || current.path !== path || activeId !== id) return;
      void persist(path, true);
    }, AUTO_SAVE_DELAY_MS);
  }

  function captureActive(): void {
    if (!editor || !activeId) return;
    const id = activeId;
    const state = editor.getState();
    const scrollTop = editor.getScrollTop();
    setTabs((current) =>
      current.map((tab) =>
        tab.id === id ? { ...tab, state, scrollTop, dirty: tab.dirty } : tab,
      ),
    );
  }

  function activateTab(id: string): void {
    if (!editor || id === activeId) return;
    captureActive();
    const target = tabs().find((tab) => tab.id === id);
    if (!target?.state) return;
    activeId = id;
    setActiveTabId(id);
    editor.setState(target.state);
    editor.setDocumentPath(target.path);
    editor.setScrollTop(target.scrollTop);
    setDirty(target.dirty);
    if (target.dirty) showDirtyBadge();
    else setDirtyBadge(false);
    refreshStats();
    refreshOutline();
    void syncTitle();
    scheduleSessionSave();
    editor.focus();
  }

  function createTab(
    path: string | null,
    text: string,
    dirtyValue = false,
    lineEnding: LineEnding = detectLineEnding(text),
    encoding: FileEncoding = "utf-8",
  ): string {
    if (!editor) return "";
    captureActive();
    const id = newTabId();
    const state = editor.createState(text);
    const tab: TabRecord = {
      id,
      path,
      dirty: dirtyValue,
      state,
      scrollTop: 0,
      lineEnding,
      encoding,
    };
    setTabs((current) => [...current, tab]);
    activeId = id;
    setActiveTabId(id);
    editor.setState(state);
    editor.setDocumentPath(path);
    editor.setScrollTop(0);
    setDirty(dirtyValue);
    setDirtyBadge(false);
    refreshStats();
    refreshOutline();
    void syncTitle();
    scheduleSessionSave();
    refreshWatches();
    editor.focus();
    return id;
  }

  async function confirmDiscard(tab: TabRecord): Promise<boolean> {
    if (!tab.dirty) return true;
    const message = t(locale(), "discard");
    const confirmed = !isTauri()
      ? window.confirm(message)
      : await ask(message, { title: "Mosharp", kind: "warning" });
    if (confirmed) await backupTab(tab);
    return confirmed;
  }

  async function closeTab(id: string): Promise<void> {
    const list = tabs();
    const tab = list.find((item) => item.id === id);
    if (!tab) return;
    if (!(await confirmDiscard(tab))) return;

    const index = list.findIndex((item) => item.id === id);
    const remaining = list.filter((item) => item.id !== id);

    // Remember the buffer for Ctrl+Shift+T. Capture first when the tab is the
    // active one, otherwise the snapshot is one edit behind.
    if (id === activeId) captureActive();
    const latest = tabs().find((item) => item.id === id) ?? tab;
    closedTabs.push({ path: latest.path, text: latest.state?.doc.toString() ?? "" });
    if (closedTabs.length > 5) closedTabs.shift();

    if (remaining.length === 0) {
      if (!editor) return;
      const fresh: TabRecord = {
        id: newTabId(),
        path: null,
        dirty: false,
        state: editor.createState(INITIAL_DOCUMENT),
        scrollTop: 0,
        lineEnding: "\n",
        encoding: "utf-8",
      };
      setTabs([fresh]);
      activeId = fresh.id;
      setActiveTabId(fresh.id);
      editor.setState(fresh.state!);
      editor.setDocumentPath(null);
      editor.setScrollTop(0);
      setDirty(false);
      setDirtyBadge(false);
      refreshStats();
      refreshOutline();
      void syncTitle();
      editor.focus();
      scheduleSessionSave();
      refreshWatches();
      return;
    }

    setTabs(remaining);
    if (id === activeId) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      activeId = "";
      activateTab(next.id);
    }
    scheduleSessionSave();
    refreshWatches();
  }

  async function openPathInTab(path: string): Promise<void> {
    const existing = tabs().find((tab) => samePath(tab.path, path));
    if (existing) {
      activateTab(existing.id);
      rememberRecent(path);
      setNotice(documentName(path, t(locale(), "untitled")));
      return;
    }
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const started = performance.now();
      const opened = await readDocument(path);
      if (!editor) return;
      const loaded = (() => {
        captureActive();
        const id = newTabId();
        const state = editor.createState(opened.content);
        setTabs((current) => [
          ...current,
          {
            id,
            path,
            dirty: false,
            state,
            scrollTop: 0,
            lineEnding: detectLineEnding(opened.content),
            encoding: normalizeEncoding(opened.encoding),
          },
        ]);
        activeId = id;
        setActiveTabId(id);
        const ms = performance.now();
        editor.setState(state);
        editor.setDocumentPath(path);
        editor.setScrollTop(0);
        setDirty(false);
        setDirtyBadge(false);
        refreshStats();
        refreshOutline();
        void syncTitle();
        editor.focus();
        return performance.now() - ms;
      })();
      rememberRecent(path);
      scheduleSessionSave();
      refreshWatches();
      const total = performance.now() - started;
      const openedEncoding = tabs().find((tab) => tab.id === activeId)?.encoding;
      const encodingNote =
        openedEncoding && openedEncoding !== "utf-8" ? ` · ${openedEncoding}` : "";
      setNotice(
        `${t(locale(), "open")} ${formatMs(total)} ms · ${formatMs(loaded)} ms${encodingNote}`,
      );
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  async function openDoc() {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const selected = await openMarkdownPath(t(locale(), "open"));
      if (!selected) return;
      await openPathInTab(selected);
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  let droppedStamp = "";
  let droppedAt = 0;
  function claimDropped(paths: string[]): string[] | null {
    const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (!unique.length) return null;
    const stamp = unique.join("\0");
    const now = performance.now();
    if (stamp === droppedStamp && now - droppedAt < 500) return null;
    droppedStamp = stamp;
    droppedAt = now;
    return unique;
  }

  async function openDroppedPaths(paths: string[]) {
    const unique = claimDropped(paths);
    if (!unique) return;
    for (const path of unique) {
      let isDir = false;
      try {
        await listDirectory(path);
        isDir = true;
      } catch {
        isDir = false;
      }
      if (isDir) {
        patchPrefs({ workspaceRoot: path, panelOpen: true, panelMode: "files" });
        await reloadTree(path);
        continue;
      }
      await openPathInTab(path);
    }
  }

  async function openDroppedFiles(files: File[]) {
    for (const file of files) {
      if (file.size > 64 * 1024 * 1024) {
        setNotice(`${t(locale(), "openFailed")}：${file.name}`);
        continue;
      }
      const text = await file.text();
      if (text.includes("\u0000")) {
        setNotice(`${t(locale(), "openFailed")}：${file.name}`);
        continue;
      }
      createTab(null, text, false);
      setNotice(file.name);
    }
  }

  async function openFolder() {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const selected = await openFolderPath(t(locale(), "openFolder"));
      if (!selected) return;
      patchPrefs({ workspaceRoot: selected, panelOpen: true, panelMode: "files" });
      await reloadTree(selected);
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  async function collectExpanded(nodes: TreeNode[]): Promise<Map<string, TreeNode[]>> {
    const expanded = new Map<string, TreeNode[]>();
    async function walk(list: TreeNode[]) {
      for (const node of list) {
        if (node.is_dir && node.expanded) {
          const children = (await listDirectory(node.path)).map((entry) => ({
            ...entry,
            depth: node.depth + 1,
            expanded: false,
            children: entry.is_dir ? null : undefined,
          }));
          expanded.set(node.path, children);
          if (node.children) await walk(node.children);
        }
      }
    }
    await walk(nodes);
    return expanded;
  }

  function applyExpanded(
    nodes: TreeNode[],
    expanded: Map<string, TreeNode[]>,
    depth = 0,
  ): TreeNode[] {
    return nodes.map((node) => {
      const kids = expanded.get(node.path);
      if (!node.is_dir || !kids) {
        return {
          ...node,
          depth,
          expanded: false,
          children: node.is_dir ? null : undefined,
        };
      }
      const withDepth = kids.map((child) => ({ ...child, depth: depth + 1 }));
      return {
        ...node,
        depth,
        expanded: true,
        children: applyExpanded(withDepth, expanded, depth + 1),
      };
    });
  }

  /** Find a node by path anywhere in the loaded tree. */
  function findTreeNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (samePath(node.path, path)) return node;
      if (node.children) {
        const hit = findTreeNode(node.children, path);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * Expand the folders leading to `path` and scroll its row into view, so the
   * file you are editing is visible in the tree instead of hidden behind
   * collapsed folders.
   */
  let revealing = false;
  async function revealInTree(path: string | null) {
    const root = prefs().workspaceRoot;
    if (!path || !root || !isTauri() || revealing) return;
    const folders = ancestorPaths(root, path);
    if (folders.length === 0) {
      scrollRowIntoView(path);
      return;
    }
    revealing = true;
    try {
      for (const folder of folders) {
        const node = findTreeNode(tree(), folder);
        if (node?.is_dir && !node.expanded) await toggleDir(node);
      }
    } catch {
      // A folder that disappeared is not worth a message.
    } finally {
      revealing = false;
    }
    scrollRowIntoView(path);
  }

  function scrollRowIntoView(path: string) {
    requestAnimationFrame(() => {
      const selector = `[data-path="${CSS.escape(path)}"]`;
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Create an empty document in `folder` and immediately offer to name it. */
  async function newFileIn(folder: string) {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const entries = await listDirectory(folder || prefs().workspaceRoot || "");
      let name = "未命名.md";
      let counter = 2;
      while (entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
        name = `未命名 ${counter}.md`;
        counter += 1;
      }
      const target = joinPath(folder, name);
      await createDocument(target);
      await reloadTree();
      setRenameText(name);
      setRenaming(target);
    } catch (error) {
      setNotice(`Mosharp: ${errorText(error)}`);
    }
  }

  /** Create a folder and immediately offer to name it. */
  async function newFolderIn(folder: string) {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const entries = await listDirectory(folder || prefs().workspaceRoot || "");
      let name = "新建文件夹";
      let counter = 2;
      while (entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
        name = `新建文件夹 ${counter}`;
        counter += 1;
      }
      const target = joinPath(folder, name);
      await createFolder(target);
      await reloadTree();
      setRenameText(name);
      setRenaming(target);
    } catch (error) {
      setNotice(`Mosharp: ${errorText(error)}`);
    }
  }

  async function commitRename() {
    const from = renaming();
    if (!from) return;
    const typed = renameText().trim();
    setRenaming(null);
    if (!typed) return;
    // A typed name without an extension keeps the original one.
    const suffix = /\.[^.]+$/.exec(documentName(from, ""))?.[0] ?? "";
    const name = /\.[^.]+$/.test(typed) ? typed : `${typed}${suffix}`;
    const to = joinPath(parentPath(from), name);
    if (to === from) return;
    try {
      await renameEntry(from, to);
      // Renaming a folder must also repoint every tab inside it, otherwise those
      // tabs keep writing to paths that no longer exist.
      const repoint = (path: string | null) =>
        path && isInside(path, from) ? `${to}${path.slice(from.length)}` : null;
      const activePath = activeTab()?.path ?? null;
      const activeNext = repoint(activePath);
      setTabs((current) =>
        current.map((tab) => {
          const next = repoint(tab.path);
          return next ? { ...tab, path: next } : tab;
        }),
      );
      if (activeNext) {
        editor?.setDocumentPath(activeNext);
        rememberRecent(activeNext);
        void syncTitle();
      }
      await reloadTree();
      refreshWatches();
    } catch (error) {
      setNotice(`${t(locale(), "rename")}：${errorText(error)}`);
    }
  }

  async function removeEntry(path: string) {
    // A folder that still backs an open tab is refused: deleting it would leave
    // the tab writing to a path that no longer exists.
    const open = tabs().find((item) => item.path && isInside(item.path, path));
    if (open?.dirty) {
      setNotice(t(locale(), "externalConflict"));
      return;
    }
    if (open && !samePath(open.path, path)) {
      setNotice(t(locale(), "closeBeforeDelete"));
      return;
    }
    if (!window.confirm(`${t(locale(), "remove")} ${documentName(path, "")}?`)) return;    try {
      await deleteEntry(path);
      if (open) await closeTab(open.id);
      await reloadTree();
      refreshWatches();
    } catch (error) {
      setNotice(`${t(locale(), "remove")}：${errorText(error)}`);
    }
  }

  async function reloadTree(root = prefs().workspaceRoot) {
    if (!root || !isTauri()) {
      lastTreeSignature = "";
      setTree([]);
      return;
    }
    try {
      const previous = tree();
      const expanded = await collectExpanded(previous);
      const entries = await listDirectory(root);
      const next = entries.map((entry) => ({
        ...entry,
        depth: 0,
        expanded: false,
        children: entry.is_dir ? null : undefined,
      }));
      const applied = applyExpanded(next, expanded);
      const signature = treeSignature(applied);
      lastTreeError = "";
      if (signature === lastTreeSignature) return;
      lastTreeSignature = signature;
      setTree(applied);
    } catch (error) {
      // A folder that vanished or became unreadable would otherwise overwrite
      // the status bar with the same error on every poll tick.
      const message = `${t(locale(), "openFailed")}：${errorText(error)}`;
      if (message !== lastTreeError) {
        lastTreeError = message;
        setNotice(message);
      }
    }
  }

  async function toggleDir(node: TreeNode) {
    if (!node.is_dir) return;
    if (node.expanded) {
      setTree((current) => mapTree(current, node.path, (item) => ({ ...item, expanded: false })));
      return;
    }
    try {
      const children = (await listDirectory(node.path)).map((entry) => ({
        ...entry,
        depth: node.depth + 1,
        expanded: false,
        children: entry.is_dir ? null : undefined,
      }));
      setTree((current) =>
        mapTree(current, node.path, (item) => ({
          ...item,
          expanded: true,
          children,
        })),
      );
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  function mapTree(
    nodes: TreeNode[],
    path: string,
    mapper: (node: TreeNode) => TreeNode,
  ): TreeNode[] {
    return nodes.map((node) => {
      if (samePath(node.path, path)) return mapper(node);
      if (!node.children) return node;
      return { ...node, children: mapTree(node.children, path, mapper) };
    });
  }

  function flattenTree(nodes: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      out.push(node);
      if (node.expanded && node.children) out.push(...flattenTree(node.children));
    }
    return out;
  }

  /**
   * Stable description of the visible tree. Repainting an identical tree every
   * poll destroys keyboard focus, hover state and the rows themselves, so the
   * poll only commits when something actually changed.
   */
  function treeSignature(nodes: TreeNode[]): string {
    const parts: string[] = [];
    const walk = (list: TreeNode[]) => {
      for (const node of list) {
        parts.push(`${node.path}|${node.is_dir ? 1 : 0}|${node.expanded ? 1 : 0}`);
        if (node.expanded && node.children) walk(node.children);
      }
    };
    walk(nodes);
    return parts.join("\n");
  }

  async function persist(target: string, quiet = false) {
    if (!editor) return;
    let imageWarning = "";
    try {
      if (isTauri()) {
        await suppressFileWatch(target);
        const targetDir = target.replace(/[\\/][^\\/]*$/, "").replace(/\\/g, "/").toLowerCase();
        for (const image of pendingImagesIn(editor.text())) {
          // Images already sitting next to this document need no move. Moving
          // them is what used to make "Save As" fail permanently.
          const source = image.absolute.replace(/\\/g, "/").toLowerCase();
          if (source.startsWith(`${targetDir}/`)) continue;
          try {
            await placeImage(target, image.relative, image.absolute);
          } catch (error) {
            // A stranded image must never block writing the document itself.
            imageWarning = errorText(error);
          }
        }
      }
      const active = tabs().find((tab) => tab.id === activeId);
      const ending = active?.lineEnding ?? "\n";
      const encoding = active?.encoding ?? "utf-8";
      const disk = prepareForSave(editor.text(), ending);
      const buffer = savedBuffer(editor.text());
      if (buffer !== editor.text()) editor.rewrite(buffer);
      // Snapshot exactly what goes to disk. Typing during the write must not be
      // reported as saved, or the user closes the tab and loses those keystrokes.
      const written = editor.text();
      await writeDocument(target, disk, encoding);
      if (isTauri()) await touchFileWatchBaseline(target);
      const stillClean = editor.text() === written;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeId
            ? { ...tab, path: target, dirty: stillClean ? false : tab.dirty, conflicted: false }
            : tab,
        ),
      );
      if (stillClean) {
        setDirty(false);
        setDirtyBadge(false);
      }
      rememberRecent(target);
      void syncTitle();
      scheduleSessionSave();
      refreshWatches();
      editor.setDocumentPath(target);
      if (imageWarning) {
        setNotice(`${t(locale(), "savedOk")} — ${imageWarning}`);
      } else if (!quiet) {
        // Auto-save is silent; a notice on every pause would be noise.
        setNotice(t(locale(), "savedOk"));
      }
      if (prefs().workspaceRoot) void reloadTree();
    } catch (error) {
      setNotice(`${t(locale(), "saveFailed")}：${errorText(error)}`);
    }
  }

  async function exportDoc(kind: ExportKind) {
    if (!editor) return;
    const sourceMode = editor.getModes().sourceMode;
    const tab = activeTab();
    try {
      await runExport(kind, {
        markdown: editor.text(),
        cursorOffset: editor.getSelection().head,
        contentWidth: prefs().contentWidth,
        docPath: tab?.path ?? null,
        title: documentName(tab?.path ?? null, t(locale(), "untitled")),
        desktop: isTauri(),
        notice: setNotice,
        saved: t(locale(), "exportedOk"),
        failed: t(locale(), "exportFailed"),
        needDesktop: t(locale(), "needDesktop"),
        labels: {
          pdf: t(locale(), "exportPdf"),
          html: t(locale(), "exportHtml"),
          word: t(locale(), "exportWord"),
          png: t(locale(), "exportPng"),
          slidesPdf: t(locale(), "exportSlides"),
          prev: t(locale(), "slidePrev"),
          next: t(locale(), "slideNext"),
          exit: t(locale(), "slideExit"),
        },
      });
    } finally {
      if (editor.getModes().sourceMode !== sourceMode) editor.setModes({ sourceMode });
      // Export steals focus (print host, slideshow); give it back.
      editor.focus();
    }
  }

  async function saveAs() {
    if (!editor) return;
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const suggested = activeTab()?.path ?? `${t(locale(), "untitled")}.md`;
      const selected = await saveMarkdownPath(t(locale(), "save"), suggested);
      if (!selected) return;
      await persist(selected);
    } catch (error) {
      setNotice(`${t(locale(), "saveFailed")}：${errorText(error)}`);
    }
  }

  async function save() {
    const path = activeTab()?.path;
    if (path) await persist(path);
    else await saveAs();
  }

  function newDoc() {
    createTab(null, INITIAL_DOCUMENT, false);
    setNotice(t(locale(), "newDoc"));
  }

  async function loadBenchmark() {
    if (!editor) return;
    setNotice(`${t(locale(), "benchmark")} …`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const generatedAt = performance.now();
    const text = generateBenchmark(BENCHMARK_LINES);
    const generateMs = performance.now() - generatedAt;

    setNotice(`${t(locale(), "benchmark")} …`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    createTab(null, text, false);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const samples = editor.measureInput();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const scrollMs = await editor.measureScroll();
    const maxInput = Math.max(...samples);
    refreshStats();
    refreshOutline();
    setNotice(
      `${t(locale(), "benchmark")}: ${BENCHMARK_LINES.toLocaleString(locale())} · ` +
        `${formatMs(generateMs)} / ${formatMs(maxInput)} / ${formatMs(scrollMs)} ms`,
    );
  }

  function startResize(event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = prefs().panelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      patchPrefs({ panelWidth: clampPanelWidth(startWidth + (moveEvent.clientX - startX)) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Keyboard equivalent of dragging the sidebar edge. */
  function resizeByKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = prefs().panelWidth - step;
    else if (event.key === "ArrowRight") next = prefs().panelWidth + step;
    else if (event.key === "Home") next = MIN_PANEL;
    else if (event.key === "End") next = MAX_PANEL;
    if (next === null) return;
    event.preventDefault();
    patchPrefs({ panelWidth: clampPanelWidth(next) });
  }

  /** Arrow keys move between tree rows instead of tabbing through all of them. */
  function treeKeyDown(event: KeyboardEvent) {
    const items = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const focusAt = (target: number) => {
      items[Math.max(0, Math.min(items.length - 1, target))]?.focus();
    };
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
    }
  }

  async function copyPath(path: string | null | undefined) {
    if (!path) {
      setNotice(t(locale(), "noPath"));
      return;
    }
    await navigator.clipboard.writeText(path);
    setNotice(t(locale(), "copied"));
  }

  async function reveal(path: string | null | undefined) {
    if (!path) {
      setNotice(t(locale(), "noPath"));
      return;
    }
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      await revealInFolder(path);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  /** The recovery folder was written by the app but had no entry point. */
  async function openRecoveryFolder() {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      await revealInFolder(await recoveryFolder());
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function resetPreferences() {
    const defaults = defaultPreferencesFor();
    persistPrefs(defaults);
    setNotice(t(defaults.locale, "restoreDefaults"));
  }

  function closeMenu() {
    setMenu(null);
  }

  function edit(action: Parameters<NonNullable<typeof editor>["run"]>[0]) {
    if (!editor) return;
    editor.run(action);
    editor.focus();
  }

  function menus(): MenuDef[] {
    const lang = locale();
    const label = (key: Parameters<typeof t>[1]) => t(lang, key);
    const recentItems = recent();
    return [
      {
        id: "file",
        label: label("menuFile"),
        access: "F",
        items: [
          { id: "new", label: label("new"), shortcut: shortcut("newFile"), run: () => newDoc() },
          { id: "open", label: label("open"), shortcut: shortcut("open"), run: () => void openDoc() },
          {
            id: "open-folder",
            label: label("openFolder"),
            shortcut: shortcut("openFolder"),
            run: () => void openFolder(),
          },
          {
            id: "recent",
            label: label("recent"),
            children:
              recentItems.length > 0
                ? recentItems.map((item) => ({
                    id: item.path,
                    label: documentName(item.path, label("untitled")),
                    run: () => void openPathInTab(item.path),
                  }))
                : [{ id: "no-recent", label: label("noRecent"), disabled: true }],
          },
          { id: "sep-file-1", sep: true },
          { id: "save", label: label("save"), shortcut: shortcut("save"), run: () => void save() },
          { id: "save-as", label: label("saveAs"), shortcut: shortcut("saveAs"), run: () => void saveAs() },
          {
            id: "export",
            label: label("exportMenu"),
            children: [
              { id: "export-pdf", label: label("exportPdf"), run: () => void exportDoc("pdf") },
              { id: "export-html", label: label("exportHtml"), run: () => void exportDoc("html") },
              { id: "export-word", label: label("exportWord"), run: () => void exportDoc("word") },
              { id: "export-png", label: label("exportPng"), run: () => void exportDoc("png") },
              { id: "slideshow", label: label("slideshow"), run: () => void exportDoc("slides") },
              { id: "export-slides", label: label("exportSlides"), run: () => void exportDoc("slidesPdf") },
            ],
          },
          { id: "sep-file-2", sep: true },
          {
            id: "close-tab",
            label: label("close"),
            run: () => {
              if (activeId) void closeTab(activeId);
            },
          },
        ],
      },
      {
        id: "edit",
        label: label("menuEdit"),
        access: "E",
        items: [
          { id: "undo", label: label("undo"), shortcut: "Ctrl+Z", run: () => edit((view) => undo(view)) },
          { id: "redo", label: label("redo"), shortcut: "Ctrl+Y", run: () => edit((view) => redo(view)) },
          { id: "sep-edit", sep: true },
          {
            id: "find",
            label: label("find"),
            shortcut: "Ctrl+F",
            run: () => edit((view) => openSearchPanel(view)),
          },
          { id: "sep-edit-2", sep: true },
          {
            id: "copy-path",
            label: label("copyPath"),
            run: () => void copyPath(activeTab()?.path),
          },
          {
            id: "reveal",
            label: label("reveal"),
            run: () => void reveal(activeTab()?.path),
          },
          {
            id: "undo-replace",
            label: label("undoReplace"),
            run: () => void undoReplace(),
          },
        ],
      },
      {
        id: "paragraph",
        label: label("menuParagraph"),
        access: "P",
        items: [
          { id: "h1", label: label("heading1"), run: () => edit((view) => insertHeading(view, 1)) },
          { id: "h2", label: label("heading2"), run: () => edit((view) => insertHeading(view, 2)) },
          { id: "h3", label: label("heading3"), run: () => edit((view) => insertHeading(view, 3)) },
          { id: "sep-p", sep: true },
          { id: "bullet", label: label("bullet"), run: () => edit((view) => insertBullet(view)) },
          {
            id: "task",
            label: label("task"),
            shortcut: shortcut("task"),
            run: () => edit((view) => toggleTask(view)),
          },
          { id: "quote", label: label("quote"), run: () => edit((view) => insertQuote(view)) },
          { id: "sep-p2", sep: true },
          { id: "fence", label: label("fence"), run: () => edit((view) => insertFence(view)) },
          { id: "math", label: label("math"), run: () => edit((view) => insertMathBlock(view)) },
          { id: "table", label: label("table"), run: () => edit((view) => insertTable(view)) },
          { id: "hr", label: label("hr"), run: () => edit((view) => insertHr(view)) },
          { id: "mermaid", label: "Mermaid", run: () => edit((view) => insertMermaid(view)) },
          { id: "vega", label: "Vega-Lite", run: () => edit((view) => insertVega(view)) },
          { id: "plantuml", label: "PlantUML", run: () => edit((view) => insertPlantuml(view)) },
        ],
      },
      {
        id: "format",
        label: label("menuFormat"),
        access: "O",
        items: [
          { id: "bold", label: label("bold"), shortcut: shortcut("bold"), run: () => edit((view) => toggleBold(view)) },
          { id: "italic", label: label("italic"), shortcut: shortcut("italic"), run: () => edit((view) => toggleItalic(view)) },
          {
            id: "code",
            label: label("inlineCode"),
            shortcut: shortcut("code"),
            run: () => edit((view) => toggleCode(view)),
          },
          {
            id: "highlight",
            label: label("highlight"),
            shortcut: shortcut("highlight"),
            run: () => edit((view) => toggleHighlight(view)),
          },
          {
            id: "strike",
            label: label("strike"),
            shortcut: shortcut("strike"),
            run: () => edit((view) => toggleStrike(view)),
          },
          { id: "link", label: label("link"), shortcut: shortcut("link"), run: () => edit((view) => insertLink(view)) },
          {
            id: "format-more",
            label: label("formatMore"),
            children: [
              { id: "sup", label: label("sup"), run: () => edit((view) => toggleSup(view)) },
              { id: "sub", label: label("sub"), run: () => edit((view) => toggleSub(view)) },
              { id: "footnote", label: label("footnote"), run: () => edit((view) => insertFootnote(view)) },
            ],
          },
        ],
      },
      {
        id: "view",
        label: label("menuView"),
        access: "V",
        items: [
          {
            id: "panel",
            label: label("panel"),
            shortcut: shortcut("toggleSidebar"),
            checked: prefs().panelOpen,
            run: () => patchPrefs({ panelOpen: !prefs().panelOpen }),
          },
          {
            id: "files",
            label: label("files"),
            checked: prefs().panelMode === "files",
            run: () => patchPrefs({ panelOpen: true, panelMode: "files" }),
          },
          {
            id: "outline",
            label: label("outline"),
            checked: prefs().panelMode === "outline",
            run: () => patchPrefs({ panelOpen: true, panelMode: "outline" }),
          },
          { id: "sep-view", sep: true },
          {
            id: "source",
            label: label("sourceMode"),
            shortcut: shortcut("sourceMode"),
            checked: prefs().sourceMode,
            run: () => toggleMode("sourceMode"),
          },
          {
            id: "typewriter",
            label: label("typewriter"),
            checked: prefs().typewriter,
            run: () => toggleMode("typewriter"),
          },
          {
            id: "focus",
            label: label("focusMode"),
            checked: prefs().focusMode,
            run: () => toggleMode("focusMode"),
          },
          { id: "sep-view-2", sep: true },
          ...CONTENT_WIDTHS.map((width) => ({
            id: `width-${width}`,
            label: `${label("width")} ${width}`,
            checked: prefs().contentWidth === width,
            run: () => patchPrefs({ contentWidth: width }),
          })),
          { id: "sep-view-3", sep: true },
          { id: "zoom-in", label: label("zoomIn"), shortcut: "Ctrl+=", run: () => stepZoom(1) },
          { id: "zoom-out", label: label("zoomOut"), shortcut: "Ctrl+-", run: () => stepZoom(-1) },
          { id: "zoom-reset", label: label("zoomReset"), shortcut: "Ctrl+0", run: () => stepZoom(0) },
          { id: "sep-view-4", sep: true },
          ...LOCALES.map((id) => ({
            id: `lang-${id}`,
            label: LOCALE_LABELS[id],
            checked: lang === id,
            run: () => {
              patchPrefs({ locale: id });
              setNotice(t(id, "ready"));
              void syncTitle();
            },
          })),
        ],
      },
      {
        id: "theme",
        label: label("menuTheme"),
        access: "T",
        items: [
          ...THEMES.filter((item) => item.scheme === "light").map((item) => ({
            id: `theme-${item.id}`,
            label: themeLabel(item.id, lang),
            checked: prefs().theme === item.id,
            run: () => patchPrefs({ theme: item.id }),
          })),
          { id: "sep-theme", sep: true },
          ...THEMES.filter((item) => item.scheme === "dark").map((item) => ({
            id: `theme-${item.id}`,
            label: themeLabel(item.id, lang),
            checked: prefs().theme === item.id,
            run: () => patchPrefs({ theme: item.id }),
          })),
        ],
      },
      {
        id: "help",
        label: label("menuHelp"),
        access: "H",
        items: [
          {
            id: "settings",
            label: label("settings"),
            shortcut: shortcut("settings"),
            run: () => setSettingsOpen(true),
          },
          {
            id: "palette",
            label: label("commandPalette"),
            shortcut: shortcut("commandPalette"),
            run: () => setPaletteOpen(true),
          },
          { id: "benchmark", label: label("benchmark"), run: () => void loadBenchmark() },
          { id: "sep-help", sep: true },
          {
            id: "open-recovery",
            label: label("openRecovery"),
            run: () => void openRecoveryFolder(),
          },
          {
            id: "browse-recovery",
            label: label("recoveryCopies"),
            run: () => setRecoveryOpen(true),
          },
          {
            id: "reset-prefs",
            label: label("restoreDefaults"),
            run: () => resetPreferences(),
          },
        ],
      },
    ];
  }

  async function restoreSession(): Promise<boolean> {
    if (!editor) return false;
    const session = loadSession();
    if (!session?.tabs.length) return false;

    restoringSession = true;
    try {
      const created: TabRecord[] = [];
      let dropped = 0;
      for (const snap of session.tabs) {
        // A single malformed tab must never abort the whole restore: that used
        // to leave the window open with zero tabs.
        try {
          let content = snap.content;
          let dirtyValue = snap.dirty;
          const path = snap.path;
          let lineEnding: LineEnding = snap.lineEnding === "\r\n" ? "\r\n" : "\n";
          let encoding = normalizeEncoding(snap.encoding);
          const lostBuffer = Boolean(snap.contentDropped) && dirtyValue;

          if (path && isTauri()) {
            try {
              const opened = await readDocument(path);
              lineEnding = detectLineEnding(opened.content);
              encoding = normalizeEncoding(opened.encoding);
              if (snap.dirty && snap.content && !sameText(snap.content, opened.content)) {
                content = snap.content;
                dirtyValue = true;
              } else {
                content = opened.content;
                dirtyValue = false;
              }
            } catch {
              content = snap.content || INITIAL_DOCUMENT;
              dirtyValue = true;
            }
          } else if (!content) {
            content = INITIAL_DOCUMENT;
          }
          if (lostBuffer) dropped += 1;

          const base = editor.createState(content);
          const max = base.doc.length;
          const anchor = Number.isFinite(snap.selection?.anchor) ? snap.selection.anchor : 0;
          const head = Number.isFinite(snap.selection?.head) ? snap.selection.head : anchor;
          const state = base.update({
            selection: {
              anchor: Math.max(0, Math.min(anchor, max)),
              head: Math.max(0, Math.min(head, max)),
            },
          }).state;
          created.push({
            id: newTabId(),
            path,
            dirty: dirtyValue,
            state,
            scrollTop: Number.isFinite(snap.scrollTop) ? snap.scrollTop : 0,
            lineEnding,
            encoding,
          });
          if (path) rememberRecent(path);
        } catch {
          // Skip the broken tab, keep the rest.
        }
      }

      if (created.length === 0) return false;
      if (dropped > 0) setNotice(t(locale(), "restoreDropped"));

      const active = created[Math.min(session.activeIndex, created.length - 1)];
      setTabs(created);
      activeId = active.id;
      setActiveTabId(active.id);
      editor.setState(active.state!);
      editor.setDocumentPath(active.path);
      editor.setScrollTop(active.scrollTop);
      setDirty(active.dirty);
      setDirtyBadge(false);
      refreshStats();
      refreshOutline();
      void syncTitle();
      refreshWatches();
      editor.focus();
      return true;
    } catch {
      return false;
    } finally {
      restoringSession = false;
    }
  }

  async function onExternalDocumentChange(path: string, kind: string) {
    void reloadTree();
    const tab = tabs().find((item) => samePath(item.path, path));
    if (!tab?.path) return;

    if (kind === "remove") {
      setNotice(t(locale(), "externalRemoved"));
      return;
    }
    if (tab.dirty) {
      // Remember the conflict so auto-save refuses to overwrite the external
      // edit until the user saves explicitly.
      setTabs((current) =>
        current.map((item) => (item.id === tab.id ? { ...item, conflicted: true } : item)),
      );
      setNotice(t(locale(), "externalConflict"));
      return;
    }
    try {
      const opened = await readDocument(tab.path);
      // Re-read the live record: the user may have typed while the disk read
      // was in flight, and that text must not be replaced.
      const liveTab = tabs().find((item) => item.id === tab.id);
      if (!liveTab) return;
      const livePath = liveTab.path;
      if (!livePath) return;
      if (liveTab.dirty) {
        setTabs((current) =>
          current.map((item) => (item.id === liveTab.id ? { ...item, conflicted: true } : item)),
        );
        setNotice(t(locale(), "externalConflict"));
        return;
      }
      const current =
        liveTab.id === activeId && editor
          ? editor.text()
          : (liveTab.state?.doc.toString() ?? "");
      if (sameText(current, opened.content)) {
        const lineEnding = detectLineEnding(opened.content);
        if (liveTab.lineEnding !== lineEnding) {
          setTabs((items) =>
            items.map((item) => (item.id === liveTab.id ? { ...item, lineEnding } : item)),
          );
        }
        if (isTauri()) await touchFileWatchBaseline(livePath);
        return;
      }

      const lineEnding = detectLineEnding(opened.content);
      if (liveTab.id === activeId && editor) {
        const scrollTop = editor.getScrollTop();
        const selection = editor.getSelection();
        editor.replace(opened.content);
        editor.setSelection(selection.anchor, selection.head);
        editor.setScrollTop(scrollTop);
        setTabs((current) =>
          current.map((item) =>
            item.id === liveTab.id
              ? { ...item, dirty: false, state: editor!.getState(), scrollTop, lineEnding }
              : item,
          ),
        );
        setDirty(false);
        setDirtyBadge(false);
        refreshStats();
        refreshOutline();
        void syncTitle();
      } else if (editor) {
        const state = editor.createState(opened.content);
        setTabs((current) =>
          current.map((item) =>
            item.id === liveTab.id ? { ...item, dirty: false, state, lineEnding } : item,
          ),
        );
      }
      if (isTauri()) await touchFileWatchBaseline(livePath);
      scheduleSessionSave();
      setNotice(t(locale(), "externalReload"));
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  /**
   * Open the documents Windows passed on the command line (Explorer
   * double-click / file association).
   */
  async function openStartupPaths(paths: string[]) {
    if (!isTauri() || paths.length === 0) return;
    const blanks = tabs().filter((tab) => !tab.path && !tab.dirty).map((tab) => tab.id);
    for (const path of paths) await openPathInTab(path);
    // Only discard the empty placeholder if a requested file really opened.
    if (!tabs().some((tab) => tab.path)) return;
    if (blanks.length > 0) {
      setTabs((current) => current.filter((tab) => !blanks.includes(tab.id)));
    }
  }

  /** Used by the single-instance event: the window is already running. */

  async function minimizeWindow() {
    if (!isTauri()) return;
    await getCurrentWindow().minimize();
  }

  async function toggleWindow() {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize();
  }

  async function closeWindow() {
    if (!isTauri()) return;
    await getCurrentWindow().close();
  }

  onMount(() => {
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void appWindow.setDecorations(false).catch(() => {});
      void fetch(logoUrl)
        .then((response) => response.arrayBuffer())
        .then((buffer) => appWindow.setIcon(new Uint8Array(buffer)))
        .catch(() => {});
    }
    persistPrefs(initialPrefs);
    setNotice(t(initialPrefs.locale, "ready"));

    try {
      editor = createEditor(host, {
        onEdit() {
          refreshStats();
          scheduleOutlineRefresh();
          markActiveDirty(true);
        },
        initialModes: {
          sourceMode: initialPrefs.sourceMode,
          typewriter: initialPrefs.typewriter,
          focus: initialPrefs.focusMode,
        },
        locale: initialPrefs.locale,
      });
    } catch (error) {
      setNotice(`Mosharp: ${errorText(error)}`);
      return;
    }
    applyEditorPrefs();

    void (async () => {
      // A file passed by Explorer means "open this document", not "continue
      // where I left off": restoring the previous session on top of it made
      // the old tabs reappear whenever a new file was double-clicked.
      let startup: string[] = [];
      if (isTauri()) {
        try {
          startup = await takeStartupFiles();
        } catch {
          startup = [];
        }
      }
      const restored = startup.length === 0 ? await restoreSession() : false;
      if (!restored) {
        const firstId = newTabId();
        activeId = firstId;
        setTabs([
          {
            id: firstId,
            path: null,
            dirty: false,
            state: editor!.getState(),
            scrollTop: 0,
            lineEnding: "\n",
            encoding: "utf-8",
          },
        ]);
        setActiveTabId(firstId);
        refreshStats();
        refreshOutline();
        void syncTitle();
        editor!.focus();
      } else {
        setNotice(t(locale(), "restored"));
      }
      await openStartupPaths(startup);
    })();

    if (initialPrefs.workspaceRoot && isTauri()) {
      void reloadTree(initialPrefs.workspaceRoot);
    }

    const stopScroll = editor.onScroll(() => {
      // Debounce UI/session work so scrollbar drag stays fluid.
      if (scrollUiTimer) clearTimeout(scrollUiTimer);
      scrollUiTimer = setTimeout(() => {
        scrollUiTimer = null;
        setActiveHeading(activeOutlineIndex(outline(), editor!.firstVisibleLine()));
        scheduleSessionSave();
      }, 120);
    });

    treePollTimer = setInterval(() => {
      if (prefs().panelOpen && prefs().panelMode === "files" && prefs().workspaceRoot) {
        void reloadTree();
      }
    }, 2000);

    const onKeyDown = (event: KeyboardEvent) => {
      // Window zoom. Handled before the shortcut map so it works even while a
      // user shortcut shadows the same chord, and never reaches the WebView's
      // own zoom handling.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          stepZoom(1);
          return;
        }
        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          stepZoom(-1);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          stepZoom(0);
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusFileSearch();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        void reopenTab();
        return;
      }
      if (event.key === "Escape") {
        // One layer per press, innermost first, and give focus back to the
        // editor so typing works again immediately.
        if (menu()) {
          closeMenu();
          return;
        }
        if (paletteOpen()) {
          setPaletteOpen(false);
          editor?.focus();
          return;
        }
        if (settingsOpen() && !document.querySelector(".settings-dialog.recording")) {
          setSettingsOpen(false);
          editor?.focus();
        }
        return;
      }
      if (document.querySelector(".settings-dialog.recording")) return;
      // An open dialog owns the keyboard; global commands must not fire behind it.
      if (paletteOpen() || settingsOpen()) return;
      const chord = chordFromEvent(event);
      if (!chord) return;
      // Modifier-less chords are typing, not commands (and the recorder now
      // refuses them). Ctrl/Alt chords stay global so Ctrl+S works from the
      // sidebar search box too.
      if (!hasCommandModifier(chord) && isTextEntryTarget(event.target)) return;
      const hit = (id: ShortcutId) => shortcut(id) === chord;
      const run = (fn: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        fn();
      };
      if (hit("saveAs")) return run(() => void saveAs());
      if (hit("save")) return run(() => void save());
      if (hit("openFolder")) return run(() => void openFolder());
      if (hit("open")) return run(() => void openDoc());
      if (hit("newFile") || (shortcut("newFile") === "Ctrl+T" && chord === "Ctrl+N")) {
        return run(() => newDoc());
      }
      if (hit("closeTab")) return run(() => void closeTab(activeId));
      if (hit("toggleSidebar")) return run(() => patchPrefs({ panelOpen: !prefs().panelOpen }));
      if (hit("sourceMode")) return run(() => toggleMode("sourceMode"));
      if (hit("commandPalette")) return run(() => setPaletteOpen(true));
      if (hit("settings")) return run(() => setSettingsOpen(true));
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("click", closeMenu);
    window.addEventListener("beforeunload", flushSession);
    // Widgets live inside the editor and have no access to the notice signal.
    const onWidgetNotice = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) setNotice(detail);
    };
    window.addEventListener("mosharp-notice", onWidgetNotice);

    let unlistenClose: (() => void) | undefined;
    let unlistenChange: (() => void) | undefined;
    let unlistenOpen: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    if (isTauri()) {
      void listen<number>("mosharp-confirm-close", (event) => {
        const token = event.payload;
        void (async () => {
          try {
            await ackClosePrompt(token);
          } catch {
            // Never leave Rust waiting on a token that will not be resolved —
            // that makes the window permanently unclosable.
            await resolveClose(token, false).catch(() => {});
            return;
          }
          captureActive();
          flushSession();
          const dirtyTabs = tabs().filter((tab) => tab.dirty);
          if (dirtyTabs.length === 0) {
            await resolveClose(token, true);
            return;
          }
          let confirmed = false;
          try {
            confirmed = await ask(t(locale(), "discardClose"), {
              title: "Mosharp",
              kind: "warning",
            });
          } catch {
            confirmed = window.confirm(t(locale(), "discardClose"));
          }
          if (confirmed) {
            for (const tab of dirtyTabs) await backupTab(tab);
          }
          await resolveClose(token, confirmed);
        })();
      }).then((stop) => {
        unlistenClose = stop;
      });

      void listen<{ path: string; kind: string }>("document-changed", (event) => {
        void onExternalDocumentChange(event.payload.path, event.payload.kind);
      }).then((stop) => {
        unlistenChange = stop;
      });

      // A second launch (another double-click) is routed into this window.
      void listen<string[]>("mosharp-open-files", (event) => {
        for (const path of event.payload) void openPathInTab(path);
      }).then((stop) => {
        unlistenOpen = stop;
      });

      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const kind = event.payload.type;
          if (kind === "enter") setDropHover(true);
          else if (kind === "leave") setDropHover(false);
          else if (kind === "drop") {
            setDropHover(false);
            void openDroppedPaths(event.payload.paths);
          }
        })
        .then((stop) => {
          unlistenDrop = stop;
        });
    }

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropHover(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && document.documentElement.contains(next)) return;
      setDropHover(false);
    };
    const onFileDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropHover(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      const nativePaths = files
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => Boolean(path));
      if (nativePaths.length) {
        void openDroppedPaths(nativePaths);
        return;
      }
      if (isTauri()) return;
      void openDroppedFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onFileDrop, true);

    onCleanup(() => {
      flushSession();
      stopScroll();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("beforeunload", flushSession);
      window.removeEventListener("mosharp-notice", onWidgetNotice);
      if (dirtyFadeTimer) clearTimeout(dirtyFadeTimer);
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (searchTimer) clearTimeout(searchTimer);
      if (wordCountTimer) clearTimeout(wordCountTimer);
      if (treePollTimer) clearInterval(treePollTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
      if (scrollUiTimer) clearTimeout(scrollUiTimer);
      unlistenClose?.();
      unlistenChange?.();
      unlistenOpen?.();
      unlistenDrop?.();
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onFileDrop, true);
      editor?.destroy();
    });
  });

  function toggleMode(key: "sourceMode" | "typewriter" | "focusMode") {
    const next = !prefs()[key];
    patchPrefs({ [key]: next });
    if (!editor) return;
    if (key === "sourceMode") editor.setModes({ sourceMode: next });
    else if (key === "typewriter") editor.setModes({ typewriter: next });
    else editor.setModes({ focus: next });
  }

  const flatTree = createMemo(() => flattenTree(tree()));

  // Keep the active file visible in the tree. Runs after the tab switch settles
  // so the tree state is read outside this reactive computation.
  createEffect(() => {
    const path = activeTab()?.path ?? null;
    const root = prefs().workspaceRoot;
    if (!path || !root) return;
    if (!prefs().panelOpen || prefs().panelMode !== "files") return;
    Promise.resolve().then(() => void revealInTree(path));
  });
  /** Outline filtered by the panel's own search box. */
  const visibleOutline = createMemo(() => {
    const query = outlineQuery().trim().toLowerCase();
    const items = outline();
    if (!query) return items;
    return items.filter((item) => item.text.toLowerCase().includes(query));
  });
  const visibleFiles = createMemo(() => {
    const query = fileQuery().trim().toLowerCase();
    const nodes = flatTree();
    if (!query) return nodes;
    return nodes.filter((node) => node.name.toLowerCase().includes(query));
  });

  function paletteActions(): PaletteAction[] {
    const actions: PaletteAction[] = [];
    const walk = (items: MenuEntry[], prefix: string) => {
      for (const item of items) {
        if (item.sep || !item.label) continue;
        if (item.children?.length) walk(item.children, `${prefix}${item.label} / `);
        if (item.run && !item.children?.length) {
          actions.push({
            id: item.id,
            label: `${prefix}${item.label}`,
            shortcut: item.shortcut,
            run: item.run,
          });
        }
      }
    };
    for (const menu of menus()) walk(menu.items, `${menu.label} / `);
    return actions;
  }

  /** Apply the persisted window zoom and keep the WebView's layout in sync. */
  createEffect(() => {
    const value = prefs().zoom;
    const root = document.documentElement;
    // `vh`/`vw` lengths are scaled by `zoom`, so a viewport-sized overlay would
    // grow past the window. Overlays divide their viewport sizing by this.
    root.style.setProperty("--ui-zoom", String(value));
    if (root.style.zoom === String(value)) return;
    root.style.zoom = String(value);
    // CodeMirror re-measures on window resize; a zoom change does not fire one,
    // so nudge it or the caret coordinates stay stale until the next edit.
    window.dispatchEvent(new Event("resize"));
  });

  /** Turning auto-save off must also drop a write that is already scheduled. */
  createEffect(() => {
    if (prefs().autoSave) return;
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  });

  /**
   * Sidebar search runs in the backend: the tree is loaded lazily, so filtering
   * it would silently miss every file inside a folder the user has not expanded.
   */
  createEffect(() => {
    const query = fileQuery().trim();
    const root = prefs().workspaceRoot;
    searchTick();
    if (searchTimer) clearTimeout(searchTimer);
    if (!query || !root || !isTauri()) {
      searchSeq += 1;
      setSearchHits({ names: [], matches: [], truncated: false });
      setSearchBusy(false);
      return;
    }
    const seq = (searchSeq += 1);
    setSearchBusy(true);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void searchWorkspace(root, query, 200)
        .then((result) => {
          if (seq !== searchSeq) return;
          setSearchHits(result);
          setMatchIndex(-1);
        })
        .catch(() => {
          if (seq !== searchSeq) return;
          setSearchHits({ names: [], matches: [], truncated: false });
        })
        .finally(() => {
          if (seq === searchSeq) setSearchBusy(false);
        });
    }, 220);
  });

  async function openSearchHit(path: string, line: number) {
    await openPathInTab(path);
    editor?.jumpToLine(line);
  }

  /** Up/down buttons walk the content matches in order, wrapping at the ends. */
  function stepMatch(delta: number) {
    const list = searchHits().matches;
    if (list.length === 0) return;
    const next = (((matchIndex() + delta) % list.length) + list.length) % list.length;
    setMatchIndex(next);
    void openSearchHit(list[next].path, list[next].line);
  }

  /**
   * Replace the search term across every file that currently has a content
   * match. Files open in a tab are skipped: rewriting a buffer that the user is
   * editing would either lose their changes or fight with the watcher.
   */
  async function replaceInWorkspace() {
    const query = fileQuery().trim();
    if (!query || !isTauri() || replacing()) return;
    const files = [...new Set(searchHits().matches.map((hit) => hit.path))];
    if (files.length === 0) return;
    const question = `${t(locale(), "replaceAll")} — ${files.length}\n\n${t(locale(), "replaceBackup")}`;
    let confirmed = false;
    try {
      confirmed = isTauri()
        ? await ask(question, { title: "Mosharp", kind: "warning" })
        : window.confirm(question);
    } catch {
      confirmed = window.confirm(question);
    }
    if (!confirmed) return;
    setReplacing(true);
    let edited = 0;
    let hits = 0;
    let skipped = 0;
    const entries: ReplaceEntry[] = [];
    for (const path of files) {
      if (tabs().some((tab) => samePath(tab.path, path))) {
        skipped += 1;
        continue;
      }
      try {
        const opened = await readDocument(path);
        const result = replaceAllText(opened.content, query, replaceText());
        if (result.count === 0) continue;
        // This operation has no undo, so a copy goes to the recovery folder
        // first. If the backup cannot be written, the file is left untouched.
        const backup = await saveRecoveryCopy(`替换前-${documentName(path, "doc")}`, opened.content);
        entries.push({
          original: path,
          backup,
          encoding: normalizeEncoding(opened.encoding),
        });
        // Keep the watcher quiet: we already know we changed the file.
        await suppressFileWatch(path);
        await writeDocument(path, result.text, normalizeEncoding(opened.encoding));
        await touchFileWatchBaseline(path);
        edited += 1;
        hits += result.count;
      } catch {
        skipped += 1;
      }
    }
    setReplacing(false);
    if (entries.length > 0) {
      const run: ReplaceRun = {
        at: Date.now(),
        query,
        replacement: replaceText(),
        entries,
      };
      const runs = appendRun(loadReplaceRuns(), run);
      saveReplaceRuns(runs);
    }
    const detail = skipped > 0 ? ` · ${t(locale(), "replaceSkipped")} ${skipped}` : "";
    setNotice(`${t(locale(), "replaceDone")} ${hits} / ${edited}${detail}`);
    setSearchTick((value) => value + 1);
  }

  const REPLACE_LOG_KEY = "mosharp.replaceLog";

  function loadReplaceRuns(): ReplaceRun[] {
    try {
      return parseRuns(localStorage.getItem(REPLACE_LOG_KEY));
    } catch {
      return [];
    }
  }

  function saveReplaceRuns(runs: ReplaceRun[]) {
    try {
      localStorage.setItem(REPLACE_LOG_KEY, JSON.stringify(runs));
    } catch {
      // A full quota only costs the undo history.
    }
  }

  /** Re-read one tab from disk after its file was restored. */
  async function reloadTabFromDisk(id: string) {
    const tab = tabs().find((item) => item.id === id);
    if (!tab?.path || !editor) return;
    const opened = await readDocument(tab.path);
    const lineEnding = detectLineEnding(opened.content);
    if (tab.id === activeId) {
      const scrollTop = editor.getScrollTop();
      editor.replace(opened.content);
      editor.setScrollTop(scrollTop);
      setTabs((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, dirty: false, conflicted: false, state: editor!.getState(), scrollTop, lineEnding }
            : item,
        ),
      );
      setDirty(false);
      setDirtyBadge(false);
      refreshStats();
      refreshOutline();
    } else {
      const state = editor.createState(opened.content);
      setTabs((current) =>
        current.map((item) =>
          item.id === id ? { ...item, dirty: false, conflicted: false, state, lineEnding } : item,
        ),
      );
    }
    await touchFileWatchBaseline(tab.path);
  }

  /**
   * Restore every file from the most recent replacement's recovery copies.
   * Only the newest run that has not been undone yet is reversed; older ones
   * stay available for another press.
   */
  async function undoReplace() {
    if (!isTauri()) return;
    const runs = loadReplaceRuns();
    const run = lastUndoableRun(runs);
    if (!run) {
      setNotice(t(locale(), "replaceNothing"));
      return;
    }
    const question = `${t(locale(), "undoReplace")} — ${run.entries.length}\n\n${run.query}`;
    let confirmed = false;
    try {
      confirmed = await ask(question, { title: "Mosharp", kind: "warning" });
    } catch {
      confirmed = window.confirm(question);
    }
    if (!confirmed) return;

    let restored = 0;
    let failed = 0;
    for (const entry of run.entries) {
      try {
        const copy = await readDocument(entry.backup);
        await suppressFileWatch(entry.original);
        await writeDocument(entry.original, copy.content, normalizeEncoding(entry.encoding));
        await touchFileWatchBaseline(entry.original);
        restored += 1;
      } catch {
        failed += 1;
      }
    }
    saveReplaceRuns(markUndone(runs, run.at, Date.now()));
    // Open buffers keep their old text; reload the ones restored on disk.
    for (const tab of tabs()) {
      if (tab.path && run.entries.some((entry) => samePath(entry.original, tab.path))) {
        await reloadTabFromDisk(tab.id);
      }
    }
    setSearchTick((value) => value + 1);
    const detail = failed > 0 ? ` · ${t(locale(), "replaceSkipped")} ${failed}` : "";
    setNotice(`${t(locale(), "replaceUndone")} ${restored}${detail}`);
  }

  /** Split a preview line so the matched term can be highlighted. */  function highlightParts(text: string, query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [{ text, hit: false }];
    const parts: Array<{ text: string; hit: boolean }> = [];
    const lower = text.toLowerCase();
    let at = 0;
    while (at <= text.length - needle.length) {
      const found = lower.indexOf(needle, at);
      if (found < 0) break;
      if (found > at) parts.push({ text: text.slice(at, found), hit: false });
      parts.push({ text: text.slice(found, found + needle.length), hit: true });
      at = found + needle.length;
    }
    if (at < text.length) parts.push({ text: text.slice(at), hit: false });
    return parts.length > 0 ? parts : [{ text, hit: false }];
  }

  let appliedEditorPrefs = "";
  createEffect(() => {
    const current = prefs();
    const key = [
      current.sourceMode,
      current.typewriter,
      current.focusMode,
      current.spellcheck,
      current.spellLang,
      current.footnotes,
      current.emoji,
      current.superSub,
      current.pandocMath,
      current.customWords,
      current.pasteImages,
      current.locale,
      JSON.stringify(current.shortcuts),
    ].join("|");
    if (!editor || key === appliedEditorPrefs) return;
    appliedEditorPrefs = key;
    applyEditorPrefs();
  });

  return (
    <div class="app">
      <Show when={dropHover()}>
        <div class="drop-overlay" role="status">
          {t(locale(), "dropToOpen")}
        </div>
      </Show>
      <Show when={paletteOpen()}>
        <CommandPalette
          actions={paletteActions()}
          placeholder={t(locale(), "commandPalette")}
          empty={t(locale(), "noCommand")}
          onClose={() => {
            setPaletteOpen(false);
            editor?.focus();
          }}
        />
      </Show>
      <Show when={settingsOpen()}>
        <SettingsDialog
          locale={locale()}
          prefs={prefs()}
          onChange={patchPrefs}
          onClose={() => {
            setSettingsOpen(false);
            editor?.focus();
          }}
        />
      </Show>
      <Show when={recoveryOpen()}>
        <RecoveryDialog
          locale={locale()}
          onOpen={(path) => {
            setRecoveryOpen(false);
            void openPathInTab(path);
          }}
          onClose={() => {
            setRecoveryOpen(false);
            editor?.focus();
          }}
        />
      </Show>
      <header class="chrome">
        <div class="titlebar">
        <div class="chrome-brand" data-tauri-drag-region>
          <img class="app-logo" src={logoUrl} alt="" draggable={false} />
        </div>
        <div class="tabs" role="tablist">
          <For each={tabs()}>
            {(tab) => (
              <div
                role="tab"
                class={`tab${tab.id === activeTabId() ? " active" : ""}`}
                title={tab.path ?? t(locale(), "notWritten")}
                aria-selected={tab.id === activeTabId()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    kind: "tab",
                    tabId: tab.id,
                    path: tab.path ?? undefined,
                  });
                }}
              >
                <button type="button" class="tab-main" onClick={() => activateTab(tab.id)}>
                  <span class={`tab-dot${tab.dirty ? " on" : ""}`} aria-hidden="true">
                    ●
                  </span>
                  <span class="tab-name">{documentName(tab.path, t(locale(), "untitled"))}</span>
                </button>
                <button
                  type="button"
                  class="tab-close"
                  title={t(locale(), "close")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            class="tab-add"
            title={shortcut("newFile") ? `${t(locale(), "new")} (${shortcut("newFile")})` : t(locale(), "new")}
            onClick={() => newDoc()}
          >
            +
          </button>
        </div>
        <div class="chrome-drag" data-tauri-drag-region />
        <div class="window-controls">
          <button type="button" class="win-btn" title={t(locale(), "minimize")} onClick={() => void minimizeWindow()}>
            <span class="win-min" aria-hidden="true" />
          </button>
          <button type="button" class="win-btn" title={t(locale(), "maximize")} onClick={() => void toggleWindow()}>
            <span class="win-max" aria-hidden="true" />
          </button>
          <button type="button" class="win-btn win-close" title={t(locale(), "close")} onClick={() => void closeWindow()}>
            <span class="win-x" aria-hidden="true" />
          </button>
        </div>
        </div>
        <div class="menu-row">
          <MenuBar menus={menus} />
          <Show when={dirtyBadge()}>
            <span class="dirty-fade">{t(locale(), "unsaved")}</span>
          </Show>
        </div>
      </header>

      <div class="workspace">
        <Show when={prefs().panelOpen}>
          <aside class="side" style={{ width: `${prefs().panelWidth}px` }}>
            <div class="side-tabs">
              <button
                type="button"
                class={prefs().panelMode === "files" ? "active" : ""}
                onClick={() => patchPrefs({ panelMode: "files" })}
              >
                {t(locale(), "files")}
              </button>
              <button
                type="button"
                class={prefs().panelMode === "outline" ? "active" : ""}
                onClick={() => patchPrefs({ panelMode: "outline" })}
              >
                {t(locale(), "outline")}
              </button>
            </div>
            <Show when={prefs().panelMode === "files"}>
              <div class="side-search-row">
                <input
                  class="side-search"
                  type="search"
                  ref={searchInput}
                  placeholder={t(locale(), "searchFiles")}
                  value={fileQuery()}
                  onInput={(event) => setFileQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    if (fileQuery()) setFileQuery("");
                    else event.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  class="side-new"
                  title={t(locale(), "newFileHere")}
                  onClick={() => void newFileIn(prefs().workspaceRoot ?? "")}
                >
                  +
                </button>
              </div>
            </Show>
            <Show when={prefs().panelMode === "outline"}>
              <input
                class="side-search"
                type="search"
                placeholder={t(locale(), "filterOutline")}
                value={outlineQuery()}
                onInput={(event) => setOutlineQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  if (outlineQuery()) setOutlineQuery("");
                  else event.currentTarget.blur();
                }}
              />
            </Show>
            <div class="side-body" role="tree" aria-label={t(locale(), "files")} onKeyDown={treeKeyDown}>
              <Show
                when={prefs().panelMode === "files"}
                fallback={
                  <Show
                    when={visibleOutline().length > 0}
                    fallback={<p class="side-empty">{t(locale(), "emptyOutline")}</p>}
                  >
                    <For each={visibleOutline()}>
                      {(item) => (
                        <button
                          type="button"
                          class={`outline-item level-${item.level}${
                            outline()[activeHeading()]?.line === item.line ? " active" : ""
                          }`}
                          style={{ "padding-left": `${10 + (item.level - 1) * 12}px` }}
                          title={item.text}
                          onClick={() => editor?.jumpToLine(item.line)}
                        >
                          {item.text}
                        </button>
                      )}
                    </For>
                  </Show>
                }
              >
                <Show
                  when={prefs().workspaceRoot}
                  fallback={<p class="side-empty">{t(locale(), "emptyFolder")}</p>}
                >
                  <Show when={fileQuery().trim()}>
                    <Show when={searchBusy()}>
                      <p class="side-empty">…</p>
                    </Show>
                    <For each={searchHits().names}>
                      {(hit) => (
                        <button
                          type="button"
                          role="treeitem"
                          class={`tree-item${samePath(hit.path, activeTab()?.path) ? " current" : ""}`}
                          title={hit.path}
                          onClick={() => void openPathInTab(hit.path)}
                        >
                          <span class="tree-twist">·</span>
                          <span class="tree-name">{hit.name}</span>
                        </button>
                      )}
                    </For>
                    <Show when={searchHits().matches.length > 0}>
                      <p class="side-section">
                        <span>
                          {t(locale(), "contentMatches")} ({searchHits().matches.length})
                        </span>
                        <span class="match-nav">
                          <button
                            type="button"
                            title={t(locale(), "previous")}
                            onClick={() => stepMatch(-1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title={t(locale(), "next")}
                            onClick={() => stepMatch(1)}
                          >
                            ↓
                          </button>
                        </span>
                      </p>
                      <div class="side-replace">
                        <input
                          class="side-search"
                          type="search"
                          placeholder={t(locale(), "replaceWith")}
                          value={replaceText()}
                          onInput={(event) => setReplaceText(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void replaceInWorkspace();
                          }}
                        />
                        <button
                          type="button"
                          class="side-replace-go"
                          disabled={replacing()}
                          onClick={() => void replaceInWorkspace()}
                        >
                          {t(locale(), "replaceAll")}
                        </button>
                      </div>
                      <For each={searchHits().matches}>
                        {(hit, index) => (
                          <button
                            type="button"
                            role="treeitem"
                            class={`match-row${index() === matchIndex() ? " active" : ""}`}
                            title={`${hit.path}:${hit.line}`}
                            onClick={() => {
                              setMatchIndex(index());
                              void openSearchHit(hit.path, hit.line);
                            }}
                          >
                            <span class="match-file">
                              {hit.path.split(/[\\/]/).pop()}:{hit.line}
                            </span>
                            <span class="match-text">
                              <For each={highlightParts(hit.text, fileQuery())}>
                                {(part) => (part.hit ? <mark>{part.text}</mark> : <>{part.text}</>)}
                              </For>
                            </span>
                          </button>
                        )}
                      </For>
                    </Show>
                    <Show when={searchHits().truncated}>
                      <p class="side-empty">{t(locale(), "searchTruncated")}</p>
                    </Show>
                    <Show
                      when={
                        !searchBusy() &&
                        searchHits().names.length === 0 &&
                        searchHits().matches.length === 0
                      }
                    >
                      <p class="side-empty">{t(locale(), "noMatches")}</p>
                    </Show>
                  </Show>
                  <Show when={!fileQuery().trim()}>
                    <For each={visibleFiles()}>
                      {(node) => (
                        <Show
                          when={renaming() === node.path}
                          fallback={
                            <button
                              type="button"
                              role="treeitem"
                              aria-expanded={node.is_dir ? node.expanded : undefined}
                              data-path={node.path}
                              class={`tree-item${node.is_dir ? " dir" : ""}${
                                samePath(node.path, activeTab()?.path) ? " current" : ""
                              }`}
                              style={{ "padding-left": `${10 + node.depth * 14}px` }}
                              title={node.path}
                              onClick={() => {
                                if (node.is_dir) void toggleDir(node);
                                else void openPathInTab(node.path);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  kind: "file",
                                  path: node.path,
                                  dir: node.is_dir,
                                });
                              }}
                            >
                              <span class="tree-twist">
                                {node.is_dir ? (node.expanded ? "▾" : "▸") : "·"}
                              </span>
                              <span class="tree-name">{node.name}</span>
                            </button>
                          }
                        >
                          <input
                            class="tree-rename"
                            value={renameText()}
                            ref={(element) => {
                              // Focus after the row exists, and preselect the
                              // name so typing replaces it.
                              queueMicrotask(() => {
                                element.focus();
                                const dot = element.value.lastIndexOf(".");
                                element.setSelectionRange(0, dot > 0 ? dot : element.value.length);
                              });
                            }}
                            onInput={(event) => setRenameText(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void commitRename();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                setRenaming(null);
                              }
                            }}
                            onBlur={() => {
                              if (renaming() === node.path) setRenaming(null);
                            }}
                          />
                        </Show>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
            <div
              class="side-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={MIN_PANEL}
              aria-valuemax={MAX_PANEL}
              aria-valuenow={prefs().panelWidth}
              aria-label="Sidebar width"
              tabindex="0"
              onPointerDown={(event) => startResize(event)}
              onKeyDown={resizeByKey}
              title={`${MIN_PANEL}–${MAX_PANEL}px`}
            />
          </aside>
        </Show>
        <div class="editor-column">
          <Show when={activeTab()?.conflicted}>
            <div class="conflict-bar" role="alert">
              <span class="conflict-text">{t(locale(), "conflictBanner")}</span>
              <button
                type="button"
                onClick={() => {
                  const id = activeTab()?.id;
                  if (id) void reloadTabFromDisk(id);
                }}
              >
                {t(locale(), "reloadFromDisk")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTabs((current) =>
                    current.map((item) =>
                      item.id === activeTabId() ? { ...item, conflicted: false } : item,
                    ),
                  );
                  void save();
                }}
              >
                {t(locale(), "keepMine")}
              </button>
            </div>
          </Show>
          <div class="editor-host" ref={host} />
        </div>
      </div>

      <footer class="status">
        <span>
          {tLines(
            locale(),
            lines().toLocaleString(locale()),
            chars().toLocaleString(locale()),
            words().toLocaleString(locale()),
          )}
        </span>
        <span class={dirty() ? "status-dirty" : "status-clean"}>
          {dirty()
            ? t(locale(), "unsaved")
            : activeTab()?.path
              ? t(locale(), "saved")
              : t(locale(), "unchanged")}
        </span>
        <span class="status-format" title={fileFormat()}>
          {fileFormat()}
        </span>
        <Show when={prefs().autoSave}>
          <span class="status-autosave" title={t(locale(), "autoSave")}>
            {t(locale(), "autoSaveOn")}
          </span>
        </Show>
        <span class="status-path" title={activeTab()?.path ?? ""}>
          {activeTab()?.path ?? t(locale(), "notWritten")}
        </span>
        <span class="status-notice">{notice()}</span>
      </footer>

      <Show when={menu()}>
        {(state) => (
          <div
            class="context-menu"
            style={clampMenuToViewport(state().x, state().y)}
            onClick={(event) => event.stopPropagation()}
          >
            <Show when={state().kind === "tab" && state().tabId}>
              <button
                type="button"
                onClick={() => {
                  const id = state().tabId!;
                  closeMenu();
                  void closeTab(id);
                }}
              >
                {t(locale(), "close")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = state().tabId!;
                  closeMenu();
                  void (async () => {
                    for (const tab of tabs()) {
                      if (tab.id !== id) await closeTab(tab.id);
                    }
                  })();
                }}
              >
                {t(locale(), "closeOthers")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = state().tabId!;
                  closeMenu();
                  const list = tabs();
                  const index = list.findIndex((tab) => tab.id === id);
                  void (async () => {
                    for (const tab of list.slice(index + 1)) await closeTab(tab.id);
                  })();
                }}
              >
                {t(locale(), "closeRight")}
              </button>
            </Show>
            <Show when={state().kind === "file" && state().path}>
              <button
                type="button"
                onClick={() => {
                  const path = state().path!;
                  const folder = state().dir ? path : parentPath(path);
                  closeMenu();
                  void newFileIn(folder);
                }}
              >
                {t(locale(), "newFileHere")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const path = state().path!;
                  const folder = state().dir ? path : parentPath(path);
                  closeMenu();
                  void newFolderIn(folder);
                }}
              >
                {t(locale(), "newFolder")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const path = state().path!;
                  closeMenu();
                  setRenameText(documentName(path, ""));
                  setRenaming(path);
                }}
              >
                {t(locale(), "rename")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const path = state().path!;
                  closeMenu();
                  void removeEntry(path);
                }}
              >
                {t(locale(), "remove")}
              </button>
            </Show>
            <button
              type="button"
              onClick={() => {
                const path = state().path ?? null;
                closeMenu();
                void copyPath(path);
              }}
            >
              {t(locale(), "copyPath")}
            </button>
            <button
              type="button"
              onClick={() => {
                const path = state().path ?? null;
                closeMenu();
                void reveal(path);
              }}
            >
              {t(locale(), "reveal")}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
