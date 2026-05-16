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

// =================================================================================================
// Pattern 2 rendering — splits the skill into a navigator SKILL.md + references/<slug>.md per
// capability. Used when the single-file render would exceed ~500 lines.
// =================================================================================================

export interface Pattern2Skill {
  skill_md: string;
  references: Array<{ filename: string; content: string }>;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "untitled";
}

function refFilename(name: string, used: Set<string>): string {
  let base = slugify(name);
  let candidate = `${base}.md`;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${i}.md`;
    i++;
  }
  used.add(candidate);
  return candidate;
}

export function renderPattern2(s: SkillExtraction): Pattern2Skill {
  const used = new Set<string>();
  const capRefs = s.capabilities.map((cap) => ({
    cap,
    filename: refFilename(cap.name, used),
  }));
  used.add("REFERENCE.md");

  // ---- references/REFERENCE.md ----
  const refIndexLines: string[] = [
    `# ${s.name} — references index`,
    "",
    `Source: ${s.source}`,
    "",
    "| Topic | File |",
    "|---|---|",
  ];
  for (const { cap, filename } of capRefs) {
    refIndexLines.push(`| ${cap.name} | [references/${filename}](${filename}) |`);
  }
  if (s.anti_patterns.length > 0) {
    refIndexLines.push(`| Anti-patterns | [references/anti-patterns.md](anti-patterns.md) |`);
  }
  if (s.citations.length > 0) {
    refIndexLines.push(`| Citations from source | [references/citations.md](citations.md) |`);
  }
  const references: Pattern2Skill["references"] = [
    { filename: "REFERENCE.md", content: refIndexLines.join("\n") + "\n" },
  ];

  // ---- references/<capability>.md per capability ----
  for (const { cap, filename } of capRefs) {
    const parts: string[] = [];
    parts.push(`# ${cap.name}`);
    parts.push("");
    parts.push(`*Part of skill: \`${s.name}\` · Source: ${s.source}*`);
    parts.push("");
    parts.push(cap.body);
    if (Array.isArray(cap.key_questions_or_steps) && cap.key_questions_or_steps.length > 0) {
      parts.push("");
      parts.push("## Concrete items from the source");
      parts.push("");
      parts.push(bullets(cap.key_questions_or_steps));
    }
    references.push({ filename, content: parts.join("\n") + "\n" });
  }

  // ---- references/anti-patterns.md ----
  if (s.anti_patterns.length > 0) {
    const ap: string[] = [`# Anti-patterns — ${s.name}`, "", `*Source: ${s.source}*`, ""];
    for (const a of s.anti_patterns) {
      ap.push(`## ❌ ${a.name}`);
      ap.push("");
      ap.push(`**Why wrong:** ${a.why_wrong}`);
      ap.push("");
      ap.push(`**Fix:** ${a.fix}`);
      ap.push("");
    }
    references.push({ filename: "anti-patterns.md", content: ap.join("\n") });
  }

  // ---- references/citations.md ----
  if (s.citations.length > 0) {
    const cit: string[] = [`# Citations — ${s.name}`, "", `*Source: ${s.source}*`, ""];
    for (const c of s.citations) {
      cit.push(`> ${c.text}  \n> — *${c.location}*`);
      cit.push("");
    }
    references.push({ filename: "citations.md", content: cit.join("\n") });
  }

  // ---- SKILL.md navigator ----
  const nav: string[] = [];
  nav.push(frontmatter(s));

  nav.push("## Use this skill when\n");
  nav.push(bullets(s.use_when));
  nav.push("");

  nav.push("## Do not use this skill when\n");
  nav.push(bullets(s.do_not_use_when));
  nav.push("");

  nav.push("## Purpose\n");
  nav.push(s.purpose_paragraph);
  nav.push("");

  nav.push("## Capabilities\n");
  for (const { cap, filename } of capRefs) {
    nav.push(`### ${cap.name}\n`);
    const firstSentence = cap.body.split(/\.\s+/)[0].trim();
    const summary = firstSentence.length < cap.body.length
      ? `${firstSentence}.`
      : cap.body;
    nav.push(summary);
    nav.push("");
    nav.push(`See [references/${filename}](references/${filename}).`);
    nav.push("");
  }

  nav.push("## Behavioral Traits\n");
  nav.push(bullets(s.behavioral_traits));
  nav.push("");

  nav.push("## Important Constraints\n");
  nav.push(bullets(s.important_constraints));
  nav.push("");

  if (s.anti_patterns.length > 0) {
    nav.push("## Anti-patterns\n");
    nav.push(`Detailed in [references/anti-patterns.md](references/anti-patterns.md). Summary:`);
    nav.push("");
    nav.push(bullets(s.anti_patterns.map((a) => `❌ ${a.name} — ${a.why_wrong}`)));
    nav.push("");
  }

  if (s.related_skills.length > 0) {
    nav.push("## Related Skills\n");
    nav.push(bullets(s.related_skills.map((x) => `\`${x}\``)));
    nav.push("");
  }

  nav.push("## API Reference\n");
  nav.push("| Topic | File |");
  nav.push("|---|---|");
  nav.push(`| Index of all references | [references/REFERENCE.md](references/REFERENCE.md) |`);
  for (const { cap, filename } of capRefs) {
    nav.push(`| ${cap.name} | [references/${filename}](references/${filename}) |`);
  }
  if (s.anti_patterns.length > 0) nav.push(`| Anti-patterns | [references/anti-patterns.md](references/anti-patterns.md) |`);
  if (s.citations.length > 0) nav.push(`| Citations from source | [references/citations.md](references/citations.md) |`);
  nav.push("");

  return { skill_md: nav.join("\n"), references };
}

/**
 * Decide whether the rendered skill is large enough to warrant Pattern 2 split.
 * Default threshold: 500 lines in the single-file render.
 */
export function shouldUsePattern2(s: SkillExtraction, singleFileLines: number): boolean {
  if (singleFileLines > 500) return true;
  if (s.capabilities.length >= 6 && singleFileLines > 350) return true;
  return false;
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
