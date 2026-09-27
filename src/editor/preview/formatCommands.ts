import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

function wrapSelection(view: EditorView, left: string, right = left): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) {
    const insert = left + right;
    view.dispatch({
      changes: { from: selection.from, insert },
      selection: { anchor: selection.from + left.length },
    });
    return true;
  }
  const text = view.state.sliceDoc(selection.from, selection.to);
  if (text.startsWith(left) && text.endsWith(right) && text.length >= left.length + right.length) {
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: text.slice(left.length, text.length - right.length),
      },
      selection: {
        anchor: selection.from,
        head: selection.to - left.length - right.length,
      },
    });
    return true;
  }
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: left + text + right },
    selection: {
      anchor: selection.from + left.length,
      head: selection.to + left.length,
    },
  });
  return true;
}

export function toggleBold(view: EditorView) {
  return wrapSelection(view, "**");
}

export function toggleItalic(view: EditorView) {
  return wrapSelection(view, "*");
}

export function toggleCode(view: EditorView) {
  return wrapSelection(view, "`");
}

export function toggleHighlight(view: EditorView) {
  return wrapSelection(view, "==");
}

export function toggleStrike(view: EditorView) {
  return wrapSelection(view, "~~");
}

export function insertLink(view: EditorView) {
  const selection = view.state.selection.main;
  const text = selection.empty ? "链接文字" : view.state.sliceDoc(selection.from, selection.to);
  const insert = `[${text}](https://)`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: {
      anchor: selection.from + text.length + 3,
      head: selection.from + text.length + 3 + "https://".length,
    },
  });
  return true;
}

export function toggleTask(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const task = /^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s/.exec(line.text);
  const list = /^(\s*)([-*+]|\d+\.)\s+/.exec(line.text);
  let changes: ChangeSpec;
  if (task) {
    const checked = task[3].toLowerCase() === "x";
    const next = `${task[1]}${task[2]} [${checked ? " " : "x"}] `;
    changes = { from: line.from, to: line.from + task[0].length, insert: next };
  } else if (list) {
    changes = {
      from: line.from,
      to: line.from + list[0].length,
      insert: `${list[1]}${list[2]} [ ] `,
    };
  } else {
    changes = { from: line.from, insert: "- [ ] " };
  }
  view.dispatch({ changes, selection: EditorSelection.cursor(line.to + 6) });
  return true;
}

export function insertHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const cleaned = line.text.replace(/^#{1,6}\s+/, "");
  const marks = "#".repeat(Math.min(6, Math.max(1, level)));
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${marks} ${cleaned}` },
    selection: EditorSelection.cursor(line.from + marks.length + 1 + cleaned.length),
  });
  return true;
}

export function insertFence(view: EditorView) {
  const selection = view.state.selection.main;
  const body = selection.empty ? "" : view.state.sliceDoc(selection.from, selection.to);
  const insert = `\`\`\`\n${body}\n\`\`\``;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 4),
  });
  return true;
}

export function insertBullet(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (/^\s*([-*+]|\d+\.)\s+/.test(line.text)) return true;
  view.dispatch({
    changes: { from: line.from, insert: "- " },
    selection: EditorSelection.cursor(line.from + 2),
  });
  return true;
}

export function insertHr(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = line.text.trim() ? "\n---\n" : "---\n";
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.length),
  });
  return true;
}

export function insertTable(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = "\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n";
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.indexOf("列")),
  });
  return true;
}

export function insertQuote(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (/^>\s?/.test(line.text)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + (line.text.startsWith("> ") ? 2 : 1), insert: "" },
    });
  } else {
    view.dispatch({ changes: { from: line.from, insert: "> " } });
  }
  return true;
}

export const formatKeymap = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-e", run: toggleCode },
  { key: "Mod-Shift-h", run: toggleHighlight },
  { key: "Mod-Shift-u", run: toggleStrike },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Enter", run: toggleTask },
];
