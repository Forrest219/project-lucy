export type ConfigAuditAssetKind = "governance" | "semantic" | "wiki" | "eval" | "publish";

export const ASSET_KIND_LABELS: Record<ConfigAuditAssetKind, string> = {
  governance: "访问治理",
  semantic: "语义 YAML",
  wiki: "业务 Wiki",
  eval: "评测",
  publish: "发布"
};

export const SOURCE_LABELS: Record<string, string> = {
  admin_agents_api: "Agent 管理",
  admin_roles_api: "角色管理",
  admin_tokens_api: "Token 管理",
  admin_access_config_api: "访问配置",
  connections_enabled_tables_api: "启用表范围",
  connections_schema_add_api: "连接 Schema",
  semantic_layer_patch_api: "表语义保存",
  semantic_layer_import_api: "表语义导入",
  wiki_api: "业务 Wiki",
  eval_cases_api: "评测用例",
  eval_suite_import_api: "评测套件导入",
  security_candidates_api: "安全候选",
  publish_workbench_api: "发布工作台"
};

export type ChangeTypeOption = {
  value: string;
  label: string;
  assetKinds: ConfigAuditAssetKind[];
};

export const CHANGE_TYPE_OPTIONS: ChangeTypeOption[] = [
  { value: "agent_create", label: "创建 Agent", assetKinds: ["governance"] },
  { value: "agent_patch", label: "Agent 信息变更", assetKinds: ["governance"] },
  { value: "agent_delete", label: "删除 Agent", assetKinds: ["governance"] },
  { value: "role_create", label: "创建角色", assetKinds: ["governance"] },
  { value: "role_patch", label: "角色变更", assetKinds: ["governance"] },
  { value: "role_delete", label: "删除角色", assetKinds: ["governance"] },
  { value: "token_create", label: "创建 Token", assetKinds: ["governance"] },
  { value: "token_revoke", label: "吊销 Token", assetKinds: ["governance"] },
  { value: "enabled_tables_update", label: "启用表范围更新", assetKinds: ["governance"] },
  { value: "schema_add", label: "新增 Schema", assetKinds: ["governance"] },
  { value: "schema_remove", label: "移除 Schema", assetKinds: ["governance"] },
  { value: "connection_create", label: "新建连接", assetKinds: ["governance"] },
  { value: "connection_delete", label: "删除连接", assetKinds: ["governance"] },
  { value: "semantic_table_save", label: "表语义保存", assetKinds: ["semantic"] },
  { value: "semantic_table_import", label: "表语义导入", assetKinds: ["semantic"] },
  { value: "wiki_create", label: "新建 Wiki", assetKinds: ["wiki"] },
  { value: "wiki_edit_save", label: "编辑 Wiki", assetKinds: ["wiki"] },
  { value: "wiki_upload_create", label: "上传新建 Wiki", assetKinds: ["wiki"] },
  { value: "wiki_upload_replace", label: "上传覆盖 Wiki", assetKinds: ["wiki"] },
  { value: "wiki_restore", label: "恢复 Wiki 版本", assetKinds: ["wiki"] },
  { value: "wiki_move", label: "移动 Wiki", assetKinds: ["wiki"] },
  { value: "eval_case_save", label: "评测用例保存", assetKinds: ["eval"] },
  { value: "eval_suite_import", label: "评测套件导入", assetKinds: ["eval"] },
  { value: "eval_security_candidate_promote", label: "安全候选晋级", assetKinds: ["eval"] },
  { value: "semantic_publish", label: "语义资产发布", assetKinds: ["publish"] }
];

export const CONFIG_AUDIT_CSV_HEADERS = [
  "时间",
  "操作者",
  "来源",
  "资产域",
  "变更类型",
  "目标",
  "文件路径"
] as const;

export function actorLabel(actor: string): string {
  if (actor === "local-admin") return "本机管理员";
  return actor;
}

export function assetKindLabel(kind: string | undefined | null): string {
  if (!kind) return "—";
  return ASSET_KIND_LABELS[kind as ConfigAuditAssetKind] ?? kind;
}

export function sourceLabel(source: string | undefined | null): string {
  if (!source) return "—";
  return SOURCE_LABELS[source] ?? source;
}

export function changeTypeLabel(changeType: string): string {
  return CHANGE_TYPE_OPTIONS.find((item) => item.value === changeType)?.label ?? changeType;
}

/** Display timestamp for ops audit tables / CSV (Asia/Shanghai, zh-CN). */
export function formatConfigAuditTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

/** Export filename stamp: YYYYMMDD-HHmmss in Asia/Shanghai. */
export function formatConfigAuditExportFilenameStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

export function targetLabel(targetId: string | undefined | null): string {
  return targetId && targetId.length > 0 ? targetId : "—";
}
