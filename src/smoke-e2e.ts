/**
 * smoke:e2e — exercises book_to_skill end-to-end through tool handlers (not MCP transport).
 *   npm run smoke:e2e -- "The Mom Test"
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { bookToSkill } from "./tools/book-to-skill.js";

const log = (...a: unknown[]): void => {
  process.stderr.write(
    a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n",
  );
};

async function main(): Promise<void> {
  const query = process.argv[2] ?? "The Mom Test Rob Fitzpatrick";
  log(`[smoke:e2e] query="${query}"`);
  const r = await bookToSkill({ query, max_text_chars: 800_000, temperature: 0.2 });
  log(r);
  if (r.audit) {
    log(`\nAUDIT: ${r.audit.passed ? "PASS" : "FAIL"}`);
    log(`  errors:   ${r.audit.error_count}`);
    log(`  warnings: ${r.audit.warning_count}`);
    log(`  passes:   ${r.audit.pass_count}`);
    if (r.audit.issues.length > 0) {
      log("issues:");
      for (const i of r.audit.issues) log(`  [${i.level}] ${i.rule}: ${i.message}`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke:e2e] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
