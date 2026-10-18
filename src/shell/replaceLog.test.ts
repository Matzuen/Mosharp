import {
  appendRun,
  lastUndoableRun,
  markUndone,
  parseRuns,
  type ReplaceRun,
} from "./replaceLog.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(at: number, files: number, undoneAt?: number): ReplaceRun {
  return {
    at,
    query: "旧",
    replacement: "新",
    entries: Array.from({ length: files }, (_, index) => ({
      original: `C:/notes/${index}.md`,
      backup: `C:/recovered/${at}-${index}.md`,
    })),
    undoneAt,
  };
}

assert(parseRuns(null).length === 0, "no stored log, no runs");
assert(parseRuns("not json").length === 0, "broken json is ignored");
assert(parseRuns('{"a":1}').length === 0, "a non-array is ignored");
assert(parseRuns('[{"at":"x"}]').length === 0, "a run without a timestamp is ignored");
assert(parseRuns('[{"at":1,"entries":[]}]').length === 0, "a run without entries is ignored");

const one = run(100, 2);
const stored = parseRuns(JSON.stringify([one]));
assert(stored.length === 1 && stored[0].entries.length === 2, "a stored run round-trips");
assert(stored[0].query === "旧" && stored[0].replacement === "新", "the search terms survive");

// Entries missing a path are dropped rather than trusted.
const partial = parseRuns(
  JSON.stringify([{ at: 5, entries: [{ original: "a.md", backup: "b.md" }, { original: "c.md" }] }]),
);
assert(partial.length === 1 && partial[0].entries.length === 1, "incomplete entries are dropped");

// The encoding is kept so a GBK file is restored as GBK, not UTF-8.
const withEncoding = parseRuns(
  JSON.stringify([{ at: 6, entries: [{ original: "a.md", backup: "b.md", encoding: "gbk" }] }]),
);
assert(withEncoding[0].entries[0].encoding === "gbk", "the encoding round-trips");
const withoutEncoding = parseRuns(JSON.stringify([{ at: 7, entries: [{ original: "a.md", backup: "b.md" }] }]));
assert(withoutEncoding[0].entries[0].encoding === undefined, "a missing encoding stays undefined");

const runs = appendRun(appendRun([], run(1, 1)), run(2, 1));
assert(runs.length === 2, "runs accumulate");
assert(lastUndoableRun(runs)?.at === 2, "the newest run is undone first");

const undone = markUndone(runs, 2, 999);
assert(undone[1].undoneAt === 999, "the run is marked undone");
assert(lastUndoableRun(undone)?.at === 1, "the next undoable run is the previous one");

const allUndone = markUndone(undone, 1, 1000);
assert(lastUndoableRun(allUndone) === null, "nothing left to undo");

// The log is capped so it cannot grow without bound.
let many: ReplaceRun[] = [];
for (let index = 0; index < 15; index += 1) many = appendRun(many, run(index, 1));
assert(many.length === 10, "the log keeps the ten newest runs");
assert(many[9].at === 14, "the newest run is last");

console.log("replaceLog ok");
