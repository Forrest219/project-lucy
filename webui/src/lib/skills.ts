// Spec 144 / 147 Skill admin client.
// Routes return `{ ok, ... }` (not `{ ok, data }`), so we fetch directly.

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

export type SkillWritePayload = {
  name: string;
  domain: string;
  title?: string;
  version?: string;
  status?: SkillStatus;
  roles_allowed?: string[];
  triggers?: string[];
  description?: string;
  content?: string;
  eval_cases?: string[];
  prerequisites?: SkillPrerequisites;
  rawContent?: string;
};

async function fetchSkillsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json()) as { ok: boolean; error?: unknown } & T;
  if (!response.ok || body.ok === false) {
    const message =
      typeof body.error === "string" ? body.error : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return body;
}

export function fetchSkills(): Promise<SkillsListResponse> {
  return fetchSkillsJson<SkillsListResponse>("/api/skills");
}

export function createSkill(payload: SkillWritePayload): Promise<{ ok: true; skill: SkillAsset }> {
  return fetchSkillsJson("/api/skills", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSkill(
  domain: string,
  name: string,
  payload: SkillWritePayload
): Promise<{ ok: true; skill: SkillAsset }> {
  return fetchSkillsJson(`/api/skills/${encodeURIComponent(domain)}/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteSkill(domain: string, name: string): Promise<{ ok: true; uri: string }> {
  return fetchSkillsJson(`/api/skills/${encodeURIComponent(domain)}/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
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

export function rolesAllowedSummary(rolesAllowed: string[]): { label: string; roles: string[] } {
  if (rolesAllowed.includes("*")) {
    return { label: "全部角色", roles: [] };
  }
  return { label: "", roles: rolesAllowed };
}
