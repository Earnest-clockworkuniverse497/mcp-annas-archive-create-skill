/**
 * Unified smoke — exercises book_skill with all 3 modes.
 *   npm run smoke -- create  "The Mom Test"
 *   npm run smoke -- preview "Software Requirements Wiegers"  /path/to/SKILL.md
 *   npm run smoke -- enrich  "User Story Mapping Patton"      /tmp/test-skill.md
 *
 * Output goes to stderr to never collide with MCP stdio.
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { bookSkill } from "./tools/book-skill.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

async function main(): Promise<void> {
  const mode = (process.argv[2] as "create" | "enrich" | "preview") ?? "preview";
  const book = process.argv[3] ?? "The Mom Test Rob Fitzpatrick";
  const skillPath = process.argv[4];

  if ((mode === "enrich" || mode === "preview") && !skillPath) {
    log("usage: npm run smoke -- <mode> <book-query-or-md5> [skill_path]");
    if (mode === "enrich") process.exit(1);
  }

  log(`[smoke] mode=${mode} book="${book}" skill_path=${skillPath ?? "<none>"}`);

  const r = await bookSkill({
    mode,
    book,
    skill_path: skillPath,
    dry_run: mode !== "create",
    max_text_chars: 800_000,
    temperature: 0.2,
  });
  log(r);
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
