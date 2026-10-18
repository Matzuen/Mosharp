import { ancestorPaths, isInside } from "./treePaths.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const root = "C:\\notes";

assert(isInside("C:\\notes\\a.md", root), "a file in the root is inside");
assert(isInside("C:\\notes", root), "the root is inside itself");
assert(isInside("C:\\notes\\sub\\b.md", root), "nested files are inside");
assert(!isInside("C:\\other\\a.md", root), "another folder is outside");
assert(!isInside("C:\\notes2\\a.md", root), "a sibling with a shared prefix is outside");
assert(isInside("c:/NOTES/Sub/B.md", root), "comparison ignores case and separators");

assert(ancestorPaths(root, "C:\\notes\\a.md").length === 0, "a root file needs no expansion");
assert(
  JSON.stringify(ancestorPaths(root, "C:\\notes\\sub\\deep\\b.md")) ===
    JSON.stringify(["C:\\notes\\sub", "C:\\notes\\sub\\deep"]),
  "folders are listed outermost first",
);
assert(
  JSON.stringify(ancestorPaths("C:/notes", "C:/notes/sub/b.md")) ===
    JSON.stringify(["C:/notes/sub"]),
  "forward slashes are preserved",
);
assert(ancestorPaths(root, "C:\\other\\b.md").length === 0, "outside the root reveals nothing");
assert(ancestorPaths(root, root).length === 0, "the root itself reveals nothing");

console.log("treePaths ok");
