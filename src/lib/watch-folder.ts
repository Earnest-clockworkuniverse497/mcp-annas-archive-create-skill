import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

export interface WaitResult {
  path: string;
  format: string;
  size_bytes: number;
}

const POLL_INTERVAL_MS = 2000;
const TICK_EVERY_N_POLLS = 15; // 15 × 2 s = 30 s
const ALLOWED_EXTS = new Set(["epub", "fb2", "pdf", "txt", "bin"]);

export async function waitForBook(
  booksDir: string,
  md5: string,
  timeoutMs: number,
  onTick?: (elapsedMs: number, remainingMs: number) => void,
): Promise<WaitResult | null> {
  if (timeoutMs <= 0) return null;

  const start = Date.now();
  const prefix = md5 + ".";

  let pendingPath: string | null = null;
  let pendingSize = -1;
  let pollCount = 0;

  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) return null;

    // Notify every 30 seconds (every TICK_EVERY_N_POLLS polls)
    if (pollCount > 0 && pollCount % TICK_EVERY_N_POLLS === 0 && onTick) {
      onTick(elapsed, timeoutMs - elapsed);
    }

    // Read directory
    let entries;
    try {
      entries = await readdir(booksDir, { withFileTypes: true });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      // Other errors: reset pending and continue
      pendingPath = null;
      pendingSize = -1;
      pollCount++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Find first matching candidate
    const candidate = entries
      .filter((ent) => ent.isFile() && ent.name.startsWith(prefix))
      .map((ent) => ent.name)
      .sort()
      .find((name) => {
        const ext = extname(name).slice(1).toLowerCase();
        return ALLOWED_EXTS.has(ext);
      });

    if (candidate) {
      const fullPath = join(booksDir, candidate);
      let fileSize: number;
      try {
        const s = await stat(fullPath);
        fileSize = s.size;
      } catch {
        // File disappeared between readdir and stat
        pendingPath = null;
        pendingSize = -1;
        pollCount++;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (fileSize > 0) {
        if (pendingPath === fullPath && pendingSize === fileSize) {
          // Stable — return result
          const format = extname(candidate).slice(1).toLowerCase();
          return { path: fullPath, format, size_bytes: fileSize };
        }
        // First sighting or size changed — record and wait another tick
        pendingPath = fullPath;
        pendingSize = fileSize;
      } else {
        // Size is 0 — not ready yet
        pendingPath = null;
        pendingSize = -1;
      }
    } else {
      pendingPath = null;
      pendingSize = -1;
    }

    pollCount++;
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
