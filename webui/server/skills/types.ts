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
}

export interface SkillAsset {
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
  filePath: string;
  content: string;
  raw: string;
}

export interface SkillValidationIssue {
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
