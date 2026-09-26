import type { EditorState } from "@codemirror/state";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  listDirectory,
  openFolderPath,
  openMarkdownPath,
  readDocument,
  revealInFolder,
  saveMarkdownPath,
  saveRecoveryCopy,
  suppressFileWatch,
  syncFileWatches,
  touchFileWatchBaseline,
  writeDocument,
  type DirEntryInfo,
} from "./api/files";
import { generateBenchmark } from "./editor/benchmark";
import { createEditor, INITIAL_DOCUMENT, type EditorController } from "./editor/createEditor";
import { activeOutlineIndex, parseOutlineDoc, type OutlineItem } from "./editor/outline";
import { t, tLines } from "./shell/i18n";
import {
  clampPanelWidth,
  CONTENT_WIDTHS,
  loadPreferences,
  MAX_PANEL,
  MIN_PANEL,
  savePreferences,
  type ContentWidth,
  type Locale,
  type Preferences,
} from "./shell/preferences";
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

interface TabRecord {
  id: string;
  path: string | null;
  dirty: boolean;
  state: EditorState | null;
  scrollTop: number;
}

interface MenuState {
  x: number;
  y: number;
  kind: "tab" | "file";
  tabId?: string;
  path?: string;
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

export default function App() {
  let host!: HTMLDivElement;
  let editor: EditorController | undefined;
  let dirtyFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let treePollTimer: ReturnType<typeof setInterval> | null = null;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollUiTimer: ReturnType<typeof setTimeout> | null = null;
  let activeId = "";
  let restoringSession = false;

  const initialPrefs = loadPreferences();
  const [prefs, setPrefs] = createSignal<Preferences>(initialPrefs);
  const [tabs, setTabs] = createSignal<TabRecord[]>([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const [dirtyBadge, setDirtyBadge] = createSignal(false);
  const [lines, setLines] = createSignal(1);
  const [chars, setChars] = createSignal(0);
  const [notice, setNotice] = createSignal("");
  const [outline, setOutline] = createSignal<OutlineItem[]>([]);
  const [activeHeading, setActiveHeading] = createSignal(-1);
  const [tree, setTree] = createSignal<TreeNode[]>([]);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [recent, setRecent] = createSignal<RecentEntry[]>(loadRecent());
  const [recentOpen, setRecentOpen] = createSignal(false);

  const locale = createMemo(() => prefs().locale);
  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeTabId()) ?? null);

  function persistPrefs(next: Preferences) {
    setPrefs(next);
    savePreferences(next);
    document.documentElement.style.setProperty("--content-width", `${next.contentWidth}px`);
    document.documentElement.style.setProperty("--panel-width", `${next.panelWidth}px`);
    document.documentElement.lang = next.locale === "en" ? "en" : "zh-CN";
  }

  function patchPrefs(partial: Partial<Preferences>) {
    persistPrefs({ ...prefs(), ...partial });
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
        dirty: tooLarge ? false : tab.dirty,
        scrollTop: isActive ? editor!.getScrollTop() : tab.scrollTop,
        selection,
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
    if (content.length > MAX_SESSION_CHARS) return;
    try {
      const savedPath = await saveRecoveryCopy(
        documentName(tab.path, t(locale(), "untitled")),
        content,
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

  function refreshStats() {
    if (!editor) return;
    const stats = editor.stats();
    setLines(stats.lines);
    setChars(stats.chars);
  }

  function refreshOutline() {
    if (!editor) return;
    const items = parseOutlineDoc(editor.getState().doc);
    setOutline(items);
    setActiveHeading(activeOutlineIndex(items, editor.firstVisibleLine()));
  }

  function markActiveDirty(value: boolean) {
    const id = activeId;
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, dirty: value } : tab)),
    );
    setDirty(value);
    if (value) showDirtyBadge();
    else setDirtyBadge(false);
    void syncTitle();
    scheduleSessionSave();
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

  function createTab(path: string | null, text: string, dirtyValue = false): string {
    if (!editor) return "";
    captureActive();
    const id = newTabId();
    const state = editor.createState(text);
    const tab: TabRecord = { id, path, dirty: dirtyValue, state, scrollTop: 0 };
    setTabs((current) => [...current, tab]);
    activeId = id;
    setActiveTabId(id);
    editor.setState(state);
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

    if (remaining.length === 0) {
      if (!editor) return;
      const fresh: TabRecord = {
        id: newTabId(),
        path: null,
        dirty: false,
        state: editor.createState(INITIAL_DOCUMENT),
        scrollTop: 0,
      };
      setTabs([fresh]);
      activeId = fresh.id;
      setActiveTabId(fresh.id);
      editor.setState(fresh.state!);
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
          { id, path, dirty: false, state, scrollTop: 0 },
        ]);
        activeId = id;
        setActiveTabId(id);
        const ms = performance.now();
        editor.setState(state);
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
      setNotice(`打开 ${formatMs(total)} ms（编辑器 ${formatMs(loaded)} ms）`);
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
      const selected = await openMarkdownPath();
      if (!selected) return;
      await openPathInTab(selected);
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  async function openFolder() {
    if (!isTauri()) {
      setNotice(t(locale(), "needDesktop"));
      return;
    }
    try {
      const selected = await openFolderPath();
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

  async function reloadTree(root = prefs().workspaceRoot) {
    if (!root || !isTauri()) {
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
      setTree(applyExpanded(next, expanded));
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
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

  async function persist(target: string) {
    if (!editor) return;
    try {
      if (isTauri()) await suppressFileWatch(target);
      await writeDocument(target, editor.text());
      if (isTauri()) await touchFileWatchBaseline(target);
      setTabs((current) =>
        current.map((tab) => (tab.id === activeId ? { ...tab, path: target, dirty: false } : tab)),
      );
      setDirty(false);
      setDirtyBadge(false);
      rememberRecent(target);
      void syncTitle();
      scheduleSessionSave();
      refreshWatches();
      setNotice(t(locale(), "savedOk"));
      if (prefs().workspaceRoot) void reloadTree();
    } catch (error) {
      setNotice(`${t(locale(), "saveFailed")}：${errorText(error)}`);
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
      const selected = await saveMarkdownPath(suggested);
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
    setNotice("正在生成 10 万行…");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const generatedAt = performance.now();
    const text = generateBenchmark(BENCHMARK_LINES);
    const generateMs = performance.now() - generatedAt;

    setNotice("正在载入编辑器…");
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
      `基准 ${BENCHMARK_LINES.toLocaleString("zh-CN")} 行：生成 ${formatMs(generateMs)} ms，输入 ${formatMs(maxInput)} ms，跳到文末 ${formatMs(scrollMs)} ms`,
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

  function closeMenu() {
    setMenu(null);
    setRecentOpen(false);
  }

  async function restoreSession(): Promise<boolean> {
    if (!editor) return false;
    const session = loadSession();
    if (!session?.tabs.length) return false;

    restoringSession = true;
    try {
      const created: TabRecord[] = [];
      for (const snap of session.tabs) {
        let content = snap.content;
        let dirtyValue = snap.dirty;
        let path = snap.path;

        if (path && isTauri()) {
          try {
            const opened = await readDocument(path);
            if (snap.dirty && snap.content && snap.content !== opened.content) {
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

        const base = editor.createState(content);
        const max = base.doc.length;
        const state = base.update({
          selection: {
            anchor: Math.max(0, Math.min(snap.selection.anchor, max)),
            head: Math.max(0, Math.min(snap.selection.head, max)),
          },
        }).state;
        created.push({
          id: newTabId(),
          path,
          dirty: dirtyValue,
          state,
          scrollTop: snap.scrollTop,
        });
        if (path) rememberRecent(path);
      }

      if (created.length === 0) return false;

      const active = created[Math.min(session.activeIndex, created.length - 1)];
      setTabs(created);
      activeId = active.id;
      setActiveTabId(active.id);
      editor.setState(active.state!);
      editor.setScrollTop(active.scrollTop);
      setDirty(active.dirty);
      setDirtyBadge(false);
      refreshStats();
      refreshOutline();
      void syncTitle();
      refreshWatches();
      editor.focus();
      return true;
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
      setNotice(t(locale(), "externalConflict"));
      return;
    }
    try {
      const opened = await readDocument(tab.path);
      const current =
        tab.id === activeId && editor
          ? editor.text()
          : (tab.state?.doc.toString() ?? "");
      if (current === opened.content) {
        if (isTauri()) await touchFileWatchBaseline(tab.path);
        return;
      }

      if (tab.id === activeId && editor) {
        const scrollTop = editor.getScrollTop();
        const selection = editor.getSelection();
        editor.replace(opened.content);
        editor.setSelection(selection.anchor, selection.head);
        editor.setScrollTop(scrollTop);
        setTabs((current) =>
          current.map((item) =>
            item.id === tab.id
              ? { ...item, dirty: false, state: editor!.getState(), scrollTop }
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
            item.id === tab.id ? { ...item, dirty: false, state } : item,
          ),
        );
      }
      if (isTauri()) await touchFileWatchBaseline(tab.path);
      scheduleSessionSave();
      setNotice(t(locale(), "externalReload"));
    } catch (error) {
      setNotice(`${t(locale(), "openFailed")}：${errorText(error)}`);
    }
  }

  onMount(() => {
    persistPrefs(initialPrefs);
    setNotice(t(initialPrefs.locale, "ready"));

    editor = createEditor(host, {
      onEdit() {
        refreshStats();
        refreshOutline();
        markActiveDirty(true);
      },
      initialModes: {
        sourceMode: initialPrefs.sourceMode,
        typewriter: initialPrefs.typewriter,
        focus: initialPrefs.focusMode,
      },
    });

    void (async () => {
      const restored = await restoreSession();
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
      const key = event.key.toLowerCase();
      if (event.key === "Escape") closeMenu();
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (key === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAs();
      } else if (key === "s") {
        event.preventDefault();
        void save();
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        void openFolder();
      } else if (key === "o") {
        event.preventDefault();
        void openDoc();
      } else if (key === "n") {
        event.preventDefault();
        newDoc();
      } else if (key === "w") {
        event.preventDefault();
        void closeTab(activeId);
      } else if (key === "\\") {
        event.preventDefault();
        patchPrefs({ panelOpen: !prefs().panelOpen });
      } else if (key === "t") {
        event.preventDefault();
        newDoc();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", closeMenu);
    window.addEventListener("beforeunload", flushSession);

    let unlistenClose: (() => void) | undefined;
    let unlistenChange: (() => void) | undefined;
    if (isTauri()) {
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          captureActive();
          flushSession();
          const dirtyTabs = tabs().filter((tab) => tab.dirty);
          if (dirtyTabs.length === 0) return;
          const confirmed = await ask(t(locale(), "discardClose"), {
            title: "Mosharp",
            kind: "warning",
          });
          if (!confirmed) {
            event.preventDefault();
            return;
          }
          for (const tab of dirtyTabs) await backupTab(tab);
        })
        .then((stop) => {
          unlistenClose = stop;
        });

      void listen<{ path: string; kind: string }>("document-changed", (event) => {
        void onExternalDocumentChange(event.payload.path, event.payload.kind);
      }).then((stop) => {
        unlistenChange = stop;
      });
    }

    onCleanup(() => {
      flushSession();
      stopScroll();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("beforeunload", flushSession);
      if (dirtyFadeTimer) clearTimeout(dirtyFadeTimer);
      if (treePollTimer) clearInterval(treePollTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
      if (scrollUiTimer) clearTimeout(scrollUiTimer);
      unlistenClose?.();
      unlistenChange?.();
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

  return (
    <div class="app">
      <header class="chrome">
        <strong class="brand">{t(locale(), "brand")}</strong>
        <div class="tabs" role="tablist">
          <For each={tabs()}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                class={`tab${tab.id === activeTabId() ? " active" : ""}`}
                title={tab.path ?? t(locale(), "notWritten")}
                aria-selected={tab.id === activeTabId()}
                onClick={() => activateTab(tab.id)}
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
                <span class={`tab-dot${tab.dirty ? " on" : ""}`} aria-hidden="true">
                  ●
                </span>
                <span class="tab-name">{documentName(tab.path, t(locale(), "untitled"))}</span>
                <span
                  class="tab-close"
                  title={t(locale(), "close")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            )}
          </For>
          <button
            type="button"
            class="tab-add"
            title={`${t(locale(), "new")} (Ctrl+T)`}
            onClick={() => newDoc()}
          >
            +
          </button>
        </div>
        <div class="chrome-actions">
          <Show when={dirtyBadge()}>
            <span class="dirty-fade">{t(locale(), "unsaved")}</span>
          </Show>
          <button type="button" title="Ctrl+\\" onClick={() => patchPrefs({ panelOpen: !prefs().panelOpen })}>
            {t(locale(), "panel")}
          </button>
          <button type="button" title="Ctrl+O" onClick={() => void openDoc()}>
            {t(locale(), "open")}
          </button>
          <button type="button" title="Ctrl+Shift+O" onClick={() => void openFolder()}>
            {t(locale(), "openFolder")}
          </button>
          <div class="recent-wrap">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setRecentOpen((open) => !open);
              }}
            >
              {t(locale(), "recent")}
            </button>
            <Show when={recentOpen()}>
              <div class="recent-menu" onClick={(event) => event.stopPropagation()}>
                <Show
                  when={recent().length > 0}
                  fallback={<div class="recent-empty">{t(locale(), "noRecent")}</div>}
                >
                  <For each={recent()}>
                    {(item) => (
                      <button
                        type="button"
                        title={item.path}
                        onClick={() => {
                          setRecentOpen(false);
                          void openPathInTab(item.path);
                        }}
                      >
                        {documentName(item.path, t(locale(), "untitled"))}
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
          <button type="button" title="Ctrl+S" onClick={() => void save()}>
            {t(locale(), "save")}
          </button>
          <button type="button" title="Ctrl+Shift+S" onClick={() => void saveAs()}>
            {t(locale(), "saveAs")}
          </button>
          <button
            type="button"
            class={prefs().sourceMode ? "mode-on" : ""}
            title="纯源码（关掉实时预览装饰）"
            onClick={() => toggleMode("sourceMode")}
          >
            {t(locale(), "sourceMode")}
          </button>
          <button
            type="button"
            class={prefs().typewriter ? "mode-on" : ""}
            title="打字机：光标行保持在视口中部"
            onClick={() => toggleMode("typewriter")}
          >
            {t(locale(), "typewriter")}
          </button>
          <button
            type="button"
            class={prefs().focusMode ? "mode-on" : ""}
            title="专注：淡化当前块以外的内容"
            onClick={() => toggleMode("focusMode")}
          >
            {t(locale(), "focusMode")}
          </button>
          <label class="width-select">
            {t(locale(), "width")}
            <select
              value={String(prefs().contentWidth)}
              onChange={(event) =>
                patchPrefs({ contentWidth: Number(event.currentTarget.value) as ContentWidth })
              }
            >
              <For each={CONTENT_WIDTHS}>{(width) => <option value={width}>{width}</option>}</For>
            </select>
          </label>
          <label class="width-select">
            {t(locale(), "language")}
            <select
              value={locale()}
              onChange={(event) => {
                const next = event.currentTarget.value as Locale;
                patchPrefs({ locale: next });
                setNotice(t(next, "ready"));
                void syncTitle();
              }}
            >
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <button type="button" onClick={() => void loadBenchmark()}>
            {t(locale(), "benchmark")}
          </button>
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
            <div class="side-body">
              <Show
                when={prefs().panelMode === "files"}
                fallback={
                  <Show
                    when={outline().length > 0}
                    fallback={<p class="side-empty">{t(locale(), "emptyOutline")}</p>}
                  >
                    <For each={outline()}>
                      {(item, index) => (
                        <button
                          type="button"
                          class={`outline-item level-${item.level}${
                            activeHeading() === index() ? " active" : ""
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
                  <For each={flatTree()}>
                    {(node) => (
                      <button
                        type="button"
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
                          });
                        }}
                      >
                        <span class="tree-twist">
                          {node.is_dir ? (node.expanded ? "▾" : "▸") : "·"}
                        </span>
                        <span class="tree-name">{node.name}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
            <div
              class="side-resizer"
              onPointerDown={(event) => startResize(event)}
              title={`${MIN_PANEL}–${MAX_PANEL}px`}
            />
          </aside>
        </Show>
        <div class="editor-host" ref={host} />
      </div>

      <footer class="status">
        <span>
          {tLines(
            locale(),
            lines().toLocaleString(locale()),
            chars().toLocaleString(locale()),
          )}
        </span>
        <span class={dirty() ? "status-dirty" : "status-clean"}>
          {dirty()
            ? t(locale(), "unsaved")
            : activeTab()?.path
              ? t(locale(), "saved")
              : t(locale(), "unchanged")}
        </span>
        <span class="status-path" title={activeTab()?.path ?? ""}>
          {activeTab()?.path ?? t(locale(), "notWritten")}
        </span>
        <span class="status-notice">{notice()}</span>
      </footer>

      <Show when={menu()}>
        {(state) => (
          <div
            class="context-menu"
            style={{ left: `${state().x}px`, top: `${state().y}px` }}
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
