import { matchInlineTag } from "./inlineHtml.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const bold = matchInlineTag("文字 <b>粗</b> 文字", 3);
assert(bold?.tag === "b", "the tag name is lowercased");
assert(bold?.void === false, "b is not void");
assert(bold?.end === 11, `the pair spans to the closing tag (got ${bold?.end})`);
assert(bold?.raw === "<b>粗</b>", "the raw construct is returned");

const span = matchInlineTag('x <span class="x">片段</span> y', 2);
assert(span?.tag === "span", "attributes are accepted");
assert(span?.raw === '<span class="x">片段</span>', "the raw construct includes attributes");

const br = matchInlineTag("a <br> b", 2);
assert(br?.void === true && br?.end === 6, "a void tag ends at its own end");

const img = matchInlineTag('a <img src="a.png"> b', 2);
assert(img?.void === true, "an image is void");
assert(img?.end === 19, `void tags stop at the tag end (got ${img?.end})`);

const upper = matchInlineTag("<B>粗</B>", 0);
assert(upper?.tag === "b", "the tag name is lowercased");
assert(upper?.raw === "<B>粗</B>", "tags match case-insensitively");

const quoted = matchInlineTag('<span title="</span>">x</span>', 0);
assert(quoted !== null, "a quoted close tag must not terminate the construct");
assert(quoted?.raw === '<span title="</span>">x</span>', `the real partner is found (got ${quoted?.raw})`);

assert(matchInlineTag("<b>未闭合", 0) === null, "an unclosed tag is left alone");
assert(matchInlineTag("普通文字", 0) === null, "plain text is not a tag");
assert(matchInlineTag("<3 爱心", 0) === null, "a smiley is not a tag");
assert(
  matchInlineTag(`<b>${"x".repeat(2500)}</b>`, 0) === null,
  "an oversized construct is not rendered",
);

console.log("inlineHtml ok");
