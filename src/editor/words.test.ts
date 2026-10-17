import { countProseWords, countWords } from "./words.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(countWords("") === 0, "empty text has no words");
assert(countWords("hello world") === 2, "two latin words");
assert(countWords("hello") === 1, "one latin word");
assert(countWords("a1 b2") === 2, "digits count as part of a word");
assert(countWords("你好") === 2, "each CJK character is a word");
assert(countWords("你好世界") === 4, "four CJK characters");
assert(countWords("hello 世界") === 3, "mixed latin and CJK");
assert(countWords("don't stop") === 2, "apostrophe does not split a word");
assert(countWords("中文, 英文!") === 4, "punctuation is not a word");
assert(countWords("カタカナ") === 4, "kana count as words");
assert(countWords("hello\n\nworld") === 2, "newlines separate words");

// Prose counting drops code and front matter.
assert(countProseWords("正文\n```js\nconst a = 1;\n```\n结尾") === 4, "fenced code is not prose");
assert(countProseWords("正文\n```\nunclosed fence\n") === 2, "unclosed fence is not prose");
assert(countProseWords("用 `code` 说明") === 3, "inline code is not prose");
assert(
  countProseWords("---\ntitle: 标题\ntags: [a, b]\n---\n正文") === 2,
  "front matter is not prose",
);
assert(countProseWords("~~~\ncode\n~~~\n正文") === 2, "tilde fence is not prose");

console.log("words ok");
