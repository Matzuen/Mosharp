import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { EditorView, WidgetType } from "@codemirror/view";
import { activeDocumentPath, pendingImagePath, rememberPendingImage } from "./docPath";
import { saveImage } from "../../api/images";

const memoryUrls = new Map<string, string>();

function dirname(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(0, slash) : "";
}

function joinPath(dir: string, rel: string): string {
  if (!dir) return rel;
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${rel.replace(/\//g, sep)}`;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Only http(s), data, blob, or Tauri's asset URL. Never a raw file path. */
export function imageDisplaySrc(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, "");
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const remembered = memoryUrls.get(url) ?? pendingImagePath(url);
  if (remembered && (remembered.startsWith("blob:") || remembered.startsWith("data:"))) return remembered;
  let absolute = remembered && isAbsolute(remembered) ? remembered : url;
  if (!isAbsolute(absolute)) {
    const doc = activeDocumentPath();
    if (!doc) return null;
    absolute = joinPath(dirname(doc), absolute);
  }
  if (!isTauri()) return null;
  try {
    return convertFileSrc(absolute);
  } catch {
    return null;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return this.src === other.src && this.alt === other.alt && this.width === other.width;
  }

  get estimatedHeight() {
    return this.width ? Math.min(420, Math.max(48, this.width * 0.6)) : 160;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.draggable = false;
    const shown = imageDisplaySrc(this.src);
    if (shown) img.src = shown;
    else {
      img.alt = this.alt || this.src;
      wrap.classList.add("cm-md-image-missing");
    }
    if (this.width) img.style.width = `${this.width}px`;
    wrap.appendChild(img);

    const handle = document.createElement("span");
    handle.className = "cm-md-image-handle";
    handle.title = "拖动调整宽度";
    wrap.appendChild(handle);

    const startWidth = () => img.getBoundingClientRect().width || this.width || 240;
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const originX = event.clientX;
      const origin = startWidth();
      const move = (ev: MouseEvent) => {
        const next = Math.round(Math.min(1200, Math.max(48, origin + ev.clientX - originX)));
        img.style.width = `${next}px`;
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const next = Math.round(Math.min(1200, Math.max(48, origin + ev.clientX - originX)));
        const pos = view.posAtDOM(wrap);
        if (pos == null) return;
        const found = imageRangeAt(view, pos);
        if (!found) return;
        commitWidth(view, found.from, found.to, next);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    return wrap;
  }

  destroy(dom: HTMLElement) {
    const img = dom.querySelector("img");
    if (img) img.removeAttribute("src");
  }

  ignoreEvent() {
    return true;
  }
}

function imageRangeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const re = /!\[[^\]]*\]\([^)\n]+\)(?:\{width=\d+\})?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line.text))) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to };
  }
  return null;
}

function commitWidth(view: EditorView, from: number, to: number, width: number) {
  if (from < 0 || to > view.state.doc.length || from >= to) return;
  const current = view.state.doc.sliceString(from, to);
  const next = /\{width=\d+\}\s*$/.test(current)
    ? current.replace(/\{width=\d+\}\s*$/, `{width=${width}}`)
    : `${current}{width=${width}}`;
  if (next === current) return;
  view.dispatch({ changes: { from, to, insert: next } });
}

export function imageSuffix(doc: { sliceString(from: number, to: number): string; length: number }, to: number) {
  const after = doc.sliceString(to, Math.min(doc.length, to + 16));
  const match = /^\{width=(\d+)\}/.exec(after);
  if (!match) return { end: to, width: null as number | null };
  return { end: to + match[0].length, width: Number(match[1]) };
}

export function imageUrl(nodeText: string): { src: string; alt: string } {
  const alt = /^!\s*\[([^\]]*)\]/.exec(nodeText)?.[1] ?? "";
  const dest = /\(\s*<?([^>\s)]+)>?/.exec(nodeText)?.[1] ?? "";
  return { src: dest, alt };
}

function extensionFor(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/svg+xml") return "svg";
  return "png";
}

export async function insertClipboardImage(view: EditorView, file: File) {
  const ext = extensionFor(file.type);
  const stamp = Date.now().toString(36);
  const relative = `assets/img-${stamp}.${ext}`;
  if (isTauri()) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const saved = await saveImage(activeDocumentPath(), bytes, ext);
    rememberPendingImage(saved.relative, saved.absolute);
    insertAtCursor(view, `![](${saved.relative})`);
    return;
  }
  const url = URL.createObjectURL(file);
  memoryUrls.set(relative, url);
  insertAtCursor(view, `![](${relative})`);
}

function insertAtCursor(view: EditorView, text: string) {
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from: head, insert: text },
    selection: { anchor: head + text.length },
  });
}

let pasteImages = true;

export function setPasteImages(enabled: boolean) {
  pasteImages = enabled;
}

export function pasteImageHandler(event: ClipboardEvent, view: EditorView): boolean {
  if (!pasteImages) return false;
  const items = event.clipboardData?.items;
  if (!items) return false;
  const image = [...items].find((item) => item.type.startsWith("image/"));
  if (!image) return false;
  const file = image.getAsFile();
  if (!file) return false;
  event.preventDefault();
  void insertClipboardImage(view, file).catch((error: unknown) => {
    console.error("paste image failed", error);
  });
  return true;
}
