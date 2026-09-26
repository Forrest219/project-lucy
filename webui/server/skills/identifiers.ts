export const SKILL_SEGMENT_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function isSkillSegment(value: string): boolean {
  return SKILL_SEGMENT_RE.test(value.trim());
}
