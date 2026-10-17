import { caretAfterLink, isOnlyUrl, linkMarkdown } from "./pasteLink.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(isOnlyUrl("https://example.com/a"), "a bare URL counts");
assert(isOnlyUrl("  http://example.com  "), "surrounding spaces are trimmed");
assert(!isOnlyUrl("见 https://example.com"), "text around the URL does not count");
assert(!isOnlyUrl("https://a.com b"), "two tokens do not count");
assert(!isOnlyUrl("ftp://example.com"), "only http(s) counts");
assert(!isOnlyUrl(""), "empty text does not count");

assert(linkMarkdown("文档", "https://a.com") === "[文档](https://a.com)", "plain label");
assert(
  linkMarkdown("a[b]c", "https://a.com") === "[a\\[b\\]c](https://a.com)",
  "brackets in the label are escaped",
);
assert(linkMarkdown("x", " https://a.com ") === "[x](https://a.com)", "the URL is trimmed");

const markdown = "[文档](https://a.com)";
assert(caretAfterLink("文档", "https://a.com") === markdown.length, "caret lands after the link");

console.log("paste link ok");
