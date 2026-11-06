/**
 * Spec 149 §7 — `connections.lucy-ops` 连接块的确保与一致性裁决。
 * Spec 20261101 D22 — driver/path/readonly 一致时仍须扩展 enabled_tables。
 * Spec 20261104 §4.2 — enabled_tables **以 Manifest 物理表为上限**。
 *
 * 契约：
 * - 缺失 → 写入 `driver: sqlite`、`readonly: true`、审计库绝对路径、
 *   `schemas: [main]`、`enabled_tables` = 冻结集合 ∩ Manifest 物理表。
 * - 三者（driver / 路径 / readonly）一致 → 把 `enabled_tables` 收敛到
 *   Manifest：补齐冻结集合里 Manifest 已有的表，移出 Manifest 里没有的
 *   孤儿启用，状态 `expanded`；已一致则 `unchanged`。
 * - 任一不一致 → **不覆盖**，状态 `conflict`。
 *
 * **没有 Manifest 约束就不写 enabled_tables**：本模块不再提供无约束的
 * 盲目 union（Spec 20261104 §1 的根因）。
 *
 * **本模块不写 `access.yaml`。** 正式 Role `lucy_ops_reader` 的缺则创建例外
 * 在 `ensureOpsEvidence` 成功返回前，见
 * `docs/specs/lucy-20261105-customer-default-system-roles-spec.md` §3.2。
 * 旧句「永不写 access.yaml」作为绝对值已作废，不得当作现值。
 * 已存在的正式 Role 仍不由连接块或 ensure 扩权。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import {
  OPS_EVIDENCE_ASSET_DIR,
  OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE,
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_ENABLED_TABLES,
  OPS_EVIDENCE_FROZEN
} from "./contract.js";
import { writeKtxYaml } from "../project.js";
import type { ContentPaths } from "../paths.js";

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
  /** 本次写进 enabled_tables 的表名（仅 expanded）。 */
  enabledTables?: string[];
  /** 新增进 enabled_tables 的表名（仅 expanded）。 */
  addedTables?: string[];
  /** 被移出 enabled_tables 的表名（仅 expanded）。 */
  removedTables?: string[];
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
 * 计划写入的 `enabled_tables`：冻结的 physicalTable ∩ Manifest 物理表。
 *
 * 这是 ensure 之后「启用表范围」的上限：Manifest 里没有的冻结表**不得**被
 * 启用，否则 WebUI 会出现「已启用 · 本地无 Manifest」的孤儿启用。
 */
export function planOpsEvidenceEnabledTables(manifestPhysicalTables: Iterable<string>): string[] {
  const present = new Set(manifestPhysicalTables);
  return OPS_EVIDENCE_ENABLED_TABLES.filter((table) => present.has(table));
}

/**
 * 把已有的 `enabled_tables` 收敛到 Manifest：
 *
 * - 保留 Manifest 里已经启用的表（含定制 Manifest 里的自定义表）；
 * - 移出 Manifest 里没有的表（孤儿启用）；
 * - 补齐冻结集合里 Manifest 已经有的表（新源随 Manifest 升级自动进启用范围）。
 */
export function mergeOpsEvidenceEnabledTables(
  existing: string[],
  manifestPhysicalTables: Iterable<string>
): { next: string[]; added: string[]; removed: string[] } {
  const manifestTables = new Set(manifestPhysicalTables);
  const planned = planOpsEvidenceEnabledTables(manifestTables);
  const surviving = existing.filter((table) => manifestTables.has(table));
  const next: string[] = [];
  for (const table of [...surviving, ...planned]) {
    if (!next.includes(table)) next.push(table);
  }
  const previous = new Set(existing);
  return {
    next,
    added: planned.filter((table) => !previous.has(table)),
    removed: existing.filter((table) => !next.includes(table))
  };
}

/** Manifest 在内容根 / 项目根里的相对路径（`semantic-layer/lucy-ops/_schema/main.yaml`）。 */
function opsEvidenceManifestRelPath(): string {
  return path.posix.join(
    "semantic-layer",
    OPS_EVIDENCE_ASSET_DIR,
    "_schema",
    `${OPS_EVIDENCE_FROZEN.schema}.yaml`
  );
}

/** 解析一个 Manifest 文件里的物理表名集合；读不到或解析失败返回 `null`。 */
async function readManifestPhysicalTables(absPath: string): Promise<Set<string> | null> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseDocument(raw).toJS();
  } catch {
    return null;
  }
  const tables = (parsed as { tables?: unknown } | null)?.tables;
  if (!tables || typeof tables !== "object") return new Set<string>();
  const physical = new Set<string>();
  for (const value of Object.values(tables as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const table = (value as { table?: unknown }).table;
    if (typeof table === "string" && table.trim().length > 0) physical.add(table.trim());
  }
  return physical;
}

/**
 * 读当前有效的 Manifest 物理表集合。
 *
 * 事实源是**项目根**（镜像后 KTX 读的那份）；项目根没有时回落到内容根
 * （`LUCY_CONTENT_ROOT=.` 的旧布局下两者是同一份）。
 *
 * 两处都读不到时返回空集合：没有本地 Manifest 就没有可启用的表。
 */
export async function readOpsEvidenceManifestPhysicalTables(
  projectRoot: string,
  contentPaths: ContentPaths
): Promise<Set<string>> {
  const candidates = [
    path.join(projectRoot, ...opsEvidenceManifestRelPath().split("/")),
    path.join(
      contentPaths.semanticLayer,
      OPS_EVIDENCE_ASSET_DIR,
      "_schema",
      `${OPS_EVIDENCE_FROZEN.schema}.yaml`
    )
  ];
  for (const absPath of candidates) {
    const physical = await readManifestPhysicalTables(absPath);
    if (physical) return physical;
  }
  return new Set<string>();
}

/**
 * 裁决已有块是否与契约一致（driver / 路径 / readonly）。
 *
 * `block` 为 `undefined` 表示连接不存在 → 需要写入。
 * 三者一致时返回 `unchanged`；**不**在此裁决 enabled_tables
 * （由 `ensureOpsEvidenceConnectionBlock` 按 Manifest 收敛）。
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
export function buildOpsEvidenceConnectionBlock(
  auditDbPath: string,
  enabledTables: readonly string[] = OPS_EVIDENCE_ENABLED_TABLES
): YAMLMap {
  const conn = new YAMLMap();
  conn.flow = false;
  conn.set("driver", "sqlite");
  conn.set("readonly", true);
  // KTX 的 SQLite 连接器读 `path`；`database` 是 Spec 149 §7 的字段名。
  conn.set("path", path.resolve(auditDbPath));
  conn.set("database", path.resolve(auditDbPath));
  conn.set("enabled_tables", buildEnabledTablesSeq([...enabledTables]));
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
 * 确保连接块存在且与契约一致，并把 `enabled_tables` 收敛到 Manifest。
 *
 * `manifestPhysicalTables` 是**必填**的：没有 Manifest 上限就不写
 * `enabled_tables`（Spec 20261104 §4.2）。
 *
 * `conflict` 时**不写任何东西**。
 */
export async function ensureOpsEvidenceConnectionBlock(
  projectRoot: string,
  auditDbPath: string,
  options: { dryRun?: boolean; manifestPhysicalTables: Iterable<string> }
): Promise<OpsEvidenceBlockState> {
  const manifestPhysicalTables = [...options.manifestPhysicalTables];
  const existing = await readOpsEvidenceBlock(projectRoot);
  const state = inspectOpsEvidenceBlock(existing, auditDbPath, projectRoot);
  if (state.write === "conflict") return state;

  if (state.write === "inserted") {
    const planned = planOpsEvidenceEnabledTables(manifestPhysicalTables);
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
          buildOpsEvidenceConnectionBlock(auditDbPath, planned)
        );
        // 刻意**不**碰 `setup.database_connection_ids`（Spec 149 Goal 5）。
      },
      { dryRun: options.dryRun === true }
    );
    return { write: "inserted", enabledTables: planned };
  }

  // unchanged（driver/path/readonly OK）→ 把 enabled_tables 收敛到 Manifest。
  const currentTables = readEnabledTables(existing);
  const merged = mergeOpsEvidenceEnabledTables(currentTables, manifestPhysicalTables);
  if (merged.next.length === currentTables.length && merged.next.every((t, i) => t === currentTables[i])) {
    return { write: "unchanged", existingBlock: existing, enabledTables: currentTables };
  }

  await writeKtxYaml(
    projectRoot,
    (doc) => {
      const connections = doc.get("connections", true);
      if (!isMap(connections)) return;
      const block = connections.get(OPS_EVIDENCE_CONNECTION_ID, true);
      if (!isMap(block)) return;
      block.set("enabled_tables", buildEnabledTablesSeq(merged.next));
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
    enabledTables: merged.next,
    addedTables: merged.added,
    removedTables: merged.removed
  };
}

/**
 * Plan 20261104 §4.2 的入口名：按 Manifest 物理表同步 `enabled_tables`
 * （含首次插入连接块）。
 */
export async function syncOpsEvidenceEnabledTables(
  projectRoot: string,
  auditDbPath: string,
  manifestPhysicalTables: Iterable<string>,
  options: { dryRun?: boolean } = {}
): Promise<OpsEvidenceBlockState> {
  return ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
    dryRun: options.dryRun,
    manifestPhysicalTables
  });
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
