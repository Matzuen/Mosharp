export interface RecentEntry {
  path: string;
  openedAt: number;
}

export interface SessionTabSnapshot {
  path: string | null;
  content: string;
  dirty: boolean;
  scrollTop: number;
  selection: { anchor: number; head: number };
  lineEnding?: "\n" | "\r\n";
  encoding?: string;
  /** True when the buffer was too large to snapshot; `content` is empty. */
  contentDropped?: boolean;
}

export interface SessionSnapshot {
  version: 1;
  tabs: SessionTabSnapshot[];
  activeIndex: number;
  savedAt: number;
}

const RECENT_KEY = "mosharp.recent.v1";
const SESSION_KEY = "mosharp.session.v1";
const MAX_RECENT = 10;
/** Keep session snapshots small so 10万行基准不会卡死 localStorage。 */
export const MAX_SESSION_CHARS = 256 * 1024;
/** Hard ceiling for the whole serialized envelope. */
const MAX_SESSION_BYTES = 1024 * 1024;

export function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.path === "string")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecent(path: string, current: RecentEntry[] = loadRecent()): RecentEntry[] {
  const normalized = path.trim();
  if (!normalized) return current;
  const next = [
    { path: normalized, openedAt: Date.now() },
    ...current.filter(
      (item) => item.path.replace(/\\/g, "/").toLowerCase() !== normalized.replace(/\\/g, "/").toLowerCase(),
    ),
  ].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Quota failure must never surface as a failed save.
  }
  return next;
}

export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    // Last-resort guard for a bloated blob written by an older build.
    if (raw.length > MAX_SESSION_BYTES) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist the session, dropping only the buffers that do not fit.
 *
 * Dropping is marked on the tab (`contentDropped`) and `dirty` is left alone so
 * the restore path can tell the user their unsaved text was not snapshotted
 * instead of silently reporting the tab as saved.
 */
export function saveSession(snapshot: SessionSnapshot): void {
  try {
    const tabs: SessionTabSnapshot[] = snapshot.tabs.map((tab) =>
      tab.content.length > MAX_SESSION_CHARS
        ? { ...tab, content: "", contentDropped: true }
        : { ...tab, contentDropped: false },
    );
    const serialise = () => JSON.stringify({ ...snapshot, tabs, savedAt: Date.now() });
    let payload = serialise();
    // Trim largest-first so one huge document cannot evict every other tab.
    const order = tabs
      .map((tab, index) => ({ index, size: tab.content.length }))
      .sort((a, b) => b.size - a.size);
    for (const entry of order) {
      if (payload.length <= MAX_SESSION_BYTES) break;
      const tab = tabs[entry.index];
      if (!tab.content) continue;
      tabs[entry.index] = { ...tab, content: "", contentDropped: true };
      payload = serialise();
    }
    localStorage.setItem(SESSION_KEY, payload);
  } catch {
    // Quota or serialization failure — ignore rather than freeze UI.
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
