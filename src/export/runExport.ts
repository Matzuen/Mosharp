import { invoke, isTauri } from "@tauri-apps/api/core";
import html2canvas from "html2canvas";
import { save } from "@tauri-apps/plugin-dialog";
import { readImageDataUri } from "../api/files";
import {
  articleCss,
  prepareBody,
  renderArticle,
  renderDocument,
  standaloneHtml,
  type DiagramSlot,
  type ThemeColors,
} from "./article";
import { dataImageToPng, drawDiagram, svgToPng, type DiagramColors } from "./diagrams";
import { markdownToDocx, pictureHrefs, topLevelDiagrams } from "./docx";
import { cursorLine, numberedExportName } from "./pages";
import { presentSlides, type SlideLabels } from "./present";
import { splitDeck } from "./slides";

export type ExportKind = "pdf" | "html" | "word" | "png" | "slides" | "slidesPdf";

export interface ExportRequest {
  markdown: string;
  cursorOffset: number;
  contentWidth: number;
  docPath: string | null;
  title: string;
  desktop: boolean;
  notice: (message: string) => void;
  saved: string;
  failed: string;
  needDesktop: string;
  labels: SlideLabels & {
    pdf: string;
    html: string;
    word: string;
    png: string;
    slidesPdf: string;
  };
}

const LIGHT: DiagramColors = { paper: "#ffffff", ink: "#1c1917", accent: "#44403c" };
const A4 = { width: 8.27, height: 11.69 };
const SLIDE_PAGE = { width: 13.333, height: 7.5 };

let busy = false;

export async function runExport(kind: ExportKind, request: ExportRequest): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await import("katex/dist/katex.min.css");
    const colors = themeColors();
    if (kind === "pdf") await exportPdf(request, colors, false);
    else if (kind === "slidesPdf") await exportPdf(request, colors, true);
    else if (kind === "html") await exportHtml(request, colors);
    else if (kind === "word") await exportWord(request);
    else if (kind === "png") await exportPng(request, colors);
    else await presentSlides({
      markdown: request.markdown,
      cursorLine: cursorLine(request.markdown, request.cursorOffset),
      colors,
      width: request.contentWidth,
      labels: request.labels,
    });
  } catch (error) {
    request.notice(`${request.failed}：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy = false;
  }
}

function themeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: pick("--paper", "#f7f5f0"),
    ink: pick("--ink", "#1c1917"),
    accent: pick("--accent", "#9a3412"),
    line: pick("--line", "#e7e5e4"),
    muted: pick("--muted", "#78716c"),
    link: pick("--link", "#1d4ed8"),
    h1: pick("--h1", "#9a3412"),
    h2: pick("--h2", "#9a3412"),
    h3: pick("--h3", "#c2410c"),
    h4: pick("--h4", "#c2410c"),
    h1Size: pick("--h1-size", "1.7em"),
    h2Size: pick("--h2-size", "1.4em"),
    h3Size: pick("--h3-size", "1.2em"),
    h4Size: pick("--h4-size", "1.05em"),
    tableBorder: pick("--table-border", "#e7e5e4"),
    tableHead: pick("--table-head", "#efece6"),
    tableHeadInk: pick("--table-head-ink", "#1c1917"),
    tableStripe: pick("--table-stripe", "transparent"),
    math: pick("--math", "#9a3412"),
    mathBg: pick("--math-bg", "transparent"),
    rule: pick("--rule", "#d6d3d1"),
    quote: pick("--quote", "#44403c"),
    quoteBorder: pick("--quote-border", "#d6d3d1"),
    highlight: pick("--highlight", "#fde68a"),
    codeBg: pick("--code-bg", "transparent"),
    codeInk: pick("--code-ink", "#1c1917"),
    codeBlock: pick("--code-block", "#f3f1ec"),
    codeBlockInk: pick("--code-block-ink", "#1c1917"),
    strong: pick("--strong", "#1c1917"),
    em: pick("--em", "#44403c"),
  };
}

async function exportHtml(request: ExportRequest, colors: ThemeColors) {
  const article = renderDocument(request.markdown);
  const holder = document.createElement("div");
  holder.innerHTML = article.html;
  await paintDiagrams(holder, article.diagrams, colors);
  // The saved file lives wherever the dialog points, so relative image paths
  // would break: embed the bytes instead.
  await inlineImages(holder, request.docPath);
  const css = articleCss(colors, request.contentWidth);
  // Only pay for the ~340 KB embedded math fonts when the document has math.
  const katexCss = /class="katex/.test(article.html)
    ? (await import("./katexCss")).KATEX_CSS
    : "";
  const html = standaloneHtml(request.title, holder.innerHTML, css, katexCss);
  const name = fileStem(request.title) + ".html";
  if (request.desktop && isTauri()) {
    const path = await choosePath(request.labels.html, name, "html", "HTML");
    if (!path) return;
    await writeText(path, html);
  } else {
    downloadBlob(name, new Blob([html], { type: "text/html;charset=utf-8" }));
  }
  request.notice(request.saved);
}

async function exportWord(request: ExportRequest) {
  const prepared = prepareBody(request.markdown);
  const pngs: Uint8Array[] = [];
  for (const diagram of topLevelDiagrams(prepared.tokens)) {
    const svg = await drawDiagram(diagram.kind, diagram.source, LIGHT);
    pngs.push(svg ? await svgToPng(svg) : new Uint8Array());
  }
  const pictures = [];
  for (const href of pictureHrefs(prepared.tokens)) {
    // Local images are read into a data URI first; otherwise Word only ever
    // embedded inline data: images and real documents lost every picture.
    const resolved = (await resolveImage(href, request.docPath)) ?? href;
    pictures.push(await dataImageToPng(resolved));
  }
  const bytes = markdownToDocx(request.markdown, pngs, pictures);
  const name = fileStem(request.title) + ".docx";
  if (request.desktop && isTauri()) {
    const path = await choosePath(request.labels.word, name, "docx", "Word");
    if (!path) return;
    await writeBytes(path, bytes);
  } else {
    downloadBlob(
      name,
      new Blob([new Uint8Array(bytes)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
  }
  request.notice(request.saved);
}

async function exportPng(request: ExportRequest, colors: ThemeColors) {
  const article = renderDocument(request.markdown);
  const width = request.contentWidth;
  const pageHeight = Math.max(900, Math.round(width * 1.35));
  const name = fileStem(request.title) + ".png";
  const desktop = request.desktop && isTauri();
  // Ask for the destination first: rendering thousands of pages and then
  // throwing them away on "cancel" is wasted work.
  const chosen = desktop ? await choosePath(request.labels.png, name, "png", "PNG") : null;
  if (desktop && !chosen) return;
  const host = mountHost(`<article class="mosharp-doc">${article.html}</article>`, colors, width);
  try {
    await paintDiagrams(host, article.diagrams, colors);
    // html2canvas cannot read the asset protocol (different origin), so embed
    // the bytes before capture or every screenshot becomes a blank gap.
    await inlineImages(host, request.docPath);
    await rewriteImages(host, request.docPath);
    await waitForPaint(host);
    const column = host.querySelector(".mosharp-doc");
    if (!(column instanceof HTMLElement)) return;
    const total = Math.max(1, Math.ceil(column.scrollHeight / pageHeight));
    const pages: Uint8Array[] = [];
    host.style.height = `${pageHeight}px`;
    for (let index = 0; index < total; index += 1) {
      column.style.transform = `translateY(${-index * pageHeight}px)`;
      const canvas = await html2canvas(host, {
        backgroundColor: colors.paper,
        scale: 1,
        width,
        height: pageHeight,
        windowWidth: width,
        windowHeight: pageHeight,
      });
      pages.push(await canvasToPng(canvas));
    }
    if (chosen) {
      for (let index = 0; index < pages.length; index += 1) {
        await writeBytes(numberedExportName(chosen, index, pages.length), pages[index]);
      }
    } else {
      pages.forEach((bytes, index) => {
        const pageName = numberedExportName(name, index, pages.length);
        downloadBlob(pageName, new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      });
    }
    request.notice(request.saved);
  } finally {
    host.remove();
    document.getElementById("mosharp-export-style")?.remove();
  }
}

async function exportPdf(request: ExportRequest, colors: ThemeColors, slides: boolean) {
  if (!request.desktop || !isTauri()) {
    request.notice(request.needDesktop);
    return;
  }
  const width = request.contentWidth;
  const css = articleCss(colors, width) + (slides ? slidePrintCss(colors.paper) : "");
  const style = document.createElement("style");
  style.id = "mosharp-export-style";
  style.textContent = css;
  document.head.appendChild(style);
  document.body.classList.add("mosharp-exporting");
  const host = document.createElement("div");
  host.id = "mosharp-print-root";
  host.className = "mosharp-print-host";
  try {
    if (slides) {
      const deck = splitDeck(request.markdown, cursorLine(request.markdown, request.cursorOffset));
      const sections = deck.pages.map((page) => {
        const article = renderArticle(page);
        return { html: article.html, diagrams: article.diagrams };
      });
      host.innerHTML = sections
        .map((section) => `<section class="mosharp-slide"><article class="mosharp-doc">${section.html}</article></section>`)
        .join("");
      for (let i = 0; i < sections.length; i += 1) {
        const section = host.children[i];
        if (section) await paintDiagrams(section, sections[i].diagrams, colors);
      }
    } else {
      const article = renderDocument(request.markdown);
      host.innerHTML = `<article class="mosharp-doc">${article.html}</article>`;
      await paintDiagrams(host, article.diagrams, colors);
    }
    await rewriteImages(host, request.docPath);
    document.body.appendChild(host);
    await waitForPaint(host);
    const ext = "pdf";
    const name = fileStem(request.title) + (slides ? "-slides.pdf" : ".pdf");
    const path = await choosePath(slides ? request.labels.slidesPdf : request.labels.pdf, name, ext, "PDF");
    if (!path) return;
    const page = slides ? SLIDE_PAGE : A4;
    await invoke("print_pdf", { path, pageWidth: page.width, pageHeight: page.height });
    request.notice(request.saved);
  } finally {
    host.remove();
    style.remove();
    document.body.classList.remove("mosharp-exporting");
  }
}

function slidePrintCss(paper: string): string {
  return `@page { size: 13.333in 7.5in; margin: 0; background: ${paper}; }
.mosharp-slide { break-after: page; box-sizing: border-box; width: 13.333in; min-height: 7.5in; padding: 0.5in 0.7in; background: ${paper}; }
.mosharp-slide:last-child { break-after: auto; }
.mosharp-slide .mosharp-doc { max-width: none; }
.mosharp-print-host hr { display: none; }`;
}

function mountHost(html: string, colors: ThemeColors, width: number): HTMLElement {
  const styleId = "mosharp-export-style";
  document.getElementById(styleId)?.remove();
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = articleCss(colors, width);
  document.head.appendChild(style);
  const host = document.createElement("div");
  host.id = "mosharp-print-root";
  host.className = "mosharp-capture-host";
  host.style.width = `${width}px`;
  host.style.background = colors.paper;
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

async function paintDiagrams(root: ParentNode, diagrams: DiagramSlot[], colors: DiagramColors) {
  const nodes = root.querySelectorAll<HTMLElement>("[data-diagram]");
  for (const node of nodes) {
    const slot = diagrams[Number(node.dataset.diagram)];
    if (!slot) continue;
    const svg = await drawDiagram(slot.kind, slot.source, colors);
    if (svg) node.innerHTML = svg;
  }
}

async function rewriteImages(root: ParentNode, docPath: string | null) {
  if (!isTauri() || !docPath) return;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const dir = docPath.replace(/[\\/][^\\/]*$/, "");
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (!src || /^(https?:|data:|blob:|asset:|tauri:)/i.test(src)) continue;
    const absolute = /^[a-zA-Z]:[\\/]|^\//.test(src) ? src : `${dir}/${src}`;
    img.src = convertFileSrc(absolute);
  }
}

const imageCache = new Map<string, string>();

function isAbsolutePath(src: string): boolean {
  return /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(src);
}

/**
 * Resolve one Markdown image href into a `data:` URI that travels with the
 * exported file. Remote URLs are left alone; local paths are read through the
 * backend so HTML/Word/PNG output does not depend on a sibling `assets` folder.
 */
async function resolveImage(href: string, docPath: string | null): Promise<string | null> {
  if (!isTauri()) return null;
  const src = href.trim();
  if (!src) return null;
  if (/^(data:|blob:|https?:|asset:|tauri:)/i.test(src)) return null;
  let path = src;
  if (src.startsWith("file://")) {
    try {
      path = decodeURIComponent(src.slice(7));
    } catch {
      return null;
    }
  } else if (!isAbsolutePath(src)) {
    const dir = docPath ? docPath.replace(/[\\/][^\\/]*$/, "") : "";
    if (!dir) return null;
    path = `${dir}/${src.replace(/^\.\//, "")}`;
  }
  const cached = imageCache.get(path);
  if (cached) return cached;
  try {
    const data = await readImageDataUri(path);
    imageCache.set(path, data);
    return data;
  } catch {
    return null;
  }
}

/** Replace every local `<img src>` with an embeddable data URI. */
async function inlineImages(root: ParentNode, docPath: string | null): Promise<void> {
  if (!isTauri()) return;
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    const data = await resolveImage(src, docPath);
    if (data) img.setAttribute("src", data);
  }
}

async function waitForPaint(root: ParentNode) {
  await document.fonts.ready;
  await Promise.all(
    [...root.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)),
  );
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("PNG"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

async function choosePath(title: string, suggested: string, ext: string, filterName: string) {
  return save({
    title,
    defaultPath: suggested,
    filters: [{ name: filterName, extensions: [ext] }],
  });
}

function writeText(path: string, content: string) {
  return invoke("write_document", { path, content });
}

function writeBytes(path: string, bytes: Uint8Array) {
  return invoke("write_bytes", { path, bytes: Array.from(bytes) });
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileStem(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "export";
}
