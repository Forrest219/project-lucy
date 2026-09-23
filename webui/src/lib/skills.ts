// Thin wrappers around the Spec 144 read-only Skill admin endpoints.
// Unlike most WebUI APIs these routes do not wrap payloads in the
// `{ ok, data }` envelope (`GET /api/skills` returns `{ ok, count, skills }`),
// so we cannot reuse `apiGet` and fetch directly with the same
// `credentials: "same-origin"` session contract.

export type SkillStatus = "draft" | "published" | "deprecated";

export type SkillPrerequisites = {
  sources?: string[];
  measures?: string[];
  wiki_docs?: string[];
};

export type SkillValidationIssue = {
  type: "error" | "warning";
  field: string;
  message: string;
};

export type SkillValidationResult = {
  valid: boolean;
  issues: SkillValidationIssue[];
};

export type SkillAsset = {
  name: string;
  title: string;
  version: string;
  domain: string;
  status: SkillStatus;
  roles_allowed: string[];
  prerequisites: SkillPrerequisites;
  triggers: string[];
  eval_cases: string[];
  description: string;
  uri: string;
  relativePath: string;
  content: string;
  validation: SkillValidationResult;
};

export type SkillsListResponse = {
  ok: true;
  count: number;
  skills: SkillAsset[];
};

async function fetchSkillsJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const body = (await response.json()) as { ok: boolean; error?: unknown } & T;
  if (!response.ok || body.ok === false) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return body;
}

export function fetchSkills(): Promise<SkillsListResponse> {
  return fetchSkillsJson<SkillsListResponse>("/api/skills");
}

export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "草稿",
  published: "已发布",
  deprecated: "已停用"
};

export function skillStatusBadgeClass(status: SkillStatus): string {
  switch (status) {
    case "published":
      return "pl-status-badge pl-status-done";
    case "deprecated":
      return "pl-status-badge pl-status-validation_failed";
    case "draft":
    default:
      return "pl-status-badge pl-status-not_started";
  }
}

/** `roles_allowed` 摘要：`*` 表示全部角色；空数组表示未配置任何角色。 */
export function rolesAllowedSummary(rolesAllowed: string[]): { label: string; roles: string[] } {
  if (rolesAllowed.includes("*")) {
    return { label: "全部角色", roles: [] };
  }
  return { label: "", roles: rolesAllowed };
}
