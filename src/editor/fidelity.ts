/** How an existing file separates lines. New documents stay LF. */
export type LineEnding = "\n" | "\r\n";

const FRONTMATTER_OPENS = /^(?:\uFEFF)?---[ \t]*$/;
const FRONTMATTER_CLOSES = /^(?:---|\.\.\.)[ \t]*$/;
const MAPPING_ENTRY = /^[A-Za-z_][A-Za-z0-9_.-]*[ \t]*:([ \t]|$)/;
const BLANK = /^[ \t]*$/;
const FRONTMATTER_LIMIT = 100;

const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const RULE_LINE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BREAK_LINE = /^[ \t]{0,3}(?:<br\s*\/?>(?:[ \t]*))+$/i;

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function detectLineEnding(text: string): LineEnding {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function toLineFeed(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sameText(left: string, right: string): boolean {
  return toLineFeed(left) === toLineFeed(right);
}

export function applyLineEnding(text: string, ending: LineEnding): string {
  const lf = toLineFeed(text);
  return ending === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}

/**
 * YAML between the opening `---` and the closing `---` / `...` stays a raw
 * slice. A later pass must not reorder keys or retouch those delimiter lines.
 */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!/^(?:\uFEFF)?---/.test(markdown)) return { frontmatter: "", body: markdown };
  const lines = markdown.split("\n");
  if (!FRONTMATTER_OPENS.test(lines[0].replace(/\r$/, ""))) {
    return { frontmatter: "", body: markdown };
  }

  let hasEntry = false;
  const limit = Math.min(lines.length, FRONTMATTER_LIMIT + 1);
  for (let i = 1; i < limit; i += 1) {
    const text = lines[i].replace(/\r$/, "");
    if (FRONTMATTER_CLOSES.test(text)) {
      if (!hasEntry) return { frontmatter: "", body: markdown };
      let last = i;
      while (last + 1 < lines.length && BLANK.test(lines[last + 1].replace(/\r$/, ""))) last += 1;
      const endsWithNewline = last < lines.length - 1;
      return {
        frontmatter: lines.slice(0, last + 1).join("\n") + (endsWithNewline ? "\n" : ""),
        body: endsWithNewline ? lines.slice(last + 1).join("\n") : "",
      };
    }
    if (text.startsWith("#")) return { frontmatter: "", body: markdown };
    if (MAPPING_ENTRY.test(text)) hasEntry = true;
  }
  return { frontmatter: "", body: markdown };
}

interface RuleHit {
  index: number;
  marker: string;
}

function collectRuleHits(lines: string[]): RuleHit[] {
  const hits: RuleHit[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_LINE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = RULE_LINE.exec(lines[i]);
    if (!match) continue;
    // A dash line under text is a setext heading, not a thematic break.
    if (match[1] === "-" && i > 0 && lines[i - 1].trim() !== "") continue;
    hits.push({ index: i, marker: match[1] });
  }
  return hits;
}

function normalizeRules(body: string): string {
  const lines = body.split("\n");
  const hits = collectRuleHits(lines);
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.marker, (counts.get(hit.marker) ?? 0) + 1);
  if (counts.size < 2) return body;

  let winner = "";
  let winnerCount = 0;
  let tie = false;
  for (const [marker, count] of counts) {
    if (count > winnerCount) {
      winner = marker;
      winnerCount = count;
      tie = false;
    } else if (count === winnerCount) {
      tie = true;
    }
  }
  if (!winner || tie) return body;

  const spellings = new Map<string, number>();
  for (const hit of hits) {
    if (hit.marker !== winner) continue;
    const line = lines[hit.index];
    spellings.set(line, (spellings.get(line) ?? 0) + 1);
  }
  let spelling = "";
  let spellingCount = 0;
  for (const [line, count] of spellings) {
    if (count > spellingCount) {
      spelling = line;
      spellingCount = count;
    }
  }

  let changed = false;
  for (const hit of hits) {
    if (lines[hit.index] === spelling) continue;
    lines[hit.index] = spelling;
    changed = true;
  }
  return changed ? lines.join("\n") : body;
}

function normalizeBlankLines(body: string): string {
  const lines = body.split("\n");
  let inFence = false;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_LINE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !BREAK_LINE.test(lines[i])) continue;
    lines[i] = "";
    changed = true;
  }
  return changed ? lines.join("\n") : body;
}

/** Marker line to insert. Mixed documents follow the marker that already leads. */
export function majorityRuleLine(source: string): string {
  const split = splitFrontmatter(toLineFeed(source));
  const lines = split.body.split("\n");
  const hits = collectRuleHits(lines);
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.marker, (counts.get(hit.marker) ?? 0) + 1);

  let winner = "";
  let winnerCount = 0;
  let tie = false;
  for (const [marker, count] of counts) {
    if (count > winnerCount) {
      winner = marker;
      winnerCount = count;
      tie = false;
    } else if (count === winnerCount) {
      tie = true;
    }
  }
  if (!winner || tie) return "---";

  const spellings = new Map<string, number>();
  for (const hit of hits) {
    if (hit.marker !== winner) continue;
    const line = lines[hit.index];
    spellings.set(line, (spellings.get(line) ?? 0) + 1);
  }
  let spelling = "---";
  let spellingCount = 0;
  for (const [line, count] of spellings) {
    if (count > spellingCount) {
      spelling = line;
      spellingCount = count;
    }
  }
  return spelling;
}

/**
 * Bytes for disk: frontmatter untouched, blank lines stay blank lines,
 * mixed thematic breaks follow the majority marker, then the file's own
 * line ending is put back.
 */
export function prepareForSave(text: string, ending: LineEnding): string {
  const lf = toLineFeed(text);
  const split = splitFrontmatter(lf);
  const body = normalizeBlankLines(normalizeRules(split.body));
  return applyLineEnding(split.frontmatter + body, ending);
}

export function savedBuffer(text: string): string {
  return toLineFeed(prepareForSave(text, "\n"));
}

export function lineChanges(before: string, after: string): TextChange[] {
  if (before === after) return [];
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length !== right.length) return [{ from: 0, to: before.length, insert: after }];
  const changes: TextChange[] = [];
  let pos = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      changes.push({ from: pos, to: pos + left[i].length, insert: right[i] });
    }
    pos += left[i].length + 1;
  }
  return changes;
}
