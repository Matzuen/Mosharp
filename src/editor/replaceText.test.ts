import { replaceAllText } from "./replaceText.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const plain = replaceAllText("foo bar foo", "foo", "baz");
assert(plain.text === "baz bar baz" && plain.count === 2, "every occurrence is replaced");

const caseInsensitive = replaceAllText("Foo foo FOO", "foo", "x");
assert(caseInsensitive.count === 3 && caseInsensitive.text === "x x x", "case-insensitive by default");

const strict = replaceAllText("Foo foo", "foo", "x", true);
assert(strict.count === 1 && strict.text === "Foo x", "case-sensitive when asked");

// Regex metacharacters in the query must be literal.
const dotted = replaceAllText("a.b axb", "a.b", "Z");
assert(dotted.text === "Z axb" && dotted.count === 1, "the query is literal, not a pattern");

// A replacement containing `$` must not be treated as a capture reference.
const dollar = replaceAllText("price", "price", "$1");
assert(dollar.text === "$1", "dollar signs stay literal");

assert(replaceAllText("abc", "", "x").count === 0, "empty query changes nothing");
assert(replaceAllText("abc", "zzz", "x").count === 0, "no match, no change");
assert(replaceAllText("aaa", "aa", "b").count === 1, "non-overlapping matches");

console.log("replaceText ok");
