import { type Token, type Tokens } from "marked";
import { diagramKind, type DiagramKind } from "../editor/preview/diagramKind.ts";
import { prepareBody, type MathSlot } from "./article.ts";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function storeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);

    const entry = new Uint8Array(46 + name.length);
    const centralView = new DataView(entry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function textOf(token: Token, slots: MathSlot[]): string {
  if (token.type === "text" || token.type === "escape" || token.type === "codespan") {
    return token.text.replace(/MOSHMATH(\d+)END/g, (_raw: string, index: string) => slots[Number(index)]?.tex ?? "");
  }
  if (token.type === "br") return "\n";
  if ("tokens" in token && token.tokens) return token.tokens.map((child) => textOf(child, slots)).join("");
  if ("text" in token && typeof token.text === "string") return token.text;
  return "";
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

export interface EmbeddedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

function inlineRuns(tokens: Token[] | undefined, slots: MathSlot[], style: Run = { text: "" }): Run[] {
  if (!tokens) return [];
  const runs: Run[] = [];
  for (const token of tokens) {
    if ((token as { type: string }).type === "highlight") {
      runs.push(...inlineRuns((token as { tokens?: Token[] }).tokens, slots, style));
      continue;
    }
    if (token.type === "text" || token.type === "escape") {
      runs.push({ ...style, text: textOf(token, slots) });
    } else if (token.type === "br") {
      runs.push({ ...style, text: "\n" });
    } else if (token.type === "codespan") {
      runs.push({ text: token.text, code: true });
    } else if (token.type === "strong") {
      runs.push(...inlineRuns(token.tokens, slots, { ...style, bold: true }));
    } else if (token.type === "em") {
      runs.push(...inlineRuns(token.tokens, slots, { ...style, italic: true }));
    } else if (token.type === "del") {
      runs.push(...inlineRuns(token.tokens, slots, { ...style, strike: true }));
    } else if (token.type === "link") {
      const href = /^https?:\/\//i.test(token.href) ? token.href : undefined;
      const inner = inlineRuns(token.tokens, slots, style);
      runs.push(...(href ? inner.map((run) => ({ ...run, href })) : inner));
    } else if (token.type === "image") {
      runs.push({ text: token.text ? `[${token.text}]` : "[image]", italic: true });
    } else if ("tokens" in token && token.tokens) {
      runs.push(...inlineRuns(token.tokens, slots, style));
    }
  }
  return runs.filter((run) => run.text.length > 0);
}

function runsXml(runs: Run[], links: string[]): string {
  return runs
    .map((run) => {
      const props = [
        run.bold ? "<w:b/>" : "",
        run.italic ? "<w:i/>" : "",
        run.strike ? "<w:strike/>" : "",
        run.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "",
        run.href ? '<w:color w:val="1D4ED8"/><w:u w:val="single"/>' : "",
      ].join("");
      const text = escapeXml(run.text).replace(/\n/g, "</w:t><w:br/><w:t xml:space=\"preserve\">");
      const inner = `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
      if (!run.href) return inner;
      let index = links.indexOf(run.href);
      if (index < 0) {
        links.push(run.href);
        index = links.length - 1;
      }
      return `<w:hyperlink r:id="rIdLink${index + 1}">${inner}</w:hyperlink>`;
    })
    .join("");
}

function paragraph(runs: Run[], links: string[], extra = ""): string {
  const body = runsXml(runs, links);
  return `<w:p>${extra}${body || "<w:r><w:t></w:t></w:r>"}</w:p>`;
}

function imageParagraph(relId: string, widthPt: number, heightPt: number, title: string): string {
  return `<w:p><w:r><w:pict><v:shape style="width:${widthPt}pt;height:${heightPt}pt" stroked="f"><v:imagedata r:id="${relId}" o:title="${escapeXml(title)}"/></v:shape></w:pict></w:r></w:p>`;
}

interface MediaFile {
  bytes: Uint8Array;
}

function soleImage(token: Token): { href: string; alt: string } | null {
  if (token.type !== "paragraph") return null;
  const tokens = token.tokens ?? [];
  const images = tokens.filter((child) => child.type === "image");
  const meaningful = tokens.filter((child) => {
    if (child.type === "image") return false;
    return !(child.type === "text" && child.text.trim() === "");
  });
  if (images.length !== 1 || meaningful.length > 0) return null;
  const image = images[0];
  if (image.type !== "image") return null;
  return { href: image.href, alt: image.text };
}

export function pictureHrefs(tokens: Token[]): string[] {
  const hrefs: string[] = [];
  for (const token of tokens) {
    const image = soleImage(token);
    if (image) hrefs.push(image.href);
  }
  return hrefs;
}

function pushMedia(media: MediaFile[], bytes: Uint8Array | undefined): string | null {
  if (!bytes || bytes.length === 0) return null;
  media.push({ bytes });
  return `rIdImage${media.length}`;
}

function blocksXml(
  tokens: Token[],
  slots: MathSlot[],
  diagrams: Uint8Array[],
  pictures: Array<EmbeddedImage | null>,
  media: MediaFile[],
  links: string[],
): string {
  let xml = "";
  let diagram = 0;
  let picture = 0;
  const walk = (list: Token[]) => {
    for (const token of list) {
      if (token.type === "heading") {
        xml += paragraph(inlineRuns(token.tokens, slots), links, `<w:pPr><w:pStyle w:val="Heading${token.depth}"/></w:pPr>`);
      } else if (token.type === "paragraph") {
        const image = soleImage(token);
        if (image) {
          const raster = pictures[picture] ?? null;
          picture += 1;
          const widthPt = raster ? Math.min(480, Math.max(12, raster.width * 0.75)) : 0;
          const heightPt = raster ? Math.max(8, raster.height * 0.75) : 0;
          const id = pushMedia(media, raster?.bytes);
          xml += id
            ? imageParagraph(id, widthPt, heightPt, image.alt || "image")
            : paragraph([{ text: image.alt ? `[${image.alt}]` : "[image]", italic: true }], links);
        } else {
          xml += paragraph(inlineRuns(token.tokens, slots), links);
        }
      } else if (token.type === "blockquote") {
        xml += paragraph(inlineRuns(flattenInline(token.tokens ?? []), slots, { text: "", italic: true }), links);
      } else if (token.type === "code") {
        if (diagramKind(token.lang)) {
          const png = diagrams[diagram];
          diagram += 1;
          const id = pushMedia(media, png);
          if (id) xml += imageParagraph(id, 420, 240, "diagram");
        } else {
          xml += paragraph([{ text: token.text, code: true }], links, `<w:pPr><w:shd w:val="clear" w:fill="F5F5F4"/></w:pPr>`);
        }
      } else if (token.type === "list") {
        const list = token as Tokens.List;
        const start = list.start || 1;
        list.items.forEach((item, index) => {
          const prefix = item.task ? (item.checked ? "☑ " : "☐ ") : list.ordered ? `${start + index}. ` : "• ";
          const nested = item.tokens.filter(isNestedBlock);
          const inline = item.tokens.filter((child) => !isNestedBlock(child));
          const runs = [{ text: prefix }, ...inlineRuns(inline.flatMap(inlineTokens), slots)];
          xml += paragraph(runs, links);
          // Sub-lists, code fences, diagrams and tables inside a list item used
          // to be dropped silently; render them instead of losing the content.
          if (nested.length) walk(nested);
        });
      } else if (token.type === "table") {
        xml += tableXml(token as Tokens.Table, slots, links);
      } else if (token.type === "hr") {
        xml += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A8A29E"/></w:pBdr></w:pPr></w:p>`;
      }
    }
  };
  walk(tokens);
  return xml;
}

function inlineTokens(token: Token): Token[] {
  if (token.type === "paragraph" || token.type === "list_item") return token.tokens ?? [];
  return [token];
}

/** Block-level children of a list item that need their own paragraph. */
const NESTED_BLOCKS = new Set(["list", "code", "table", "blockquote", "hr"]);

function isNestedBlock(token: Token): boolean {
  return NESTED_BLOCKS.has(token.type);
}

function flattenInline(tokens: Token[]): Token[] {
  return tokens.flatMap((token) => ("tokens" in token && token.tokens ? token.tokens : [token]));
}

function tableXml(token: Tokens.Table, slots: MathSlot[], links: string[]): string {
  const row = (cells: Tokens.TableCell[], header: boolean) =>
    `<w:tr>${cells
      .map((cell) => {
        const runs = inlineRuns(cell.tokens, slots, header ? { text: "", bold: true } : { text: "" });
        return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(runs, links)}</w:tc>`;
      })
      .join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="E7E5E4"/>
    <w:left w:val="single" w:sz="4" w:color="E7E5E4"/>
    <w:bottom w:val="single" w:sz="4" w:color="E7E5E4"/>
    <w:right w:val="single" w:sz="4" w:color="E7E5E4"/>
    <w:insideH w:val="single" w:sz="4" w:color="E7E5E4"/>
    <w:insideV w:val="single" w:sz="4" w:color="E7E5E4"/>
  </w:tblBorders></w:tblPr>${row(token.header, true)}${token.rows.map((cells) => row(cells, false)).join("")}</w:tbl>`;
}

export function topLevelDiagrams(tokens: Token[]): Array<{ kind: DiagramKind; source: string }> {
  const sources: Array<{ kind: DiagramKind; source: string }> = [];
  for (const token of tokens) {
    if (token.type !== "code") continue;
    const kind = diagramKind(token.lang);
    if (kind) sources.push({ kind, source: token.text });
  }
  return sources;
}

export function markdownToDocx(
  markdown: string,
  diagrams: Uint8Array[],
  pictures: Array<EmbeddedImage | null> = [],
): Uint8Array {
  const { tokens, slots } = prepareBody(markdown);
  const media: MediaFile[] = [];
  const links: string[] = [];
  const body = blocksXml(tokens, slots, diagrams, pictures, media, links);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;
  const rels = [
    ...media.map((_, index) => {
      const type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
      const id = `rIdImage${index + 1}`;
      return `<Relationship Id="${id}" Type="${type}" Target="media/image${index + 1}.png"/>`;
    }),
    ...links.map(
      (href, index) =>
        `<Relationship Id="rIdLink${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(href)}" TargetMode="External"/>`,
    ),
  ].join("");
  const encoder = new TextEncoder();
  const files: Array<{ name: string; data: Uint8Array }> = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    {
      name: "word/_rels/document.xml.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    },
  ];
  media.forEach((file, index) => {
    files.push({ name: `word/media/image${index + 1}.png`, data: file.bytes });
  });
  return storeZip(files);
}
