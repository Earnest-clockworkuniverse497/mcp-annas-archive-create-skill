import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

export interface EpubText {
  text: string;
  chapter_count: number;
  char_count: number;
}

function runUnzip(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("unzip", ["-q", "-o", zip, "-d", dest]);
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip exit ${code}`));
    });
  });
}

async function walkFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractFb2Text(fb2Path: string): Promise<EpubText> {
  const raw = await readFile(fb2Path, "utf-8");
  const sectionMatches = raw.match(/<section[\s\S]*?<\/section>/g) ?? [];
  const text = stripHtml(raw);
  return {
    text,
    chapter_count: sectionMatches.length || 1,
    char_count: text.length,
  };
}

function runPdfToText(pdfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("pdftotext", ["-layout", "-q", pdfPath, "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString("utf-8")));
    p.stderr.on("data", (d) => (err += d.toString("utf-8")));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`pdftotext exit ${code}: ${err}`));
    });
  });
}

export async function extractPdfText(pdfPath: string): Promise<EpubText> {
  const raw = await runPdfToText(pdfPath);
  const text = raw.replace(/\f/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  const pages = (raw.match(/\f/g) ?? []).length + 1;
  return { text, chapter_count: pages, char_count: text.length };
}

export async function extractBookText(path: string): Promise<EpubText> {
  const ext = extname(path).toLowerCase().replace(/^\./, "");
  if (ext === "epub") return extractEpubText(path);
  if (ext === "fb2") return extractFb2Text(path);
  if (ext === "pdf") return extractPdfText(path);
  if (ext === "txt") {
    const text = await readFile(path, "utf-8");
    return { text, chapter_count: 1, char_count: text.length };
  }
  throw new Error(`unsupported format: .${ext} (supported: epub, fb2, pdf, txt)`);
}

export async function extractEpubText(epubPath: string): Promise<EpubText> {
  const s = await stat(epubPath);
  if (s.size === 0) throw new Error(`empty file: ${epubPath}`);

  const workDir = await mkdtemp(join(tmpdir(), "epub-"));
  try {
    await runUnzip(epubPath, workDir);
    const files = await walkFiles(workDir);
    const docs = files.filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext === ".xhtml" || ext === ".html" || ext === ".htm";
    });
    docs.sort();

    const parts: string[] = [];
    let chapters = 0;
    for (const doc of docs) {
      const raw = await readFile(doc, "utf-8").catch(() => "");
      if (!raw) continue;
      const text = stripHtml(raw);
      if (text.length < 40) continue;
      parts.push(text);
      chapters += 1;
    }
    const full = parts.join("\n\n");
    return { text: full, chapter_count: chapters, char_count: full.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
