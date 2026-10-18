/**
 * Column widths remembered across sessions, per document.
 *
 * Markdown has nowhere to store display widths, so they live in localStorage
 * keyed by document path and table header. The store is a plain object so the
 * lookup and the write-back can be tested without a DOM.
 */

export interface WidthRecord {
  /** document key → table key → widths */
  [scope: string]: { [tableKey: string]: number[] };
}

/** Keep the store small: a document remembers its most recent tables. */
const MAX_TABLES_PER_SCOPE = 64;
const MAX_SCOPES = 64;
const MIN_WIDTH = 24;
const MAX_WIDTH = 4000;

export function parseStore(raw: string | null): WidthRecord {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const store: WidthRecord = {};
    for (const [scope, tables] of Object.entries(value as Record<string, unknown>)) {
      if (!tables || typeof tables !== "object" || Array.isArray(tables)) continue;
      const kept: { [tableKey: string]: number[] } = {};
      for (const [key, widths] of Object.entries(tables as Record<string, unknown>)) {
        if (!Array.isArray(widths)) continue;
        const numbers = widths.filter(
          (width): width is number =>
            typeof width === "number" && Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH,
        );
        if (numbers.length === widths.length && numbers.length > 0) kept[key] = numbers;
      }
      if (Object.keys(kept).length > 0) store[scope] = kept;
    }
    return store;
  } catch {
    return {};
  }
}

export function getWidths(store: WidthRecord, scope: string, key: string): number[] | null {
  const widths = store[scope]?.[key];
  return widths && widths.length > 0 ? widths : null;
}

/** Returns a new store with the widths recorded, trimming the oldest scopes. */
export function setWidths(
  store: WidthRecord,
  scope: string,
  key: string,
  widths: number[],
): WidthRecord {
  if (widths.length === 0) return store;
  const tables = { ...(store[scope] ?? {}) };
  tables[key] = widths.map((width) => Math.round(width));
  const keys = Object.keys(tables);
  if (keys.length > MAX_TABLES_PER_SCOPE) {
    for (const stale of keys.slice(0, keys.length - MAX_TABLES_PER_SCOPE)) delete tables[stale];
  }
  const next: WidthRecord = { ...store, [scope]: tables };
  const scopes = Object.keys(next);
  if (scopes.length > MAX_SCOPES) {
    for (const stale of scopes.slice(0, scopes.length - MAX_SCOPES)) delete next[stale];
  }
  return next;
}

export function serialize(store: WidthRecord): string {
  return JSON.stringify(store);
}
