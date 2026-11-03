/**
 * L25-16 — 运维控制面工具登记表（Spec §3.1 / §3.3）。
 *
 * 本模块是控制面工具的**单一事实源**：工具名、适用域（managed_asset_kinds）、
 * 是否连接域（connection_scoped）、是否 owner-only、读/写标记与原子性口径。
 *
 * 分类判定（`ToolClass = "ControlPlane"`）在 `webui/server/proxy/acl.ts` 中实现，
 * 但**工具名单从本模块导入**，避免两处各写一份清单。
 *
 * 本模块不得 import `proxy/acl.ts`：`acl.ts` 反向依赖本模块，导入会形成循环。
 */

/**
 * 域词汇复用 `ConfigAuditAssetKind`（governance | semantic | wiki | eval | publish | skill），
 * 不新增枚举，使授权与审计分类同源。这里结构化重复一次，避免 import 环。
 */
export type OpsAssetKind = "governance" | "semantic" | "wiki" | "eval" | "publish" | "skill";

export const OPS_ASSET_KINDS: readonly OpsAssetKind[] = [
  "governance",
  "semantic",
  "wiki",
  "eval",
  "publish",
  "skill"
];

/**
 * 原子性口径（Spec §4.3）：
 * - `batch_all_or_nothing`：整批全成或全拒（连接表——全部 KTX 连接配置在同一份 ktx.yaml）。
 * - `group_all_or_nothing`：组内全成或全败，组间部分成功可重放（源表导入——按写集交集分组）。
 */
export type OpsAtomicity = "batch_all_or_nothing" | "group_all_or_nothing";

export interface OpsToolSpec {
  name: string;
  title: string;
  description: string;
  /** 该工具适用的域集合；授权判定要求 grant 的 `asset_kinds` 覆盖它。 */
  managedAssetKinds: OpsAssetKind[];
  /** 是否绑定连接域；为真时 grant 必须显式给出 `connections`（缺省即拒绝）。 */
  connectionScoped: boolean;
  /** 是否要求 owner-only 委托人。 */
  ownerOnly: boolean;
  /** 是否写类。 */
  write: boolean;
  atomicity: OpsAtomicity;
}

export const CONTROL_PLANE_TOOLS: readonly OpsToolSpec[] = [
  {
    name: "lucy_ops_connection_tables",
    title: "批量维护连接的启用表范围",
    description:
      "批量设置连接的启用表范围 / 移除 Schema。只改 ktx.yaml，不删除语义文件。" +
      "整批全成或全拒：任一连接校验失败或检测到外部修改，整批不写。",
    managedAssetKinds: ["governance"],
    connectionScoped: true,
    ownerOnly: false,
    write: true,
    atomicity: "batch_all_or_nothing"
  },
  {
    name: "lucy_ops_source_import",
    title: "批量导入源表语义",
    description:
      "批量导入源表语义 / 校验 / 版本回滚。写集相交的目标构成一个原子组，组内全成或全败，" +
      "组间可部分成功并重放。版本回滚经导入写服务落盘。",
    managedAssetKinds: ["semantic"],
    connectionScoped: true,
    ownerOnly: false,
    write: true,
    atomicity: "group_all_or_nothing"
  }
];

export const CONTROL_PLANE_TOOL_NAMES: readonly string[] = CONTROL_PLANE_TOOLS.map((tool) => tool.name);

const CONTROL_PLANE_TOOL_BY_NAME = new Map<string, OpsToolSpec>(
  CONTROL_PLANE_TOOLS.map((tool) => [tool.name, tool])
);

export function getOpsToolSpec(name: string): OpsToolSpec | undefined {
  return CONTROL_PLANE_TOOL_BY_NAME.get(name);
}

export function isControlPlaneTool(name: string): boolean {
  return CONTROL_PLANE_TOOL_BY_NAME.has(name);
}

export function isOpsAssetKind(value: string): value is OpsAssetKind {
  return (OPS_ASSET_KINDS as readonly string[]).includes(value);
}
