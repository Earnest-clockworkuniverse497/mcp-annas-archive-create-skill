/**
 * Programmatic auditor for Claude Code SKILL.md files.
 *
 * Implements the audit checklist from ~/.claude/skills/skill-evaluation/SKILL.md
 * so this MCP is self-contained and doesn't depend on the user having
 * skill-evaluation installed.
 *
 * Reference: Anthropic Agent Skills best practices.
 */

export interface AuditIssue {
  level: "error" | "warning";
  rule: string;
  message: string;
}

export interface AuditResult {
  passed: boolean;
  error_count: number;
  warning_count: number;
  pass_count: number;
  issues: AuditIssue[];
  passes: string[];
}

const REQUIRED_SECTIONS = [
  "Use this skill when",
  "Do not use this skill when",
  "Purpose",
  "Capabilities",
  "Behavioral Traits",
  "Important Constraints",
];

const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/,
  /\bTODO\b/,
  /<placeholder>/i,
  /lorem ipsum/i,
  /\bFIXME\b/,
];

const TIME_SENSITIVE_PATTERNS = [
  /\bas of (january|february|march|april|may|june|july|august|september|october|november|december|\d{4})/i,
  /\bcurrent\s+(version|best practice|state)/i,
  /\b(in|since|after|before)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i,
];

function extractFrontmatter(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return {};
  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*(.+?)\s*$/m);
  const descMatch = fm.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m) ||
                    fm.match(/^description:\s*(.+?)\s*$/m);
  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.replace(/\\"/g, '"').trim(),
  };
}

export function auditSkillMd(content: string): AuditResult {
  const issues: AuditIssue[] = [];
  const passes: string[] = [];
  const fm = extractFrontmatter(content);

  if (!fm.name) {
    issues.push({ level: "error", rule: "name-required", message: "frontmatter `name:` missing" });
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name)) {
    issues.push({ level: "error", rule: "name-kebab-case", message: `name "${fm.name}" must be kebab-case (lowercase letters, digits, hyphens only)` });
  } else if (/-(pro|expert|specialist|advanced)$/.test(fm.name)) {
    issues.push({ level: "warning", rule: "name-no-suffix", message: `name "${fm.name}" uses banned suffix (-pro/-expert/-specialist/-advanced). Prefer plain library name.` });
  } else {
    passes.push(`name "${fm.name}" is valid kebab-case`);
  }

  if (!fm.description) {
    issues.push({ level: "error", rule: "description-required", message: "frontmatter `description:` missing" });
  } else {
    const len = fm.description.length;
    if (len < 80) {
      issues.push({ level: "error", rule: "description-too-short", message: `description is ${len} chars — almost certainly lacks trigger terms (need ≥150 ideal, ≥80 hard min)` });
    } else if (len < 150) {
      issues.push({ level: "warning", rule: "description-below-target", message: `description is ${len} chars — under target 150-400; consider adding trigger nouns/verbs` });
    } else if (len > 600) {
      issues.push({ level: "error", rule: "description-too-long", message: `description is ${len} chars — over 600 hard cap; dilutes routing signal` });
    } else if (len > 400) {
      issues.push({ level: "warning", rule: "description-above-target", message: `description is ${len} chars — over target 400; consider trimming` });
    } else {
      passes.push(`description length ${len} chars (target 150-400)`);
    }

    const triggers = /\b(use when|trigger|triggers|triggered by|when:|when user|when the user)\b/i.test(fm.description);
    if (!triggers) {
      issues.push({ level: "warning", rule: "description-no-triggers", message: "description should contain `Use when:` or `Trigger` to guide routing" });
    } else {
      passes.push("description has trigger guidance (`Use when` / `Trigger`)");
    }

    const skip = /\b(skip|do not use|don't use)\b/i.test(fm.description);
    if (!skip) {
      issues.push({ level: "warning", rule: "description-no-skip", message: "description should include `SKIP:` or `Do not use:` edge to prevent wrong-skill routing" });
    } else {
      passes.push("description has SKIP/edge guidance");
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    const re = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*$|\\s*\\[)`, "im");
    if (!re.test(content)) {
      issues.push({ level: "error", rule: `section-missing-${section.toLowerCase().replace(/\s+/g, "-")}`, message: `required section \`## ${section}\` is missing` });
    } else {
      passes.push(`section \`## ${section}\` present`);
    }
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > 500) {
    issues.push({ level: "warning", rule: "size-pattern-2", message: `SKILL.md is ${lines.length} lines — over 500 cap. Consider Pattern 2 split into references/*.md` });
  } else {
    passes.push(`size ${lines.length} lines (cap 500)`);
  }

  {
    // Scan only non-citation, non-frontmatter lines for placeholder tokens. guardian: allow
    // Quoted lines (starting with '>') may legitimately contain such tokens. guardian: allow
    const scanLines = content
      .split(/\r?\n/)
      .filter((l) => !l.startsWith(">") && !l.startsWith("source:"))
      .join("\n");
    for (const pat of PLACEHOLDER_PATTERNS) {
      const m = scanLines.match(pat);
      if (m) {
        issues.push({ level: "error", rule: "placeholder-prose", message: `placeholder content found: "${m[0]}" — replace with real content` });
        break;
      }
    }
  }

  for (const pat of TIME_SENSITIVE_PATTERNS) {
    const m = content.match(pat);
    if (m) {
      issues.push({ level: "warning", rule: "time-sensitive", message: `time-sensitive prose found: "${m[0]}" — keep dates in the version block, not body` });
      break;
    }
  }

  const capsMatch = content.match(/^## Capabilities\b[\s\S]*?(?=^## |\Z)/m);
  if (capsMatch) {
    const capsBody = capsMatch[0];
    const subsections = capsBody.match(/^###\s+.+$/gm) ?? [];
    if (subsections.length < 2) {
      issues.push({ level: "warning", rule: "capabilities-thin", message: `## Capabilities has only ${subsections.length} subsection(s). Strong skills have ≥3 real ### subsections.` });
    } else {
      passes.push(`## Capabilities has ${subsections.length} subsections`);
    }

    const emptyHeader = capsBody.match(/^###\s+.+\n+###\s+/m);
    if (emptyHeader) {
      issues.push({ level: "error", rule: "capabilities-empty-subsection", message: "found two adjacent ### headers with no body between — empty subsection" });
    }
  }

  const constraintsMatch = content.match(/^## Important Constraints\b[\s\S]*?(?=^## |\Z)/m);
  if (constraintsMatch && !/\bNEVER\b|\bALWAYS\b|❌|✅/.test(constraintsMatch[0])) {
    issues.push({ level: "warning", rule: "constraints-soft", message: "## Important Constraints should use concrete NEVER/ALWAYS markers" });
  }

  return {
    passed: issues.filter((i) => i.level === "error").length === 0,
    error_count: issues.filter((i) => i.level === "error").length,
    warning_count: issues.filter((i) => i.level === "warning").length,
    pass_count: passes.length,
    issues,
    passes,
  };
}
