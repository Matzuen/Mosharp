import { extendDeletion } from "./markerEdit.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// "**bold**" rendered with the markers hidden: [0,2) and [6,8).
const markers = [
  { from: 0, to: 2 },
  { from: 6, to: 8 },
];

const backspace = extendDeletion(markers, 2, false);
assert(backspace?.from === 0 && backspace?.to === 2, "Backspace next to the closing marker removes it");

assert(extendDeletion(markers, 1, false) === null, "a caret inside a marker is left alone");
assert(extendDeletion(markers, 0, false) === null, "nothing to delete at the document start");

const forward = extendDeletion(markers, 6, true);
assert(forward?.from === 6 && forward?.to === 8, "Delete before the marker removes it");
assert(extendDeletion(markers, 7, true) === null, "a caret inside is left alone");

assert(extendDeletion(markers, 4, false) === null, "plain text keeps normal Backspace");
assert(extendDeletion(markers, 4, true) === null, "plain text keeps normal Delete");
assert(extendDeletion([], 4, false) === null, "no markers, no extension");

// A marker starting the line ("# ") behaves the same way.
const heading = [{ from: 0, to: 2 }];
assert(extendDeletion(heading, 2, false)?.to === 2, "heading marker is removed as a unit");

console.log("markerEdit ok");
