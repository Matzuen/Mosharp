import { invoke } from "@tauri-apps/api/core";

export interface WalkEntry {
  path: string;
  name: string;
  is_dir: boolean;
}

export interface TextMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceSearch {
  names: WalkEntry[];
  matches: TextMatch[];
  truncated: boolean;
}

/**
 * One backend walk answering both searches.
 *
 * The sidebar tree is loaded lazily, so a front-end filter on `flatTree()` only
 * ever sees expanded folders. The backend walks the workspace itself, which is
 * also what makes searching file *contents* possible.
 */
export function searchWorkspace(
  root: string,
  query: string,
  limit = 200,
  caseSensitive = false,
  useRegex = false,
): Promise<WorkspaceSearch> {
  return invoke<WorkspaceSearch>("search_workspace", {
    root,
    query,
    limit,
    caseSensitive,
    useRegex,
  });
}
