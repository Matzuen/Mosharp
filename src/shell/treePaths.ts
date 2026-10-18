/**
 * Path helpers for the file tree, kept free of Tauri and JSX so they can be
 * tested in Node (the only automated harness this project has).
 */

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** True when `path` is `folder` itself or somewhere below it. */
export function isInside(path: string, folder: string): boolean {
  const child = normalize(path);
  const root = normalize(folder).replace(/\/+$/, "");
  return child === root || child.startsWith(`${root}/`);
}

/**
 * Folders that must be expanded to reveal `path`, outermost first, excluding
 * `root` itself. Returns an empty list when the file sits directly in the root,
 * or when `path` is not inside `root` at all.
 */
export function ancestorPaths(root: string, path: string): string[] {
  if (!root || !path || !isInside(path, root)) return [];
  const relative = path.slice(root.length).replace(/^[\\/]+/, "");
  const parts = relative.split(/[\\/]/).filter((part) => part.length > 0);
  // The last part is the file itself.
  const folders = parts.slice(0, -1);
  const out: string[] = [];
  let current = root.replace(/[\\/]+$/, "");
  for (const folder of folders) {
    const separator = current.includes("\\") ? "\\" : "/";
    current = `${current}${separator}${folder}`;
    out.push(current);
  }
  return out;
}
