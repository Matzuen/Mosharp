import { EditorState } from "@codemirror/state";
import { decorateMath } from "./math.ts";

/**
 * `decorateMath` only reads `view.state`, so a bare state is enough to exercise
 * the decoration decisions without a DOM.
 */
function probe(doc: string, anchor: number) {
  const state = EditorState.create({ doc, selection: { anchor } });
  const build = {
    decos: [] as Array<{ from: number; to: number }>,
    atomic: [] as Array<{ from: number; to: number }>,
    covered: [] as Array<{ from: number; to: number }>,
    hidden: [] as number[],
    lineClasses: new Map<number, Set<string>>(),
    labels: new Map<number, string>(),
  };
  decorateMath({ state } as never, 0, doc.length, build as never);
  return build;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// A document that ends at the closing fence puts the caret on the fence itself.
// That used to count as "caret inside the block", so the formula never rendered.
const endsWithFence = "$$\na^2+b^2=c^2\n$$";
const atEnd = probe(endsWithFence, endsWithFence.length);
assert(atEnd.decos.length > 0, "a block ending the document still renders");
assert(
  atEnd.decos.some((deco) => deco.from === 0 && deco.to === 2),
  "the opening fence is replaced by the formula",
);
assert(
  !atEnd.atomic.some((deco) => deco.from === endsWithFence.length - 2),
  "the closing fence stays reachable while the caret sits on it",
);

// A collapsed block also labels its source span in the gutter, so the number
// column shows "1–3" instead of skipping the swallowed lines.
assert(
  [...atEnd.labels.values()].includes("1–3"),
  `collapsed block labels its source range (got ${JSON.stringify([...atEnd.labels.values()])})`,
);

// The caret anywhere in the opening fence or the body must reveal the source,
// otherwise the TeX cannot be edited.
assert(probe(endsWithFence, 1).decos.length === 0, "caret on the opening fence shows source");
assert(probe(endsWithFence, 4).decos.length === 0, "caret in the body shows source");

// Trailing content keeps working as before.
const withTail = `${endsWithFence}\n\ntail`;
assert(probe(withTail, withTail.length).decos.length > 0, "caret after the block renders it");
assert(probe(withTail, 4).decos.length === 0, "caret in the body still shows source");

// Single-line and inline math are unaffected, including at the document end
// where the caret rests on the closing delimiter.
assert(probe("$$x^2$$\n", 7).decos.length === 1, "single-line display math renders at line end");
assert(probe("$$x^2$$\n", 8).decos.length === 1, "single-line display math renders after the line");
assert(probe("$$x^2$$\n", 3).decos.length === 0, "single-line display math reveals inside");
assert(probe("a $x^2$ b\n", 9).decos.length === 1, "inline math decorates");
assert(probe("a $x^2$ b\n", 4).decos.length === 0, "inline math reveals under the caret");

// An unclosed block stays as source so the marks can be fixed.
assert(probe("$$\na^2\n", 6).decos.length === 0, "unclosed block stays source");

console.log("math block ok");
