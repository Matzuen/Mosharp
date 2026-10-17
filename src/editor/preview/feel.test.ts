import { syntaxTouched } from "./markTouch.ts";
import { looksLikeRichHtml } from "./htmlPaste.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const caret = (head: number) => [{ from: head, to: head, head }];

assert(!syntaxTouched(caret(4), 0, 2, "inside"), "middle of a word does not open the mark");
assert(!syntaxTouched(caret(2), 0, 2, "inside"), "first content character stays clear");
assert(syntaxTouched(caret(1), 0, 2, "inside"), "caret inside the delimiter opens it");
assert(syntaxTouched(caret(0), 0, 2, "edge"), "block marker opens from its leading edge");
assert(!syntaxTouched(caret(2), 0, 2, "edge"), "block marker stays hidden on the text");
assert(syntaxTouched(caret(8), 2, 8, "inclusive"), "url stays open at its end");
assert(
  syntaxTouched([{ from: 2, to: 8, head: 8 }], 2, 8, "inside"),
  "a selection across the url opens it",
);
assert(!syntaxTouched(caret(1), 2, 8, "inclusive"), "link text does not open the url");

assert(
  looksLikeRichHtml("<p><strong>你好</strong></p>", "你好"),
  "word html converts",
);
assert(
  !looksLikeRichHtml("<p><strong>你好</strong></p>", "这是 **你好**"),
  "markdown on the clipboard stays markdown",
);

console.log("feel ok");
