import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const markdownFilter = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];

export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
}

export type FileEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gbk";

export function normalizeEncoding(value: string | undefined): FileEncoding {
  if (value === "utf-8-bom" || value === "utf-16le" || value === "utf-16be" || value === "gbk") {
    return value;
  }
  return "utf-8";
}

export interface OpenedDocument {
  path: string;
  content: string;
  mtimeMs: number;
  encoding?: string;
}

export async function openMarkdownPath(title: string): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title,
    filters: markdownFilter,
  });
  return typeof selected === "string" ? selected : null;
}

export async function openFolderPath(title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function saveMarkdownPath(title: string, suggested: string): Promise<string | null> {
  return save({
    title,
    defaultPath: suggested,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
}

export async function readDocument(path: string): Promise<OpenedDocument> {
  return invoke<OpenedDocument>("read_document", { path });
}

export function writeDocument(path: string, content: string, encoding = "utf-8"): Promise<void> {
  return invoke("write_document", { path, content, encoding });
}

export function listDirectory(path: string): Promise<DirEntryInfo[]> {
  return invoke("list_directory", { path });
}

/** Creates an empty document; the parent folder is created when missing. */
export function createDocument(path: string): Promise<void> {
  return invoke("create_document", { path });
}

/** Renames or moves an entry; refuses to overwrite an existing path. */
export function renameEntry(from: string, to: string): Promise<void> {
  return invoke("rename_entry", { from, to });
}

/** Deletes a file, or a folder that is already empty. */
export function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
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

/** Path of the recovery folder, created on demand. */
export function recoveryFolder(): Promise<string> {
  return invoke("recovery_folder");
}

/** Read a referenced image as a data: URI so exports can embed it. */
export function readImageDataUri(path: string): Promise<string> {
  return invoke("read_image_data_uri", { path });
}

/**
 * Documents that were passed on this launch's command line (Explorer
 * double-click / file association). Consumed once.
 */
export function takeStartupFiles(): Promise<string[]> {
  return invoke<string[]>("take_startup_files");
}
