import { z } from "zod";

// Mirror of server/SCHEMA_NAME_PATTERN in `server/project.ts`. Keep in sync —
// the regex is the source of truth that decides what can be appended to a
// connection's `schemas` list in ktx.yaml.
export const SCHEMA_NAME_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$";

export const schemaNameSchema = z
  .string()
  .min(1, "Schema 名不能为空")
  .max(63, "Schema 名不能超过 63 个字符")
  .regex(new RegExp(SCHEMA_NAME_PATTERN), {
    message: "Schema 名须以字母或下划线开头，仅含字母/数字/下划线"
  });

export type SchemaNameIssue = {
  message: string;
};

export function validateSchemaName(value: string): SchemaNameIssue | null {
  const result = schemaNameSchema.safeParse(value);
  if (result.success) return null;
  return { message: result.error.issues[0]?.message ?? "非法 Schema 名" };
}

export function schemaFieldLabel(engine?: string): string {
  switch (engine) {
    case "postgres":
      return "Schema";
    case "mysql":
    case "doris":
    case "starrocks":
      return "Schema 或 database";
    default:
      return "Schema";
  }
}