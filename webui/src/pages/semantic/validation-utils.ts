import type { ValidationResult } from "../../lib/types";

const PROJECT_NOISE = /^Project:\s/i;
const TOAST_ISSUE_MAX = 160;

export function listValidationIssueMessages(validation: ValidationResult): string[] {
  const fromIssues = (validation.issues ?? [])
    .map((issue) => issue.message.trim())
    .filter(Boolean);
  if (fromIssues.length > 0) {
    return fromIssues;
  }
  return `${validation.stderr}\n${validation.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isNoiseValidationLine(message: string): boolean {
  return PROJECT_NOISE.test(message);
}

/** Prefer the first actionable issue; skip ktx "Project: …" banner lines. */
export function primaryValidationIssue(validation: ValidationResult): string | null {
  const messages = listValidationIssueMessages(validation);
  const substantive = messages.find((message) => !isNoiseValidationLine(message));
  return substantive ?? messages[0] ?? null;
}

export function formatValidationFailureToast(validation: ValidationResult): string {
  const primary = primaryValidationIssue(validation);
  if (!primary) {
    return "校验未通过";
  }
  const truncated =
    primary.length > TOAST_ISSUE_MAX ? `${primary.slice(0, TOAST_ISSUE_MAX - 3)}...` : primary;
  return `校验未通过：${truncated}`;
}
