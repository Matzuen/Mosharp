/**
 * Status-bar message from inside an editor widget.
 *
 * Widgets are plain DOM and have no access to the app's notice signal, so they
 * fire a DOM event that `App` listens for.
 */
export const NOTICE_EVENT = "mosharp-notice";

export function notify(text: string) {
  window.dispatchEvent(new CustomEvent<string>(NOTICE_EVENT, { detail: text }));
}
