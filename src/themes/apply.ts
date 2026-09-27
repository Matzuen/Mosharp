import { themeById } from "./catalog";

export interface Appearance {
  theme: string;
  locale: string;
  editorFont: string;
  editorSize: number | null;
}

const HTML_LANG: Record<string, string> = {
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
  ja: "ja",
  de: "de",
  fr: "fr",
  es: "es",
};

export function applyAppearance(next: Appearance): void {
  const root = document.documentElement;
  const theme = themeById(next.theme);
  root.dataset.theme = theme.id;
  root.lang = HTML_LANG[next.locale] ?? "zh-CN";
  if (next.editorFont) root.style.setProperty("--user-font", next.editorFont);
  else root.style.removeProperty("--user-font");
  if (next.editorSize) root.style.setProperty("--user-size", `${next.editorSize}px`);
  else root.style.removeProperty("--user-size");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.swatch);
}
