/**
 * End-to-end: search → download → extract text → Gemini JSON skill extraction → SKILL.md
 *   npm run smoke:skill -- "The Mom Test"
 *   npm run smoke:skill -- <md5>
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFromEnv, searchBooks } from "./lib/annas-client.js";
import { extractBookText } from "./lib/epub-extractor.js";
import { generateText, loadGeminiConfigFromEnv } from "./lib/gemini-client.js";
import { bookDownload } from "./tools/book-download.js";
import {
  isExtractionError,
  renderSkillMd,
  validateExtraction,
} from "./lib/skill-renderer.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

const HERE = dirname(fileURLToPath(import.meta.url));

async function loadExtractPrompt(): Promise<string> {
  const path = resolve(HERE, "prompts", "extract-skill.md");
  return readFile(path, "utf-8");
}

async function resolveMd5(query: string): Promise<{ md5: string; format: string }> {
  if (/^[a-f0-9]{32}$/i.test(query)) return { md5: query, format: "?" };
  const cfg = loadConfigFromEnv();
  const hits = await searchBooks(cfg, query, 10);
  if (hits.length === 0) throw new Error(`no results for: ${query}`);
  const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3, txt: 4 };
  hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
  log(`[smoke-skill] picked from ${hits.length} hits: md5=${hits[0].md5} fmt=${hits[0].format}`);
  return { md5: hits[0].md5, format: hits[0].format };
}

async function main(): Promise<void> {
  const query = process.argv[2];
  if (!query) {
    process.stderr.write("usage: npm run smoke:skill -- \"<title or md5>\"\n");
    process.exit(1);
  }

  log(`[smoke-skill] query="${query}"`);

  const { md5 } = await resolveMd5(query);

  log("[smoke-skill] step: download ...");
  const dl = await bookDownload({
    md5,
    server_index: 0,
    overwrite: false,
    try_fallback_servers: true,
  });
  log(`[smoke-skill] file: ${dl.path} (${dl.size_bytes} bytes, fmt=${dl.format})`);

  log("[smoke-skill] step: extract text ...");
  const extracted = await extractBookText(dl.path);
  log(`[smoke-skill] chars=${extracted.char_count} chapters=${extracted.chapter_count}`);

  const MAX = 800_000;
  const text = extracted.text.slice(0, MAX);
  if (extracted.text.length > MAX) log(`[smoke-skill] truncated to ${MAX} chars`);

  const prompt = await loadExtractPrompt();
  const geminiCfg = loadGeminiConfigFromEnv();

  log(`[smoke-skill] step: Gemini ${geminiCfg.model} (JSON mode) ...`);
  const result = await generateText(
    geminiCfg,
    `${prompt}\n\n---\nBOOK TEXT:\n---\n${text}`,
    { temperature: 0.2, maxOutputTokens: 16384, jsonMode: true },
  );
  log(`[smoke-skill] tokens: prompt=${result.prompt_tokens} output=${result.output_tokens} finish=${result.finish_reason}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    process.stderr.write(`[smoke-skill] JSON parse FAILED. Raw output (first 500):\n${result.text.slice(0, 500)}\n`);
    throw err;
  }

  if (isExtractionError(parsed)) {
    log(`[smoke-skill] book rejected by extractor:`);
    log(parsed);
    return;
  }

  const skill = validateExtraction(parsed);
  log(`[smoke-skill] extraction valid. name=${skill.name} description_len=${skill.description.length} caps=${skill.capabilities.length}`);

  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  const draftDir = join(dataDir, "skill-drafts", skill.name);
  await mkdir(draftDir, { recursive: true });

  await writeFile(join(draftDir, "extraction.json"), JSON.stringify(skill, null, 2), "utf-8");
  const md = renderSkillMd(skill);
  await writeFile(join(draftDir, "SKILL.md"), md, "utf-8");
  log(`[smoke-skill] saved → ${draftDir}/SKILL.md  (${md.length} chars)`);

  process.stdout.write("\n========== SKILL.md preview (first 2500 chars) ==========\n\n");
  process.stdout.write(md.slice(0, 2500));
  process.stdout.write("\n\n========== END ==========\n");
}

main().catch((err) => {
  process.stderr.write(`[smoke-skill] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
