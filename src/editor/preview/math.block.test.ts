import { EditorState } from "@codemirror/state";
import { decorateMath, mathRegions } from "./math.ts";

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

// Collapsed rendering: the caret lives outside the block.
const blockDoc = "$$\na^2+b^2=c^2\n$$";
const withTail = `${blockDoc}\n\ntail`;
const collapsed = probe(withTail, withTail.length);
assert(collapsed.decos.length > 0, "caret outside the block renders it");
assert(
  collapsed.decos.some((deco) => deco.from === 0 && deco.to === 2),
  "the opening fence is replaced by the formula",
);
assert(
  collapsed.atomic.some((deco) => deco.from === blockDoc.length - 2),
  "the closing fence is swallowed by the collapsed block",
);

// A collapsed block also labels its source span in the gutter, so the number
// column shows "1–3" instead of skipping the swallowed lines.
assert(
  [...collapsed.labels.values()].includes("1–3"),
  `collapsed block labels its source range (got ${JSON.stringify([...collapsed.labels.values()])})`,
);

// The caret anywhere in the block — opening fence, body, or right after the
// last `$` — must reveal the source. A rendered preview is still appended
// below it, so "no replacement decoration" is what "source is visible" means.
const renders = (build: { decos: Array<{ from: number; to: number }> }) =>
  build.decos.some((deco) => deco.to > deco.from);
const previewOnly = (build: { decos: Array<{ from: number; to: number }> }) =>
  build.decos.length > 0 && !renders(build);

assert(!renders(probe(blockDoc, 1)), "caret on the opening fence shows source");
assert(!renders(probe(blockDoc, 4)), "caret in the body shows source");
assert(!renders(probe(blockDoc, blockDoc.length)), "caret after the last $ shows source");
assert(previewOnly(probe(blockDoc, 4)), "editing renders a preview below the source");

// The preview must be an inline widget on the closing fence's end: block
// widgets are not allowed from a view plugin, and trying left the formula
// stuck in its rendered state.
const editing = probe(blockDoc, 4);
const points = editing.decos.filter((deco) => deco.from === deco.to);
assert(points.length === 1, `editing adds exactly one widget (got ${points.length})`);
assert(
  points[0].from === blockDoc.length,
  `the preview sits at the end of the closing fence (got ${points[0].from})`,
);

// Trailing content keeps working as before.
assert(renders(probe(withTail, withTail.length)), "caret after the block renders it");
assert(!renders(probe(withTail, 4)), "caret in the body still shows source");

// Single-line and inline math are unaffected, including at the document end
// where the caret rests on the closing delimiter.
assert(probe("$$x^2$$\n", 7).decos.length === 1, "single-line display math renders at line end");
assert(probe("$$x^2$$\n", 8).decos.length === 1, "single-line display math renders after the line");
assert(probe("$$x^2$$\n", 3).decos.length === 0, "single-line display math reveals inside");
assert(probe("a $x^2$ b\n", 9).decos.length === 1, "inline math decorates");
// While editing, the source stays and a bubble carries the rendered form. The
// bubble is a zero-sized point widget, so it cannot push the line around.
const inlineEditing = probe("a $x^2$ b\n", 4);
assert(!renders(inlineEditing), "inline math reveals under the caret");
const bubble = inlineEditing.decos.filter((deco) => deco.from === deco.to);
assert(bubble.length === 1, `inline editing adds exactly one bubble (got ${bubble.length})`);
assert(bubble[0].from === 2, `the bubble anchors at the opening dollar (got ${bubble[0].from})`);
// Inline maths only reveals with the caret *between* the dollars; sitting just
// after the closing `$` is ordinary prose and keeps the formula rendered.
assert(probe("a $x^2$ b\n", 7).decos.length === 1, "inline math renders right after the closing $");
assert(
  !probe("a $x^2$ b\n", 9).decos.some((deco) => deco.from === deco.to),
  "inline math never renders a preview widget",
);

// An unclosed block stays as source so the marks can be fixed.
assert(probe("$$\na^2\n", 6).decos.length === 0, "unclosed block stays source");

// Regions mark where inline markup must stay literal. Only display maths
// qualifies: inline `$…$` keeps its normal markdown treatment.
function lines(texts: string[]) {
  let offset = 0;
  return texts.map((text) => {
    const from = offset;
    offset += text.length + 1;
    return { from, text };
  });
}

const block = mathRegions(lines(["$$", "a^2+b^2=c^2", "$$"]));
assert(block.length === 1, "a $$ block yields one region");
assert(block[0].from === 0 && block[0].to === 17, `block covers the whole fence (${block[0].to})`);

assert(mathRegions(lines(["行内 $x^2$ 说明"])).length === 1, "inline math is a region too");
assert(mathRegions(lines(["$$x^2$$"])).length === 1, "single-line display math is a region");
assert(mathRegions(lines(["代码 `$x$` 不算"])).length === 0, "math inside code is not a region");
assert(mathRegions(lines(["普通段落"])).length === 0, "prose has no math");
assert(mathRegions(lines(["$$", "a^2"])).length === 1, "unclosed block still covers its lines");

console.log("math block ok");
