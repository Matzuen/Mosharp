export interface CaretRect {
  top: number;
  bottom: number;
  left: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MenuBox {
  top: number;
  left: number;
}

export const MENU_GAP = 6;
export const MENU_MARGIN = 8;

/**
 * Viewport-safe position for a floating menu anchored under a caret.
 *
 * The menu goes below the caret when it fits, flips above it when it would
 * overflow the bottom edge, and is clamped into the viewport either way, so an
 * eight-item menu near the bottom of the window never runs off screen.
 */
export function placeMenu(
  caret: CaretRect,
  menu: MenuSize,
  viewport: Viewport,
  gap = MENU_GAP,
  margin = MENU_MARGIN,
): MenuBox {
  let top = caret.bottom + gap;
  if (top + menu.height > viewport.height - margin) {
    const above = caret.top - menu.height - gap;
    top = above >= margin ? above : Math.max(margin, viewport.height - menu.height - margin);
  }
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(margin, caret.left), maxLeft);
  return { top, left };
}
