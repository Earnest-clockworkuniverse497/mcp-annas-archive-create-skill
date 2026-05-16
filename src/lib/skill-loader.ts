/**
 * Reads a Claude Code skill from disk as a single textual blob suitable for
 * passing to an LLM as context. Handles both single-file skills and Pattern 2
 * skills (SKILL.md navigator + references/*.md).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

export interface LoadedSkill {
  skill_path: string;
  skill_md: string;
  references: Array<{ filename: string; content: string }>;
  is_pattern_2: boolean;
  total_chars: number;
}

export async function loadSkill(skillPath: string): Promise<LoadedSkill> {
  const skillMd = await readFile(skillPath, "utf-8");
  const skillDir = dirname(skillPath);
  const refsDir = join(skillDir, "references");

  const references: Array<{ filename: string; content: string }> = [];
  let isPattern2 = false;

  try {
    const stats = await stat(refsDir);
    if (stats.isDirectory()) {
      isPattern2 = true;
      const entries = await readdir(refsDir);
      entries.sort();
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const content = await readFile(join(refsDir, entry), "utf-8");
        references.push({ filename: entry, content });
      }
    }
  } catch {
    // no references/ — single-file skill
  }

  const totalChars =
    skillMd.length + references.reduce((s, r) => s + r.content.length, 0);
  return {
    skill_path: skillPath,
    skill_md: skillMd,
    references,
    is_pattern_2: isPattern2,
    total_chars: totalChars,
  };
}

/**
 * Formats a LoadedSkill into a single Markdown blob for an LLM prompt.
 * Each file gets its own labeled section so the model can cite source paths.
 */
export function formatSkillForPrompt(loaded: LoadedSkill): string {
  const relPath = basename(dirname(loaded.skill_path));
  const parts: string[] = [];
  parts.push(`### FILE: ${relPath}/SKILL.md`);
  parts.push("");
  parts.push(loaded.skill_md);
  if (loaded.references.length > 0) {
    parts.push("");
    parts.push(`### Pattern 2 references for ${relPath}/`);
    parts.push("");
    for (const ref of loaded.references) {
      parts.push(`#### FILE: ${relPath}/references/${ref.filename}`);
      parts.push("");
      parts.push(ref.content);
      parts.push("");
    }
  }
  return parts.join("\n");
}
