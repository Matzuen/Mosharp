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
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    // Drop previously bloated snapshots that would freeze the UI on parse/restore.
    if (raw.length > MAX_SESSION_CHARS * 4) {
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

export function saveSession(snapshot: SessionSnapshot): void {
  try {
    const tabs = snapshot.tabs.map((tab) => {
      if (tab.content.length > MAX_SESSION_CHARS) {
        return {
          ...tab,
          // Drop huge buffers (benchmark / pasted novels); keep path only.
          content: tab.path ? "" : "",
          dirty: false,
        };
      }
      return tab;
    });
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...snapshot, tabs, savedAt: Date.now() }),
    );
  } catch {
    // Quota or serialization failure — ignore rather than freeze UI.
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
