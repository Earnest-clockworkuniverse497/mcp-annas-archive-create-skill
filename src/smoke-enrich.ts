/**
 * smoke:enrich — exercises book_enrich_skill on a controlled test SKILL.md.
 *   npm run smoke:enrich -- "<book query>" [path/to/SKILL.md]
 *
 * Defaults: enriches /tmp/test-skill.md (created on first run) with
 * "Designing Data-Intensive Applications Kleppmann".
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { writeFile, stat } from "node:fs/promises";
import { bookEnrichSkill } from "./tools/book-enrich-skill.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

const SEED_SKILL = `---
name: test-architect-seed
description: "Senior architect for greenfield projects. Phase-based methodology for non-tech client onboarding: requirements, architecture, structure, deployment. Use when: greenfield, новый проект с нуля, plan a system, architect a service. SKIP: refactor (→refactoring), single feature in existing project (→feature-planner)."
---

## Use this skill when

- User has a fresh idea, not a codebase
- Stack not chosen yet

## Do not use this skill when

- Refactor of existing code
- Single bug fix

## Purpose

Onboards a non-technical client from idea to ready-to-execute task DAG. Produces an architecture, file structure, and risk plan. Hand-off to an orchestrator for implementation.

## Capabilities

### Requirements gathering

Discover what the client actually needs. Ask about past behaviour, not hypothetical future preferences.

### Stack selection

Pick from a preloaded skill stack first; deviate only when task requires it.

### Risk identification

List specific technical, security, operational, and business risks. No generic boilerplate.

## Behavioral Traits

- Asks ≤3 questions per chat turn
- Defaults to known stack
- Writes artifacts to disk so progress is recoverable

## Important Constraints

- NEVER edit production code — write artifacts only
- ALWAYS check package versions before recommending
`;

async function ensureSeedSkill(path: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    await writeFile(path, SEED_SKILL, "utf-8");
    log(`[smoke:enrich] seeded ${path}`);
  }
}

async function main(): Promise<void> {
  const query = process.argv[2] ?? "Designing Data-Intensive Applications Kleppmann";
  const skillPath = process.argv[3] ?? "/tmp/test-skill.md";
  await ensureSeedSkill(skillPath);

  log(`[smoke:enrich] skill=${skillPath}`);
  log(`[smoke:enrich] book="${query}"`);
  log(`[smoke:enrich] dry_run=true (no write)`);

  const r = await bookEnrichSkill({
    skill_path: skillPath,
    book_query: query,
    focus: "architecture decisions, distributed systems pitfalls",
    dry_run: true,
    max_text_chars: 800_000,
    temperature: 0.2,
  });
  log(r);

  log(`\n=== SUMMARY ===`);
  log(`source_book:           ${r.source_book}`);
  log(`additions:             ${r.additions_count}`);
  log(`by section:            ${JSON.stringify(r.additions_by_section)}`);
  log(`skipped duplicates:    ${r.skipped_duplicates.length}`);
  log(`audit before:          passed=${r.audit_before.passed} errs=${r.audit_before.error_count} warns=${r.audit_before.warning_count}`);
  log(`audit after:           passed=${r.audit_after.passed} errs=${r.audit_after.error_count} warns=${r.audit_after.warning_count}`);
  log(`tokens:                p=${r.gemini.prompt_tokens} o=${r.gemini.output_tokens}`);
  log(`rolled back:           ${r.rolled_back}`);

  if (r.patched_preview) {
    const previewPath = "/tmp/test-skill.enriched-preview.md";
    await writeFile(previewPath, r.patched_preview, "utf-8");
    log(`\npreview saved to: ${previewPath}`);
    log(`  diff:  diff ${skillPath} ${previewPath} | head -100`);
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke:enrich] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
