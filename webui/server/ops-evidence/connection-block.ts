/**
 * Spec 149 §7 — `connections.lucy-ops` 连接块的确保与一致性裁决。
 * Spec 20261101 D22 — driver/path/readonly 一致时仍须 union 扩展 enabled_tables。
 *
 * 契约：
 * - 缺失 → 写入 `driver: sqlite`、`readonly: true`、审计库绝对路径、
 *   `schemas: [main]`、`enabled_tables` = 当前冻结的 physicalTable（含 W1）。
 * - 三者（driver / 路径 / readonly）一致 → 检查 `enabled_tables`；缺名则
 *   union 写入（保留额外表名），状态 `expanded`；已齐全则 `unchanged`。
 * - 任一不一致 → **不覆盖**，状态 `conflict`。
 *
 * **永不写 `access.yaml`**（正式 Role 扩权由运营显式完成）。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import {
  OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_ENABLED_TABLES,
  OPS_EVIDENCE_FROZEN
} from "./contract.js";
import { writeKtxYaml } from "../project.js";

export type OpsEvidenceConnectionWrite = "inserted" | "unchanged" | "expanded" | "conflict";

export type OpsEvidenceConflictField = "driver" | "database" | "readonly";

export interface OpsEvidenceBlockState {
  write: OpsEvidenceConnectionWrite;
  /** 冲突字段（仅 conflict）。 */
  conflictField?: OpsEvidenceConflictField;
  /** 面向管理员的冲突说明（仅 conflict）。 */
  conflictReason?: string;
  /** 冲突或未改写时读到的原块。 */
  existingBlock?: Record<string, unknown>;
  /** union 后新增进 enabled_tables 的表名（仅 expanded）。 */
  addedTables?: string[];
}

/** 审计热库路径：环境变量优先，缺省 `<projectRoot>/.ktx-ui/audit.sqlite`。 */
export async function resolveOpsEvidenceAuditDbPath(projectRoot: string): Promise<string> {
  const envDbPath = process.env.LUCY_AUDIT_DB;
  if (envDbPath && envDbPath.trim().length > 0) return path.resolve(envDbPath.trim());
  return path.join(projectRoot, ".ktx-ui", "audit.sqlite");
}

/** 连接块里的数据库路径（sqlite 用 `path`，也兼容 `database` / `db` / `dbname`）。 */
export function opsEvidenceBlockDatabasePath(block: Record<string, unknown>): string | undefined {
  for (const key of ["path", "database", "db", "dbname"]) {
    const value = block[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** 读出 enabled_tables 列表（保留顺序与额外项）。 */
export function readEnabledTables(block: Record<string, unknown> | undefined): string[] {
  if (!block) return [];
  const raw = block.enabled_tables;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

/**
 * 计算 `enabled_tables ∪ OPS_EVIDENCE_ENABLED_TABLES`（保留已有额外项与相对顺序）。
 * 返回 `null` 表示无需改写。
 */
export function unionEnabledTables(existing: string[]): { next: string[]; added: string[] } | null {
  const present = new Set(existing);
  const added = OPS_EVIDENCE_ENABLED_TABLES.filter((table) => !present.has(table));
  if (added.length === 0) return null;
  return { next: [...existing, ...added], added };
}

/**
 * 裁决已有块是否与契约一致（driver / 路径 / readonly）。
 *
 * `block` 为 `undefined` 表示连接不存在 → 需要写入。
 * 三者一致时返回 `unchanged`；**不**在此裁决 enabled_tables（由 ensure 做 union）。
 */
export function inspectOpsEvidenceBlock(
  block: Record<string, unknown> | undefined,
  auditDbPath: string,
  projectRoot: string
): OpsEvidenceBlockState {
  if (!block) return { write: "inserted" };

  const driver = typeof block.driver === "string" ? block.driver.trim().toLowerCase() : "";
  if (driver !== "sqlite") {
    return {
      write: "conflict",
      conflictField: "driver",
      conflictReason: OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
      existingBlock: block
    };
  }

  if (block.readonly !== true) {
    return {
      write: "conflict",
      conflictField: "readonly",
      conflictReason: OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
      existingBlock: block
    };
  }

  const configured = opsEvidenceBlockDatabasePath(block);
  const expected = path.resolve(auditDbPath);
  const actual = configured ? path.resolve(projectRoot, configured) : undefined;
  if (actual !== expected) {
    return {
      write: "conflict",
      conflictField: "database",
      conflictReason: OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
      existingBlock: block
    };
  }

  return { write: "unchanged", existingBlock: block };
}

/** 从 ktx.yaml 读出 `connections.lucy-ops` 的普通对象形态。 */
export async function readOpsEvidenceBlock(
  projectRoot: string
): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseDocument(raw).toJS();
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const connections = (parsed as Record<string, unknown>).connections;
  if (!connections || typeof connections !== "object") return undefined;
  const block = (connections as Record<string, unknown>)[OPS_EVIDENCE_CONNECTION_ID];
  if (!block || typeof block !== "object") return undefined;
  return block as Record<string, unknown>;
}

/** 写入用的连接块（值全部来自冻结结果与当前审计库路径）。 */
export function buildOpsEvidenceConnectionBlock(auditDbPath: string): YAMLMap {
  const conn = new YAMLMap();
  conn.flow = false;
  conn.set("driver", "sqlite");
  conn.set("readonly", true);
  // KTX 的 SQLite 连接器读 `path`；`database` 是 Spec 149 §7 的字段名。
  conn.set("path", path.resolve(auditDbPath));
  conn.set("database", path.resolve(auditDbPath));
  const enabledTables = new YAMLSeq();
  for (const table of OPS_EVIDENCE_ENABLED_TABLES) enabledTables.items.push(table);
  conn.set("enabled_tables", enabledTables);
  const schemas = new YAMLSeq();
  schemas.items.push(OPS_EVIDENCE_FROZEN.schema);
  conn.set("schemas", schemas);
  return conn;
}

function buildEnabledTablesSeq(tables: string[]): YAMLSeq {
  const seq = new YAMLSeq();
  for (const table of tables) seq.items.push(table);
  return seq;
}

/**
 * 确保连接块存在且与契约一致；一致时仍可 union 扩展 enabled_tables（D22）。
 *
 * `conflict` 时**不写任何东西**。
 */
export async function ensureOpsEvidenceConnectionBlock(
  projectRoot: string,
  auditDbPath: string,
  options: { dryRun?: boolean } = {}
): Promise<OpsEvidenceBlockState> {
  const existing = await readOpsEvidenceBlock(projectRoot);
  const state = inspectOpsEvidenceBlock(existing, auditDbPath, projectRoot);
  if (state.write === "conflict") return state;

  if (state.write === "inserted") {
    await writeKtxYaml(
      projectRoot,
      (doc) => {
        let connections = doc.get("connections", true);
        if (!isMap(connections)) {
          connections = new YAMLMap();
          connections.flow = false;
          doc.set("connections", connections);
        }
        connections.set(
          OPS_EVIDENCE_CONNECTION_ID,
          buildOpsEvidenceConnectionBlock(auditDbPath)
        );
        // 刻意**不**碰 `setup.database_connection_ids`（Spec 149 Goal 5）。
      },
      { dryRun: options.dryRun === true }
    );
    return { write: "inserted" };
  }

  // unchanged（driver/path/readonly OK）→ 检查 enabled_tables 是否缺名。
  const currentTables = readEnabledTables(existing);
  const union = unionEnabledTables(currentTables);
  if (!union) {
    return { write: "unchanged", existingBlock: existing };
  }

  await writeKtxYaml(
    projectRoot,
    (doc) => {
      const connections = doc.get("connections", true);
      if (!isMap(connections)) return;
      const block = connections.get(OPS_EVIDENCE_CONNECTION_ID, true);
      if (!isMap(block)) return;
      block.set("enabled_tables", buildEnabledTablesSeq(union.next));
      // schemas 若缺失则补上；已有则不动。
      if (!isSeq(block.get("schemas", true))) {
        const schemas = new YAMLSeq();
        schemas.items.push(OPS_EVIDENCE_FROZEN.schema);
        block.set("schemas", schemas);
      }
    },
    { dryRun: options.dryRun === true }
  );

  return {
    write: "expanded",
    existingBlock: existing,
    addedTables: union.added
  };
}

/** 便于测试：读出 `setup.database_connection_ids`。 */
export async function readDatabaseConnectionIds(projectRoot: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseDocument(raw).toJS();
  } catch {
    return [];
  }
  const setup = (parsed as Record<string, unknown> | undefined)?.setup;
  if (!setup || typeof setup !== "object") return [];
  const ids = (setup as Record<string, unknown>).database_connection_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((value): value is string => typeof value === "string");
}
