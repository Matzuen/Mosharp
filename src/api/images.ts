import { invoke } from "@tauri-apps/api/core";

export interface SavedImage {
  relative: string;
  absolute: string;
}

export function saveImage(
  docPath: string | null,
  bytes: number[],
  extension: string,
): Promise<SavedImage> {
  return invoke<SavedImage>("save_image", { docPath, bytes, extension });
}

export function placeImage(docPath: string, relative: string, source: string): Promise<void> {
  return invoke("place_image", { docPath, relative, source });
}
