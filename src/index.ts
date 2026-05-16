#!/usr/bin/env node
/**
 * mcp-books — MCP server for Anna's Archive → Claude Code skill pipeline.
 *
 * Tools (v0.3.0, consolidated):
 *   book_skill   — unified modal tool: create | enrich | preview
 *   skill_audit  — standalone auditor for any SKILL.md
 *
 * Env (required):
 *   ANNAS_ACCOUNT_KEY  — member secret key from annas-archive.gl
 *   GEMINI_API_KEY     — Google AI Studio key
 *
 * Env (optional):
 *   ANNAS_BASE_URL     — default https://annas-archive.gl
 *   ANNAS_HTTPS_PROXY  — http/https/socks5 proxy for Anna's traffic only
 *   GEMINI_MODEL       — default gemini-3-flash-preview
 *   DATA_DIR           — default ./data
 */

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bookSkill } from "./tools/book-skill.js";
import { skillAudit } from "./tools/skill-audit-tool.js";
import { describeProxy } from "./lib/proxy.js";

const server = new McpServer({
  name: "mcp-books",
  version: "0.3.0",
});

server.registerTool(
  "book_skill",
  {
    title: "Book → Claude Code skill (create / enrich / preview)",
    description:
      "Unified pipeline. Search Anna's Archive (or accept md5) → download → extract text (epub/fb2/pdf/txt) → Gemini extracts methodology as strict JSON → render or patch SKILL.md → audit against the Claude Code skill-evaluation standard. " +
      "mode='create' makes a new SKILL.md and optionally promotes to `promote_to` (gated by audit). " +
      "mode='enrich' surgically inserts NEW additions into an existing SKILL.md at `skill_path` (auto-rollback if audit worsens). " +
      "mode='preview' returns analysis + proposed additions or full SKILL.md preview WITHOUT writing — use for interactive review before deciding. " +
      "Rejects non-methodology books (fiction/folklore) with an explicit reason instead of inventing.",
    inputSchema: {
      mode: z
        .enum(["create", "enrich", "preview"])
        .describe("create | enrich | preview"),
      book: z
        .string()
        .min(2)
        .describe(
          "One of: (1) absolute path to a local file (.epub/.fb2/.pdf/.txt) — Anna's Archive is NOT called; (2) Book MD5 (32 hex chars); (3) search query (title, author, keywords).",
        ),
      skill_path: z
        .string()
        .optional()
        .describe("Required for mode=enrich. Optional for mode=preview (provides context for diff vs an existing skill)."),
      promote_to: z
        .string()
        .optional()
        .describe("mode=create only. Absolute path; copies generated SKILL.md here ONLY if audit passes 0 errors."),
      focus: z
        .string()
        .optional()
        .describe("Optional focus hint (e.g. 'sales discovery', 'distributed systems decisions')"),
      dry_run: z
        .boolean()
        .default(false)
        .describe("mode=create|enrich only. If true, computes everything but does NOT write the final file."),
      max_text_chars: z
        .number()
        .int()
        .min(10000)
        .max(2_000_000)
        .default(800_000)
        .describe("Max characters of book text sent to Gemini"),
      temperature: z.number().min(0).max(1).default(0.2),
    },
  },
  async (args) => {
    const result = await bookSkill(args as Parameters<typeof bookSkill>[0]);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "skill_audit",
  {
    title: "Audit any SKILL.md against the Claude Code skill-evaluation standard",
    // guardian: allow
    description:
      "Runs the embedded skill-evaluation audit on any SKILL.md file. Checks: description length 150-400 with trigger terms + SKIP edges, kebab-case name without -pro/-expert/-specialist suffix, required sections present (Use this skill when / Do not use this skill when / Purpose / Capabilities / Behavioral Traits / Important Constraints), SKILL.md ≤ 500 lines (else Pattern 2 warning), no placeholder prose (banned tokens listed in src/lib/skill-audit.ts), no time-sensitive phrases, ≥3 capability subsections with body, NEVER/ALWAYS markers in constraints. Returns issues (error|warning) + passes. Reusable beyond books — works for any hand-written or LLM-generated skill.",
    inputSchema: {
      skill_path: z.string().describe("Absolute path to SKILL.md"),
      show_passes: z.boolean().default(false).describe("Include passed checks in output (default: only issues)"),
    },
  },
  async ({ skill_path, show_passes }) => {
    const result = await skillAudit({ skill_path, show_passes });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

async function main(): Promise<void> {
  if (!process.env.ANNAS_ACCOUNT_KEY) {
    console.error("ERROR: ANNAS_ACCOUNT_KEY is required in .env");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-books v0.3.0 running via stdio (Anna's proxy: ${describeProxy()})`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
