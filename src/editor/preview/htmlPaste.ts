/** Prefer the markdown already on the clipboard when it looks like source. */
export function looksLikeRichHtml(html: string, plain: string): boolean {
  if (!html.trim()) return false;
  if (/(^|\n)\s{0,3}(#{1,6}\s|```|~~~)/.test(plain)) return false;
  if (/\*\*|~~|==|\[[^\]]+\]\([^)]+\)/.test(plain)) return false;
  return /<(p|div|h[1-6]|ul|ol|li|table|tr|blockquote|pre|br|img|strong|b|em|a)\b/i.test(html);
}

function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/[ \t\f\v]+/g, " ");
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "script" || tag === "style") return "";
  const inner = [...node.childNodes].map(inlineText).join("");
  const trimmed = inner.replace(/\n{2,}/g, "\n").trim();
  if (!trimmed) return "";
  if (tag === "strong" || tag === "b") return `**${trimmed}**`;
  if (tag === "em" || tag === "i") return `*${trimmed}*`;
  if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${trimmed}\``;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${trimmed}~~`;
  if (tag === "mark") return `==${trimmed}==`;
  if (tag === "a") {
    const href = node.getAttribute("href")?.trim() ?? "";
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return trimmed;
    return `[${trimmed}](${href})`;
  }
  return inner;
}

function listToMarkdown(list: HTMLElement, ordered: boolean, indent: string): string {
  const items = [...list.children].filter((el) => el.tagName.toLowerCase() === "li");
  return items
    .map((item, index) => {
      const nested = [...item.children].filter((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === "ul" || tag === "ol";
      });
      const clone = item.cloneNode(true) as HTMLElement;
      for (const child of [...clone.children]) {
        const tag = child.tagName.toLowerCase();
        if (tag === "ul" || tag === "ol") child.remove();
      }
      const text = inlineText(clone).trim().replace(/\n+/g, " ");
      const marker = ordered ? `${index + 1}. ` : "- ";
      const lines = [`${indent}${marker}${text}`];
      for (const child of nested) {
        lines.push(
          listToMarkdown(child as HTMLElement, child.tagName.toLowerCase() === "ol", `${indent}  `),
        );
      }
      return lines.filter((line) => line.trim().length > 0).join("\n");
    })
    .join("\n");
}

function rowCells(row: Element): string[] {
  return [...row.querySelectorAll("th, td")].map((cell) =>
    inlineText(cell).trim().replace(/\|/g, "\\|").replace(/\s+/g, " "),
  );
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = [...table.querySelectorAll("tr")];
  if (rows.length === 0) return "";
  const header = rowCells(rows[0]);
  if (header.length === 0) return "";
  const body = rows.slice(1).map((row) => {
    const cells = rowCells(row);
    while (cells.length < header.length) cells.push("");
    return `| ${cells.slice(0, header.length).join(" | ")} |`;
  });
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body].join("\n");
}

function blocks(parent: ParentNode): string {
  const parts: string[] = [];
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") continue;
    if (/^h[1-6]$/.test(tag)) {
      const text = inlineText(node).trim();
      if (text) parts.push(`${"#".repeat(Number(tag[1]))} ${text}`);
      continue;
    }
    if (tag === "p" || tag === "div") {
      const text = inlineText(node).trim();
      if (text) parts.push(text);
      continue;
    }
    if (tag === "blockquote") {
      const inner = blocks(node).trim();
      if (inner) parts.push(inner.split("\n").map((line) => `> ${line}`).join("\n"));
      continue;
    }
    if (tag === "pre") {
      const code = (node.textContent ?? "").replace(/\n$/, "");
      parts.push(`\`\`\`\n${code}\n\`\`\``);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const markdown = listToMarkdown(node, tag === "ol", "");
      if (markdown.trim()) parts.push(markdown);
      continue;
    }
    if (tag === "table") {
      const markdown = tableToMarkdown(node);
      if (markdown) parts.push(markdown);
      continue;
    }
    if (tag === "img") {
      const src = node.getAttribute("src")?.trim() ?? "";
      if (src && !src.startsWith("data:")) parts.push(`![${node.getAttribute("alt") ?? ""}](${src})`);
      continue;
    }
    const nested = blocks(node).trim();
    if (nested) parts.push(nested);
  }
  return parts.join("\n\n");
}

/** Turn a Word or browser HTML clipboard into Markdown. Empty when nothing structural remains. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return blocks(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}
