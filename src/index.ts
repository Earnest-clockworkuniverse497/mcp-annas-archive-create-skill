#!/usr/bin/env node
/**
 * mcp-books — MCP server for Anna's Archive book retrieval.
 *
 * Tools:
 *   book_get_download_url — resolve Fast downloads (no redirect) URL by MD5
 *   book_download         — download the file to $DATA_DIR/books/<md5>.<ext>
 *
 * Env (required):
 *   ANNAS_COOKIE_AA_ACCOUNT_ID2  — member auth cookie
 *
 * Env (optional):
 *   ANNAS_BASE_URL               — default https://annas-archive.gl
 *   ANNAS_ACCOUNT_KEY            — long-form account_id (reserved for future use)
 *   ANNAS_COOKIE_DDG{1,8,9,10}_  — anti-DDoS cookies
 *   DATA_DIR                     — default ./data
 */

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bookGetUrl } from "./tools/book-get-url.js";
import { bookDownload } from "./tools/book-download.js";
import { bookSearch } from "./tools/book-search.js";
import { bookToSkill } from "./tools/book-to-skill.js";
import { skillAudit } from "./tools/skill-audit-tool.js";

const server = new McpServer({
  name: "mcp-books",
  version: "0.1.0",
});

server.registerTool(
  "book_get_download_url",
  {
    title: "Get direct book download URL",
    description:
      "Resolves the 'Fast downloads — no redirect' direct URL from Anna's Archive for a given book MD5. Requires member auth via cookies in env. Returns the partner-server URL ready for HTTP GET, plus filename, format and partner host. If server_index N fails, retry with N+1 (up to 10).",
    inputSchema: {
      md5: z
        .string()
        .regex(/^[a-fA-F0-9]{32}$/, "must be a 32-char hex md5")
        .describe("Book MD5 (32 hex chars). Find on annas-archive.gl URL /md5/<hash>"),
      server_index: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(0)
        .describe("Fast Partner Server index 0-10. Try 0 first; servers 0-5 marked 'recommended'."),
    },
  },
  async ({ md5, server_index }) => {
    const result = await bookGetUrl({ md5, server_index });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "book_download",
  {
    title: "Download book by MD5",
    description:
      "Downloads a book from Anna's Archive by MD5. Resolves the Fast-downloads no-redirect URL, then streams the file to $DATA_DIR/books/<md5>.<ext>. Idempotent (returns cached path if file already exists and overwrite=false). With try_fallback_servers=true, retries on next 3 partner servers if the primary fails.",
    inputSchema: {
      md5: z
        .string()
        .regex(/^[a-fA-F0-9]{32}$/, "must be a 32-char hex md5")
        .describe("Book MD5 (32 hex chars)"),
      server_index: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(0)
        .describe("Primary Fast Partner Server index 0-10"),
      overwrite: z
        .boolean()
        .default(false)
        .describe("If true, re-download even if local file exists"),
      output_dir: z
        .string()
        .optional()
        .describe("Override download dir (default $DATA_DIR/books)"),
      try_fallback_servers: z
        .boolean()
        .default(true)
        .describe("On failure, sequentially try the next 3 partner servers"),
    },
  },
  async ({ md5, server_index, overwrite, output_dir, try_fallback_servers }) => {
    const result = await bookDownload({
      md5,
      server_index,
      overwrite,
      output_dir,
      try_fallback_servers,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "book_search",
  {
    title: "Search Anna's Archive",
    description:
      "Searches Anna's Archive for books matching a query (title, author, ISBN, keywords). Returns up to N hits with md5/title/authors/format. Use to find a book before downloading.",
    inputSchema: {
      query: z.string().min(2).describe("Title, author, ISBN, or keywords"),
      limit: z.number().int().min(1).max(50).default(10).describe("Max hits (1-50)"),
    },
  },
  async ({ query, limit }) => {
    const result = await bookSearch({ query, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "book_to_skill",
  {
    title: "Book → Claude Code SKILL.md (end-to-end)",
    description:
      "End-to-end pipeline: search/download Anna's Archive book → extract text (epub/fb2/pdf/txt) → Gemini extracts methodology as structured JSON → render SKILL.md → audit against Claude Code skill-evaluation standard. If `promote_to` is set AND audit passes, copies the SKILL.md to that path. Otherwise leaves draft in $DATA_DIR/skill-drafts/<name>/. Rejects non-methodology books (fiction/folklore) with explicit reason.",
    inputSchema: {
      query: z
        .string()
        .min(2)
        .describe("Book MD5 (32 hex) OR a search query (title, author, keywords)"),
      promote_to: z
        .string()
        .optional()
        .describe("Optional absolute path for the final SKILL.md (e.g. ~/.claude/skills/book-<slug>/SKILL.md). Only copies if audit passes."),
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
  async ({ query, promote_to, max_text_chars, temperature }) => {
    const result = await bookToSkill({ query, promote_to, max_text_chars, temperature });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "skill_audit",
  {
    title: "Audit any SKILL.md against Claude Code standard",
    description:
      "Runs the skill-evaluation audit checklist on any SKILL.md file: description length 150-400, required sections present, no placeholder prose, no time-sensitive phrases, kebab-case name, line cap 500, capability subsections present. Returns issues + passes. Use to validate a hand-written or generated skill.",
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
  console.error("mcp-books MCP server running via stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
