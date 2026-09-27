import type { ShortcutId } from "./preferences";

/** Chord such as `Ctrl+Shift+P`. Modifier keys alone return null. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  if (event.key === "Control" || event.key === "Shift" || event.key === "Alt" || event.key === "Meta") {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

/** CodeMirror key name. `Ctrl+Shift+H` becomes `Mod-Shift-h`. */
export function toCmKey(binding: string): string | null {
  if (!binding) return null;
  const parts = binding.split("+");
  const raw = parts.pop();
  if (!raw) return null;
  const mods = parts.map((part) => (part === "Ctrl" || part === "Meta" ? "Mod" : part));
  const key = raw.length === 1 ? raw.toLowerCase() : raw;
  return [...mods, key].join("-");
}

export type { ShortcutId };
