import { createSignal, For, onMount, Show } from "solid-js";

export interface PaletteAction {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette(props: {
  actions: PaletteAction[];
  placeholder: string;
  empty: string;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let input: HTMLInputElement | undefined;

  const visible = () => {
    const needle = query().trim().toLowerCase();
    const items = needle
      ? props.actions.filter((action) => action.label.toLowerCase().includes(needle))
      : props.actions;
    return items.slice(0, 12);
  };

  onMount(() => input?.focus());

  function choose(index: number) {
    const action = visible()[index];
    if (!action) return;
    props.onClose();
    action.run();
  }

  return (
    <div class="palette-backdrop" onMouseDown={() => props.onClose()}>
      <div
        class="palette"
        role="dialog"
        aria-label={props.placeholder}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          class="palette-input"
          placeholder={props.placeholder}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            const items = visible();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active());
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
        />
        <div class="palette-list">
          <Show when={visible().length > 0} fallback={<p class="palette-empty">{props.empty}</p>}>
            <For each={visible()}>
              {(action, index) => (
                <button
                  type="button"
                  class={`palette-item${index() === active() ? " active" : ""}`}
                  onMouseEnter={() => setActive(index())}
                  onClick={() => choose(index())}
                >
                  <span>{action.label}</span>
                  <Show when={action.shortcut}>
                    <kbd>{action.shortcut}</kbd>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
