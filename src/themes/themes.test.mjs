import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "./catalog.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const required = [
  "color-scheme",
  "--paper",
  "--ink",
  "--muted",
  "--faint",
  "--line",
  "--bar",
  "--chrome",
  "--side",
  "--menu",
  "--hover",
  "--accent",
  "--link",
  "--code-bg",
  "--code-block",
  "--code-ink",
  "--code-block-ink",
  "--quote",
  "--quote-border",
  "--highlight",
  "--selection",
  "--danger",
  "--on-danger",
  "--h1",
  "--h2",
  "--h3",
  "--h4",
  "--h1-size",
  "--h2-size",
  "--h3-size",
  "--h4-size",
  "--table-border",
  "--table-head",
  "--table-head-ink",
  "--table-stripe",
  "--math",
  "--math-bg",
  "--rule",
  "--marker",
  "--strong",
  "--em",
  "--syn-keyword",
  "--syn-string",
  "--syn-number",
  "--syn-comment",
  "--editor-font",
  "--editor-size",
];

let colamdLight = 0;
let colamdDark = 0;
const styles = readFileSync(join(dir, "styles.ts"), "utf8");
const readme = readFileSync(join(dir, "README.md"), "utf8");

for (const item of THEMES) {
  if (item.set === "colamd" && item.scheme === "light") colamdLight += 1;
  if (item.set === "colamd" && item.scheme === "dark") colamdDark += 1;
  const css = readFileSync(join(dir, `${item.id}.css`), "utf8");
  if (!css.includes(`html[data-theme="${item.id}"]`)) throw new Error(`selector ${item.id}`);
  if (!css.includes(`--paper: ${item.swatch}`)) throw new Error(`swatch ${item.id}`);
  for (const key of required) {
    if (!css.includes(key)) throw new Error(`${item.id} missing ${key}`);
  }
  if (!styles.includes(`"./${item.id}.css"`)) throw new Error(`import ${item.id}`);
}

if (colamdLight !== 6 || colamdDark !== 6) throw new Error(`colamd ${colamdLight}/${colamdDark}`);
if (!THEMES.some((item) => item.id === "cadmium-light" && item.scheme === "light")) {
  throw new Error("cadmium");
}
if (!THEMES.some((item) => item.id === "material-dark" && item.scheme === "dark")) {
  throw new Error("material");
}
if (!readme.includes("--user-font") || !readme.includes("--accent")) throw new Error("readme");

console.log("themes ok");
