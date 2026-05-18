import { fetch } from "undici";
import * as cheerio from "cheerio";
import { getAnnasDispatcher } from "./proxy.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FORMAT_RE = /\.(epub|pdf|mobi|djvu|fb2|azw3|azw|zip|cbz|cbr|txt)$/i;

export interface AnnasConfig {
  baseUrl: string;
  accountKey: string;
}

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export interface FastDownloadInfo {
  md5: string;
  server_index: number;
  direct_url: string;
  filename: string;
  format: string;
  partner_host: string;
  quota: {
    downloads_left: number;
    downloads_per_day: number;
    downloads_done_today: number;
  };
}

interface FastDownloadJsonResponse {
  download_url?: string | null;
  error?: string;
  account_fast_download_info?: {
    downloads_left: number;
    downloads_per_day: number;
    downloads_done_today: number;
  };
}

export interface BookMetadata {
  md5: string;
  title: string;
  authors: string;
  format: string;
  size_human: string;
  language: string;
}

export interface SearchHit {
  md5: string;
  title: string;
  authors: string;
  format: string;
  size_human: string;
}

function defaultHeaders(_cfg: AnnasConfig): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  };
}

export async function getFastDownloadUrl(
  cfg: AnnasConfig,
  md5: string,
  serverIndex = 0,
): Promise<FastDownloadInfo> {
  if (!/^[a-f0-9]{32}$/i.test(md5)) {
    throw new Error(`invalid md5: ${md5}`);
  }
  if (!cfg.accountKey) {
    throw new QuotaExhaustedError("no API key (ANNAS_ACCOUNT_KEY empty)");
  }
  const params = new URLSearchParams({
    md5,
    key: cfg.accountKey,
    path_index: "0",
    domain_index: String(serverIndex),
  });
  const url = `${cfg.baseUrl}/dyn/api/fast_download.json?${params.toString()}`;
  const res = await fetch(url, { headers: defaultHeaders(cfg), dispatcher: getAnnasDispatcher() });
  const text = await res.text();

  let data: FastDownloadJsonResponse;
  try {
    data = JSON.parse(text) as FastDownloadJsonResponse;
  } catch {
    throw new Error(`fast_download API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (data.error || !data.download_url) {
    if (data.error && /quota|limit|exhaust|exceed/i.test(data.error)) {
      throw new QuotaExhaustedError(data.error);
    }
    throw new Error(`fast_download API error: ${data.error ?? "no download_url returned"}`);
  }

  const direct = data.download_url;
  const u = new URL(direct);
  const filenameRaw = decodeURIComponent(u.pathname.split("/").pop() || "book");
  const formatMatch = filenameRaw.match(FORMAT_RE);
  const format = (formatMatch?.[1] ?? "bin").toLowerCase();
  const quota = data.account_fast_download_info ?? {
    downloads_left: -1,
    downloads_per_day: -1,
    downloads_done_today: -1,
  };

  if (data.account_fast_download_info?.downloads_left === 0) {
    throw new QuotaExhaustedError("daily download quota exhausted (downloads_left=0)");
  }

  return {
    md5,
    server_index: serverIndex,
    direct_url: direct,
    filename: filenameRaw,
    format,
    partner_host: u.host,
    quota,
  };
}

export async function getMetadata(cfg: AnnasConfig, md5: string): Promise<BookMetadata> {
  if (!/^[a-f0-9]{32}$/i.test(md5)) throw new Error(`invalid md5: ${md5}`);
  const url = `${cfg.baseUrl}/md5/${md5}`;
  const res = await fetch(url, { headers: defaultHeaders(cfg), dispatcher: getAnnasDispatcher() });
  if (res.status !== 200) throw new Error(`md5 page HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const title = $("div.text-3xl.font-bold").first().text().trim() || "(unknown)";
  const authors = $("div.italic").first().text().trim() || "(unknown)";
  const metaLine = $("div.text-sm.text-gray-500").first().text().trim();
  const formatMatch = metaLine.match(/\b(epub|pdf|mobi|djvu|fb2|azw3|azw|cbz|cbr|txt)\b/i);
  const sizeMatch = metaLine.match(/[\d.]+\s?(KB|MB|GB|B)/i);
  const langMatch = metaLine.match(/\b(English|Russian|Русский|German|French|Spanish|Italian|Polish|Chinese|Japanese)\b/i);

  return {
    md5,
    title,
    authors,
    format: formatMatch?.[1]?.toLowerCase() ?? "(unknown)",
    size_human: sizeMatch?.[0] ?? "(unknown)",
    language: langMatch?.[0] ?? "(unknown)",
  };
}

const FORMAT_WHITELIST = new Set(["epub", "fb2", "pdf", "txt", "?"]);

export async function searchBooks(
  cfg: AnnasConfig,
  query: string,
  limit = 10,
  preferFormat?: "epub" | "pdf" | "fb2" | "txt",
): Promise<SearchHit[]> {
  const url = `${cfg.baseUrl}/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: defaultHeaders(cfg), dispatcher: getAnnasDispatcher() });
  if (res.status !== 200) throw new Error(`search HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const hits: SearchHit[] = [];
  $("a[href^='/md5/']").each((_, el) => {
    if (hits.length >= limit) return false;
    const href = $(el).attr("href") ?? "";
    const md5Match = href.match(/\/md5\/([a-f0-9]{32})/);
    if (!md5Match) return;
    const md5 = md5Match[1];
    if (hits.find((h) => h.md5 === md5)) return;

    const block = $(el);
    const title = block.find("h3").first().text().trim() ||
                  block.find("div.font-bold").first().text().trim() ||
                  "(no title)";
    const authors = block.find("div.italic").first().text().trim() || "(unknown)";
    const meta = block.find("div.text-gray-500").first().text().trim();
    const fmt = meta.match(/\b(epub|pdf|mobi|djvu|fb2|azw3|txt)\b/i)?.[1] ?? "?";
    const size = meta.match(/[\d.]+\s?(KB|MB|GB)/i)?.[0] ?? "?";
    hits.push({ md5, title, authors, format: fmt.toLowerCase(), size_human: size });
  });

  const excluded: string[] = hits
    .filter((h) => !FORMAT_WHITELIST.has(h.format))
    .map((h) => h.format);
  if (excluded.length > 0) {
    const unique = [...new Set(excluded)].join(", ");
    process.stderr.write(`[annas] filtered ${excluded.length} hits (excluded: ${unique})\n`);
  }

  const filtered = hits.filter((h) => FORMAT_WHITELIST.has(h.format));

  if (!preferFormat) return filtered;

  const preferred = filtered.filter((h) => h.format === preferFormat);
  const rest = filtered.filter((h) => h.format !== preferFormat);
  return [...preferred, ...rest];
}

export function loadConfigFromEnv(): AnnasConfig {
  const baseUrl = process.env.ANNAS_BASE_URL ?? "https://annas-archive.gl";
  const accountKey = process.env.ANNAS_ACCOUNT_KEY ?? "";
  if (!accountKey) {
    throw new Error("ANNAS_ACCOUNT_KEY not set in env (member account key from annas-archive.gl)");
  }
  return { baseUrl, accountKey };
}

export function loadConfigFromEnvSoft(): AnnasConfig {
  const baseUrl = process.env.ANNAS_BASE_URL ?? "https://annas-archive.gl";
  const accountKey = process.env.ANNAS_ACCOUNT_KEY ?? "";
  return { baseUrl, accountKey };
}
