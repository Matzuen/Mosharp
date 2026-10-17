/**
 * The CSS `zoom` currently applied to the document root (1 when unzoomed).
 *
 * `position: fixed` descendants of a zoomed subtree get their insets multiplied
 * by that zoom, while `getBoundingClientRect()` / `coordsAtPos()` already report
 * viewport pixels. A fixed overlay therefore has to divide its coordinates by
 * this factor to land where the caret is — without it the menu drifts further
 * from the caret the larger the zoom.
 */
export function viewportZoom(): number {
  const raw = document.documentElement.style.zoom;
  const value = Number.parseFloat(raw || "1");
  return Number.isFinite(value) && value > 0 ? value : 1;
}
