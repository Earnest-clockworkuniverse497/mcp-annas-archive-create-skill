/**
 * Smoke test — bypasses MCP transport, calls tool handlers directly.
 *   npm run smoke -- <md5>
 *   npm run smoke -- 85527824b047ed4868fbcc8dc55aa892
 *
 * Output goes to stderr so it never collides with MCP stdio.
 */
import "dotenv/config";
import { bookGetUrl } from "./tools/book-get-url.js";
import { bookDownload } from "./tools/book-download.js";

const log = (...args: unknown[]): void => {
  process.stderr.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ") + "\n");
};

const md5 = process.argv[2] ?? "85527824b047ed4868fbcc8dc55aa892";

async function main(): Promise<void> {
  log(`[smoke] md5=${md5}`);

  log("[smoke] step 1: book_get_download_url ...");
  const url = await bookGetUrl({ md5, server_index: 0 });
  log(url);

  log("[smoke] step 2: book_download ...");
  const dl = await bookDownload({
    md5,
    server_index: 0,
    overwrite: true,
    try_fallback_servers: true,
  });
  log(dl);

  log("[smoke] OK");
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
