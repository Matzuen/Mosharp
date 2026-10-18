import { For, Show, createResource, createSignal } from "solid-js";
import { deleteRecoveryCopy, listRecoveryCopies, recoveryFolder, revealInFolder } from "../api/files";
import { t, type MessageKey } from "./i18n";
import type { Locale } from "./preferences";

interface Props {
  locale: Locale;
  onClose: () => void;
  /** Open a copy as a read-only-ish tab so the user can save it elsewhere. */
  onOpen: (path: string) => void;
}

/** Browse the recovery folder: the copies written before data was discarded. */
export function RecoveryDialog(props: Props) {
  const label = (key: MessageKey) => t(props.locale, key);
  const [reload, setReload] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [copies] = createResource(reload, async () => {
    try {
      return await listRecoveryCopies();
    } catch {
      return [];
    }
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatTime = (stamp: number) => {
    if (!stamp) return "";
    try {
      return new Date(stamp).toLocaleString(props.locale);
    } catch {
      return "";
    }
  };

  const remove = async (path: string) => {
    setBusy(true);
    try {
      await deleteRecoveryCopy(path);
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="settings-backdrop" onMouseDown={() => props.onClose()}>
      <div
        class="settings-dialog recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label("recoveryCopies")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header class="settings-head">
          <strong>{label("recoveryCopies")}</strong>
          <button type="button" class="settings-close" onClick={() => props.onClose()}>
            {label("close")}
          </button>
        </header>
        <p class="recovery-hint">{label("recoveryHint")}</p>
        <div class="recovery-list">
          <Show when={(copies() ?? []).length > 0} fallback={<p class="side-empty">{label("recoveryEmpty")}</p>}>
            <For each={copies()}>
              {(copy) => (
                <div class="recovery-row">
                  <button
                    type="button"
                    class="recovery-open"
                    title={copy.path}
                    onClick={() => props.onOpen(copy.path)}
                  >
                    <span class="recovery-name">{copy.name}</span>
                    <span class="recovery-meta">
                      {formatTime(copy.modified)} · {formatSize(copy.size)}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="recovery-delete"
                    disabled={busy()}
                    onClick={() => void remove(copy.path)}
                  >
                    {label("remove")}
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
        <footer class="recovery-foot">
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            {label("refresh")}
          </button>
          <button type="button" onClick={() => void recoveryFolder().then((dir) => revealInFolder(dir))}>
            {label("openRecovery")}
          </button>
        </footer>
      </div>
    </div>
  );
}
