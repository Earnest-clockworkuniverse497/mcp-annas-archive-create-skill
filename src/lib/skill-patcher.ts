/**
 * Surgical patcher for SKILL.md.
 *
 * Inserts atomic additions into named sections WITHOUT rewriting existing content.
 * If a section does not exist, it is created before the next `## ` heading
 * (or appended at end-of-file).
 *
 * No LLM in this layer — purely deterministic string ops on parsed structure.
 */

export type AdditionType = "subsection" | "bullet" | "anti-pattern";
export type AdditionSection =
  | "Capabilities"
  | "Behavioral Traits"
  | "Important Constraints"
  | "Anti-patterns"
  | "Use this skill when"
  | "Do not use this skill when";

export interface Addition {
  section: AdditionSection;
  type: AdditionType;
  title?: string;
  body: string;
  citation?: { text: string; location: string };
}

export interface EnrichmentPayload {
  source_book: string;
  additions: Addition[];
  skipped_duplicates: string[];
}

interface SectionRange {
  found: boolean;
  start: number;
  contentStart: number;
  end: number;
}

function findSection(content: string, sectionName: string): SectionRange {
  const re = new RegExp(
    `^##\\s+${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im",
  );
  const m = re.exec(content);
  if (!m) {
    return { found: false, start: -1, contentStart: -1, end: -1 };
  }
  const start = m.index;
  const headerEnd = start + m[0].length;
  const contentStart = headerEnd + (content[headerEnd] === "\n" ? 1 : 0);
  const nextH2 = /^##\s+/m.exec(content.slice(headerEnd + 1));
  const end = nextH2 ? headerEnd + 1 + nextH2.index : content.length;
  return { found: true, start, contentStart, end };
}

function bookSlug(sourceBook: string): string {
  return sourceBook.split(/[—-]/)[0].trim();
}

function citationLine(addition: Addition, sourceBook: string): string {
  if (!addition.citation) return ` [${bookSlug(sourceBook)}]`;
  return `\n\n> ${addition.citation.text}  \n> — *${bookSlug(sourceBook)}, ${addition.citation.location}*`;
}

function formatSubsection(addition: Addition, sourceBook: string): string {
  const title = addition.title?.trim() ?? "Untitled";
  const body = addition.body.trim();
  return `\n### ${title} [${bookSlug(sourceBook)}]\n\n${body}${citationLine(addition, sourceBook)}\n`;
}

function formatBullet(addition: Addition, sourceBook: string): string {
  const body = addition.body.trim().replace(/\s+/g, " ");
  return `- ${body} [${bookSlug(sourceBook)}]`;
}

function formatAntiPattern(addition: Addition, sourceBook: string): string {
  const title = addition.title?.trim() ?? "Anti-pattern";
  const body = addition.body.trim();
  return `\n### ❌ ${title} [${bookSlug(sourceBook)}]\n\n${body}${citationLine(addition, sourceBook)}\n`;
}

function ensureSection(content: string, sectionName: string): string {
  if (findSection(content, sectionName).found) return content;
  const trimmed = content.replace(/\s+$/, "");
  return `${trimmed}\n\n## ${sectionName}\n`;
}

function insertIntoSection(content: string, sectionName: string, payload: string): string {
  const r = findSection(content, sectionName);
  if (!r.found) {
    return `${content.replace(/\s+$/, "")}\n\n## ${sectionName}\n${payload.trimEnd()}\n`;
  }
  const before = content.slice(0, r.end).replace(/\s+$/, "");
  const after = content.slice(r.end);
  return `${before}\n${payload.replace(/^\n+/, "").trimEnd()}\n${after.startsWith("\n") ? after : `\n${after}`}`;
}

export interface ApplyResult {
  patched: string;
  applied_count: number;
  by_section: Record<string, number>;
  warnings: string[];
}

export function applyAdditions(
  current: string,
  enrichment: EnrichmentPayload,
): ApplyResult {
  let out = current;
  const bySection: Record<string, number> = {};
  const warnings: string[] = [];
  let applied = 0;

  for (const addition of enrichment.additions) {
    if (!addition.body || addition.body.trim().length < 5) {
      warnings.push(`skipped addition with empty/short body for section ${addition.section}`);
      continue;
    }
    out = ensureSection(out, addition.section);

    let payload: string;
    if (addition.type === "subsection") {
      payload = formatSubsection(addition, enrichment.source_book);
    } else if (addition.type === "anti-pattern") {
      payload = formatAntiPattern(addition, enrichment.source_book);
    } else {
      payload = formatBullet(addition, enrichment.source_book);
    }

    out = insertIntoSection(out, addition.section, payload);
    bySection[addition.section] = (bySection[addition.section] ?? 0) + 1;
    applied += 1;
  }

  return { patched: out, applied_count: applied, by_section: bySection, warnings };
}

export function validateEnrichmentPayload(raw: unknown): EnrichmentPayload {
  if (Array.isArray(raw) && raw.length === 1) return validateEnrichmentPayload(raw[0]);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("enrichment payload is not an object");
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.additions)) throw new Error("payload.additions must be an array");
  if (typeof r.source_book !== "string") throw new Error("payload.source_book must be a string");

  const ALLOWED_SECTIONS: AdditionSection[] = [
    "Capabilities",
    "Behavioral Traits",
    "Important Constraints",
    "Anti-patterns",
    "Use this skill when",
    "Do not use this skill when",
  ];
  const ALLOWED_TYPES: AdditionType[] = ["subsection", "bullet", "anti-pattern"];

  const additions: Addition[] = [];
  for (const [i, a] of r.additions.entries()) {
    if (typeof a !== "object" || a === null) {
      throw new Error(`additions[${i}] is not an object`);
    }
    const ar = a as Record<string, unknown>;
    if (!ALLOWED_SECTIONS.includes(ar.section as AdditionSection)) {
      throw new Error(`additions[${i}].section "${String(ar.section)}" is not allowed`);
    }
    if (!ALLOWED_TYPES.includes(ar.type as AdditionType)) {
      throw new Error(`additions[${i}].type "${String(ar.type)}" is not allowed`);
    }
    if (typeof ar.body !== "string" || ar.body.length < 5) {
      throw new Error(`additions[${i}].body must be a non-trivial string`);
    }
    additions.push({
      section: ar.section as AdditionSection,
      type: ar.type as AdditionType,
      title: typeof ar.title === "string" ? ar.title : undefined,
      body: ar.body,
      citation:
        typeof ar.citation === "object" && ar.citation !== null
          ? {
              text: String((ar.citation as Record<string, unknown>).text ?? ""),
              location: String((ar.citation as Record<string, unknown>).location ?? ""),
            }
          : undefined,
    });
  }
  return {
    source_book: r.source_book,
    additions,
    skipped_duplicates: Array.isArray(r.skipped_duplicates)
      ? r.skipped_duplicates.map(String)
      : [],
  };
}
