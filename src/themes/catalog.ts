export type ThemeScheme = "light" | "dark";
/**
 * Where a theme came from. `soft` themes are tuned here for long writing
 * sessions: no pure white or black, desaturated accents, slightly reduced
 * heading contrast.
 */
export type ThemeSet = "app" | "colamd" | "marktext" | "soft";

export interface ThemeDef {
  id: string;
  scheme: ThemeScheme;
  set: ThemeSet;
  zh: string;
  en: string;
  swatch: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "paper", scheme: "light", set: "app", zh: "纸色", en: "Paper", swatch: "#f7f5f0" },
  { id: "light", scheme: "light", set: "colamd", zh: "浅色", en: "Light", swatch: "#ffffff" },
  { id: "elegant", scheme: "light", set: "colamd", zh: "雅致", en: "Elegant", swatch: "#f0edea" },
  { id: "notion", scheme: "light", set: "colamd", zh: "简白", en: "Notion", swatch: "#ffffff" },
  { id: "writer", scheme: "light", set: "colamd", zh: "作家", en: "Writer", swatch: "#fcfcfa" },
  { id: "bear", scheme: "light", set: "colamd", zh: "熊红", en: "Bear", swatch: "#ffffff" },
  { id: "sepia", scheme: "light", set: "colamd", zh: "羊皮纸", en: "Sepia", swatch: "#f6efe0" },
  { id: "cadmium-light", scheme: "light", set: "marktext", zh: "Cadmium Light", en: "Cadmium Light", swatch: "#ffffff" },
  { id: "dawn", scheme: "light", set: "soft", zh: "晨光", en: "Dawn", swatch: "#f7f3ec" },
  { id: "celadon", scheme: "light", set: "soft", zh: "青瓷", en: "Celadon", swatch: "#f1f4f0" },
  { id: "dark", scheme: "dark", set: "colamd", zh: "深色", en: "Dark", swatch: "#0d1117" },
  { id: "midnight", scheme: "dark", set: "colamd", zh: "午夜", en: "Midnight", swatch: "#000000" },
  { id: "solarized-dark", scheme: "dark", set: "colamd", zh: "夜航", en: "Solarized Dark", swatch: "#002b36" },
  { id: "nord", scheme: "dark", set: "colamd", zh: "极地", en: "Nord", swatch: "#2e3440" },
  { id: "gruvbox", scheme: "dark", set: "colamd", zh: "暖木", en: "Gruvbox", swatch: "#282828" },
  { id: "dracula", scheme: "dark", set: "colamd", zh: "德古拉", en: "Dracula", swatch: "#282a36" },
  { id: "material-dark", scheme: "dark", set: "marktext", zh: "Material Dark", en: "Material Dark", swatch: "#34393f" },
  { id: "dusk", scheme: "dark", set: "soft", zh: "暮色", en: "Dusk", swatch: "#21262e" },
  { id: "ember", scheme: "dark", set: "soft", zh: "炭火", en: "Ember", swatch: "#262120" },
];

export const THEME_IDS = THEMES.map((item) => item.id);

export function themeById(id: string): ThemeDef {
  return THEMES.find((item) => item.id === id) ?? THEMES[0];
}

export function themeLabel(id: string, locale: string): string {
  const item = themeById(id);
  return locale === "zh-CN" || locale === "zh-TW" ? item.zh : item.en;
}
