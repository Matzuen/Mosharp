import { languages } from "@codemirror/language-data";

/** Fence languages the editor handles itself, on top of the syntax list. */
const EXTRA = ["mermaid", "vega", "vega-lite", "plantuml", "text", "plaintext"];

export interface LangOption {
  /** What gets written into the info string. */
  value: string;
  /** Shown in the menu. */
  label: string;
  /** Extra words that also match. */
  match: string[];
}

const MAX_VISIBLE = 8;

/** A single-token name that can go into a fence info string. */
function fenceName(name: string, aliases: string[]): string {
  // Only single-word aliases are usable: some languages list a sentence-like
  // alias ("closure stylesheets (gss)"), which would end the info string early.
  const usable = aliases.filter((alias) => alias.length > 0 && !/\s/.test(alias));
  const shortest = usable.reduce<string | null>(
    (best, alias) => (best === null || alias.length < best.length ? alias : best),
    null,
  );
  if (shortest) return shortest;
  // "Closure Stylesheets (GSS)" → "gss"; anything else loses its spaces.
  const parenthesised = /\(([^)\s]+)\)/.exec(name);
  if (parenthesised) return parenthesised[1].toLowerCase();
  return name.toLowerCase().replace(/\s+/g, "-");
}

function buildOptions(): LangOption[] {
  const seen = new Set<string>();
  const out: LangOption[] = [];
  for (const language of languages) {
    const aliases = language.alias.map((alias) => alias.toLowerCase());
    const value = fenceName(language.name, aliases);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: language.name,
      match: [language.name.toLowerCase(), ...aliases],
    });
  }
  for (const extra of EXTRA) {
    if (seen.has(extra)) continue;
    seen.add(extra);
    out.push({ value: extra, label: extra, match: [extra] });
  }
  out.sort((left, right) => left.label.localeCompare(right.label));
  return out;
}

const OPTIONS = buildOptions();

/** Options whose name starts with, or contains, the typed prefix. */
export function matchLanguages(query: string): LangOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const starts: LangOption[] = [];
  const contains: LangOption[] = [];
  for (const option of OPTIONS) {
    if (option.value.startsWith(needle) || option.match.some((word) => word.startsWith(needle))) {
      starts.push(option);
    } else if (option.value.includes(needle) || option.match.some((word) => word.includes(needle))) {
      contains.push(option);
    }
  }
  return [...starts, ...contains].slice(0, MAX_VISIBLE);
}
