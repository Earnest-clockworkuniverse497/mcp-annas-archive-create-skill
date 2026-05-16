/**
 * book_to_skill — end-to-end flow: query/md5 → download → extract → Gemini → render → audit → save.
 *
 * Single MCP tool that turns a methodology book into a Claude Code SKILL.md compliant with
 * the skill-evaluation standard (Anthropic Agent Skills best practices).
 */
import { z } from "zod";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadConfigFromEnv as loadAnnas, searchBooks } from "../lib/annas-client.js";
import { extractBookText } from "../lib/epub-extractor.js";
import { generateText, loadGeminiConfigFromEnv } from "../lib/gemini-client.js";
import {
  isExtractionError,
  renderSkillMd,
  validateExtraction,
  type SkillExtraction,
} from "../lib/skill-renderer.js";
import { auditSkillMd, type AuditResult } from "../lib/skill-audit.js";
import { bookDownload } from "./book-download.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(HERE, "..", "prompts", "extract-skill.md");

export const BookToSkillInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("Either a book MD5 (32 hex chars) OR a search query (title, author, keywords)"),
  promote_to: z
    .string()
    .optional()
    .describe(
      "Optional absolute path to write the final SKILL.md (e.g. /home/user/.claude/skills/<name>/SKILL.md). " +
        "If omitted, only the draft in $DATA_DIR/skill-drafts/<name>/ is written.",
    ),
  max_text_chars: z
    .number()
    .int()
    .min(10000)
    .max(2_000_000)
    .default(800_000)
    .describe("Max text chars to send to Gemini (longer books are truncated)"),
  temperature: z.number().min(0).max(1).default(0.2),
});

export type BookToSkillInput = z.infer<typeof BookToSkillInputSchema>;

export interface BookToSkillOutput {
  ok: boolean;
  md5: string;
  query: string;
  book: {
    format: string;
    size_bytes: number;
    extracted_chars: number;
    text_sent_chars: number;
    truncated: boolean;
  };
  gemini: {
    model: string;
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
    finish_reason: string;
  };
  skill: {
    name: string;
    description_length: number;
    capability_count: number;
    citation_count: number;
  } | null;
  audit: AuditResult | null;
  paths: {
    book_file: string;
    draft_skill_md: string;
    draft_extraction_json: string;
    promoted_skill_md: string | null;
  };
  rejection?: {
    reason: string;
    detected_genre?: string;
  };
}

async function resolveMd5(query: string): Promise<{ md5: string; format_hint?: string }> {
  if (/^[a-f0-9]{32}$/i.test(query)) return { md5: query };
  const cfg = loadAnnas();
  const hits = await searchBooks(cfg, query, 10);
  if (hits.length === 0) throw new Error(`no Anna's Archive results for: ${query}`);
  const priority: Record<string, number> = { epub: 1, fb2: 2, pdf: 3, txt: 4 };
  hits.sort((a, b) => (priority[a.format] ?? 9) - (priority[b.format] ?? 9));
  return { md5: hits[0].md5, format_hint: hits[0].format };
}

function safeDataDir(): string {
  const env = process.env.DATA_DIR;
  if (env && env.length > 0) return env.startsWith("/") ? env : resolve(env);
  return join(homedir(), "tools/mcp-books/data");
}

function countCitations(skill: SkillExtraction): number {
  return skill.citations.length;
}

export async function bookToSkill(input: BookToSkillInput): Promise<BookToSkillOutput> {
  const { md5 } = await resolveMd5(input.query);

  const dl = await bookDownload({
    md5,
    server_index: 0,
    overwrite: false,
    try_fallback_servers: true,
  });

  const extracted = await extractBookText(dl.path);
  const text = extracted.text.slice(0, input.max_text_chars);
  const truncated = extracted.text.length > input.max_text_chars;

  const promptTemplate = await readFile(PROMPT_PATH, "utf-8");
  const geminiCfg = loadGeminiConfigFromEnv();

  const result = await generateText(
    geminiCfg,
    `${promptTemplate}\n\n---\nBOOK TEXT:\n---\n${text}`,
    { temperature: input.temperature, maxOutputTokens: 32768, jsonMode: true },
  );

  const dataDir = safeDataDir();
  const baseOut: BookToSkillOutput = {
    ok: false,
    md5,
    query: input.query,
    book: {
      format: dl.format,
      size_bytes: dl.size_bytes,
      extracted_chars: extracted.char_count,
      text_sent_chars: text.length,
      truncated,
    },
    gemini: {
      model: result.model,
      prompt_tokens: result.prompt_tokens,
      output_tokens: result.output_tokens,
      total_tokens: result.prompt_tokens + result.output_tokens,
      finish_reason: result.finish_reason,
    },
    skill: null,
    audit: null,
    paths: {
      book_file: dl.path,
      draft_skill_md: "",
      draft_extraction_json: "",
      promoted_skill_md: null,
    },
  };

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

  if (isExtractionError(parsed)) {
    baseOut.rejection = {
      reason: parsed.reason,
      detected_genre: parsed.detected_genre,
    };
    return baseOut;
  }

  const skill = validateExtraction(parsed);
  const skillMd = renderSkillMd(skill);
  const draftDir = join(dataDir, "skill-drafts", skill.name);
  await mkdir(draftDir, { recursive: true });

  const draftSkill = join(draftDir, "SKILL.md");
  const draftJson = join(draftDir, "extraction.json");
  await writeFile(draftJson, JSON.stringify(skill, null, 2), "utf-8");
  await writeFile(draftSkill, skillMd, "utf-8");

  const audit = auditSkillMd(skillMd);

  let promotedPath: string | null = null;
  if (input.promote_to) {
    if (!audit.passed) {
      throw new Error(
        `Cannot promote: audit has ${audit.error_count} errors. Issues: ${audit.issues
          .filter((i) => i.level === "error")
          .map((i) => `${i.rule}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const target = input.promote_to;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(draftSkill, target);
    promotedPath = target;
  }

  baseOut.ok = audit.passed;
  baseOut.skill = {
    name: skill.name,
    description_length: skill.description.length,
    capability_count: skill.capabilities.length,
    citation_count: countCitations(skill),
  };
  baseOut.audit = audit;
  baseOut.paths.draft_skill_md = draftSkill;
  baseOut.paths.draft_extraction_json = draftJson;
  baseOut.paths.promoted_skill_md = promotedPath;
  return baseOut;
}
