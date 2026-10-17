import { THEME_IDS } from "../themes/catalog";
import { isEditorFont, isEditorSize } from "../themes/fonts";

export type ContentWidth = 640 | 780 | 1080;
export type PanelMode = "files" | "outline";
export const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "de", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export type SpellLang = "zh-CN" | "en-US";

export const SHORTCUT_IDS = [
  "save",
  "saveAs",
  "open",
  "openFolder",
  "newFile",
  "closeTab",
  "toggleSidebar",
  "sourceMode",
  "commandPalette",
  "settings",
  "bold",
  "italic",
  "code",
  "highlight",
  "strike",
  "link",
  "task",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];
export type ShortcutMap = Record<ShortcutId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  save: "Ctrl+S",
  saveAs: "Ctrl+Shift+S",
  open: "Ctrl+O",
  openFolder: "Ctrl+Shift+O",
  newFile: "Ctrl+T",
  closeTab: "Ctrl+W",
  toggleSidebar: "Ctrl+\\",
  sourceMode: "Ctrl+/",
  commandPalette: "Ctrl+Shift+P",
  settings: "Ctrl+,",
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  code: "Ctrl+E",
  highlight: "Ctrl+Shift+H",
  strike: "Ctrl+Shift+U",
  link: "Ctrl+K",
  task: "Ctrl+Enter",
};

export interface Preferences {
  panelOpen: boolean;
  panelWidth: number;
  panelMode: PanelMode;
  contentWidth: ContentWidth;
  locale: Locale;
  theme: string;
  editorFont: string;
  editorSize: number | null;
  workspaceRoot: string | null;
  sourceMode: boolean;
  typewriter: boolean;
  focusMode: boolean;
  footnotes: boolean;
  emoji: boolean;
  superSub: boolean;
  pandocMath: boolean;
  pasteImages: boolean;
  spellcheck: boolean;
  spellLang: SpellLang;
  customWords: string;
  shortcuts: ShortcutMap;
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
  theme: "paper",
  editorFont: "",
  editorSize: null,
  workspaceRoot: null,
  sourceMode: false,
  typewriter: false,
  focusMode: false,
  footnotes: true,
  emoji: true,
  superSub: true,
  pandocMath: true,
  pasteImages: true,
  spellcheck: true,
  spellLang: "zh-CN",
  customWords: "",
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

function loadShortcuts(value: unknown): ShortcutMap {
  const next = { ...DEFAULT_SHORTCUTS };
  if (!value || typeof value !== "object") return next;
  const record = value as Record<string, unknown>;
  for (const id of SHORTCUT_IDS) {
    const binding = record[id];
    if (typeof binding === "string") next[id] = binding;
  }
  return next;
}

function clampPanelWidth(width: number): number {
  const value = Number.isFinite(width) ? width : defaultPreferences.panelWidth;
  return Math.min(MAX_PANEL, Math.max(MIN_PANEL, Math.round(value)));
}

/** Persisted booleans may be strings from an older build; only real booleans win. */
function pickBool(value: unknown, fallback: boolean): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultPreferences, shortcuts: { ...DEFAULT_SHORTCUTS } };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      panelOpen: pickBool(parsed.panelOpen, defaultPreferences.panelOpen),
      panelWidth: clampPanelWidth(parsed.panelWidth ?? defaultPreferences.panelWidth),
      panelMode: parsed.panelMode === "outline" ? "outline" : "files",
      contentWidth: CONTENT_WIDTHS.includes(parsed.contentWidth as ContentWidth)
        ? (parsed.contentWidth as ContentWidth)
        : defaultPreferences.contentWidth,
      locale: LOCALES.includes(parsed.locale as Locale)
        ? (parsed.locale as Locale)
        : defaultPreferences.locale,
      theme:
        typeof parsed.theme === "string" && THEME_IDS.includes(parsed.theme)
          ? parsed.theme
          : defaultPreferences.theme,
      editorFont:
        typeof parsed.editorFont === "string" && isEditorFont(parsed.editorFont)
          ? parsed.editorFont
          : "",
      editorSize:
        typeof parsed.editorSize === "number" && isEditorSize(parsed.editorSize)
          ? parsed.editorSize
          : null,
      workspaceRoot:
        typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : null,
      sourceMode: pickBool(parsed.sourceMode, defaultPreferences.sourceMode),
      typewriter: pickBool(parsed.typewriter, defaultPreferences.typewriter),
      focusMode: pickBool(parsed.focusMode, defaultPreferences.focusMode),
      footnotes: pickBool(parsed.footnotes, defaultPreferences.footnotes),
      emoji: pickBool(parsed.emoji, defaultPreferences.emoji),
      superSub: pickBool(parsed.superSub, defaultPreferences.superSub),
      pandocMath: pickBool(parsed.pandocMath, defaultPreferences.pandocMath),
      pasteImages: pickBool(parsed.pasteImages, defaultPreferences.pasteImages),
      spellcheck: pickBool(parsed.spellcheck, defaultPreferences.spellcheck),
      spellLang: parsed.spellLang === "en-US" ? "en-US" : "zh-CN",
      customWords: typeof parsed.customWords === "string" ? parsed.customWords : "",
      shortcuts: loadShortcuts(parsed.shortcuts),
    };
  } catch {
    return { ...defaultPreferences, shortcuts: { ...DEFAULT_SHORTCUTS } };
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...prefs,
        panelWidth: clampPanelWidth(prefs.panelWidth),
      }),
    );
  } catch {
    // A quota failure must not surface as a failed document save.
  }
}

/** Everything back to factory defaults (used by Settings ▸ 恢复默认). */
export function defaultPreferencesFor(): Preferences {
  return { ...defaultPreferences, shortcuts: { ...DEFAULT_SHORTCUTS } };
}

export { MIN_PANEL, MAX_PANEL, clampPanelWidth };
