/**
 * Spec 149 — 运维问数连接（Ops Evidence Connection）的共享契约。
 * Spec 20261101 — 可问治理面：W1／W2 源名并列；ensure 扩 enabled_tables（D22）。
 *
 * 连接 ID、角色 ID、Skill 名与 Agent ID 的**唯一事实源**在
 * `webui/src/lib/opsEvidence.ts`（前后端都能引用）。本模块在此基础上补充
 * 后端专用的冻结结果与错误码。
 *
 * 术语（`webui/docs/00-product-terminology-standard.md` §4.7 / §4.7.3）：
 * - 运维问数连接 = 连接 ID `lucy-ops`
 * - 运维问数角色 = Role ID `lucy_ops_reader`
 * - 运维问数 Skill = Skill 名 `ops-questioning`
 * - 演示运维问数 Agent = 用户 ID `demo_ops`
 */

export {
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_ROLE_ID,
  OPS_EVIDENCE_SKILL_NAME,
  OPS_EVIDENCE_DEMO_USER_ID
} from "../../src/lib/opsEvidence.js";

import {
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_ROLE_ID,
  OPS_EVIDENCE_SKILL_NAME,
  OPS_EVIDENCE_DEMO_USER_ID
} from "../../src/lib/opsEvidence.js";

/** 运维问数 Skill / Wiki 的目录名（内容根与项目根镜像都按这个名字落位）。 */
export const OPS_EVIDENCE_ASSET_DIR = OPS_EVIDENCE_CONNECTION_ID;

/** W0 — Spec 149 两张调用流水视图（无 snapshot_id）。 */
export const OPS_EVIDENCE_LEGACY_SOURCE_NAMES = ["ops_calls", "ops_call_tables"] as const;

/** W1 — 可问治理面源（含 snapshot_id）。 */
export const OPS_EVIDENCE_W1_SOURCE_NAMES = [
  "ops_agents",
  "ops_tokens",
  "ops_agent_activity",
  "ops_question_kpi_agents"
] as const;

/** W2 — 图结构／表采用（含 snapshot_id；复用 access-map builder）。 */
export const OPS_EVIDENCE_W2_SOURCE_NAMES = [
  "ops_grant_paths",
  "ops_access_paths",
  "ops_edge_signals",
  "ops_map_nodes",
  "ops_map_meta",
  "ops_table_adoption"
] as const;

/** 当前交付的全部 source 名（W0 ∪ W1 ∪ W2）。 */
export const OPS_EVIDENCE_SOURCE_NAMES = [
  ...OPS_EVIDENCE_LEGACY_SOURCE_NAMES,
  ...OPS_EVIDENCE_W1_SOURCE_NAMES,
  ...OPS_EVIDENCE_W2_SOURCE_NAMES
] as const;

/** 治理投影源（须绑定 materialization_id）。 */
export const OPS_EVIDENCE_GOVERNANCE_SOURCE_NAMES = [
  ...OPS_EVIDENCE_W1_SOURCE_NAMES,
  ...OPS_EVIDENCE_W2_SOURCE_NAMES
] as const;

export type OpsEvidenceLegacySourceName = (typeof OPS_EVIDENCE_LEGACY_SOURCE_NAMES)[number];
export type OpsEvidenceW1SourceName = (typeof OPS_EVIDENCE_W1_SOURCE_NAMES)[number];
export type OpsEvidenceW2SourceName = (typeof OPS_EVIDENCE_W2_SOURCE_NAMES)[number];
export type OpsEvidenceGovernanceSourceName = (typeof OPS_EVIDENCE_GOVERNANCE_SOURCE_NAMES)[number];
export type OpsEvidenceSourceName = (typeof OPS_EVIDENCE_SOURCE_NAMES)[number];

/**
 * T0 冻结的名字（Spec 149 §5.2 + 可问治理面 W1／W2）。
 *
 * 四个字段**各管各的**，不得互相代替：
 * - `schema`：`_schema/<schema>.yaml` 的文件名，也是 Role `tableSelectors.schema`。
 * - `sourceName`：Manifest 表键，也是 overlay 文件名，也是 Role `tableSelectors.names`。
 * - `physicalTable`：Manifest `table:`，来自交付 KTX 版本的目录。
 * - `enabledTables`：连接块里的启用表范围，与 `physicalTable` 同源。
 *
 * SQLite 目录返回裸表名 → physicalTable / enabled_tables 用裸名。
 */
export const OPS_EVIDENCE_FROZEN = {
  schema: "main",
  sourceName: {
    ops_calls: "ops_calls",
    ops_call_tables: "ops_call_tables",
    ops_agents: "ops_agents",
    ops_tokens: "ops_tokens",
    ops_agent_activity: "ops_agent_activity",
    ops_question_kpi_agents: "ops_question_kpi_agents",
    ops_grant_paths: "ops_grant_paths",
    ops_access_paths: "ops_access_paths",
    ops_edge_signals: "ops_edge_signals",
    ops_map_nodes: "ops_map_nodes",
    ops_map_meta: "ops_map_meta",
    ops_table_adoption: "ops_table_adoption"
  } satisfies Record<OpsEvidenceSourceName, string>,
  physicalTable: {
    ops_calls: "ops_calls",
    ops_call_tables: "ops_call_tables",
    ops_agents: "ops_agents",
    ops_tokens: "ops_tokens",
    ops_agent_activity: "ops_agent_activity",
    ops_question_kpi_agents: "ops_question_kpi_agents",
    ops_grant_paths: "ops_grant_paths",
    ops_access_paths: "ops_access_paths",
    ops_edge_signals: "ops_edge_signals",
    ops_map_nodes: "ops_map_nodes",
    ops_map_meta: "ops_map_meta",
    ops_table_adoption: "ops_table_adoption"
  } satisfies Record<OpsEvidenceSourceName, string>
} as const;

/** 连接块的 `enabled_tables`（= 冻结后的 physicalTable 集合）。 */
export const OPS_EVIDENCE_ENABLED_TABLES: string[] = OPS_EVIDENCE_SOURCE_NAMES.map(
  (name) => OPS_EVIDENCE_FROZEN.physicalTable[name]
);

/** 旧源：跳过 gov.* / 快照分支（N01）。 */
export function isOpsEvidenceLegacySource(sourceName: string | null | undefined): boolean {
  if (typeof sourceName !== "string") return false;
  return (OPS_EVIDENCE_LEGACY_SOURCE_NAMES as readonly string[]).includes(sourceName.trim());
}

/** W1／W2 治理源：须绑定 materialization_id。 */
export function isOpsEvidenceGovernanceSource(sourceName: string | null | undefined): boolean {
  if (typeof sourceName !== "string") return false;
  return (OPS_EVIDENCE_GOVERNANCE_SOURCE_NAMES as readonly string[]).includes(sourceName.trim());
}

// ─── 错误码 ─────────────────────────────────────────────────────────────────

/** 删除连接时被拒绝（HTTP 400）。 */
export const OPS_EVIDENCE_CONNECTION_PROTECTED = "OPS_EVIDENCE_CONNECTION_PROTECTED";

/** 已有连接块与契约不一致（driver / 路径 / readonly）。 */
export const OPS_EVIDENCE_CONNECTION_CONFLICT = "OPS_EVIDENCE_CONNECTION_CONFLICT";

/** 连接已配置但执行层尚未加载（daemon 启动后才补上 / 需要重载）。 */
export const OPS_EVIDENCE_RUNTIME_NOT_READY = "OPS_EVIDENCE_RUNTIME_NOT_READY";

/** 内容根里的资产与模板字节不同：保留原文件并记冲突。 */
export const OPS_EVIDENCE_ASSET_CONFLICT = "OPS_EVIDENCE_ASSET_CONFLICT";

/** 治理投影未就绪／半份物化未发布（SC-18）。 */
export const OPS_EVIDENCE_GOVERNANCE_UNREADY = "OPS_EVIDENCE_GOVERNANCE_UNREADY";

// ─── 就绪状态 ───────────────────────────────────────────────────────────────

/**
 * 连接就绪状态。
 *
 * - `current`：连接块一致、内容根镜像完成、摘要戳与当前 `ktx.yaml` 一致 →
 *   执行层已加载，可以查询。
 * - `reload_required`：配置已写入但执行层还没加载（daemon 启动后才补上的连接）。
 * - `conflict`：已有连接块与契约不一致 → 不覆盖，且拒绝查询。
 * - `not_ready`：内容根镜像失败 → 执行层可能仍看见旧目录，状态保持未就绪。
 */
export type OpsEvidenceReadiness = "current" | "reload_required" | "conflict" | "not_ready";

/** 摘要戳的相对路径（`<projectRoot>/.lucy-seed/ops-evidence-ktx-digest`）。 */
export const OPS_EVIDENCE_DIGEST_STAMP_REL = ".lucy-seed/ops-evidence-ktx-digest";

/** 已有连接块与契约不一致时的告警文案（Spec 149 §7）。 */
export const OPS_EVIDENCE_CONNECTION_CONFLICT_MESSAGE =
  "运维问数连接配置不一致，未改写";

/** 内容根资产与模板字节不同时的告警文案（Spec 149 §5.5）。 */
export const OPS_EVIDENCE_ASSET_CONFLICT_MESSAGE =
  "运维问数资产配置不一致，未改写";
