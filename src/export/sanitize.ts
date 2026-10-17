/**
 * Conservative allow-list sanitizer for raw HTML embedded in a Markdown file.
 *
 * Export renders the document into the live app window (`innerHTML`), which has
 * full Tauri IPC access, so untrusted HTML must never reach it verbatim.
 *
 * The design is "rebuild, never pass through": every emitted tag is reconstructed
 * from a checked tag name plus validated attributes whose values are escaped, so
 * a malformed or cleverly nested input can at worst lose markup — it cannot
 * smuggle an attribute, a protocol, or an event handler into the output.
 */

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "center", "cite",
  "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
  "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby",
  "s", "samp", "small", "span", "strike", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var", "wbr",
]);

const VOID_TAGS = new Set(["br", "col", "hr", "img", "wbr"]);

/** Elements whose *content* is also dropped, not just the tag. */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"];

const ALLOWED_ATTRS = new Set([
  "align", "alt", "class", "colspan", "dir", "height", "href", "id", "lang",
  "rowspan", "src", "start", "style", "title", "valign", "width",
]);

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{0,2}\/)/i;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,]/i;

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

function dropDangerousElements(input: string): string {
  let text = input;
  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    text = text.replace(paired, "");
    const orphan = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    text = text.replace(orphan, "");
  }
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

function safeUrl(value: string, tag: string, attr: string): string | null {
  const trimmed = value.trim().replace(/[\u0000-\u0020]+/g, "");
  if (!trimmed) return null;
  // Any scheme that is not explicitly allowed (javascript:, vbscript:, file:,
  // data: for links) is rejected outright.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (attr === "src" && tag === "img" && SAFE_DATA_IMAGE.test(trimmed)) return trimmed;
    return SAFE_URL.test(trimmed) ? trimmed : null;
  }
  return trimmed;
}

function parseAttrs(raw: string, tag: string): string {
  const out: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1].toLowerCase();
    if (name.startsWith("on")) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "href" || name === "src") {
      const url = safeUrl(value, tag, name);
      if (url) out.push(`${name}="${escapeAttr(url)}"`);
      continue;
    }
    if (name === "style") {
      // CSS cannot execute script in modern engines, but url()/expression()
      // can still reach the network or old parsers. Reject those outright.
      if (/url\s*\(|expression|behavio|<|>|\\/i.test(value)) continue;
      out.push(`${name}="${escapeAttr(value)}"`);
      continue;
    }
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * Return markup that is safe to inject with `innerHTML`. Unknown tags are
 * removed but their text is kept so the document still reads correctly.
 */
export function sanitizeHtml(raw: string): string {
  if (!raw) return "";
  const text = dropDangerousElements(raw);
  const out: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(text))) {
    out.push(escapeText(text.slice(last, match.index)));
    last = tagRe.lastIndex;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      if (!VOID_TAGS.has(name)) out.push(`</${name}>`);
      continue;
    }
    const attrs = parseAttrs(match[3], name);
    out.push(`<${name}${attrs}>`);
  }
  out.push(escapeText(text.slice(last)));
  return out.join("");
}
