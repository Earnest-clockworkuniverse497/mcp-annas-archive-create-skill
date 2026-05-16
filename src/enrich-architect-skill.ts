/**
 * Enriches ~/.claude/skills/project-architecting/SKILL.md using JSON extractions
 * from data/skill-drafts/{book-mom-test, book-software-requirements, book-user-story-mapping}/extraction.json.
 *
 *   npm run enrich:architect
 *
 * Output:
 *   - new SKILL.md saved to ~/.claude/skills/project-architecting/SKILL.md.enriched (review before promote)
 *   - backup of current saved to ~/.claude/skills/project-architecting/SKILL.md.bak-<ts>
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateText, loadGeminiConfigFromEnv } from "./lib/gemini-client.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

const HERE = dirname(fileURLToPath(import.meta.url));

const ARCHITECT_SKILL_PATH = join(homedir(), ".claude/skills/project-architecting/SKILL.md");
const DRAFT_DIR = join(process.env.DATA_DIR ?? join(homedir(), "tools/mcp-books/data"), "skill-drafts");
const BOOKS = ["book-mom-test", "book-software-requirements", "book-user-story-mapping"];

async function main(): Promise<void> {
  log("[enrich] loading current architect skill ...");
  const currentSkill = await readFile(ARCHITECT_SKILL_PATH, "utf-8");
  log(`[enrich] current SKILL.md: ${currentSkill.length} chars, ${currentSkill.split("\n").length} lines`);

  log("[enrich] loading book extractions ...");
  const extractions: Array<{ slug: string; data: unknown }> = [];
  for (const slug of BOOKS) {
    const raw = await readFile(join(DRAFT_DIR, slug, "extraction.json"), "utf-8");
    extractions.push({ slug, data: JSON.parse(raw) });
    log(`  loaded ${slug}`);
  }

  const promptPath = resolve(HERE, "prompts", "enrich-skill.md");
  const promptTemplate = await readFile(promptPath, "utf-8");

  const userMessage = [
    promptTemplate,
    "",
    "## CURRENT SKILL.md",
    "",
    currentSkill,
    "",
    "## BOOK EXTRACTIONS",
    "",
    ...extractions.map((e) => `### ${e.slug}\n\n\`\`\`json\n${JSON.stringify(e.data, null, 2)}\n\`\`\`\n`),
  ].join("\n");

  const geminiCfg = loadGeminiConfigFromEnv();
  log(`[enrich] calling Gemini ${geminiCfg.model} ...  input chars=${userMessage.length}`);

  const result = await generateText(geminiCfg, userMessage, {
    temperature: 0.25,
    maxOutputTokens: 32768,
  });
  log(`[enrich] tokens: prompt=${result.prompt_tokens} output=${result.output_tokens} total=${result.prompt_tokens + result.output_tokens} finish=${result.finish_reason}`);
  log(`[enrich] est cost (flash-preview): $${(result.prompt_tokens * 0.3e-6 + result.output_tokens * 2.5e-6).toFixed(4)}`);

  let enriched = result.text.trim();
  const fenceStart = enriched.match(/^```(?:markdown|md)?\s*\n/);
  if (fenceStart) enriched = enriched.slice(fenceStart[0].length);
  if (enriched.endsWith("```")) enriched = enriched.slice(0, -3).trimEnd();

  if (!enriched.startsWith("---")) {
    log(`[enrich] WARNING: output does not start with frontmatter '---'. First 200 chars:\n${enriched.slice(0, 200)}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${ARCHITECT_SKILL_PATH}.bak-${ts}`;
  await copyFile(ARCHITECT_SKILL_PATH, backupPath);
  log(`[enrich] backed up current → ${backupPath}`);

  const enrichedPath = `${ARCHITECT_SKILL_PATH}.enriched`;
  await writeFile(enrichedPath, enriched, "utf-8");
  log(`[enrich] enriched draft saved → ${enrichedPath}`);
  log(`[enrich] size: ${enriched.length} chars, ${enriched.split("\n").length} lines`);

  process.stdout.write("\n========== DIFF SUMMARY ==========\n");
  process.stdout.write(`current:  ${currentSkill.length} chars, ${currentSkill.split("\n").length} lines\n`);
  process.stdout.write(`enriched: ${enriched.length} chars, ${enriched.split("\n").length} lines\n`);
  process.stdout.write(`backup:   ${backupPath}\n`);
  process.stdout.write(`draft:    ${enrichedPath}\n`);
  process.stdout.write(`\nReview, then promote with:\n  mv ${enrichedPath} ${ARCHITECT_SKILL_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`[enrich] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
