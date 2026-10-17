import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { placeMenu } from "./menuPlacement";
import { sourceModeField } from "./modes";
import { slashItems } from "./toolbar";
import { viewportZoom } from "./zoom";

class SlashMenu implements PluginValue {
  dom: HTMLDivElement;
  open = false;
  triggerFrom = -1;
  active = 0;
  items: typeof slashItems = [];
  private signature = "";
  private onKey: (event: KeyboardEvent) => void;
  private onScroll: () => void;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-slash-menu";
    this.dom.style.display = "none";
    // Stays inside the editor so CodeMirror's scoped base theme applies to it
    // (baseTheme rules are prefixed with the editor class, so anything attached
    // to <body> would be completely unstyled).
    view.dom.appendChild(this.dom);
    // ...but `fixed` is set inline so the position is measured against the
    // viewport. `.cm-editor` is statically positioned, so an absolutely
    // positioned child resolved against an unrelated containing block and
    // drifted away from the caret.
    this.dom.style.position = "fixed";
    this.onKey = (event) => {
      if (!this.open) return;
      // Never steal keys the IME needs to commit a composition (CJK input).
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.active = (this.active + 1) % this.items.length;
        this.render(this.items);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.active = (this.active - 1 + this.items.length) % this.items.length;
        this.render(this.items);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.choose(this.active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      }
    };
    view.contentDOM.addEventListener("keydown", this.onKey, true);
    // CodeMirror only re-renders (and therefore dispatches an update) once the
    // viewport actually moves past its render margin, so small scrolls never
    // reach `update()`. Track the scroller directly or the menu stays behind
    // while the caret scrolls away.
    this.onScroll = () => {
      if (!this.open) return;
      this.place(this.view.state.selection.main.head);
    };
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll);
  }

  update(update: ViewUpdate) {
    if (update.state.field(sourceModeField)) {
      this.hide();
      return;
    }
    const selection = update.state.selection.main;
    let match: RegExpExecArray | null = null;
    if (selection.empty) {
      const line = update.state.doc.lineAt(selection.head);
      const before = line.text.slice(0, selection.head - line.from);
      match = /(^|\s)\/([^\s]*)$/.exec(before);
    }
    if (!match) {
      this.hide();
      return;
    }
    const query = match[2].toLowerCase();
    const items = slashItems.filter((item) => item.label.toLowerCase().includes(query));
    if (items.length === 0) {
      this.hide();
      return;
    }
    this.triggerFrom = selection.head - match[2].length - 1;
    const signature = items.map((item) => item.label).join("|");
    if (!this.open || signature !== this.signature) {
      this.signature = signature;
      this.active = 0;
      this.render(items);
    }
    this.items = items;
    this.open = true;
    this.dom.style.display = "block";
    // Re-place on every update, not just content changes: after the document
    // re-measures (estimated block heights above the viewport) a caret that did
    // not move can still change screen position.
    this.place(selection.head);
  }

  /** Anchor to the caret in viewport coordinates and keep the menu on screen. */
  private place(head: number) {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const coords = view.coordsAtPos(head, 1);
        if (!coords) return null;
        // The menu is already visible at this point, so its real size is known.
        const rect = this.dom.getBoundingClientRect();
        return { coords, width: rect.width, height: rect.height };
      },
      write: (measure) => {
        if (!this.open) return;
        if (!measure) {
          // The caret is not rendered (scrolled out of the viewport); a menu
          // parked at a stale offset would just be a stray box.
          this.hide();
          return;
        }
        const { coords, width, height } = measure;
        // The caret scrolled out of the window: a menu pinned to the edge would
        // just float next to unrelated text.
        if (coords.bottom < 0 || coords.top > window.innerHeight) {
          this.hide();
          return;
        }
        const box = placeMenu(
          coords,
          { width, height },
          { width: window.innerWidth, height: window.innerHeight },
        );
        // Viewport pixels in, zoom-local CSS pixels out (see viewportZoom).
        const zoom = viewportZoom();
        this.dom.style.top = `${box.top / zoom}px`;
        this.dom.style.left = `${box.left / zoom}px`;
      },
    });
  }

  render(items: typeof slashItems) {
    this.dom.textContent = "";
    items.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = index === this.active ? "cm-slash-item active" : "cm-slash-item";
      btn.textContent = item.label;
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("mouseenter", () => {
        this.active = index;
        const buttons = this.dom.querySelectorAll(".cm-slash-item");
        buttons.forEach((el, itemIndex) => {
          el.className = itemIndex === index ? "cm-slash-item active" : "cm-slash-item";
        });
      });
      btn.addEventListener("click", () => this.choose(index));
      this.dom.appendChild(btn);
    });
  }

  choose(index: number) {
    const item = this.items[index];
    if (!item) return;
    const view = this.view;
    const head = view.state.selection.main.head;
    const from = Math.min(this.triggerFrom, head);
    view.dispatch({
      changes: { from, to: head, insert: "" },
    });
    item.run(view);
    this.hide();
    view.focus();
  }

  hide() {
    this.dom.style.display = "none";
    this.open = false;
    this.triggerFrom = -1;
    this.items = [];
    this.active = 0;
    this.signature = "";
  }

  destroy() {
    this.view.contentDOM.removeEventListener("keydown", this.onKey, true);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onScroll);
    this.dom.remove();
  }
}

export const slashMenuPlugin = ViewPlugin.fromClass(SlashMenu);

export const slashMenuTheme = EditorView.baseTheme({
  ".cm-slash-menu": {
    position: "fixed",
    zIndex: "60",
    minWidth: "160px",
    maxHeight: "min(60vh, 420px)",
    overflowY: "auto",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid var(--line)",
    background: "var(--menu)",
    color: "var(--ink)",
    boxShadow: "0 8px 20px rgba(28,25,23,0.12)",
  },
  ".cm-slash-item": {
    display: "block",
    width: "100%",
    height: "30px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    textAlign: "left",
    padding: "0 10px",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-slash-item.active, .cm-slash-item:hover": {
    background: "var(--hover)",
  },
});
