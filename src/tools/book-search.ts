import { z } from "zod";
import { loadConfigFromEnv, searchBooks } from "../lib/annas-client.js";

export const BookSearchInputSchema = z.object({
  query: z.string().min(2).describe("Search query — title, author, ISBN, or keywords"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max hits to return"),
});

export type BookSearchInput = z.infer<typeof BookSearchInputSchema>;

export interface BookSearchOutput {
  ok: true;
  query: string;
  hit_count: number;
  hits: Array<{
    md5: string;
    title: string;
    authors: string;
    format: string;
    size_human: string;
  }>;
}

export async function bookSearch(input: BookSearchInput): Promise<BookSearchOutput> {
  const cfg = loadConfigFromEnv();
  const hits = await searchBooks(cfg, input.query, input.limit);
  return {
    ok: true,
    query: input.query,
    hit_count: hits.length,
    hits,
  };
}
