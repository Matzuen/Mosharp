import { StateEffect, StateField } from "@codemirror/state";

export const setSourceMode = StateEffect.define<boolean>();
export const setTypewriterMode = StateEffect.define<boolean>();
export const setFocusMode = StateEffect.define<boolean>();

export const sourceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSourceMode)) return effect.value;
    }
    return value;
  },
});

export const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTypewriterMode)) return effect.value;
    }
    return value;
  },
});

export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocusMode)) return effect.value;
    }
    return value;
  },
});

export interface PreviewModes {
  sourceMode: boolean;
  typewriter: boolean;
  focus: boolean;
}
