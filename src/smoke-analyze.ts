/**
 * End-to-end smoke:
 *   1. search Anna's Archive for query
 *   2. download top result
 *   3. extract EPUB text
 *   4. send to Gemini for structured summary
 *
 * Run:  npm run smoke:analyze -- "Сказки"
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFromEnv, searchBooks } from "./lib/annas-client.js";
import { extractBookText } from "./lib/epub-extractor.js";
import { generateText, loadGeminiConfigFromEnv } from "./lib/gemini-client.js";
import { bookDownload } from "./tools/book-download.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

const SUMMARY_PROMPT = `Ты — литературный аналитик. Перед тобой текст книги (возможно с шумом от вёрстки EPUB). Дай структурированное саммери на русском в виде Markdown по схеме:

# <Название книги> — саммери

## Жанр и формат
- 1 предложение

## Аннотация (3-5 предложений)
...

## Главные герои
- имя — кто и какую роль играет (1 строка на героя)

## Структура / содержание
- кратко по главам или разделам (5-15 буллетов)

## Ключевые темы
- 3-7 буллетов с краткой расшифровкой

## Аудитория
- кому подходит, возраст, кому НЕ подходит

## Качество текста
- честная оценка: уровень письма, редактуры, есть ли явные дефекты

## Цитаты (2-3)
- короткие, показательные

Будь честным. Если книга слабая — скажи прямо. Если содержимое непонятно или текст битый — укажи это в начале.`;

async function main(): Promise<void> {
  const query = process.argv[2] ?? "Сказки";
  log(`[smoke-analyze] query="${query}"`);

  const annasCfg = loadConfigFromEnv();
  const geminiCfg = loadGeminiConfigFromEnv();

  // 1. Search
  log("[smoke-analyze] step 1: searchBooks ...");
  const hits = await searchBooks(annasCfg, query, 10);
  log(`[smoke-analyze] hits: ${hits.length}`);
  if (hits.length === 0) throw new Error("no search hits");
  hits.slice(0, 5).forEach((h, i) => {
    log(`  [${i}] md5=${h.md5} fmt=${h.format} size=${h.size_human}  title="${h.title.slice(0, 80)}"`);
  });

  // Prefer epub, then fb2, then pdf
  const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3 };
  const sorted = [...hits].sort(
    (a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9),
  );
  const picked = sorted[0];
  log(`[smoke-analyze] picked: md5=${picked.md5} fmt=${picked.format} title="${picked.title.slice(0, 80)}"`);

  // 2. Download
  log("[smoke-analyze] step 2: bookDownload ...");
  const dl = await bookDownload({
    md5: picked.md5,
    server_index: 0,
    overwrite: false,
    try_fallback_servers: true,
  });
  log(`[smoke-analyze] downloaded ${dl.size_bytes} bytes → ${dl.path}`);

  // 3. Extract
  log(`[smoke-analyze] step 3: extractBookText (format=${dl.format}) ...`);
  const extracted = await extractBookText(dl.path);
  log(`[smoke-analyze] extracted ${extracted.char_count} chars, ${extracted.chapter_count} chapters`);
  const MAX_CHARS = 600_000;
  const textForLlm = extracted.text.slice(0, MAX_CHARS);
  if (extracted.text.length > MAX_CHARS) {
    log(`[smoke-analyze] truncated to ${MAX_CHARS} chars for LLM`);
  }

  // 4. Gemini
  log(`[smoke-analyze] step 4: Gemini ${geminiCfg.model} ...`);
  const result = await generateText(
    geminiCfg,
    `${SUMMARY_PROMPT}\n\n---\nТЕКСТ КНИГИ:\n---\n${textForLlm}`,
    { temperature: 0.3, maxOutputTokens: 8192 },
  );
  log(`[smoke-analyze] tokens: prompt=${result.prompt_tokens}, output=${result.output_tokens}, finish=${result.finish_reason}`);

  // 5. Save
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  const outDir = join(dataDir, "analyses");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${picked.md5}.summary.md`);
  await writeFile(
    outPath,
    `<!-- md5: ${picked.md5} | title: ${picked.title} | model: ${result.model} -->\n\n${result.text}\n`,
    "utf-8",
  );
  log(`[smoke-analyze] saved → ${outPath}`);

  process.stdout.write("\n\n========== SUMMARY ==========\n\n");
  process.stdout.write(result.text);
  process.stdout.write("\n\n========== END ==========\n");
}

main().catch((err) => {
  process.stderr.write(`[smoke-analyze] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
