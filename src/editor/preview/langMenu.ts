import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { matchLanguages, type LangOption } from "./langOptions";
import { placeMenu } from "./menuPlacement";
import { sourceModeField } from "./modes";
import { viewportZoom } from "./zoom";

/**
 * Language picker for a fence info string.
 *
 * Typing after ` ``` ` offers the supported languages; Enter/Tab accepts the
 * highlighted one. The menu stays out of the way when the typed text already is
 * a language, so Enter can go back to closing the fence.
 */
class LangMenu implements PluginValue {
  dom: HTMLDivElement;
  open = false;
  active = 0;
  items: LangOption[] = [];
  private from = -1;
  private to = -1;
  private signature = "";

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    // Reuse the slash-menu skin: same popup, same placement rules.
    this.dom.className = "cm-slash-menu cm-lang-menu";
    this.dom.style.display = "none";
    this.dom.style.position = "fixed";
    view.dom.appendChild(this.dom);

    view.contentDOM.addEventListener(
      "keydown",
      (event) => {
        if (!this.open) return;
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          this.active = (this.active + delta + this.items.length) % this.items.length;
          this.paint();
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          this.choose(this.active);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.hide();
        }
      },
      true,
    );
    view.scrollDOM.addEventListener("scroll", () => this.place(), { passive: true });
    window.addEventListener("resize", () => this.place());
  }

  update(update: ViewUpdate) {
    if (update.state.field(sourceModeField)) {
      this.hide();
      return;
    }
    const selection = update.state.selection.main;
    if (!selection.empty) {
      this.hide();
      return;
    }
    const line = update.state.doc.lineAt(selection.head);
    const before = line.text.slice(0, selection.head - line.from);
    // Caret must sit in the info string of a fence opener.
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(before);
    if (!opener) {
      this.hide();
      return;
    }
    const info = opener[2];
    // Nothing typed yet, or the info string already has a second word.
    if (info.trim().length === 0 || /\s/.test(info.trim())) {
      this.hide();
      return;
    }
    const items = matchLanguages(info);
    const exact = items.length > 0 && items[0].value === info.trim().toLowerCase();
    if (items.length === 0 || exact) {
      this.hide();
      return;
    }
    this.from = line.from + opener[1].length;
    this.to = selection.head;
    const signature = items.map((item) => item.value).join("|");
    if (signature !== this.signature) {
      this.signature = signature;
      this.active = 0;
      this.items = items;
      this.paint();
    }
    this.open = true;
    this.dom.style.display = "block";
    this.place();
  }

  private paint() {
    this.dom.textContent = "";
    this.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === this.active ? "cm-slash-item active" : "cm-slash-item";
      button.textContent = item.label;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => this.choose(index));
      this.dom.appendChild(button);
    });
  }

  private place() {
    if (!this.open) return;
    const head = this.view.state.selection.main.head;
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const coords = view.coordsAtPos(head, 1);
        if (!coords) return null;
        const rect = this.dom.getBoundingClientRect();
        return { coords, width: rect.width, height: rect.height };
      },
      write: (measure) => {
        if (!this.open || !measure) return;
        const box = placeMenu(
          measure.coords,
          { width: measure.width, height: measure.height },
          { width: window.innerWidth, height: window.innerHeight },
        );
        const zoom = viewportZoom();
        this.dom.style.top = `${box.top / zoom}px`;
        this.dom.style.left = `${box.left / zoom}px`;
      },
    });
  }

  private choose(index: number) {
    const item = this.items[index];
    if (!item || this.from < 0) return;
    this.view.dispatch({
      changes: { from: this.from, to: this.to, insert: item.value },
      selection: { anchor: this.from + item.value.length },
    });
    this.hide();
    this.view.focus();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.signature = "";
    this.from = -1;
    this.dom.style.display = "none";
  }

  destroy() {
    this.dom.remove();
  }
}

export const langMenuPlugin = ViewPlugin.fromClass(LangMenu);
