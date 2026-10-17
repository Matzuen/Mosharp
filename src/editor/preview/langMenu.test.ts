import { matchLanguages } from "./langOptions.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const js = matchLanguages("js");
assert(js.length > 0, "js matches something");
assert(js[0].value === "js", `the shortest alias wins (got ${js[0].value})`);

const html = matchLanguages("htm");
assert(html.some((option) => option.value === "html"), "a prefix finds html");

const mermaid = matchLanguages("mer");
assert(mermaid.some((option) => option.value === "mermaid"), "editor-only languages are listed");

const vega = matchLanguages("vega");
assert(vega.some((option) => option.value === "vega"), "vega is offered");
assert(vega.some((option) => option.value === "vega-lite"), "vega-lite is offered");

const upper = matchLanguages("JS");
assert(upper.length > 0 && upper[0].value === "js", "matching is case-insensitive");

assert(matchLanguages("").length === 0, "empty query offers nothing");
assert(matchLanguages("   ").length === 0, "whitespace only offers nothing");
assert(matchLanguages("zzzznotalang").length === 0, "unknown text offers nothing");
assert(matchLanguages("a").length <= 8, "the list stays short");

// Every option is safe to write into an info string.
for (const option of matchLanguages("c")) {
  assert(!/\s/.test(option.value), `no spaces in ${option.value}`);
}

console.log("langMenu ok");
