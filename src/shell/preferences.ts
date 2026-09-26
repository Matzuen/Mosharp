export type ContentWidth = 640 | 780 | 1080;
export type PanelMode = "files" | "outline";
export type Locale = "zh-CN" | "en";

export interface Preferences {
  panelOpen: boolean;
  panelWidth: number;
  panelMode: PanelMode;
  contentWidth: ContentWidth;
  locale: Locale;
  workspaceRoot: string | null;
  sourceMode: boolean;
  typewriter: boolean;
  focusMode: boolean;
}

const KEY = "mosharp.preferences.v1";
const MIN_PANEL = 180;
const MAX_PANEL = 420;

export const CONTENT_WIDTHS: ContentWidth[] = [640, 780, 1080];

export const defaultPreferences: Preferences = {
  panelOpen: true,
  panelWidth: 260,
  panelMode: "files",
  contentWidth: 780,
  locale: "zh-CN",
  workspaceRoot: null,
  sourceMode: false,
  typewriter: false,
  focusMode: false,
};

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL, Math.max(MIN_PANEL, Math.round(width)));
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultPreferences };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      panelOpen: parsed.panelOpen ?? defaultPreferences.panelOpen,
      panelWidth: clampPanelWidth(parsed.panelWidth ?? defaultPreferences.panelWidth),
      panelMode: parsed.panelMode === "outline" ? "outline" : "files",
      contentWidth: CONTENT_WIDTHS.includes(parsed.contentWidth as ContentWidth)
        ? (parsed.contentWidth as ContentWidth)
        : defaultPreferences.contentWidth,
      locale: parsed.locale === "en" ? "en" : "zh-CN",
      workspaceRoot:
        typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : null,
      sourceMode: parsed.sourceMode ?? defaultPreferences.sourceMode,
      typewriter: parsed.typewriter ?? defaultPreferences.typewriter,
      focusMode: parsed.focusMode ?? defaultPreferences.focusMode,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function savePreferences(prefs: Preferences): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      ...prefs,
      panelWidth: clampPanelWidth(prefs.panelWidth),
    }),
  );
}

export { MIN_PANEL, MAX_PANEL, clampPanelWidth };
