import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export const flashEffect = StateEffect.define<number | null>();

export const flashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(flashEffect)) {
        if (effect.value == null) return Decoration.none;
        const line = transaction.state.doc.line(effect.value);
        return Decoration.set([Decoration.line({ class: "cm-heading-flash" }).range(line.from)]);
      }
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
