import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const markdownFilter = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];

export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface OpenedDocument {
  path: string;
  content: string;
  mtimeMs: number;
}

export async function openMarkdownPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title: "打开 Markdown",
    filters: markdownFilter,
  });
  return typeof selected === "string" ? selected : null;
}

export async function openFolderPath(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "打开文件夹",
  });
  return typeof selected === "string" ? selected : null;
}

export async function saveMarkdownPath(suggested?: string): Promise<string | null> {
  return save({
    title: "保存 Markdown",
    defaultPath: suggested ?? "未命名.md",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
}

export async function readDocument(path: string): Promise<OpenedDocument> {
  return invoke<OpenedDocument>("read_document", { path });
}

export function writeDocument(path: string, content: string): Promise<void> {
  return invoke("write_document", { path, content });
}

export function listDirectory(path: string): Promise<DirEntryInfo[]> {
  return invoke("list_directory", { path });
}

export function revealInFolder(path: string): Promise<void> {
  return invoke("reveal_in_folder", { path });
}

export function syncFileWatches(paths: string[]): Promise<void> {
  return invoke("sync_file_watches", { paths });
}

export function suppressFileWatch(path: string, ms = 1200): Promise<void> {
  return invoke("suppress_file_watch", { path, ms });
}

export function touchFileWatchBaseline(path: string): Promise<void> {
  return invoke("touch_file_watch_baseline", { path });
}

export function saveRecoveryCopy(suggestedName: string, content: string): Promise<string> {
  return invoke("save_recovery_copy", { suggestedName, content });
}
