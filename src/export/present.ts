import { articleCss, renderArticle, type ThemeColors } from "./article";
import { drawDiagram, type DiagramColors } from "./diagrams";
import { splitDeck } from "./slides";

export interface SlideLabels {
  prev: string;
  next: string;
  exit: string;
}

export function presentSlides(options: {
  markdown: string;
  cursorLine: number;
  colors: ThemeColors;
  width: number;
  labels: SlideLabels;
}): Promise<void> {
  const deck = splitDeck(options.markdown, options.cursorLine);
  const pages = deck.pages.length > 0 ? deck.pages : [""];
  let index = Math.min(deck.start, pages.length - 1);

  const style = document.createElement("style");
  style.id = "mosharp-slide-style";
  style.textContent = articleCss(options.colors, options.width);
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "mosharp-slideshow";
  overlay.tabIndex = -1;
  overlay.style.setProperty("--slide-paper", options.colors.paper);
  overlay.innerHTML = `<div class="mosharp-slideshow-stage"></div>
    <div class="mosharp-slideshow-bar">
      <button type="button" data-act="prev">${options.labels.prev}</button>
      <span data-act="count"></span>
      <span>
        <button type="button" data-act="next">${options.labels.next}</button>
        <button type="button" data-act="exit">${options.labels.exit}</button>
      </span>
    </div>`;
  document.body.appendChild(overlay);
  const stage = overlay.querySelector(".mosharp-slideshow-stage");
  const count = overlay.querySelector("[data-act='count']");
  if (!(stage instanceof HTMLElement) || !(count instanceof HTMLElement)) {
    overlay.remove();
    style.remove();
    return Promise.resolve();
  }

  let token = 0;
  const show = (next: number) => {
    index = (next + pages.length) % pages.length;
    const mine = ++token;
    const article = renderArticle(pages[index] ?? "");
    stage.innerHTML = `<article class="mosharp-doc">${article.html}</article>`;
    count.textContent = `${index + 1} / ${pages.length}`;
    void paint(stage, article.diagrams, options.colors, mine, () => mine === token);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      show(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      show(index - 1);
    }
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const act = target.closest("button")?.getAttribute("data-act");
    if (act === "prev") show(index - 1);
    else if (act === "next") show(index + 1);
    else if (act === "exit") close();
    else if (target.closest(".mosharp-slideshow-stage")) {
      const rect = stage.getBoundingClientRect();
      show(event.clientX < rect.left + rect.width * 0.28 ? index - 1 : index + 1);
    }
  };

  let closed = false;
  let finish = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    overlay.removeEventListener("click", onClick);
    if (document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => {});
    overlay.remove();
    style.remove();
    finish();
  };

  window.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", onClick);
  show(index);
  overlay.focus();
  void overlay.requestFullscreen?.().catch(() => {});

  return new Promise((resolve) => {
    finish = resolve;
  });
}

async function paint(
  root: ParentNode,
  diagrams: Array<{ kind: "mermaid" | "vega" | "vega-lite" | "plantuml"; source: string }>,
  colors: DiagramColors,
  mine: number,
  current: () => boolean,
) {
  const nodes = root.querySelectorAll<HTMLElement>("[data-diagram]");
  for (const node of nodes) {
    if (!current() || mine < 0) return;
    const slot = diagrams[Number(node.dataset.diagram)];
    if (!slot) continue;
    const svg = await drawDiagram(slot.kind, slot.source, colors);
    if (!current() || !svg) continue;
    node.innerHTML = svg;
  }
}
