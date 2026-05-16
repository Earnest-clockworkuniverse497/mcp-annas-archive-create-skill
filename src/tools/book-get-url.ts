import { z } from "zod";
import { getFastDownloadUrl, loadConfigFromEnv } from "../lib/annas-client.js";

export const BookGetUrlInputSchema = z.object({
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
    .describe("Fast Partner Server index (0-10). Try next on failure."),
});

export type BookGetUrlInput = z.infer<typeof BookGetUrlInputSchema>;

export interface BookGetUrlOutput {
  ok: true;
  md5: string;
  direct_url: string;
  filename: string;
  format: string;
  partner_host: string;
  server_index: number;
}

export async function bookGetUrl(input: BookGetUrlInput): Promise<BookGetUrlOutput> {
  const cfg = loadConfigFromEnv();
  const info = await getFastDownloadUrl(cfg, input.md5, input.server_index);
  return {
    ok: true,
    md5: info.md5,
    direct_url: info.direct_url,
    filename: info.filename,
    format: info.format,
    partner_host: info.partner_host,
    server_index: info.server_index,
  };
}

export const BOOK_GET_URL_TOOL = {
  name: "book_get_download_url",
  description:
    "Extracts the direct 'Fast downloads — no redirect' URL from Anna's Archive for a given MD5. Returns the partner-server URL ready for HTTP GET. Auth via account_key + cookies set in env. Try server_index 0 first; on failure increment up to 10.",
  inputSchema: {
    type: "object",
    properties: {
      md5: { type: "string", pattern: "^[a-fA-F0-9]{32}$", description: "Book MD5 (32 hex chars)" },
      server_index: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        default: 0,
        description: "Partner server 0-10",
      },
    },
    required: ["md5"],
  },
} as const;
