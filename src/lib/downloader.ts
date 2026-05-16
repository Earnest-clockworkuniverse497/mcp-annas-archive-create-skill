import { fetch } from "undici";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface DownloadResult {
  path: string;
  size_bytes: number;
  bytes_per_sec: number;
}

export async function downloadFile(
  url: string,
  destPath: string,
  opts: { overwrite?: boolean; timeoutMs?: number } = {},
): Promise<DownloadResult> {
  await mkdir(dirname(destPath), { recursive: true });

  if (!opts.overwrite) {
    try {
      const s = await stat(destPath);
      if (s.size > 0) {
        return { path: destPath, size_bytes: s.size, bytes_per_sec: 0 };
      }
    } catch {
      // not exists, proceed
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 300_000);

  const t0 = Date.now();
  let bytes = 0;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (res.status !== 200 || !res.body) {
      throw new Error(`download HTTP ${res.status}`);
    }
    const fileStream = createWriteStream(destPath);
    const reader = Readable.fromWeb(res.body as never);
    reader.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    await pipeline(reader, fileStream);
  } finally {
    clearTimeout(timeout);
  }

  const elapsed = (Date.now() - t0) / 1000;
  return {
    path: destPath,
    size_bytes: bytes,
    bytes_per_sec: elapsed > 0 ? Math.round(bytes / elapsed) : 0,
  };
}
