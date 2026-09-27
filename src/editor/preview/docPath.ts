/** Active file path used to resolve relative images. Not stored in the document. */
let current: string | null = null;
const pending = new Map<string, string>();

export function activeDocumentPath(): string | null {
  return current;
}

export function setActiveDocumentPath(path: string | null) {
  current = path && path.trim() ? path : null;
}

/** Untitled pastes remember where the bytes actually landed. */
export function rememberPendingImage(relative: string, absolute: string) {
  pending.set(relative.replace(/\\/g, "/"), absolute);
}

export function pendingImagePath(relative: string): string | null {
  return pending.get(relative.replace(/\\/g, "/")) ?? null;
}

export function pendingImagesIn(text: string): Array<{ relative: string; absolute: string }> {
  const found: Array<{ relative: string; absolute: string }> = [];
  for (const [relative, absolute] of pending) {
    if (text.includes(relative)) found.push({ relative, absolute });
  }
  return found;
}
