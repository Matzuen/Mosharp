const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

function encode6bit(value: number): string {
  return ALPHABET[value & 0x3f];
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

/** PlantUML's own alphabet over a raw deflate stream. The `~1` prefix tells the server which decoder to use. */
export function encodePlantumlBytes(compressed: Uint8Array): string {
  let encoded = "";
  for (let i = 0; i < compressed.length; i += 3) {
    if (i + 2 === compressed.length) encoded += append3bytes(compressed[i], compressed[i + 1], 0);
    else if (i + 1 === compressed.length) encoded += append3bytes(compressed[i], 0, 0);
    else encoded += append3bytes(compressed[i], compressed[i + 1], compressed[i + 2]);
  }
  return encoded;
}

export async function encodePlantuml(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return encodePlantumlBytes(compressed);
}

export function plantumlSvgUrl(encoded: string): string {
  return `https://www.plantuml.com/plantuml/svg/~1${encoded}`;
}
