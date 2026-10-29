/**
 * Spec 149 — 运维问数连接（Ops Evidence Connection）的共享契约。
 *
 * 连接 ID、角色 ID、Skill 名与 Agent ID 的**唯一事实源**在
 * `webui/src/lib/opsEvidence.ts`（前后端都能引用）。本模块在此基础上补充
 * 后端专用的冻结结果与错误码。
 *
 * 术语（`webui/docs/00-product-terminology-standard.md` §4.7）：
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

/** 两张视图的 source 名（= Manifest 表键 = overlay 文件名）。 */
export const OPS_EVIDENCE_SOURCE_NAMES = ["ops_calls", "ops_call_tables"] as const;

export type OpsEvidenceSourceName = (typeof OPS_EVIDENCE_SOURCE_NAMES)[number];

/**
 * T0 冻结的四个名字（Spec 149 §5.2）。
 *
 * 四个字段**各管各的**，不得互相代替：
 * - `schema`：`_schema/<schema>.yaml` 的文件名，也是 Role `tableSelectors.schema`。
 *   Role 匹配 schema 用的是 `_schema/*.yaml` 的文件名，**不是**物理表名。
 * - `sourceName`：Manifest 表键，也是 overlay 文件名，也是 Role `tableSelectors.names`。
 * - `physicalTable`：Manifest `table:`，来自交付 KTX 版本的目录。
 * - `enabledTables`：连接块里的启用表范围，与 `physicalTable` 同源。
 *
 * 冻结依据：镜像 `ARG KTX_VERSION` 所钉住的 KTX **0.16.0**（`Dockerfile`）。
 * 该版本的 SQLite 目录（`connectors/sqlite/connector.js` 的 `introspect` /
 * `listTables` + `context/ingest/adapters/live-database/manifest.js` 的
 * `buildTableRef`）对 SQLite 返回 **catalog=null、db=null、name=裸表名**：
 * - 目录给出的是**无前缀名** → `physicalTable` 用裸名，**不是** `main.ops_calls`；
 * - `enabled_tables` 必须与之一致：KTX 的 `scopedTableNames(scope, {catalog:null,db:null})`
 *   对 `main.ops_calls` 这类带段的名字解析出 db=`main`，与命名空间不匹配而**落空**；
 * - 目录返回不带 schema 的表名 → Role `schema` **仍保持 `main`**（我们自己写
 *   `_schema/main.yaml`，文件名就是 Role 匹配的依据）。
 *
 * 版本变化后必须重做 T0 并同步本文件。
 */
export const OPS_EVIDENCE_FROZEN = {
  schema: "main",
  sourceName: {
    ops_calls: "ops_calls",
    ops_call_tables: "ops_call_tables"
  } satisfies Record<OpsEvidenceSourceName, string>,
  physicalTable: {
    ops_calls: "ops_calls",
    ops_call_tables: "ops_call_tables"
  } satisfies Record<OpsEvidenceSourceName, string>
} as const;

/** 连接块的 `enabled_tables`（= 冻结后的 physicalTable 集合）。 */
export const OPS_EVIDENCE_ENABLED_TABLES: string[] = OPS_EVIDENCE_SOURCE_NAMES.map(
  (name) => OPS_EVIDENCE_FROZEN.physicalTable[name]
);

// ─── 错误码 ─────────────────────────────────────────────────────────────────

/** 删除连接时被拒绝（HTTP 400）。 */
export const OPS_EVIDENCE_CONNECTION_PROTECTED = "OPS_EVIDENCE_CONNECTION_PROTECTED";

/** 已有连接块与契约不一致（driver / 路径 / readonly）。 */
export const OPS_EVIDENCE_CONNECTION_CONFLICT = "OPS_EVIDENCE_CONNECTION_CONFLICT";

/** 连接已配置但执行层尚未加载（daemon 启动后才补上 / 需要重载）。 */
export const OPS_EVIDENCE_RUNTIME_NOT_READY = "OPS_EVIDENCE_RUNTIME_NOT_READY";

/** 内容根里的资产与模板字节不同：保留原文件并记冲突。 */
export const OPS_EVIDENCE_ASSET_CONFLICT = "OPS_EVIDENCE_ASSET_CONFLICT";

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
