import { z } from "zod";
import { readFile } from "node:fs/promises";
import { auditSkillMd, type AuditResult } from "../lib/skill-audit.js";

export const SkillAuditInputSchema = z.object({
  skill_path: z.string().describe("Absolute path to a SKILL.md file"),
  show_passes: z.boolean().default(false).describe("Include the list of passed checks in output (default: only issues)"),
});

export type SkillAuditInput = z.infer<typeof SkillAuditInputSchema>;

export interface SkillAuditOutput {
  ok: true;
  skill_path: string;
  audit: AuditResult;
}

export async function skillAudit(input: SkillAuditInput): Promise<SkillAuditOutput> {
  const content = await readFile(input.skill_path, "utf-8");
  const audit = auditSkillMd(content);
  const out: AuditResult = input.show_passes
    ? audit
    : { ...audit, passes: [] };
  return { ok: true, skill_path: input.skill_path, audit: out };
}
