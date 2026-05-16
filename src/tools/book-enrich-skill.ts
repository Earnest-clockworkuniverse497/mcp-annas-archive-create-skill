/**
 * book_enrich_skill — augment an existing SKILL.md with methodology from a new book.
 *
 * Does NOT rewrite the existing skill. Gemini returns only NEW atomic additions
 * (subsections, bullets, anti-patterns); the patcher mechanically inserts them
 * into the right sections, leaving everything else untouched. Backup is saved
 * before any write. Audit runs before and after — if `after` is strictly worse
 * than `before`, the change is rolled back.
 */
import { z } from "zod";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromEnv as loadAnnas, searchBooks } from "../lib/annas-client.js";
import { extractBookText } from "../lib/epub-extractor.js";
import { generateText, loadGeminiConfigFromEnv } from "../lib/gemini-client.js";
import {
  applyAdditions,
  validateEnrichmentPayload,
  type EnrichmentPayload,
} from "../lib/skill-patcher.js";
import { auditSkillMd, type AuditResult } from "../lib/skill-audit.js";
import { bookDownload } from "./book-download.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(HERE, "..", "prompts", "enrich-skill-v2.md");

export const BookEnrichSkillInputSchema = z.object({
  skill_path: z.string().describe("Absolute path to the existing SKILL.md to enrich"),
  book_query: z.string().min(2).describe("Book MD5 (32 hex) OR a search query"),
  focus: z
    .string()
    .optional()
    .describe("Optional focus hint, e.g. 'distributed-systems decisions' or 'sales discovery questions'"),
  dry_run: z
    .boolean()
    .default(false)
    .describe("If true, computes the patch and audit but does NOT write the SKILL.md (returns patched_preview)"),
  max_text_chars: z.number().int().min(10000).max(2_000_000).default(800_000),
  temperature: z.number().min(0).max(1).default(0.2),
});

export type BookEnrichSkillInput = z.infer<typeof BookEnrichSkillInputSchema>;

export interface BookEnrichSkillOutput {
  ok: boolean;
  skill_path: string;
  source_book: string;
  additions_count: number;
  additions_by_section: Record<string, number>;
  skipped_duplicates: string[];
  audit_before: AuditResult;
  audit_after: AuditResult;
  rolled_back: boolean;
  backup_path: string | null;
  gemini: {
    model: string;
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
    finish_reason: string;
  };
  patched_preview?: string;
  warnings: string[];
}

async function resolveMd5(query: string): Promise<string> {
  if (/^[a-f0-9]{32}$/i.test(query)) return query;
  const cfg = loadAnnas();
  const hits = await searchBooks(cfg, query, 10);
  if (hits.length === 0) throw new Error(`no Anna's Archive results for: ${query}`);
  const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3, txt: 4 };
  hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
  return hits[0].md5;
}

function auditWorse(before: AuditResult, after: AuditResult): boolean {
  if (after.error_count > before.error_count) return true;
  if (after.error_count === 0 && before.error_count === 0 && after.warning_count > before.warning_count + 1) {
    // tolerate one extra warning (size growth past 500 lines etc.)
    return true;
  }
  return false;
}

export async function bookEnrichSkill(input: BookEnrichSkillInput): Promise<BookEnrichSkillOutput> {
  const currentSkill = await readFile(input.skill_path, "utf-8");
  const auditBefore = auditSkillMd(currentSkill);

  const md5 = await resolveMd5(input.book_query);
  const dl = await bookDownload({
    md5, server_index: 0, overwrite: false, try_fallback_servers: true,
  });
  const extracted = await extractBookText(dl.path);
  const bookText = extracted.text.slice(0, input.max_text_chars);

  const promptTemplate = await readFile(PROMPT_PATH, "utf-8");
  const focusLine = input.focus ? `FOCUS: ${input.focus}\n\n` : "";
  const userMessage = `${promptTemplate}\n\n---\nCURRENT SKILL.md:\n---\n${currentSkill}\n\n---\n${focusLine}BOOK TEXT:\n---\n${bookText}`;

  const geminiCfg = loadGeminiConfigFromEnv();
  const result = await generateText(geminiCfg, userMessage, {
    temperature: input.temperature,
    maxOutputTokens: 16384,
    jsonMode: true,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON (finish=${result.finish_reason}): ${
        err instanceof Error ? err.message : String(err)
      }. Raw start: ${result.text.slice(0, 200)}`,
    );
  }

  const enrichment: EnrichmentPayload = validateEnrichmentPayload(parsed);
  const { patched, applied_count, by_section, warnings } = applyAdditions(currentSkill, enrichment);
  const auditAfter = auditSkillMd(patched);

  const baseOut: BookEnrichSkillOutput = {
    ok: false,
    skill_path: input.skill_path,
    source_book: enrichment.source_book,
    additions_count: applied_count,
    additions_by_section: by_section,
    skipped_duplicates: enrichment.skipped_duplicates,
    audit_before: auditBefore,
    audit_after: auditAfter,
    rolled_back: false,
    backup_path: null,
    gemini: {
      model: result.model,
      prompt_tokens: result.prompt_tokens,
      output_tokens: result.output_tokens,
      total_tokens: result.prompt_tokens + result.output_tokens,
      finish_reason: result.finish_reason,
    },
    warnings,
  };

  if (auditWorse(auditBefore, auditAfter)) {
    baseOut.rolled_back = true;
    baseOut.warnings.push(
      `audit got strictly worse (errors ${auditBefore.error_count}→${auditAfter.error_count}, warnings ${auditBefore.warning_count}→${auditAfter.warning_count}); no write`,
    );
    if (input.dry_run) baseOut.patched_preview = patched;
    return baseOut;
  }

  if (input.dry_run) {
    baseOut.ok = true;
    baseOut.patched_preview = patched;
    return baseOut;
  }

  if (applied_count > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${input.skill_path}.bak-${ts}`;
    await copyFile(input.skill_path, backupPath);
    await writeFile(input.skill_path, patched, "utf-8");
    baseOut.backup_path = backupPath;
  } else {
    baseOut.warnings.push("no additions applied — book had nothing new to add to this skill");
  }
  baseOut.ok = true;
  return baseOut;
}
