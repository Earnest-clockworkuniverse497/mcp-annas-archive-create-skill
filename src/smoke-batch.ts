/**
 * Batch extraction: process N books, log token spend per book.
 *   npm run smoke:batch -- "Query 1" "Query 2" "Query 3"
 *
 * Outputs:
 *   data/skill-drafts/<name>/SKILL.md
 *   data/skill-drafts/<name>/extraction.json
 *   data/skill-drafts/_ledger.json  (aggregated token report)
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

interface LedgerEntry {
  query: string;
  md5: string;
  format: string;
  file_size_bytes: number;
  extracted_chars: number;
  text_sent_chars: number;
  truncated: boolean;
  model: string;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
  status: "extracted" | "rejected_not_methodology" | "error";
  reject_reason?: string;
  skill_name?: string;
  description_len?: number;
  capability_count?: number;
  saved_to?: string;
}

async function loadExtractPrompt(): Promise<string> {
  return readFile(resolve(HERE, "prompts", "extract-skill.md"), "utf-8");
}

async function processOne(query: string, prompt: string): Promise<LedgerEntry> {
  const annasCfg = loadConfigFromEnv();
  const geminiCfg = loadGeminiConfigFromEnv();

  const entry: LedgerEntry = {
    query,
    md5: "",
    format: "",
    file_size_bytes: 0,
    extracted_chars: 0,
    text_sent_chars: 0,
    truncated: false,
    model: geminiCfg.model,
    prompt_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    status: "error",
  };

  log(`\n========== ${query} ==========`);

  const isMd5 = /^[a-f0-9]{32}$/i.test(query);
  let md5 = query;
  if (!isMd5) {
    const hits = await searchBooks(annasCfg, query, 10);
    if (hits.length === 0) throw new Error(`no results for: ${query}`);
    const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3, txt: 4 };
    hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
    md5 = hits[0].md5;
    log(`  picked md5=${md5} fmt=${hits[0].format}`);
  }
  entry.md5 = md5;

  const dl = await bookDownload({
    md5, server_index: 0, overwrite: false, try_fallback_servers: true,
  });
  entry.format = dl.format;
  entry.file_size_bytes = dl.size_bytes;
  log(`  downloaded: ${dl.path} (${dl.size_bytes} bytes, ${dl.format})`);

  const extracted = await extractBookText(dl.path);
  entry.extracted_chars = extracted.char_count;
  log(`  extracted: ${extracted.char_count} chars`);

  const MAX = 800_000;
  const textToSend = extracted.text.slice(0, MAX);
  entry.text_sent_chars = textToSend.length;
  entry.truncated = extracted.text.length > MAX;

  log(`  calling Gemini ${geminiCfg.model} (JSON mode) ...`);
  let result;
  try {
    result = await generateText(
      geminiCfg,
      `${prompt}\n\n---\nBOOK TEXT:\n---\n${textToSend}`,
      { temperature: 0.2, maxOutputTokens: 32768, jsonMode: true },
    );
  } catch (err) {
    entry.status = "error";
    (entry as LedgerEntry & { error_message?: string }).error_message =
      err instanceof Error ? err.message : String(err);
    log(`  ERR (API): ${(entry as { error_message?: string }).error_message}`);
    return entry;
  }
  entry.prompt_tokens = result.prompt_tokens;
  entry.output_tokens = result.output_tokens;
  entry.total_tokens = result.prompt_tokens + result.output_tokens;
  log(`  tokens: prompt=${result.prompt_tokens} output=${result.output_tokens} total=${entry.total_tokens} finish=${result.finish_reason}`);

  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  const safeSlug = entry.md5 || `q-${query.slice(0, 30).replace(/[^a-z0-9]+/gi, "-")}`;
  const debugDir = join(dataDir, "skill-drafts", `_raw-${safeSlug}`);
  await mkdir(debugDir, { recursive: true });
  await writeFile(join(debugDir, "gemini-response.json"), result.text, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    entry.status = "error";
    (entry as LedgerEntry & { error_message?: string }).error_message =
      `invalid JSON (finish=${result.finish_reason}): ${err instanceof Error ? err.message : String(err)}`;
    log(`  ERR (JSON parse): ${(entry as { error_message?: string }).error_message}`);
    log(`  raw saved to: ${debugDir}/gemini-response.json`);
    return entry;
  }

  if (isExtractionError(parsed)) {
    entry.status = "rejected_not_methodology";
    entry.reject_reason = parsed.reason;
    log(`  REJECTED: ${parsed.reason}`);
    return entry;
  }

  try {
    const skill = validateExtraction(parsed);
    entry.status = "extracted";
    entry.skill_name = skill.name;
    entry.description_len = skill.description.length;
    entry.capability_count = skill.capabilities.length;
    const draftDir = join(dataDir, "skill-drafts", skill.name);
    await mkdir(draftDir, { recursive: true });
    await writeFile(join(draftDir, "extraction.json"), JSON.stringify(skill, null, 2), "utf-8");
    await writeFile(join(draftDir, "SKILL.md"), renderSkillMd(skill), "utf-8");
    entry.saved_to = draftDir;
    log(`  ✓ extracted: name=${skill.name} caps=${skill.capabilities.length} desc=${skill.description.length} → ${draftDir}`);
  } catch (err) {
    entry.status = "error";
    (entry as LedgerEntry & { error_message?: string }).error_message =
      `validation failed: ${err instanceof Error ? err.message : String(err)}`;
    log(`  ERR (validation): ${(entry as { error_message?: string }).error_message}`);
    log(`  raw saved to: ${debugDir}/gemini-response.json`);
  }
  return entry;
}

function fmtMoney(promptTok: number, outTok: number): string {
  // gemini-3-flash-preview rough pricing 2026: prompt $0.30/1M, output $2.50/1M
  const cost = (promptTok / 1_000_000) * 0.3 + (outTok / 1_000_000) * 2.5;
  return `$${cost.toFixed(4)}`;
}

async function main(): Promise<void> {
  const queries = process.argv.slice(2);
  if (queries.length === 0) {
    process.stderr.write("usage: npm run smoke:batch -- \"Query 1\" \"Query 2\" ...\n");
    process.exit(1);
  }

  const prompt = await loadExtractPrompt();
  const entries: LedgerEntry[] = [];

  for (const q of queries) {
    entries.push(await processOne(q, prompt));
  }

  const totalPrompt = entries.reduce((s, e) => s + e.prompt_tokens, 0);
  const totalOutput = entries.reduce((s, e) => s + e.output_tokens, 0);
  const ledger = {
    timestamp: new Date().toISOString(),
    model: entries[0]?.model ?? "?",
    book_count: entries.length,
    totals: {
      prompt_tokens: totalPrompt,
      output_tokens: totalOutput,
      total_tokens: totalPrompt + totalOutput,
      est_cost_usd: fmtMoney(totalPrompt, totalOutput),
    },
    books: entries,
  };

  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  await mkdir(join(dataDir, "skill-drafts"), { recursive: true });
  const ledgerPath = join(dataDir, "skill-drafts", "_ledger.json");
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf-8");

  process.stdout.write("\n\n========== TOKEN LEDGER ==========\n\n");
  process.stdout.write(`Model: ${ledger.model}\n`);
  process.stdout.write(`Books: ${ledger.book_count}\n\n`);

  for (const e of entries) {
    process.stdout.write(`${e.query}\n`);
    process.stdout.write(`  status:   ${e.status}${e.skill_name ? ` (${e.skill_name})` : ""}\n`);
    process.stdout.write(`  format:   ${e.format}  size=${(e.file_size_bytes / 1024).toFixed(1)} KB\n`);
    process.stdout.write(`  chars:    extracted=${e.extracted_chars}, sent=${e.text_sent_chars}${e.truncated ? " (truncated)" : ""}\n`);
    process.stdout.write(`  tokens:   prompt=${e.prompt_tokens}  output=${e.output_tokens}  total=${e.total_tokens}\n`);
    process.stdout.write(`  est cost: ${fmtMoney(e.prompt_tokens, e.output_tokens)}\n\n`);
  }

  process.stdout.write(`TOTALS\n`);
  process.stdout.write(`  prompt:   ${totalPrompt.toLocaleString()}\n`);
  process.stdout.write(`  output:   ${totalOutput.toLocaleString()}\n`);
  process.stdout.write(`  total:    ${(totalPrompt + totalOutput).toLocaleString()}\n`);
  process.stdout.write(`  est cost: ${ledger.totals.est_cost_usd}  (gemini-3-flash-preview rates: $0.30/$2.50 per 1M)\n\n`);
  process.stdout.write(`Ledger saved → ${ledgerPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`[smoke-batch] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
