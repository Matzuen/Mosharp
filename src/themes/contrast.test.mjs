import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contrast guard for the theme palette.
 *
 * Italic text is now synthesised by the browser (`font-synthesis: style`), so
 * anything styled italic is read as body text rather than a decorative accent —
 * it has to stay legible on the theme's own background. These floors are
 * regression guards, not WCAG certification: comment text is secondary by
 * design and sits well below body-text contrast in most themes.
 */
const dir = dirname(fileURLToPath(import.meta.url));

function hexToRgb(value) {
  const raw = value.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
}

function luminance(value) {
  const [r, g, b] = hexToRgb(value).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function variables(css) {
  const vars = {};
  for (const match of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

const files = readdirSync(dir).filter((file) => file.endsWith(".css"));
if (files.length < 15) throw new Error(`expected the full theme set, found ${files.length}`);

const MIN_BODY = 4.5;
const MIN_ACCENT = 3.5;
const MIN_COMMENT = 2.2;
const advised = [];

for (const file of files) {
  const vars = variables(readFileSync(join(dir, file), "utf8"));
  const paper = vars.paper;
  const block = vars["code-block"];
  if (!paper || !block || !vars.ink) throw new Error(`${file}: missing core colours`);

  const body = contrast(vars.ink, paper);
  if (body < MIN_BODY) throw new Error(`${file}: --ink on --paper is ${body.toFixed(2)}`);

  for (const name of ["em", "quote"]) {
    const value = vars[name];
    if (!value) throw new Error(`${file}: missing --${name}`);
    const ratio = contrast(value, paper);
    if (ratio < MIN_ACCENT) throw new Error(`${file}: --${name} on --paper is ${ratio.toFixed(2)}`);
  }

  const comment = contrast(vars["syn-comment"], block);
  if (comment < MIN_COMMENT) {
    throw new Error(`${file}: --syn-comment on --code-block is ${comment.toFixed(2)}`);
  }
  if (comment < 3) advised.push(`${file} comments at ${comment.toFixed(2)}`);
}

if (advised.length > 0) {
  console.log(`contrast ok (below 3.0, muted by design: ${advised.join(", ")})`);
} else {
  console.log("contrast ok");
}
