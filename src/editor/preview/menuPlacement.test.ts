import { MENU_GAP, MENU_MARGIN, placeMenu } from "./menuPlacement.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const viewport = { width: 1000, height: 800 };
const menu = { width: 180, height: 280 };

// Fits below the caret: sits just under it, aligned to its left edge.
const below = placeMenu({ top: 100, bottom: 120, left: 200 }, menu, viewport);
assert(below.top === 120 + MENU_GAP, "menu opens under the caret");
assert(below.left === 200, "menu aligns to the caret");

// Near the bottom edge: flips above the caret instead of running off screen.
const flipped = placeMenu({ top: 700, bottom: 720, left: 200 }, menu, viewport);
assert(flipped.top === 700 - 280 - MENU_GAP, "menu flips above near the bottom edge");
assert(flipped.top + menu.height <= viewport.height - MENU_MARGIN, "flipped menu stays on screen");

// Taller than the space above too: clamp to the top margin, never negative.
const cramped = placeMenu({ top: 300, bottom: 320, left: 0 }, menu, { width: 1000, height: 400 });
assert(cramped.top >= MENU_MARGIN, "clamped menu keeps the top margin");
assert(cramped.top + menu.height <= 400 - MENU_MARGIN + 0.001 || cramped.top === MENU_MARGIN, "clamped menu prefers the margin");

// Right edge: pulled left so the whole menu is visible.
const right = placeMenu({ top: 100, bottom: 120, left: 980 }, menu, viewport);
assert(right.left === viewport.width - menu.width - MENU_MARGIN, "menu pulled in from the right edge");

// Left edge: never crosses the margin.
const leftEdge = placeMenu({ top: 100, bottom: 120, left: -40 }, menu, viewport);
assert(leftEdge.left === MENU_MARGIN, "menu kept off the left edge");

// A menu wider than the viewport must still start at the margin, not go negative.
const tooWide = placeMenu({ top: 100, bottom: 120, left: 900 }, { width: 1200, height: 100 }, viewport);
assert(tooWide.left === MENU_MARGIN, "oversized menu clamps to the margin");

console.log("menuPlacement ok");
