import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { t, type MessageKey } from "./i18n";
import {
  CONTENT_WIDTHS,
  SHORTCUT_IDS,
  type ContentWidth,
  type Locale,
  type Preferences,
  type ShortcutId,
} from "./preferences";
import { chordFromEvent } from "./shortcuts";
import { EDITOR_FONTS, EDITOR_SIZES } from "../themes/fonts";
import { THEMES, themeLabel } from "../themes/catalog";

const SECTIONS = ["edit", "markdown", "theme", "image", "spell", "keys"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_KEY: Record<Section, MessageKey> = {
  edit: "prefEdit",
  markdown: "prefMarkdown",
  theme: "prefTheme",
  image: "prefImage",
  spell: "prefSpell",
  keys: "prefKeys",
};

const SHORTCUT_KEY: Record<ShortcutId, MessageKey> = {
  save: "save",
  saveAs: "saveAs",
  open: "open",
  openFolder: "openFolder",
  newFile: "new",
  closeTab: "close",
  toggleSidebar: "panel",
  sourceMode: "sourceMode",
  commandPalette: "commandPalette",
  settings: "settings",
  bold: "bold",
  italic: "italic",
  code: "inlineCode",
  highlight: "highlight",
  strike: "strike",
  link: "link",
  task: "task",
};

export function SettingsDialog(props: {
  locale: Locale;
  prefs: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  const [section, setSection] = createSignal<Section>("edit");
  const [recording, setRecording] = createSignal<ShortcutId | null>(null);

  createEffect(() => {
    const id = recording();
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;
      props.onChange({ shortcuts: { ...props.prefs.shortcuts, [id]: chord } });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  const label = (key: MessageKey) => t(props.locale, key);

  return (
    <div class="settings-backdrop" onMouseDown={() => props.onClose()}>
      <div
        class={`settings-dialog${recording() ? " recording" : ""}`}
        role="dialog"
        aria-label={label("settings")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header class="settings-head">
          <strong>{label("settings")}</strong>
          <button type="button" class="settings-close" onClick={() => props.onClose()}>
            {label("close")}
          </button>
        </header>
        <div class="settings-layout">
          <nav class="settings-nav">
            <For each={SECTIONS}>
              {(item) => (
                <button
                  type="button"
                  class={section() === item ? "active" : ""}
                  onClick={() => setSection(item)}
                >
                  {label(SECTION_KEY[item])}
                </button>
              )}
            </For>
          </nav>
          <div class="settings-body">
            <Show when={section() === "edit"}>
              <Check
                label={label("sourceMode")}
                checked={props.prefs.sourceMode}
                onChange={(sourceMode) => props.onChange({ sourceMode })}
              />
              <Check
                label={label("typewriter")}
                checked={props.prefs.typewriter}
                onChange={(typewriter) => props.onChange({ typewriter })}
              />
              <Check
                label={label("focusMode")}
                checked={props.prefs.focusMode}
                onChange={(focusMode) => props.onChange({ focusMode })}
              />
            </Show>
            <Show when={section() === "markdown"}>
              <Check
                label={label("footnotesOpt")}
                checked={props.prefs.footnotes}
                onChange={(footnotes) => props.onChange({ footnotes })}
              />
              <Check
                label={label("emojiOpt")}
                checked={props.prefs.emoji}
                onChange={(emoji) => props.onChange({ emoji })}
              />
              <Check
                label={label("superSubOpt")}
                checked={props.prefs.superSub}
                onChange={(superSub) => props.onChange({ superSub })}
              />
              <Check
                label={label("pandocMath")}
                checked={props.prefs.pandocMath}
                onChange={(pandocMath) => props.onChange({ pandocMath })}
              />
            </Show>
            <Show when={section() === "theme"}>
              <div class="theme-grid">
                <For each={THEMES}>
                  {(item) => (
                    <button
                      type="button"
                      class={`theme-pick${props.prefs.theme === item.id ? " active" : ""}`}
                      onClick={() => props.onChange({ theme: item.id })}
                    >
                      <span class="theme-swatch" style={{ background: item.swatch }} />
                      {themeLabel(item.id, props.locale)}
                    </button>
                  )}
                </For>
              </div>
              <label class="settings-field">
                <span>{label("fontFamily")}</span>
                <select
                  value={props.prefs.editorFont}
                  onChange={(event) => props.onChange({ editorFont: event.currentTarget.value })}
                >
                  <option value="">{label("fontFollow")}</option>
                  <For each={EDITOR_FONTS}>
                    {(item) => <option value={item.family}>{item.label}</option>}
                  </For>
                </select>
              </label>
              <label class="settings-field">
                <span>{label("fontSize")}</span>
                <select
                  value={props.prefs.editorSize ?? ""}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    props.onChange({
                      editorSize: EDITOR_SIZES.includes(value as (typeof EDITOR_SIZES)[number])
                        ? value
                        : null,
                    });
                  }}
                >
                  <option value="">{label("fontFollow")}</option>
                  <For each={EDITOR_SIZES}>
                    {(size) => <option value={size}>{size}</option>}
                  </For>
                </select>
              </label>
              <p class="settings-note">{label("paperOnly")}</p>
              <div class="settings-widths">
                <For each={CONTENT_WIDTHS}>
                  {(width) => (
                    <button
                      type="button"
                      class={props.prefs.contentWidth === width ? "active" : ""}
                      onClick={() => props.onChange({ contentWidth: width as ContentWidth })}
                    >
                      {width}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={section() === "image"}>
              <Check
                label={label("pasteImages")}
                checked={props.prefs.pasteImages}
                onChange={(pasteImages) => props.onChange({ pasteImages })}
              />
            </Show>
            <Show when={section() === "spell"}>
              <Check
                label={label("spellcheck")}
                checked={props.prefs.spellcheck}
                onChange={(spellcheck) => props.onChange({ spellcheck })}
              />
              <label class="settings-field">
                <span>{label("spellLang")}</span>
                <select
                  value={props.prefs.spellLang}
                  onChange={(event) =>
                    props.onChange({
                      spellLang: event.currentTarget.value === "en-US" ? "en-US" : "zh-CN",
                    })
                  }
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
              <label class="settings-field">
                <span>{label("customWords")}</span>
                <textarea
                  rows={5}
                  value={props.prefs.customWords}
                  onInput={(event) => props.onChange({ customWords: event.currentTarget.value })}
                />
              </label>
            </Show>
            <Show when={section() === "keys"}>
              <Show when={recording()}>
                <p class="settings-note">{label("recordKey")}</p>
              </Show>
              <For each={SHORTCUT_IDS}>
                {(id) => (
                  <div class="shortcut-row">
                    <span>{label(SHORTCUT_KEY[id])}</span>
                    <button type="button" onClick={() => setRecording(id)}>
                      {props.prefs.shortcuts[id] || "—"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        props.onChange({ shortcuts: { ...props.prefs.shortcuts, [id]: "" } })
                      }
                    >
                      {label("clearKey")}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="settings-check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}
