/**
 * Spec 149 §7 — `connections.lucy-ops` 连接块的确保与一致性裁决。
 *
 * 契约：
 * - 缺失 → 写入 `driver: sqlite`、`readonly: true`、审计库绝对路径、
 *   `schemas: [main]`、`enabled_tables` = T0 冻结的 physicalTable。
 * - 三者（driver / 路径 / readonly）一致 → 不改文件。
 * - 任一不一致 → **不覆盖**，状态 `conflict`，目录不列出该连接，查询返回
 *   `OPS_EVIDENCE_CONNECTION_CONFLICT`。
 *
 * 不调用 `createConnection`（那会追加 `setup.database_connection_ids`），
 * 也不改其它连接。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import {
  OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_ENABLED_TABLES,
  OPS_EVIDENCE_FROZEN
} from "./contract.js";
import { writeKtxYaml } from "../project.js";

export type OpsEvidenceConnectionWrite = "inserted" | "unchanged" | "conflict";

export type OpsEvidenceConflictField = "driver" | "database" | "readonly";

export interface OpsEvidenceBlockState {
  write: OpsEvidenceConnectionWrite;
  /** 冲突字段（仅 conflict）。 */
  conflictField?: OpsEvidenceConflictField;
  /** 面向管理员的冲突说明（仅 conflict）。 */
  conflictReason?: string;
  /** 冲突时读到的原块，用于证明「未改写」。 */
  existingBlock?: Record<string, unknown>;
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

/**
 * 裁决已有块是否与契约一致。
 *
 * `block` 为 `undefined` 表示连接不存在 → 需要写入。
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
  // KTX 的 SQLite 连接器读 `path`（见 ktx `connectors/sqlite/connector.js`：
  // "requires connections.<id>.path or url"）；`database` 是 Spec 149 §7 的
  // 字段名，写成同值，两边读到的都是当前审计热库。
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

/**
 * 确保连接块存在且与契约一致。
 *
 * `conflict` 时**不写任何东西**：原块保留，目录不列出该连接，查询按
 * `OPS_EVIDENCE_CONNECTION_CONFLICT` 拒绝。
 */
export async function ensureOpsEvidenceConnectionBlock(
  projectRoot: string,
  auditDbPath: string,
  options: { dryRun?: boolean } = {}
): Promise<OpsEvidenceBlockState> {
  const existing = await readOpsEvidenceBlock(projectRoot);
  const state = inspectOpsEvidenceBlock(existing, auditDbPath, projectRoot);
  if (state.write !== "inserted") return state;

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
