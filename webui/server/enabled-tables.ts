/**
 * 启用表范围（`ktx.yaml` 的 `enabled_tables`）的**共享**实现。
 *
 * 抽成独立模块的原因：WebUI 旧写入口（`PUT /api/connections/:connId/enabled-tables`）
 * 与 L25-16 控制面工具（`lucy_ops_connection_tables`）必须**复用同一套校验与补丁逻辑**，
 * 且控制面要在此之上做**多连接一次合并写**（Spec §4.5 规则 2）。
 *
 * 补丁保持 ktx.yaml 的**顺序、注释与未知字段**——只做行级替换，
 * 不把整份 YAML 重新序列化（否则 diff 噪音巨大）。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { ktxYamlWithBlockConnections } from "./project.js";
import { resolveContentPaths } from "./paths.js";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lineIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

export function isStructuralYamlLine(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && !trimmed.startsWith("#");
}

export function findYamlBlockEnd(lines: string[], start: number, parentIndent: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (!isStructuralYamlLine(lines[i])) continue;
    if (lineIndent(lines[i]) <= parentIndent) return i;
  }
  return lines.length;
}

export function enabledTablesBlock(indent: number, enabledTables: string[]): string[] {
  const pad = " ".repeat(indent);
  if (enabledTables.length === 0) {
    return [`${pad}enabled_tables: []`];
  }
  return [`${pad}enabled_tables:`, ...enabledTables.map((table) => `${pad}  - ${table}`)];
}

export function enabledTableError(code: string, message: string): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = code === "CONNECTION_NOT_FOUND" ? 404 : 400;
  err.code = code;
  return err;
}

export function assertProposedKtxYaml(proposedYaml: string): { proposedYaml: string } {
  const check = parseDocument(proposedYaml);
  if (check.errors.length > 0) {
    throw enabledTableError(
      "CONNECTION_NOT_FOUND",
      `Failed to patch ktx.yaml enabled_tables: ${check.errors[0]?.message ?? "unknown error"}`
    );
  }
  return { proposedYaml };
}

/**
 * 单连接的 `enabled_tables` 行级补丁。
 */
export function patchConnectionEnabledTablesYaml(
  rawYamlText: string,
  connId: string,
  newEnabledTables: string[]
): { proposedYaml: string } {
  // Flow mappings cannot host a block `enabled_tables` list. Convert first so
  // the line-level patch never emits illegal YAML.
  const yamlText = ktxYamlWithBlockConnections(rawYamlText);
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  const connections = doc.get("connections", true) as
    | { get?: (key: string, keepScalar?: boolean) => unknown }
    | undefined;
  if (!connections || typeof connections.get !== "function") {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }
  const connNode = connections.get(connId, true);
  if (!connNode) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const lines = yamlText.split("\n");
  const connectionsLine = lines.findIndex((line) => /^(\s*)connections:\s*(?:#.*)?$/.test(line));
  if (connectionsLine === -1) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const connectionsIndent = lineIndent(lines[connectionsLine]);
  const connectionsEnd = findYamlBlockEnd(lines, connectionsLine + 1, connectionsIndent);
  const connPattern = new RegExp(`^(\\s*)${escapeRegExp(connId)}:\\s*(?:#.*)?$`);
  let connLine = -1;
  for (let i = connectionsLine + 1; i < connectionsEnd; i += 1) {
    if (connPattern.test(lines[i]) && lineIndent(lines[i]) > connectionsIndent) {
      connLine = i;
      break;
    }
  }
  if (connLine === -1) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const connIndent = lineIndent(lines[connLine]);
  const connEnd = findYamlBlockEnd(lines, connLine + 1, connIndent);
  let enabledTablesLine = -1;
  for (let i = connLine + 1; i < connEnd; i += 1) {
    if (/^\s*enabled_tables:\s*(?:.*)?$/.test(lines[i]) && lineIndent(lines[i]) > connIndent) {
      enabledTablesLine = i;
      break;
    }
  }

  if (enabledTablesLine === -1) {
    const firstFieldLine = lines
      .slice(connLine + 1, connEnd)
      .find((line) => isStructuralYamlLine(line) && lineIndent(line) > connIndent);
    const fieldIndent = firstFieldLine ? lineIndent(firstFieldLine) : connIndent + 2;
    lines.splice(connEnd, 0, ...enabledTablesBlock(fieldIndent, newEnabledTables));
    return assertProposedKtxYaml(lines.join("\n"));
  }

  const fieldIndent = lineIndent(lines[enabledTablesLine]);
  const enabledTablesEnd = findYamlBlockEnd(lines, enabledTablesLine + 1, fieldIndent);
  lines.splice(
    enabledTablesLine,
    enabledTablesEnd - enabledTablesLine,
    ...enabledTablesBlock(fieldIndent, newEnabledTables)
  );
  return assertProposedKtxYaml(lines.join("\n"));
}

/**
 * **多连接一次合并补丁**（Spec §4.5 规则 2）。
 *
 * 逐连接在内存中生成补丁并串联，最终只产出一份 yaml 文本——
 * 调用方对 `ktx.yaml` **只写一次**。
 */
export function patchConnectionsEnabledTablesYaml(
  rawYamlText: string,
  entries: ReadonlyArray<{ connId: string; enabledTables: string[] }>
): { proposedYaml: string } {
  let text = rawYamlText;
  for (const entry of entries) {
    text = patchConnectionEnabledTablesYaml(text, entry.connId, entry.enabledTables).proposedYaml;
  }
  return { proposedYaml: text };
}

/**
 * Schema 移除的 **ktx.yaml-only** 补丁：只改 `ktx.yaml` 里的 `schemas` 与 `enabled_tables`，
 * **不删除任何语义文件**（控制面首期不提供语义内容删除）。
 */
export function patchRemoveSchemaYaml(
  rawYamlText: string,
  connId: string,
  schema: string
): { proposedYaml: string; removedEnabledTables: string[] } {
  const yamlText = ktxYamlWithBlockConnections(rawYamlText);
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw enabledTableError(
      "CONNECTION_NOT_FOUND",
      `Failed to parse ktx.yaml: ${doc.errors[0]?.message ?? "unknown error"}`
    );
  }
  const connections = doc.get("connections", true) as
    | { get?: (key: string, keepScalar?: boolean) => unknown }
    | undefined;
  if (!connections || typeof connections.get !== "function") {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }
  const conn = connections.get(connId, true) as
    | { get?: (key: string, keepScalar?: boolean) => unknown; set?: (key: string, value: unknown) => void }
    | undefined;
  if (!conn || typeof conn.get !== "function") {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const prefix = `${schema}.`;
  const removedEnabledTables: string[] = [];

  const schemasNode = conn.get("schemas", true) as { items?: unknown[] } | undefined;
  if (schemasNode && Array.isArray(schemasNode.items)) {
    for (let i = schemasNode.items.length - 1; i >= 0; i -= 1) {
      const item = schemasNode.items[i] as { value?: unknown } | string | undefined;
      const value = typeof item === "string" ? item : (item?.value as unknown);
      if (value === schema) schemasNode.items.splice(i, 1);
    }
  }

  const enabledNode = conn.get("enabled_tables", true) as { items?: unknown[] } | undefined;
  if (enabledNode && Array.isArray(enabledNode.items)) {
    for (let i = enabledNode.items.length - 1; i >= 0; i -= 1) {
      const item = enabledNode.items[i] as { value?: unknown } | string | undefined;
      const value = typeof item === "string" ? item : (item?.value as unknown);
      if (typeof value === "string" && value.startsWith(prefix)) {
        removedEnabledTables.unshift(value);
        enabledNode.items.splice(i, 1);
      }
    }
  }

  return { proposedYaml: doc.toString(), removedEnabledTables };
}

/**
 * 同源校验：新增的表必须在已扫描的语义层 Manifest 里；既有但已失效的表只告警。
 */
export type EnabledTableWarning = {
  code: "ENABLED_TABLE_NOT_SCANNED";
  table: string;
  message: string;
};

export function validateEnabledTables(
  enabledTables: unknown,
  scanned: Set<string>,
  previouslyEnabled: Set<string>
): { tables: string[]; warnings: EnabledTableWarning[] } {
  if (!Array.isArray(enabledTables)) {
    throw enabledTableError("INVALID_ENABLED_TABLE", "enabledTables must be an array");
  }
  const seen = new Set<string>();
  const valid: string[] = [];
  const warnings: EnabledTableWarning[] = [];
  for (const item of enabledTables) {
    if (typeof item !== "string") {
      throw enabledTableError("INVALID_ENABLED_TABLE", "enabled table must be a string");
    }
    const table = item.trim();
    if (
      !table ||
      /[\\/\u0000-\u001F]/.test(table) ||
      table.includes("..") ||
      !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)
    ) {
      throw enabledTableError("INVALID_ENABLED_TABLE", `Invalid enabled table '${item}'`);
    }
    if (seen.has(table)) {
      throw enabledTableError("DUPLICATE_ENABLED_TABLE", `Duplicate enabled table '${table}'`);
    }
    if (!scanned.has(table) && !previouslyEnabled.has(table)) {
      throw enabledTableError("TABLE_NOT_SCANNED", `Table '${table}' is not present in scanned semantic-layer schema`);
    }
    if (!scanned.has(table)) {
      warnings.push({
        code: "ENABLED_TABLE_NOT_SCANNED",
        table,
        message: `Table '${table}' is enabled but not present in scanned semantic-layer schema`
      });
    }
    seen.add(table);
    valid.push(table);
  }
  return { tables: valid, warnings };
}

/** 扫描该连接已扫描到的物理表。 */
export async function scannedPhysicalTables(projectRoot: string, connId: string): Promise<Set<string>> {
  // 按传入的 projectRoot 解析语义层目录——控制面可能在临时项目根上跑，
  // 不得落到全局解析结果上。
  const schemaDir = path.join((await resolveContentPaths(projectRoot)).semanticLayer, connId, "_schema");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
  const tables = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const schemaName = entry.name.replace(/\.yaml$/, "");
    const text = await readFile(path.join(schemaDir, entry.name), "utf8").catch(() => "");
    const doc = parseDocument(text).toJSON() as
      | { tables?: Record<string, { table?: string }> }
      | null;
    const rawTables = doc && typeof doc === "object" && doc.tables && typeof doc.tables === "object"
      ? doc.tables
      : {};
    for (const [sourceName, value] of Object.entries(rawTables)) {
      const tableDef = value && typeof value === "object" ? value : {};
      const physical = typeof tableDef.table === "string" && tableDef.table.trim()
        ? tableDef.table.trim()
        : `${schemaName}.${sourceName}`;
      tables.add(physical);
    }
  }
  return tables;
}
