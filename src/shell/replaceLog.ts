/**
 * Log of workspace-wide replacements, so the operation can be undone.
 *
 * Each run records the recovery copy that was written before the file was
 * rewritten. The log lives in localStorage next to the other preferences; the
 * copies themselves live in the recovery folder, which is the durable part.
 */

export interface ReplaceEntry {
  /** Document that was rewritten. */
  original: string;
  /** Recovery copy holding the pre-replacement content. */
  backup: string;
  /** Encoding to write the restored content back with. */
  encoding?: string;
}

export interface ReplaceRun {
  /** Milliseconds since the epoch, used as the run identity. */
  at: number;
  query: string;
  replacement: string;
  entries: ReplaceEntry[];
  /** Set once the run has been rolled back. */
  undoneAt?: number;
}

const MAX_RUNS = 10;

export function parseRuns(raw: string | null): ReplaceRun[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const runs: ReplaceRun[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const run = item as Partial<ReplaceRun>;
      if (typeof run.at !== "number" || !Array.isArray(run.entries)) continue;
      const entries = run.entries.filter(
        (entry): entry is ReplaceEntry =>
          !!entry &&
          typeof (entry as ReplaceEntry).original === "string" &&
          typeof (entry as ReplaceEntry).backup === "string",
      );
      if (entries.length === 0) continue;
      const kept = entries.map((entry) => ({
        original: entry.original,
        backup: entry.backup,
        encoding: typeof entry.encoding === "string" ? entry.encoding : undefined,
      }));
      runs.push({
        at: run.at,
        query: typeof run.query === "string" ? run.query : "",
        replacement: typeof run.replacement === "string" ? run.replacement : "",
        entries: kept,
        undoneAt: typeof run.undoneAt === "number" ? run.undoneAt : undefined,
      });
    }
    return runs.sort((left, right) => left.at - right.at).slice(-MAX_RUNS);
  } catch {
    return [];
  }
}

/** Newest run last; the oldest runs fall off beyond `MAX_RUNS`. */
export function appendRun(runs: ReplaceRun[], run: ReplaceRun): ReplaceRun[] {
  return [...runs, run].slice(-MAX_RUNS);
}

/** The run that "undo last replacement" should reverse, or null. */
export function lastUndoableRun(runs: ReplaceRun[]): ReplaceRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (!runs[index].undoneAt) return runs[index];
  }
  return null;
}

export function markUndone(runs: ReplaceRun[], at: number, undoneAt: number): ReplaceRun[] {
  return runs.map((run) => (run.at === at ? { ...run, undoneAt } : run));
}
