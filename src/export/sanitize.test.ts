import { sanitizeHtml } from "./sanitize.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function contains(markup: string, needle: string, message: string): void {
  assert(markup.includes(needle), `${message} (got ${JSON.stringify(markup)})`);
}

function excludes(markup: string, needle: string, message: string): void {
  assert(!markup.toLowerCase().includes(needle.toLowerCase()), `${message} (got ${JSON.stringify(markup)})`);
}

// Script elements lose their whole content, not just the tag.
excludes(
  sanitizeHtml('<p>a</p><script>alert("x")</script><p>b</p>'),
  "alert",
  "script content removed",
);

// Event handlers never survive.
excludes(
  sanitizeHtml('<img src="x.png" onerror="steal()">'),
  "onerror",
  "event handler stripped",
);
excludes(sanitizeHtml('<img src=x.png onerror=steal()>'), "onerror", "unquoted handler stripped");

// Dangerous URLs are dropped entirely.
excludes(
  sanitizeHtml('<a href="javascript:alert(1)">x</a>'),
  "javascript:",
  "javascript: href removed",
);
excludes(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>'), "javascript", "case/space bypass removed");
excludes(sanitizeHtml('<iframe src="https://evil"></iframe>'), "iframe", "iframe removed");

// Inline SVG and MathML are dropped with their content (they can execute).
excludes(sanitizeHtml('<svg onload="steal()"></svg>'), "onload", "svg stripped");

// Ordinary formatting survives.
contains(sanitizeHtml("<p>hello <strong>world</strong></p>"), "<strong>world</strong>", "strong kept");
contains(sanitizeHtml('<a href="https://example.com">site</a>'), 'href="https://example.com"', "https href kept");
contains(sanitizeHtml('<img src="a.png" alt="图">'), 'src="a.png"', "relative img src kept");

// A data: image is allowed for <img> but never for <a>.
contains(
  sanitizeHtml('<img src="data:image/png;base64,AAAA">'),
  "data:image/png",
  "inline image data uri kept",
);
excludes(
  sanitizeHtml('<a href="data:text/html;base64,AAAA">x</a>'),
  "data:text/html",
  "data: link removed",
);

// Unknown tags are removed but their text is preserved so the document still reads.
const unknown = sanitizeHtml("<blink>kept</blink>");
contains(unknown, "kept", "unknown tag text kept");
excludes(unknown, "blink", "unknown tag removed");

// Text outside tags stays escaped, so a stray '<' cannot open a tag.
excludes(sanitizeHtml("1 < 2 and 3 > 2"), "< 2", "loose angle brackets escaped");

// style is kept for ordinary declarations but dropped when it can fetch or run.
contains(sanitizeHtml('<p style="text-align:center">x</p>'), "text-align", "plain style kept");
excludes(
  sanitizeHtml('<p style="background:url(javascript:alert(1))">x</p>'),
  "javascript",
  "url() style dropped",
);

console.log("sanitize ok");
