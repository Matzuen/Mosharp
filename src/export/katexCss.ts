/**
 * KaTeX stylesheet with every font embedded as a data URI.
 *
 * The exported HTML used to `<link>` the KaTeX CSS from a CDN, so opening the
 * file offline lost the math fonts entirely. Inlining both the rules and the
 * twenty woff2 faces makes a single self-contained file (~340 KB on top) that
 * renders identically without a network.
 *
 * This module is imported lazily, only when an export actually contains math.
 */
import css from "katex/dist/katex.min.css?raw";
import ams from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?inline";
import sansBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline";
import sansItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline";
import sansRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline";
import script from "katex/dist/fonts/KaTeX_Script-Regular.woff2?inline";
import size1 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline";
import size2 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline";
import size3 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline";
import size4 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline";
import typewriter from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline";

const FONTS: Record<string, string> = {
  "KaTeX_AMS-Regular.woff2": ams,
  "KaTeX_Caligraphic-Bold.woff2": caligraphicBold,
  "KaTeX_Caligraphic-Regular.woff2": caligraphicRegular,
  "KaTeX_Fraktur-Bold.woff2": frakturBold,
  "KaTeX_Fraktur-Regular.woff2": frakturRegular,
  "KaTeX_Main-Bold.woff2": mainBold,
  "KaTeX_Main-BoldItalic.woff2": mainBoldItalic,
  "KaTeX_Main-Italic.woff2": mainItalic,
  "KaTeX_Main-Regular.woff2": mainRegular,
  "KaTeX_Math-BoldItalic.woff2": mathBoldItalic,
  "KaTeX_Math-Italic.woff2": mathItalic,
  "KaTeX_SansSerif-Bold.woff2": sansBold,
  "KaTeX_SansSerif-Italic.woff2": sansItalic,
  "KaTeX_SansSerif-Regular.woff2": sansRegular,
  "KaTeX_Script-Regular.woff2": script,
  "KaTeX_Size1-Regular.woff2": size1,
  "KaTeX_Size2-Regular.woff2": size2,
  "KaTeX_Size3-Regular.woff2": size3,
  "KaTeX_Size4-Regular.woff2": size4,
  "KaTeX_Typewriter-Regular.woff2": typewriter,
};

/** `url(fonts/KaTeX_X.woff2)` → `url(data:font/woff2;base64,…)`. */
export const KATEX_CSS = css.replace(
  /url\((['"]?)fonts\/([^)'"]+)\1\)/g,
  (match: string, _quote: string, name: string) => {
    const data = FONTS[name];
    return data ? `url(${data})` : match;
  },
);
