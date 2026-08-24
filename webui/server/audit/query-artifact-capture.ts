import { createHash } from "node:crypto";
import type { QueryArtifactKind } from "./query-artifact-crypto.js";

const SEMANTIC_KEYS = [
  "measures",
  "dimensions",
  "filters",
  "segments",
  "order_by",
  "orderBy",
  "limit",
  "connectionId",
  "source",
  "sources"
] as const;

export type CapturedQueryPayload = {
  kind: QueryArtifactKind;
  plaintext: string;
  queryHash: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function extractRawSqlFromArgs(toolArgs: unknown): string | undefined {
  const record = asRecord(toolArgs);
  if (!record) return undefined;
  for (const key of ["sql", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function extractSqlFromToolResult(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;
  const result = asRecord(root.result) ?? root;

  const structured = asRecord(result.structuredContent);
  if (typeof structured?.sql === "string" && structured.sql.trim()) {
    return structured.sql;
  }
  if (typeof result.sql === "string" && result.sql.trim()) {
    return result.sql;
  }

  const content = result.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const block = asRecord(item);
      if (!block) continue;
      if (typeof block.text === "string") {
        try {
          const parsed = JSON.parse(block.text) as unknown;
          const parsedRecord = asRecord(parsed);
          if (typeof parsedRecord?.sql === "string" && parsedRecord.sql.trim()) {
            return parsedRecord.sql;
          }
        } catch {
          // not JSON text
        }
      }
    }
  }
  return undefined;
}

export function buildSemanticQueryPlaintext(toolArgs: unknown): string | undefined {
  const record = asRecord(toolArgs);
  if (!record) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of SEMANTIC_KEYS) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  if (Object.keys(picked).length === 0) return undefined;
  return JSON.stringify(picked);
}

export function captureQueryPayload(options: {
  toolArgs: unknown;
  toolResultBody?: unknown;
}): CapturedQueryPayload | null {
  const fromResult = extractSqlFromToolResult(options.toolResultBody);
  if (fromResult) {
    return {
      kind: "generated_sql",
      plaintext: fromResult,
      queryHash: createHash("sha256").update(fromResult).digest("hex")
    };
  }
  const fromArgs = extractRawSqlFromArgs(options.toolArgs);
  if (fromArgs) {
    return {
      kind: "raw_sql",
      plaintext: fromArgs,
      queryHash: createHash("sha256").update(fromArgs).digest("hex")
    };
  }
  const semantic = buildSemanticQueryPlaintext(options.toolArgs);
  if (semantic) {
    return {
      kind: "semantic_query",
      plaintext: semantic,
      queryHash: createHash("sha256").update(semantic).digest("hex")
    };
  }
  return null;
}

export function mergeIncludeSql(args: Record<string, unknown>): Record<string, unknown> {
  const include = args.include;
  const list = Array.isArray(include)
    ? include.filter((item): item is string => typeof item === "string")
    : [];
  if (!list.includes("sql")) list.push("sql");
  return { ...args, include: list };
}
