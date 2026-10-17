import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export interface MenuEntry {
  id: string;
  label?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  sep?: boolean;
  children?: MenuEntry[];
  run?: () => void;
}

export interface MenuDef {
  id: string;
  label: string;
  access: string;
  items: MenuEntry[];
}

function AccessKey(props: { access: string }) {
  return (
    <span class="menu-key">
      (<span class="menu-key-letter">{props.access}</span>)
    </span>
  );
}

function MenuItems(props: { items: MenuEntry[]; onDone: () => void }) {
  const [flyout, setFlyout] = createSignal<string | null>(null);

  return (
    <For each={props.items}>
      {(item) => (
        <Show
          when={!item.sep}
          fallback={<div class="menu-sep" />}
        >
          <div
            class="menu-row-item"
            onMouseEnter={() => setFlyout(item.children ? item.id : null)}
          >
            <button
              type="button"
              class="menu-item"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (item.children) {
                  setFlyout(item.id);
                  return;
                }
                item.run?.();
                props.onDone();
              }}
            >
              <span class="menu-check">{item.checked ? "✓" : ""}</span>
              <span class="menu-label">{item.label}</span>
              <span class="menu-shortcut">
                {item.children ? "›" : item.shortcut ?? ""}
              </span>
            </button>
            <Show when={item.children && flyout() === item.id}>
              <div class="menu-flyout">
                <MenuItems items={item.children ?? []} onDone={props.onDone} />
              </div>
            </Show>
          </div>
        </Show>
      )}
    </For>
  );
}

export function MenuBar(props: { menus: () => MenuDef[] }) {
  const [open, setOpen] = createSignal<string | null>(null);
  let bar: HTMLDivElement | undefined;
  let suppressClick = false;
  let openedByHover = false;

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!bar?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(null);
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const key = event.key.toUpperCase();
      const match = props.menus().find((menu) => menu.access.toUpperCase() === key);
      if (!match) return;
      event.preventDefault();
      setOpen((current) => (current === match.id ? null : match.id));
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="menu-bar" ref={bar}>
      <For each={props.menus()}>
        {(menu) => (
          <div class="menu-root-wrap">
            <button
              type="button"
              class={`menu-root${open() === menu.id ? " open" : ""}`}
              onPointerDown={() => {
                const keepOpen = open() !== menu.id || openedByHover;
                setOpen(keepOpen ? menu.id : null);
                openedByHover = false;
                suppressClick = true;
              }}
              onClick={() => {
                if (suppressClick) {
                  suppressClick = false;
                  return;
                }
                setOpen((current) => (current === menu.id ? null : menu.id));
              }}
              onMouseEnter={() => {
                if (!open() || open() === menu.id) return;
                setOpen(menu.id);
                openedByHover = true;
              }}
            >
              {menu.label}
              <AccessKey access={menu.access} />
            </button>
            <Show when={open() === menu.id}>
              <div
                class={`menu-drop${
                  menu.items.some((item) => item.children) ? "" : " is-scrollable"
                }`}
              >
                <MenuItems items={menu.items} onDone={() => setOpen(null)} />
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
