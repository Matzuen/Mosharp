import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownInlineToHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return out;
}

export function selectionToHtml(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  if (from === to) return "";
  const text = view.state.sliceDoc(from, to);
  const lines = text.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(escapeHtml(lines[i]));
        i += 1;
      }
      blocks.push(
        `<pre><code class="language-${escapeHtml(lang)}">${body.join("\n")}</code></pre>`,
      );
      i += 1;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      blocks.push(
        `<h${level}>${markdownInlineToHtml(line.replace(/^#{1,6}\s+/, ""))}</h${level}>`,
      );
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(`<blockquote>${markdownInlineToHtml(line.replace(/^>\s?/, ""))}</blockquote>`);
      i += 1;
      continue;
    }
    if (/^[-*+]\s+\[[ xX]\]\s/.test(line)) {
      const checked = /\[[xX]\]/.test(line);
      blocks.push(
        `<p><input type="checkbox" disabled ${checked ? "checked" : ""} /> ${markdownInlineToHtml(
          line.replace(/^[-*+]\s+\[[ xX]\]\s/, ""),
        )}</p>`,
      );
      i += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      blocks.push(`<li>${markdownInlineToHtml(line.replace(/^[-*+]\s+/, ""))}</li>`);
      i += 1;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      blocks.push(`<li>${markdownInlineToHtml(line.replace(/^\d+\.\s+/, ""))}</li>`);
      i += 1;
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    blocks.push(`<p>${markdownInlineToHtml(line)}</p>`);
    i += 1;
  }
  return blocks.join("\n");
}

function selectionLooksFormatted(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  let hit = false;
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === "Emphasis" ||
        node.name === "StrongEmphasis" ||
        node.name === "InlineCode" ||
        node.name === "Link" ||
        node.name === "Highlight" ||
        node.name === "Strikethrough" ||
        /^ATXHeading\d$/.test(node.name) ||
        node.name === "Blockquote" ||
        node.name === "TaskMarker"
      ) {
        hit = true;
      }
    },
  });
  return hit;
}

/** Write HTML + plain text on copy when the selection looks formatted. */
export const richCopyHandler = EditorView.domEventHandlers({
  copy(event, view) {
    const { from, to } = view.state.selection.main;
    if (from === to || !event.clipboardData) return false;
    if (!selectionLooksFormatted(view)) return false;
    const plain = view.state.sliceDoc(from, to);
    const html = selectionToHtml(view);
    event.clipboardData.setData("text/plain", plain);
    event.clipboardData.setData("text/html", html);
    event.preventDefault();
    return true;
  },
});
