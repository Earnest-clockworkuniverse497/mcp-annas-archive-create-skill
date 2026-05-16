import { z } from "zod";
import { join } from "node:path";
import { getFastDownloadUrl, loadConfigFromEnv } from "../lib/annas-client.js";
import { downloadFile } from "../lib/downloader.js";

export const BookDownloadInputSchema = z.object({
  md5: z
    .string()
    .regex(/^[a-f0-9]{32}$/i, "must be a 32-char hex md5")
    .describe("MD5 hash of the book on Anna's Archive"),
  server_index: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(0)
    .describe("Fast Partner Server index 0-10"),
  overwrite: z
    .boolean()
    .default(false)
    .describe("If true, re-download even if local file exists"),
  output_dir: z
    .string()
    .optional()
    .describe("Override download directory (default: $DATA_DIR/books)"),
  try_fallback_servers: z
    .boolean()
    .default(true)
    .describe("If primary server_index fails, sequentially try the next 3 partner servers"),
});

export type BookDownloadInput = z.infer<typeof BookDownloadInputSchema>;

export interface BookDownloadOutput {
  ok: true;
  md5: string;
  path: string;
  size_bytes: number;
  bytes_per_sec: number;
  filename: string;
  format: string;
  partner_host: string;
  server_index_used: number;
  cached: boolean;
}

function booksDir(override?: string): string {
  if (override) return override;
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  return join(dataDir, "books");
}

export async function bookDownload(input: BookDownloadInput): Promise<BookDownloadOutput> {
  const cfg = loadConfigFromEnv();
  const dir = booksDir(input.output_dir);

  const indices: number[] = input.try_fallback_servers
    ? [input.server_index, input.server_index + 1, input.server_index + 2, input.server_index + 3].filter(
        (i) => i >= 0 && i <= 10,
      )
    : [input.server_index];

  let lastErr: unknown;
  for (const idx of indices) {
    try {
      const info = await getFastDownloadUrl(cfg, input.md5, idx);
      const destPath = join(dir, `${input.md5}.${info.format}`);
      const result = await downloadFile(info.direct_url, destPath, {
        overwrite: input.overwrite,
        timeoutMs: 300_000,
      });
      const cached = result.bytes_per_sec === 0;
      return {
        ok: true,
        md5: input.md5,
        path: result.path,
        size_bytes: result.size_bytes,
        bytes_per_sec: result.bytes_per_sec,
        filename: info.filename,
        format: info.format,
        partner_host: info.partner_host,
        server_index_used: idx,
        cached,
      };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw new Error(
    `all partner servers failed for md5=${input.md5}. last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export const BOOK_DOWNLOAD_TOOL = {
  name: "book_download",
  description:
    "Downloads a book from Anna's Archive by MD5. Resolves Fast-downloads no-redirect URL, then streams the file to $DATA_DIR/books/<md5>.<ext>. Idempotent: if file exists and overwrite=false, returns cached path. With try_fallback_servers=true, will retry on next 3 partner servers if the primary one fails.",
  inputSchema: {
    type: "object",
    properties: {
      md5: { type: "string", pattern: "^[a-fA-F0-9]{32}$", description: "Book MD5 (32 hex)" },
      server_index: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        default: 0,
        description: "Primary partner server 0-10",
      },
      overwrite: {
        type: "boolean",
        default: false,
        description: "Re-download even if cached locally",
      },
      output_dir: {
        type: "string",
        description: "Override download dir (default $DATA_DIR/books)",
      },
      try_fallback_servers: {
        type: "boolean",
        default: true,
        description: "Try next 3 servers on failure",
      },
    },
    required: ["md5"],
  },
} as const;
