import { z } from "zod";

// Mirror of server/SCHEMA_NAME_PATTERN in `server/project.ts`. Keep in sync —
// the regex is the source of truth that decides what can be appended to a
// connection's `schemas` list in ktx.yaml.
export const SCHEMA_NAME_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$";
export const SCHEMA_NAME_RULE_HINT =
  "字母或下划线开头，仅含字母、数字、下划线，最多 63 个字符";

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

export function schemaFieldLabel(): string {
  return "Schema 名称";
}

export function schemaFieldHelper(engine?: string, driver?: string): string {
  const normalized = (engine ?? driver ?? "").toLowerCase();
  if (normalized === "mysql") return "MySQL 中通常对应 database 名。";
  if (normalized === "doris" || normalized === "starrocks") {
    return "Doris / StarRocks 使用 MySQL wire protocol 时，通常填写 database 名。";
  }
  if (normalized === "postgres" || normalized === "postgresql") {
    return "PostgreSQL 中请填写 schema，不是 database。";
  }
  return "填写要纳入该连接治理的 Schema。";
}
