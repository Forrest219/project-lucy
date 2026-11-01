/**
 * 行权限视图（/admin/row-policies）的**唯一基准线**。
 *
 * 取值与真实 demo 实例一致（容器 project-lucy-lucy-1，http://127.0.0.1:55176）：
 *
 *   连接   demo-mysql     本地 demo MySQL（容器 demo-db），数据库 dataforai
 *   Schema dataforai
 *   表     superstore_orders（1000 行）、superstore_people（4 行）、superstore_returns（60 行）
 *
 * 规则：行权限场景的用例**不得**硬编码表身份，一律引用本文件。演示环境换连接或
 * 换表时只改这里，用例与断言不动；这样同一套断言既能跑 mock E2E，也能对着
 * 真实 demo 实例跑（真实实例上 `dataforai.superstore_orders` 的 region 实测取值为
 * Northeast／Southwest／East／Central South）。
 */

/** 基准线连接 ID。 */
export const DEMO_CONNECTION = "demo-mysql";

/** 基准线 Schema。 */
export const DEMO_SCHEMA = "dataforai";

/** 基准线三张表。键是语义角色，值是真实的 sourceName。 */
export const DEMO_TABLES = {
  orders: "superstore_orders",
  people: "superstore_people",
  returns: "superstore_returns"
} as const;

/**
 * 备用 Schema —— 只给「同名不同 Schema 不合并」的身份合同用例用。
 *
 * 真实 demo 实例的 demo-mysql 只有一个 Schema（dataforai），所以这条用例在
 * 对真实实例运行时会被跳过；在 E2E 夹具里它是夹具自带的第二个 Schema。
 */
export const DEMO_SCHEMA_ALT = "openclaw_db";

/** demo 数据里真实存在的 region 取值（dataforai.superstore_orders 实测）。 */
export const DEMO_REGION_EAST = "East";
export const DEMO_REGION_SOUTHWEST = "Southwest";

// ─── 演示实例上的 Role / Agent 命名 ──────────────────────────────────────────
//
// 与 demo 实例 access.yaml 一一对应（2026-11-01 实测）：
//
//   Role   demo_readonly          连接 demo-mysql、Schema dataforai、全部行
//   Role   demo_east_reader       同一张表仅 East 行（走模板 by_region_east）
//   Role   demo_southwest_reader  同一张表仅 Southwest 行（内联谓词）
//   Agent  demo_agent             持 demo_readonly
//   Agent  demo-east-agent        持 demo_east_reader
//   Agent  demo-southwest-agent   持 demo_southwest_reader
//
// 用例与断言一律引用这里；换环境只改本文件。

/** 全部行 Role。 */
export const DEMO_ROLE_ALL = "demo_readonly";

/** 模板限行 Role（East）。 */
export const DEMO_ROLE_EAST = "demo_east_reader";

/** 内联谓词限行 Role（Southwest）。 */
export const DEMO_ROLE_SOUTHWEST = "demo_southwest_reader";

/** 全部行 Agent。 */
export const DEMO_AGENT_ALL = "demo_agent";

/** 模板限行 Agent（East）。 */
export const DEMO_AGENT_EAST = "demo-east-agent";

/** 内联谓词限行 Agent（Southwest）。 */
export const DEMO_AGENT_SOUTHWEST = "demo-southwest-agent";

/** 演示实例上的行权限模板名。 */
export const DEMO_TEMPLATE_EAST = "by_region_east";

/** 表身份三元组文本（页面上的 `conn/schema/source` 形态）。 */
export function demoIdentity(connectionId: string, schema: string, sourceName: string): string {
  return `${connectionId}/${schema}/${sourceName}`;
}

/** 清单行的 data-testid。 */
export function demoTableTestId(connectionId: string, schema: string, sourceName: string): string {
  return `row-policy-view-table-${connectionId}-${schema}-${sourceName}`;
}

/** 单表详情深链（三个身份参数缺一不可，参数名不得改）。 */
export function demoDeepLink(connectionId: string, schema: string, sourceName: string): string {
  return `/admin/row-policies?connectionId=${connectionId}&schema=${schema}&sourceName=${sourceName}`;
}

/** 物理表名（`schema.source`）。 */
export function demoPhysicalTable(schema: string, sourceName: string): string {
  return `${schema}.${sourceName}`;
}
