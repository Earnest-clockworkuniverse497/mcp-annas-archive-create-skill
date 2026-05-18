import { open } from "node:fs/promises";

export type MagicKind = "epub" | "pdf" | "fb2" | "rtf" | "html" | "unknown";

const READ_WINDOW = 512;

export async function detectMagic(filePath: string): Promise<MagicKind> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(READ_WINDOW);
    const { bytesRead } = await fh.read(buf, 0, READ_WINDOW, 0);
    const raw = buf.subarray(0, bytesRead);
    return classify(raw);
  } finally {
    await fh.close();
  }
}

function classify(raw: Buffer): MagicKind {
  // 1. ZIP / EPUB: PK\x03\x04
  if (raw.length >= 4 &&
      raw[0] === 0x50 && raw[1] === 0x4b && raw[2] === 0x03 && raw[3] === 0x04) {
    return "epub";
  }

  // 2. PDF: %PDF-
  if (raw.length >= 5 &&
      raw[0] === 0x25 && raw[1] === 0x50 && raw[2] === 0x44 && raw[3] === 0x46 && raw[4] === 0x2d) {
    return "pdf";
  }

  // 3. RTF: {\rtf
  if (raw.length >= 5 &&
      raw[0] === 0x7b && raw[1] === 0x5c && raw[2] === 0x72 && raw[3] === 0x74 && raw[4] === 0x66) {
    return "rtf";
  }

  // 4. Text-based detection: strip optional UTF-8 BOM and leading whitespace
  let start = 0;
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    start = 3;
  }
  while (start < raw.length && (raw[start] === 0x20 || raw[start] === 0x09 ||
         raw[start] === 0x0a || raw[start] === 0x0d)) {
    start++;
  }

  const text = raw.subarray(start).toString("latin1");

  if (/^<\?xml/i.test(text)) {
    // Must also contain <FictionBook to qualify as fb2
    if (text.includes("<FictionBook")) {
      return "fb2";
    }
    return "unknown";
  }

  if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) {
    return "html";
  }

  return "unknown";
}
