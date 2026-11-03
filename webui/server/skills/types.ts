export type SkillStatus = "draft" | "published" | "deprecated";

export interface SkillPrerequisites {
  sources?: string[];
  measures?: string[];
  wiki_docs?: string[];
}

export interface SkillFrontmatter {
  name: string;
  title: string;
  version: string;
  domain: string;
  status?: SkillStatus;
  roles_allowed?: string[];
  prerequisites?: SkillPrerequisites;
  triggers?: string[];
  eval_cases?: string[];
  description?: string;
  /**
   * L25-04: optional free-text owner label (a person or a team). Declared as
   * `unknown` on purpose — the YAML value can be any shape, so the loader must
   * narrow it strictly instead of stringifying it.
   */
  owner?: unknown;
}

export interface SkillAsset {
  name: string;
  title: string;
  version: string;
  domain: string;
  status: SkillStatus;
  roles_allowed: string[];
  /** Set when `roles_allowed` is non-array / has bad elements / mixes `*` with ids; denied at runtime. */
  roles_allowed_invalid?: boolean;
  prerequisites: SkillPrerequisites;
  triggers: string[];
  eval_cases: string[];
  description: string;
  /**
   * L25-04: the free-text owner label. Empty means "unspecified"; it is not an
   * account, a role, or an authorization source.
   */
  owner: string;
  /** Set when the stored `owner` declaration is corrupt (disclosed, never repaired silently). */
  owner_invalid?: true;
  uri: string;
  relativePath: string;
  filePath: string;
  content: string;
  raw: string;
  /** SHA-256 of the exact entry-file bytes; used for optimistic concurrency. */
  file_version: string;
}

export interface SkillValidationIssue {
  /** Stable machine-readable identifier; UI copy must not depend on message text. */
  code: string;
  type: "error" | "warning";
  field: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  issues: SkillValidationIssue[];
}

export interface SkillWithValidation extends SkillAsset {
  validation: SkillValidationResult;
}

export type SkillClientTarget = "claude-code" | "cursor" | "mcp-json" | "all";

export interface SkillExportBundle {
  target: SkillClientTarget;
  files: Record<string, string>;
  mcpConfig?: Record<string, unknown>;
  exportedAt: string;
  count: number;
}
