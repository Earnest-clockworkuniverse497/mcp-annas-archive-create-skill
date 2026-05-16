/**
 * book_skill — the unified tool of mcp-books.
 *
 * Three modes:
 *   - "create"   → book → new SKILL.md (audit-gated promote)
 *   - "enrich"   → book → surgical additions into an EXISTING SKILL.md (auto-rollback on audit regression)
 *   - "preview"  → book → analysis + proposed additions, NO writes (for interactive use by the agent)
 *
 * Internally orchestrates search → download → text-extract → Gemini → render/patch → audit.
 */
import { z } from "zod";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import {
  loadConfigFromEnv as loadAnnas,
  searchBooks,
  getFastDownloadUrl,
} from "../lib/annas-client.js";
import { downloadFile } from "../lib/downloader.js";
import { extractBookText } from "../lib/epub-extractor.js";
import { generateText, loadGeminiConfigFromEnv } from "../lib/gemini-client.js";
import {
  isExtractionError,
  renderSkillMd,
  renderPattern2,
  shouldUsePattern2,
  validateExtraction,
  type SkillExtraction,
} from "../lib/skill-renderer.js";
import {
  applyAdditions,
  validateEnrichmentPayload,
  type EnrichmentPayload,
} from "../lib/skill-patcher.js";
import { auditSkillMd, type AuditResult } from "../lib/skill-audit.js";
import { loadSkill, formatSkillForPrompt } from "../lib/skill-loader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT_PROMPT = resolve(HERE, "..", "prompts", "extract-skill.md");
const ENRICH_PROMPT = resolve(HERE, "..", "prompts", "enrich-skill-v2.md");

export const BookSkillInputSchema = z.object({
  mode: z
    .enum(["create", "enrich", "preview"])
    .describe(
      "create = book → new SKILL.md (audit-gated promote); enrich = book → surgical additions into existing SKILL.md (auto-rollback if audit worsens); preview = book → analysis + proposed additions, no writes",
    ),
  book: z.string().min(2).describe("Book MD5 (32 hex) OR a search query (title, author, keywords)"),
  skill_path: z
    .string()
    .optional()
    .describe("Required for mode=enrich. Optional for mode=preview (provides context for diff)."),
  promote_to: z
    .string()
    .optional()
    .describe("mode=create only. Absolute path; copies generated SKILL.md here ONLY if audit passes 0 errors."),
  focus: z.string().optional().describe("Optional focus hint (e.g. 'sales discovery', 'distributed systems decisions')"),
  dry_run: z
    .boolean()
    .default(false)
    .describe("mode=create|enrich only. If true, computes everything but does NOT write the final file. Always true in mode=preview."),
  max_text_chars: z.number().int().min(10000).max(2_000_000).default(800_000),
  temperature: z.number().min(0).max(1).default(0.2),
});

export type BookSkillInput = z.infer<typeof BookSkillInputSchema>;

interface BookFile {
  md5: string;
  path: string;
  format: string;
  size_bytes: number;
}

async function findCachedByMd5(md5: string, booksDir: string): Promise<BookFile | null> {
  try {
    const entries = await readdir(booksDir);
    const match = entries.find((e) => e.startsWith(`${md5}.`));
    if (!match) return null;
    const path = join(booksDir, match);
    const s = await stat(path);
    if (s.size === 0) return null;
    const ext = match.split(".").pop()?.toLowerCase() ?? "bin";
    return { md5, path, format: ext, size_bytes: s.size };
  } catch {
    return null;
  }
}

async function resolveAndDownload(book: string): Promise<BookFile> {
  const dataDir = process.env.DATA_DIR ?? join(homedir(), "tools/mcp-books/data");
  const booksDir = join(dataDir, "books");

  let md5 = book;
  const isMd5 = /^[a-f0-9]{32}$/i.test(book);

  // Fast path: cached file by md5 — skip Anna's API entirely
  if (isMd5) {
    const cached = await findCachedByMd5(md5, booksDir);
    if (cached) return cached;
  }

  const cfg = loadAnnas();
  if (!isMd5) {
    const hits = await searchBooks(cfg, book, 10);
    if (hits.length === 0) throw new Error(`no Anna's Archive results for: ${book}`);
    const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3, txt: 4 };
    hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
    md5 = hits[0].md5;
    // Recheck cache after resolving md5
    const cached = await findCachedByMd5(md5, booksDir);
    if (cached) return cached;
  }

  const indices = [0, 1, 2, 3];
  let lastErr: unknown;

  for (const idx of indices) {
    try {
      const info = await getFastDownloadUrl(cfg, md5, idx);
      const dest = join(booksDir, `${md5}.${info.format}`);
      const dl = await downloadFile(info.direct_url, dest, { overwrite: false, timeoutMs: 300_000 });
      return { md5, path: dl.path, format: info.format, size_bytes: dl.size_bytes };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `all partner servers failed for md5=${md5}. last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

interface CommonFields {
  mode: BookSkillInput["mode"];
  md5: string;
  book: { format: string; size_bytes: number; extracted_chars: number; text_sent_chars: number; truncated: boolean };
  gemini: { model: string; prompt_tokens: number; output_tokens: number; total_tokens: number; finish_reason: string };
  paths: { book_file: string };
}

async function runCreate(input: BookSkillInput, common: CommonFields, parsedJson: unknown) {
  if (isExtractionError(parsedJson)) {
    return {
      ok: false,
      ...common,
      rejection: { reason: parsedJson.reason, detected_genre: parsedJson.detected_genre },
    };
  }
  const skill: SkillExtraction = validateExtraction(parsedJson);
  const singleFileMd = renderSkillMd(skill);
  const singleLines = singleFileMd.split(/\r?\n/).length;
  const usePattern2 = shouldUsePattern2(skill, singleLines);

  let skillMd: string;
  let pattern2Files: Array<{ filename: string; content: string }> = [];
  if (usePattern2) {
    const p2 = renderPattern2(skill);
    skillMd = p2.skill_md;
    pattern2Files = p2.references;
  } else {
    skillMd = singleFileMd;
  }
  const audit = auditSkillMd(skillMd);

  const dataDir = process.env.DATA_DIR ?? join(homedir(), "tools/mcp-books/data");
  const draftDir = join(dataDir, "skill-drafts", skill.name);
  let draftSkillPath = "";
  let draftJsonPath = "";
  let promotedPath: string | null = null;
  const writtenReferences: string[] = [];

  if (!input.dry_run) {
    await mkdir(draftDir, { recursive: true });
    draftSkillPath = join(draftDir, "SKILL.md");
    draftJsonPath = join(draftDir, "extraction.json");
    await writeFile(draftJsonPath, JSON.stringify(skill, null, 2), "utf-8");
    await writeFile(draftSkillPath, skillMd, "utf-8");
    if (usePattern2) {
      const refsDir = join(draftDir, "references");
      await mkdir(refsDir, { recursive: true });
      for (const ref of pattern2Files) {
        const refPath = join(refsDir, ref.filename);
        await writeFile(refPath, ref.content, "utf-8");
        writtenReferences.push(refPath);
      }
    }

    if (input.promote_to) {
      if (!audit.passed) {
        return {
          ok: false,
          ...common,
          pattern_2: usePattern2,
          skill: { name: skill.name, description_length: skill.description.length, capability_count: skill.capabilities.length, citation_count: skill.citations.length },
          audit,
          paths: { ...common.paths, draft_skill_md: draftSkillPath, draft_extraction_json: draftJsonPath, draft_references: writtenReferences, promoted_skill_md: null, promoted_references: [] },
          error: `cannot promote: audit has ${audit.error_count} errors`,
        };
      }
      const promotedRefs: string[] = [];
      await mkdir(dirname(input.promote_to), { recursive: true });
      await copyFile(draftSkillPath, input.promote_to);
      promotedPath = input.promote_to;
      if (usePattern2) {
        const targetRefsDir = join(dirname(input.promote_to), "references");
        await mkdir(targetRefsDir, { recursive: true });
        for (const ref of pattern2Files) {
          const targetRefPath = join(targetRefsDir, ref.filename);
          await writeFile(targetRefPath, ref.content, "utf-8");
          promotedRefs.push(targetRefPath);
        }
      }
      return {
        ok: audit.passed,
        ...common,
        pattern_2: usePattern2,
        skill: { name: skill.name, description_length: skill.description.length, capability_count: skill.capabilities.length, citation_count: skill.citations.length },
        audit,
        paths: { ...common.paths, draft_skill_md: draftSkillPath, draft_extraction_json: draftJsonPath, draft_references: writtenReferences, promoted_skill_md: promotedPath, promoted_references: promotedRefs },
      };
    }
  }

  return {
    ok: audit.passed,
    ...common,
    pattern_2: usePattern2,
    skill: { name: skill.name, description_length: skill.description.length, capability_count: skill.capabilities.length, citation_count: skill.citations.length },
    audit,
    paths: { ...common.paths, draft_skill_md: draftSkillPath, draft_extraction_json: draftJsonPath, draft_references: writtenReferences, promoted_skill_md: promotedPath, promoted_references: [] },
    ...(input.dry_run
      ? { preview_skill_md: skillMd, preview_references: pattern2Files }
      : {}),
  };
}

function auditWorse(before: AuditResult, after: AuditResult): boolean {
  if (after.error_count > before.error_count) return true;
  if (after.error_count === 0 && before.error_count === 0 && after.warning_count > before.warning_count + 1) return true;
  return false;
}

async function runEnrich(input: BookSkillInput, common: CommonFields, parsedJson: unknown, currentSkillContent: string, auditBefore: AuditResult) {
  const enrichment: EnrichmentPayload = validateEnrichmentPayload(parsedJson);
  const { patched, applied_count, by_section, warnings } = applyAdditions(currentSkillContent, enrichment);
  const auditAfter = auditSkillMd(patched);

  const baseOut = {
    ok: false,
    ...common,
    skill_path: input.skill_path,
    source_book: enrichment.source_book,
    additions_count: applied_count,
    additions_by_section: by_section,
    skipped_duplicates: enrichment.skipped_duplicates,
    audit_before: auditBefore,
    audit_after: auditAfter,
    rolled_back: false,
    backup_path: null as string | null,
    warnings,
    ...(input.dry_run ? { preview_skill_md: patched } : {}),
  };

  if (auditWorse(auditBefore, auditAfter)) {
    baseOut.rolled_back = true;
    baseOut.warnings.push(
      `audit got strictly worse (errors ${auditBefore.error_count}→${auditAfter.error_count}, warnings ${auditBefore.warning_count}→${auditAfter.warning_count}); no write`,
    );
    return baseOut;
  }

  if (input.dry_run) {
    baseOut.ok = true;
    return baseOut;
  }

  if (applied_count > 0 && input.skill_path) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${input.skill_path}.bak-${ts}`;
    await copyFile(input.skill_path, backupPath);
    await writeFile(input.skill_path, patched, "utf-8");
    baseOut.backup_path = backupPath;
  } else if (applied_count === 0) {
    baseOut.warnings.push("no additions applied — book had nothing new to add to this skill");
  }
  baseOut.ok = true;
  return baseOut;
}

async function runPreview(input: BookSkillInput, common: CommonFields, parsedJson: unknown, currentSkillContent: string | null, auditBefore: AuditResult | null) {
  if (currentSkillContent && auditBefore && input.skill_path) {
    const enrichment = validateEnrichmentPayload(parsedJson);
    const { patched, applied_count, by_section, warnings } = applyAdditions(currentSkillContent, enrichment);
    const auditAfter = auditSkillMd(patched);
    return {
      ok: true,
      preview_kind: "enrich" as const,
      ...common,
      skill_path: input.skill_path,
      source_book: enrichment.source_book,
      additions_count: applied_count,
      additions_by_section: by_section,
      skipped_duplicates: enrichment.skipped_duplicates,
      audit_before: auditBefore,
      audit_after: auditAfter,
      patched_skill_md: patched,
      enrichment_payload: enrichment,
      warnings,
    };
  }
  if (isExtractionError(parsedJson)) {
    return {
      ok: false,
      preview_kind: "create" as const,
      ...common,
      rejection: { reason: parsedJson.reason, detected_genre: parsedJson.detected_genre },
    };
  }
  const skill = validateExtraction(parsedJson);
  const skillMd = renderSkillMd(skill);
  const audit = auditSkillMd(skillMd);
  return {
    ok: audit.passed,
    preview_kind: "create" as const,
    ...common,
    skill: { name: skill.name, description_length: skill.description.length, capability_count: skill.capabilities.length, citation_count: skill.citations.length },
    audit,
    preview_skill_md: skillMd,
    extraction: skill,
  };
}

export async function bookSkill(input: BookSkillInput) {
  if (input.mode === "enrich" && !input.skill_path) {
    throw new Error("mode='enrich' requires skill_path");
  }

  const bookFile = await resolveAndDownload(input.book);
  const extracted = await extractBookText(bookFile.path);
  const text = extracted.text.slice(0, input.max_text_chars);

  let promptTemplate: string;
  let currentSkillContent: string | null = null;
  let auditBefore: AuditResult | null = null;
  let skillContextSummary: { is_pattern_2: boolean; references_count: number; total_chars: number } | null = null;

  const useEnrichPrompt = input.mode === "enrich" || (input.mode === "preview" && input.skill_path);

  if (useEnrichPrompt && input.skill_path) {
    const loaded = await loadSkill(input.skill_path);
    currentSkillContent = loaded.skill_md;
    auditBefore = auditSkillMd(loaded.skill_md);
    skillContextSummary = {
      is_pattern_2: loaded.is_pattern_2,
      references_count: loaded.references.length,
      total_chars: loaded.total_chars,
    };

    const tmpl = await readFile(ENRICH_PROMPT, "utf-8");
    const focusLine = input.focus ? `FOCUS: ${input.focus}\n\n` : "";
    const skillBlob = formatSkillForPrompt(loaded);
    const p2Note = loaded.is_pattern_2
      ? `\n\nNOTE: This is a Pattern 2 skill — the navigator SKILL.md plus ${loaded.references.length} references file(s) are ALL provided below. Treat them as a single skill when deciding what's already covered vs new.\n`
      : "";
    promptTemplate = `${tmpl}${p2Note}\n\n---\nCURRENT SKILL (full content${loaded.is_pattern_2 ? ", including references/" : ""}):\n---\n${skillBlob}\n\n---\n${focusLine}BOOK TEXT:\n---\n${text}`;
  } else {
    const tmpl = await readFile(EXTRACT_PROMPT, "utf-8");
    promptTemplate = `${tmpl}\n\n---\nBOOK TEXT:\n---\n${text}`;
  }

  const geminiCfg = loadGeminiConfigFromEnv();
  const result = await generateText(geminiCfg, promptTemplate, {
    temperature: input.temperature,
    maxOutputTokens: useEnrichPrompt ? 16384 : 32768,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.text);
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON (finish=${result.finish_reason}): ${err instanceof Error ? err.message : String(err)}. Raw start: ${result.text.slice(0, 200)}`,
    );
  }

  const common: CommonFields = {
    mode: input.mode,
    md5: bookFile.md5,
    book: {
      format: bookFile.format,
      size_bytes: bookFile.size_bytes,
      extracted_chars: extracted.char_count,
      text_sent_chars: text.length,
      truncated: extracted.text.length > input.max_text_chars,
    },
    gemini: {
      model: result.model,
      prompt_tokens: result.prompt_tokens,
      output_tokens: result.output_tokens,
      total_tokens: result.prompt_tokens + result.output_tokens,
      finish_reason: result.finish_reason,
    },
    paths: { book_file: bookFile.path },
  };

  if (input.mode === "create") return runCreate(input, common, parsedJson);
  if (input.mode === "enrich") {
    const r = await runEnrich(input, common, parsedJson, currentSkillContent ?? "", auditBefore ?? auditSkillMd(""));
    return { ...r, skill_context: skillContextSummary };
  }
  const r = await runPreview(input, common, parsedJson, currentSkillContent, auditBefore);
  return { ...r, skill_context: skillContextSummary };
}
