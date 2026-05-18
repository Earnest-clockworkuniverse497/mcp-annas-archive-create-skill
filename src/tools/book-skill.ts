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
import { readFile, writeFile, mkdir, copyFile, readdir, stat, unlink, rename } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  loadConfigFromEnvSoft,
  searchBooks,
  getFastDownloadUrl,
  QuotaExhaustedError,
  type AnnasConfig,
  type SearchHit,
} from "../lib/annas-client.js";
import { waitForBook } from "../lib/watch-folder.js";
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
import { detectMagic } from "../lib/magic-bytes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT_PROMPT = resolve(HERE, "..", "prompts", "extract-skill.md");
const ENRICH_PROMPT = resolve(HERE, "..", "prompts", "enrich-skill-v2.md");

export const BookSkillInputSchema = z.object({
  mode: z
    .enum(["create", "enrich", "preview"])
    .describe(
      "create = book → new SKILL.md (audit-gated promote); enrich = book → surgical additions into existing SKILL.md (auto-rollback if audit worsens); preview = book → analysis + proposed additions, no writes",
    ),
  book: z
    .string()
    .min(2)
    .describe(
      "One of: (1) absolute path to a local file (.epub/.fb2/.pdf/.txt) — Anna's Archive is NOT called; (2) Book MD5 (32 hex chars) — looks for $DATA_DIR/books/<md5>.* first, downloads from Anna's if missing; (3) search query (title, author, keywords) — finds best hit on Anna's.",
    ),
  skill_path: z
    .string()
    .optional()
    .describe("Required for mode=enrich. Optional for mode=preview (provides context for diff)."),
  promote_to: z
    .string()
    .optional()
    .describe("mode=create only. Absolute path; copies generated SKILL.md here ONLY if audit passes 0 errors."),
  focus: z.string().optional().describe("Optional focus hint (e.g. 'sales discovery', 'distributed systems decisions')"),
  prefer_format: z.enum(["epub", "pdf", "fb2", "txt"]).optional()
    .describe("Optional preferred format; ranks this format first in search results"),
  manual_download_wait_ms: z
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .optional()
    .describe(
      "Wait this many ms for a manually-downloaded file in data/books/ when fast-download is unavailable. 0 = no wait (fail fast). Default 600000 (10 min) or env MANUAL_DOWNLOAD_WAIT_MS.",
    ),
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

async function asLocalFile(input: string): Promise<BookFile | null> {
  const isPathLike =
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("~/") ||
    /^[A-Za-z]:\\/.test(input);
  if (!isPathLike) return null;
  const absPath = input.startsWith("~/")
    ? join(homedir(), input.slice(2))
    : resolve(input);
  try {
    const s = await stat(absPath);
    if (!s.isFile() || s.size === 0) return null;
  } catch {
    return null;
  }
  const ext = extname(absPath).slice(1).toLowerCase() || "bin";
  const SUPPORTED = ["epub", "fb2", "pdf", "txt"];
  if (!SUPPORTED.includes(ext)) {
    throw new Error(
      `local file ${absPath} has unsupported extension .${ext}. Supported: ${SUPPORTED.join(", ")}`,
    );
  }
  // Compute md5 of file contents so subsequent runs with the same file hit cache.
  const buf = readFileSync(absPath);
  const md5 = createHash("md5").update(buf).digest("hex");
  return { md5, path: absPath, format: ext, size_bytes: buf.length };
}

function printManualDownloadBlock(md5: string, booksDir: string, waitMs: number): void {
  const mm = Math.floor(waitMs / 60000);
  const ss = String(Math.floor((waitMs % 60000) / 1000)).padStart(2, "0");
  const lines = [
    "─────────────────────────────────────────────────────────────",
    "[mcp-books] Manual download mode (slow path / no key / quota)",
    "─────────────────────────────────────────────────────────────",
    "  1. Open in browser:",
    `       https://annas-archive.gl/md5/${md5}`,
    `  2. Click "Slow download" — wait for the timer.`,
    "  3. Save the file as:",
    `       ${booksDir}/${md5}.<ext>`,
    "     Allowed extensions: .epub .fb2 .pdf .txt",
    "     (Wrong extension is OK — magic-byte detector will fix it.)",
    "",
    `   Waiting up to ${mm}:${ss}. Polling every 2s.`,
    "─────────────────────────────────────────────────────────────",
  ];
  for (const l of lines) process.stderr.write(l + "\n");
}

async function runWatchMode(md5: string, booksDir: string, waitMs: number): Promise<BookFile> {
  await mkdir(booksDir, { recursive: true });
  printManualDownloadBlock(md5, booksDir, waitMs);
  const onTick = (e: number, r: number): void => {
    const fmt = (ms: number): string => {
      const m = Math.floor(ms / 60000);
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
      return `${m}:${s}`;
    };
    process.stderr.write(`[mcp-books] ${fmt(e)} elapsed, ${fmt(r)} remaining...\n`);
  };
  const wait = await waitForBook(booksDir, md5, waitMs, onTick);
  if (!wait) {
    throw new Error(`manual download timed out after ${Math.floor(waitMs / 1000)}s for md5=${md5}`);
  }
  process.stderr.write(
    `[mcp-books] Found file: ${wait.path} (${(wait.size_bytes / 1024 / 1024).toFixed(2)} MB). Validating...\n`,
  );
  const detected = await detectMagic(wait.path);
  if (detected === "rtf" || detected === "html" || detected === "unknown") {
    await unlink(wait.path).catch(() => {});
    throw new Error(`manual download payload is not a supported book (detected=${detected})`);
  }
  if (detected !== wait.format && wait.format !== "bin") {
    // mismatch — rename to detected
    const newPath = join(booksDir, `${md5}.${detected}`);
    await rename(wait.path, newPath);
    return { md5, path: newPath, format: detected, size_bytes: wait.size_bytes };
  }
  if (wait.format === "bin") {
    // user saved as .bin — rename to detected so extractor recognises it
    const newPath = join(booksDir, `${md5}.${detected}`);
    await rename(wait.path, newPath);
    return { md5, path: newPath, format: detected, size_bytes: wait.size_bytes };
  }
  return { md5, path: wait.path, format: wait.format, size_bytes: wait.size_bytes };
}

async function tryFastDownloadForHits(
  cfg: AnnasConfig,
  candidateHits: SearchHit[],
  booksDir: string,
): Promise<BookFile> {
  const errors: string[] = [];
  for (const hit of candidateHits) {
    const cached = await findCachedByMd5(hit.md5, booksDir);
    if (cached) return cached;
    for (const idx of [0, 1, 2, 3]) {
      try {
        const info = await getFastDownloadUrl(cfg, hit.md5, idx);
        const dest = join(booksDir, `${hit.md5}.${info.format}`);
        const dl = await downloadFile(info.direct_url, dest, { overwrite: false, timeoutMs: 300_000 });
        const detected = await detectMagic(dl.path);
        if (detected === "rtf" || detected === "html" || detected === "unknown") {
          await unlink(dl.path).catch(() => {});
          errors.push(`${hit.md5}@srv${idx}: bad payload (${detected})`);
          continue;
        }
        if (detected !== info.format) {
          const newPath = join(booksDir, `${hit.md5}.${detected}`);
          await rename(dl.path, newPath);
          return { md5: hit.md5, path: newPath, format: detected, size_bytes: dl.size_bytes };
        }
        return { md5: hit.md5, path: dl.path, format: info.format, size_bytes: dl.size_bytes };
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          // re-throw immediately — let caller decide watch vs fail
          throw err;
        }
        errors.push(`${hit.md5}@srv${idx}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  throw new Error(`all candidate hits failed (${candidateHits.length} books × 4 servers). Errors: ${errors.slice(-6).join(" | ")}`);
}

async function tryFastDownloadSingleMd5(
  cfg: AnnasConfig,
  md5: string,
  booksDir: string,
): Promise<BookFile> {
  const errors: string[] = [];
  for (const idx of [0, 1, 2, 3]) {
    try {
      const info = await getFastDownloadUrl(cfg, md5, idx);
      const dest = join(booksDir, `${md5}.${info.format}`);
      const dl = await downloadFile(info.direct_url, dest, { overwrite: false, timeoutMs: 300_000 });
      const detected = await detectMagic(dl.path);
      if (detected === "rtf" || detected === "html" || detected === "unknown") {
        await unlink(dl.path).catch(() => {});
        errors.push(`${md5}@srv${idx}: bad payload (${detected})`);
        continue;
      }
      if (detected !== info.format) {
        const newPath = join(booksDir, `${md5}.${detected}`);
        await rename(dl.path, newPath);
        return { md5, path: newPath, format: detected, size_bytes: dl.size_bytes };
      }
      return { md5, path: dl.path, format: info.format, size_bytes: dl.size_bytes };
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;
      errors.push(`${md5}@srv${idx}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`all partner servers failed for md5=${md5}. Errors: ${errors.slice(-4).join(" | ")}`);
}

async function resolveAndDownload(
  book: string,
  preferFormat?: BookSkillInput["prefer_format"],
  manualWaitMs?: number,
): Promise<BookFile> {
  const dataDir = process.env.DATA_DIR ?? join(homedir(), "tools/mcp-books/data");
  const booksDir = join(dataDir, "books");

  // Local file path — bypass everything
  const local = await asLocalFile(book);
  if (local) return local;

  const isMd5 = /^[a-f0-9]{32}$/i.test(book);
  const waitMs = manualWaitMs ?? 0;

  // Fast-path: md5 already cached
  if (isMd5) {
    const cached = await findCachedByMd5(book, booksDir);
    if (cached) return cached;
  }

  const cfg = loadConfigFromEnvSoft();

  if (isMd5) {
    // Direct md5 input
    if (cfg.accountKey) {
      try {
        return await tryFastDownloadSingleMd5(cfg, book, booksDir);
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          if (waitMs > 0) return await runWatchMode(book, booksDir, waitMs);
          throw new Error(`no key / quota exhausted; set manual_download_wait_ms > 0 to wait. underlying: ${err.message}`);
        }
        throw err;
      }
    }
    // No key at all
    if (waitMs > 0) return await runWatchMode(book, booksDir, waitMs);
    throw new Error("no ANNAS_ACCOUNT_KEY; set manual_download_wait_ms > 0 to wait for a manual download");
  }

  // Search path
  const hits = await searchBooks(cfg, book, 10, preferFormat);
  if (hits.length === 0) throw new Error(`no Anna's Archive results for: ${book}`);
  const priority: Record<string, number> = { epub: 1, pdf: 2, fb2: 3, txt: 4 };
  hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
  const candidateHits = hits.slice(0, 3);
  const targetMd5 = candidateHits[0].md5;

  if (cfg.accountKey) {
    try {
      return await tryFastDownloadForHits(cfg, candidateHits, booksDir);
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        if (waitMs > 0) return await runWatchMode(targetMd5, booksDir, waitMs);
        throw new Error(`no key / quota exhausted; set manual_download_wait_ms > 0 to wait. underlying: ${err.message}`);
      }
      throw err;
    }
  }
  // No key
  if (waitMs > 0) return await runWatchMode(targetMd5, booksDir, waitMs);
  throw new Error("no ANNAS_ACCOUNT_KEY; set manual_download_wait_ms > 0 to wait for a manual download");
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

  const envWait = parseInt(process.env.MANUAL_DOWNLOAD_WAIT_MS ?? "", 10);
  const waitMs = input.manual_download_wait_ms ?? (Number.isFinite(envWait) ? envWait : 600_000);
  const bookFile = await resolveAndDownload(input.book, input.prefer_format, waitMs);
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
