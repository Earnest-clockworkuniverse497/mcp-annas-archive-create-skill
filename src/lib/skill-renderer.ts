export interface SkillExtraction {
  name: string;
  description: string;
  stacks: string[];
  tags: string[];
  source: string;
  purpose_paragraph: string;
  use_when: string[];
  do_not_use_when: string[];
  capabilities: Array<{
    name: string;
    body: string;
    key_questions_or_steps: string[];
  }>;
  behavioral_traits: string[];
  important_constraints: string[];
  anti_patterns: Array<{ name: string; why_wrong: string; fix: string }>;
  citations: Array<{ text: string; location: string }>;
  related_skills: string[];
}

export interface ExtractionError {
  error: "not_methodology";
  reason: string;
  detected_genre: string;
}

export function isExtractionError(v: unknown): v is ExtractionError {
  return typeof v === "object" && v !== null && "error" in v && (v as { error?: unknown }).error === "not_methodology";
}

function bullets(items: string[]): string {
  return items.map((s) => `- ${s.trim()}`).join("\n");
}

function frontmatter(s: SkillExtraction): string {
  const lines = [
    "---",
    `name: ${s.name}`,
    `description: "${s.description.replace(/"/g, '\\"')}"`,
    "stacks:",
    ...s.stacks.map((x) => `  - ${x}`),
    "tags:",
    ...s.tags.map((x) => `  - ${x}`),
    `source: ${s.source}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

export function renderSkillMd(s: SkillExtraction): string {
  const parts: string[] = [];
  parts.push(frontmatter(s));

  parts.push("## Use this skill when\n");
  parts.push(bullets(s.use_when));
  parts.push("");

  parts.push("## Do not use this skill when\n");
  parts.push(bullets(s.do_not_use_when));
  parts.push("");

  parts.push("## Purpose\n");
  parts.push(s.purpose_paragraph);
  parts.push("");

  parts.push("## Capabilities\n");
  for (const cap of s.capabilities) {
    parts.push(`### ${cap.name}\n`);
    parts.push(cap.body);
    if (Array.isArray(cap.key_questions_or_steps) && cap.key_questions_or_steps.length > 0) {
      parts.push("");
      parts.push("Concrete items from the source:");
      parts.push(bullets(cap.key_questions_or_steps));
    }
    parts.push("");
  }

  parts.push("## Behavioral Traits\n");
  parts.push(bullets(s.behavioral_traits));
  parts.push("");

  parts.push("## Important Constraints\n");
  parts.push(bullets(s.important_constraints));
  parts.push("");

  parts.push("## Anti-patterns\n");
  for (const ap of s.anti_patterns) {
    parts.push(`### ❌ ${ap.name}\n`);
    parts.push(`**Why wrong:** ${ap.why_wrong}`);
    parts.push("");
    parts.push(`**Fix:** ${ap.fix}`);
    parts.push("");
  }

  parts.push("## Citations from source\n");
  for (const c of s.citations) {
    parts.push(`> ${c.text}  \n> — *${c.location}*`);
    parts.push("");
  }

  if (s.related_skills.length > 0) {
    parts.push("## Related Skills\n");
    parts.push(bullets(s.related_skills.map((x) => `\`${x}\``)));
    parts.push("");
  }

  return parts.join("\n");
}

export function validateExtraction(raw: unknown): SkillExtraction {
  if (Array.isArray(raw)) {
    if (raw.length === 1) {
      return validateExtraction(raw[0]);
    }
    throw new Error(`extraction is an array of ${raw.length} items, expected single object`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("extraction is not an object");
  }
  const r = raw as Record<string, unknown>;
  const required = [
    "name", "description", "stacks", "tags", "source",
    "purpose_paragraph", "use_when", "do_not_use_when",
    "capabilities", "behavioral_traits", "important_constraints",
    "anti_patterns", "citations", "related_skills",
  ];
  for (const k of required) {
    if (!(k in r)) throw new Error(`missing field: ${k}`);
  }
  const desc = String(r.description ?? "");
  if (desc.length < 150) throw new Error(`description too short (${desc.length}) — need ≥150 chars`);
  if (desc.length > 600) throw new Error(`description too long (${desc.length}) — need ≤400 ideally, ≤600 hard cap`);
  const caps = r.capabilities as unknown[];
  if (!Array.isArray(caps) || caps.length < 3) {
    throw new Error(`capabilities must have ≥3 items, got ${Array.isArray(caps) ? caps.length : "non-array"}`);
  }
  return r as unknown as SkillExtraction;
}
