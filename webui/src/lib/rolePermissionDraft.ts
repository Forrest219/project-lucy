/**
 * T1 — 草稿纯函数：角色权限配置信息架构 (Spec WO-202609-23)
 *
 * 纯函数，无副作用，无外部依赖。与 acl.ts 的 ABSOLUTE_DENY_TOOLS 保持集合相等
 * 由 server/__tests__/role-permission-draft-parity.test.ts 静态 import 断言。
 */

import type { RoleUserReference } from "./types";

// ─── AbsoluteDeny ────────────────────────────────────────────────────────────

/**
 * 系统绝对禁止工具名数组。成员集合必须与 webui/server/proxy/acl.ts 的
 * ABSOLUTE_DENY_TOOLS 相等（由 parity 测试静态断言）。
 */
export const ABSOLUTE_DENY_TOOL_NAMES = [
  "sl_query",
  "sl_read_source",
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status",
] as const;

// ─── Presets ─────────────────────────────────────────────────────────────────

/** 只读问答预设：恰好 6 个工具，不含 sl_validate。 */
export const READONLY_QA_PRESET = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question",
] as const;

/** 只读问答 + 知识库预设：只读问答 + wiki_search、wiki_read，共 8 个。 */
export const READONLY_QA_WIKI_PRESET = [
  ...READONLY_QA_PRESET,
  "wiki_search",
  "wiki_read",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Spec 150: v2 editing supports explicit names or catalog binding only. */
export type ScopeMode = "names" | "catalog_bound";

export type PresetName = "只读问答" | "只读问答 + 知识库";

export interface PartitionedTools {
  /** 可授予工具（不属于 AbsoluteDeny）。 */
  grantable: string[];
  /** 被拒绝工具（仅含 AbsoluteDeny 成员）。 */
  rejected: string[];
}

export interface RowPolicyPredicateDraft {
  field: string;
  op: "eq" | "in";
  /** eq 时为单值，in 时为数组。 */
  value: string | string[];
}

export interface TableGrant {
  connection: string;
  schema: string;
  /** 表的 source name（schema 内）。 */
  name: string;
  /** 行级策略谓词列表。空或 undefined 表示全部行。 */
  predicates?: RowPolicyPredicateDraft[];
}

export type PermissionSection = "overview" | "tables" | "tools" | "rowPolicy" | "usage";

export type RolePermissionDraft = {
  roleId: string;
  description: string;
  scope:
    | { mode: "names"; tables: TableGrant[] }
    | { mode: "catalog_bound"; connections: string[] };
  tools: string[];
};

export type PermissionRisk = "expanded" | "contracted" | "mixed" | "unchanged";

export interface PermissionImpactSummary {
  tablesAdded: string[];
  tablesRemoved: string[];
  toolsAdded: string[];
  toolsRemoved: string[];
  rowPoliciesChanged: string[];
  rejectedToolsRemoved: string[];
  catalogBoundChange: "enabled" | "disabled" | null;
  risk: PermissionRisk;
  affectedAgents: RoleUserReference[];
}

/** 输出给 access.yaml 的 names selector（草稿形态）。 */
export interface NamesSelectorDraft {
  connection: string;
  schema: string;
  names: string[];
  /** 仅在有行策略时写入 "scoped"。 */
  row_access?: "scoped";
  /**
   * 仅在 row_access === "scoped" 时写入。
   * predicates 格式与 acl.ts compileScopedRowGrant 期待的 YAML 形状一致。
   */
  row_policy?: {
    predicates: Array<{
      sourceName: string;
      field: string;
      op: "eq" | "in";
      value?: string;
      values?: string[];
    }>;
  };
}

export interface RowPolicyDigestEntry {
  /** 表名（用于摘要文案）。 */
  table: string;
  field: string;
  /** 取值（eq 时为单值字符串，in 时为 "v1, v2" 形式）。 */
  value: string;
}

export interface DigestInput {
  connections: string[];
  tableCount: number;
  /** null 时省略「（对应 M 个已发布指标）」，禁止输出「对应 0 个」。 */
  publishedMeasureCount: number | null;
  toolCount: number;
  mode: ScopeMode;
  rowPolicies?: RowPolicyDigestEntry[];
}

// ─── Preset functions ─────────────────────────────────────────────────────────

/**
 * Stamp：返回预设的完整副本，忽略 current。不是并集。
 */
export function stampPreset(
  _current: readonly string[] | string[],
  preset: readonly string[] | string[]
): string[] {
  return [...preset];
}

/**
 * 集合相等时返回预设名称；多一个或少一个返回 null；顺序无关。
 */
export function matchingPresetName(tools: string[]): PresetName | null {
  const toolSet = new Set(tools);
  const wikiSet = new Set(READONLY_QA_WIKI_PRESET);
  const qaSet = new Set(READONLY_QA_PRESET);

  if (toolSet.size === wikiSet.size && [...wikiSet].every((t) => toolSet.has(t))) {
    return "只读问答 + 知识库";
  }
  if (toolSet.size === qaSet.size && [...qaSet].every((t) => toolSet.has(t))) {
    return "只读问答";
  }
  return null;
}

// ─── Tool partition ───────────────────────────────────────────────────────────

/**
 * 拆分可授与工具和拒绝工具。rejected 只含 AbsoluteDeny 成员。
 */
export function partitionGrantableTools(tools: string[]): PartitionedTools {
  const denySet = new Set<string>(ABSOLUTE_DENY_TOOL_NAMES);
  const grantable: string[] = [];
  const rejected: string[] = [];
  for (const tool of tools) {
    if (denySet.has(tool)) {
      rejected.push(tool);
    } else {
      grantable.push(tool);
    }
  }
  return { grantable, rejected };
}

// ─── Connection derivation ────────────────────────────────────────────────────

/**
 * 从已选表或手工列表推导连接列表。
 * - names：连接 = 已选表的连接去重（顺序保留首次出现）。
 * - catalog_bound：连接 = 调用方传入的手工列表，不从空表树推导。
 */
export function deriveConnections(
  tables: Array<{ connection: string }>,
  mode: ScopeMode,
  catalogConnections?: string[]
): string[] {
  if (mode === "catalog_bound") {
    return catalogConnections ? [...catalogConnections] : [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tables) {
    if (!seen.has(t.connection)) {
      seen.add(t.connection);
      result.push(t.connection);
    }
  }
  return result;
}

// ─── Table grant grouping ─────────────────────────────────────────────────────

/**
 * 把表授权列表合并为 names selector 数组：
 * - 同连接 + 同 Schema + 行策略完全相同的表，合并为一个 names selector。
 * - 策略不同的表拆成独立 selector。
 * - 全部行：不写 row_policy，不写 row_access。
 * - 限定行：写 row_access: "scoped" 与 row_policy.predicates（含 sourceName）。
 */
export function groupTableGrants(tables: TableGrant[]): NamesSelectorDraft[] {
  const groups = new Map<
    string,
    { connection: string; schema: string; names: string[]; predicates?: RowPolicyPredicateDraft[] }
  >();

  for (const table of tables) {
    const hasPolicy = table.predicates && table.predicates.length > 0;
    const predicateKey = hasPolicy
      ? JSON.stringify(
          table.predicates!.map((p) => ({ field: p.field, op: p.op, value: p.value }))
        )
      : "";
    const groupKey = `${table.connection}\0${table.schema}\0${predicateKey}`;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.names.push(table.name);
    } else {
      groups.set(groupKey, {
        connection: table.connection,
        schema: table.schema,
        names: [table.name],
        predicates: hasPolicy ? table.predicates : undefined,
      });
    }
  }

  return [...groups.values()].map((group): NamesSelectorDraft => {
    if (!group.predicates || group.predicates.length === 0) {
      return {
        connection: group.connection,
        schema: group.schema,
        names: group.names,
      };
    }

    // 为每个 table name 展开 predicates（含 sourceName）
    const predicates: NamesSelectorDraft["row_policy"] extends undefined
      ? never
      : NonNullable<NamesSelectorDraft["row_policy"]>["predicates"] = group.names.flatMap((name) =>
      (group.predicates ?? []).map((p) => {
        if (p.op === "in") {
          return {
            sourceName: name,
            field: p.field,
            op: "in" as const,
            values: Array.isArray(p.value) ? (p.value as string[]) : [p.value as string],
          };
        }
        return {
          sourceName: name,
          field: p.field,
          op: "eq" as const,
          value: Array.isArray(p.value) ? p.value[0] : (p.value as string),
        };
      })
    );

    return {
      connection: group.connection,
      schema: group.schema,
      names: group.names,
      row_access: "scoped",
      row_policy: { predicates },
    };
  });
}

// ─── Expansion notice ─────────────────────────────────────────────────────────

/**
 * 扩权模式的警示文案。
 * - names：null（无扩权）。
 * - catalog_bound：「已声明连接上，后续新启用的表自动进入，并走扩权审计」。
 */
export function expansionNotice(mode: ScopeMode): string | null {
  switch (mode) {
    case "names":
      return null;
    case "catalog_bound":
      return "已声明连接上，后续新启用的表自动进入，并走扩权审计";
  }
}

// ─── buildTableAllow ─────────────────────────────────────────────────────────

/**
 * Output type for buildTableAllow.
 * Differs from NamesSelectorDraft: all-row tables carry row_access: "all" explicitly.
 */
export interface TableAllowSelector {
  connection: string;
  schema: string;
  names: string[];
  /** "all" = no row restriction (explicit); "scoped" = row_policy applies. */
  row_access?: "all" | "scoped";
  row_policy?: {
    predicates: Array<{
      sourceName: string;
      field: string;
      op: "eq" | "in";
      value?: string;
      values?: string[];
    }>;
  };
}

export interface TableAllowOutput {
  connections: string[];
  /** Absent for catalog_bound mode. */
  tableSelectors?: TableAllowSelector[];
  /** Present only for catalog_bound. */
  source_scope?: "catalog_bound";
}

export interface BuildTableAllowInput {
  mode: ScopeMode;
  tables: TableGrant[];
  /** Connections passed explicitly for catalog_bound mode. */
  manualConnections?: string[];
}

/**
 * Converts the form state into access.yaml–shaped table allow spec.
 *
 * Behaviours locked by T5:
 * - Two same-schema all-row tables → one names selector; row_access: "all".
 * - One table with row policy → two selectors; scoped has row_policy; all-row has row_access: "all".
 * - catalog_bound → connections from manualConnections; source_scope: "catalog_bound"; no tableSelectors.
 */
export function buildTableAllow({
  mode,
  tables,
  manualConnections,
}: BuildTableAllowInput): TableAllowOutput {
  if (mode === "catalog_bound") {
    return {
      connections: manualConnections ? [...manualConnections] : [],
      source_scope: "catalog_bound",
    };
  }

  const connections = deriveConnections(tables, mode, manualConnections);
  const grouped = groupTableGrants(tables);

  const tableSelectors: TableAllowSelector[] = grouped.map((sel) => {
    if (!sel.row_access) {
      // All-row: write explicit "all" so downstream callers can distinguish from absent.
      return {
        connection: sel.connection,
        schema: sel.schema,
        names: sel.names,
        row_access: "all" as const,
      };
    }
    return {
      connection: sel.connection,
      schema: sel.schema,
      names: sel.names,
      row_access: "scoped" as const,
      row_policy: sel.row_policy,
    };
  });

  return { connections, tableSelectors };
}

// ─── Spec 150 shared draft / impact helpers ────────────────────────────────

export function permissionTableKey(table: Pick<TableGrant, "connection" | "schema" | "name">): string {
  return `${table.connection}/${table.schema}/${table.name}`;
}

function normalizedPredicate(predicate: RowPolicyPredicateDraft): RowPolicyPredicateDraft {
  const field = predicate.field.trim();
  if (predicate.op === "in") {
    const values = (Array.isArray(predicate.value) ? predicate.value : String(predicate.value).split(","))
      .map((value) => String(value).trim())
      .filter(Boolean);
    return { field, op: "in", value: [...new Set(values)].sort() };
  }
  const value = Array.isArray(predicate.value) ? String(predicate.value[0] ?? "") : String(predicate.value);
  return { field, op: "eq", value: value.trim() };
}

export function normalizeRolePermissionDraft(draft: RolePermissionDraft): RolePermissionDraft {
  const tools = [...new Set(draft.tools.map((tool) => tool.trim()).filter(Boolean))].sort();
  if (draft.scope.mode === "catalog_bound") {
    return {
      roleId: draft.roleId.trim(),
      description: draft.description.trim(),
      scope: {
        mode: "catalog_bound",
        connections: [...new Set(draft.scope.connections.map((connection) => connection.trim()).filter(Boolean))].sort(),
      },
      tools,
    };
  }

  const tables = draft.scope.tables
    .map((table) => ({
      connection: table.connection.trim(),
      schema: table.schema.trim(),
      name: table.name.trim(),
      ...(table.predicates?.length
        ? { predicates: table.predicates.map(normalizedPredicate).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
        : {}),
    }))
    .filter((table) => table.connection && table.schema && table.name)
    .sort((a, b) => permissionTableKey(a).localeCompare(permissionTableKey(b)));

  return {
    roleId: draft.roleId.trim(),
    description: draft.description.trim(),
    scope: { mode: "names", tables },
    tools,
  };
}

export function rolePermissionDraftHash(draft: RolePermissionDraft): string {
  return JSON.stringify(normalizeRolePermissionDraft(draft));
}

function policyHash(table: TableGrant | undefined): string {
  if (!table?.predicates?.length) return "";
  return JSON.stringify(table.predicates.map(normalizedPredicate).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function derivePermissionImpact(
  baseline: RolePermissionDraft,
  draft: RolePermissionDraft,
  rejectedToolsRemoved: string[] = [],
  affectedAgents: RoleUserReference[] = []
): PermissionImpactSummary {
  const before = normalizeRolePermissionDraft(baseline);
  const after = normalizeRolePermissionDraft(draft);
  const beforeTables = before.scope.mode === "names" ? before.scope.tables : [];
  const afterTables = after.scope.mode === "names" ? after.scope.tables : [];
  const beforeByKey = new Map(beforeTables.map((table) => [permissionTableKey(table), table]));
  const afterByKey = new Map(afterTables.map((table) => [permissionTableKey(table), table]));
  const tablesAdded = [...afterByKey.keys()].filter((key) => !beforeByKey.has(key));
  const tablesRemoved = [...beforeByKey.keys()].filter((key) => !afterByKey.has(key));
  const rowPoliciesChanged = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])]
    .filter((key) => beforeByKey.has(key) && afterByKey.has(key))
    .filter((key) => policyHash(beforeByKey.get(key)) !== policyHash(afterByKey.get(key)));
  const rowPolicyExpanded = rowPoliciesChanged.some((key) => {
    const beforePolicy = beforeByKey.get(key)?.predicates?.length ?? 0;
    const afterPolicy = afterByKey.get(key)?.predicates?.length ?? 0;
    return beforePolicy > 0 && (afterPolicy === 0 || policyHash(beforeByKey.get(key)) !== policyHash(afterByKey.get(key)));
  });
  const rowPolicyContracted = rowPoliciesChanged.some((key) => {
    const beforePolicy = beforeByKey.get(key)?.predicates?.length ?? 0;
    const afterPolicy = afterByKey.get(key)?.predicates?.length ?? 0;
    return afterPolicy > 0 && (beforePolicy === 0 || policyHash(beforeByKey.get(key)) !== policyHash(afterByKey.get(key)));
  });
  const beforeTools = new Set(before.tools);
  const afterTools = new Set(after.tools);
  const toolsAdded = after.tools.filter((tool) => !beforeTools.has(tool));
  const toolsRemoved = before.tools.filter((tool) => !afterTools.has(tool));
  const catalogBoundChange = before.scope.mode === after.scope.mode
    ? null
    : after.scope.mode === "catalog_bound" ? "enabled" : "disabled";

  const expanded = tablesAdded.length > 0 || toolsAdded.length > 0 || catalogBoundChange === "enabled" || rowPolicyExpanded;
  const contracted = tablesRemoved.length > 0 || toolsRemoved.length > 0 || rejectedToolsRemoved.length > 0 || catalogBoundChange === "disabled" || rowPolicyContracted;
  const risk: PermissionRisk = expanded && contracted ? "mixed" : expanded ? "expanded" : contracted ? "contracted" : "unchanged";

  return {
    tablesAdded,
    tablesRemoved,
    toolsAdded,
    toolsRemoved,
    rowPoliciesChanged,
    rejectedToolsRemoved: [...new Set(rejectedToolsRemoved)].sort(),
    catalogBoundChange,
    risk,
    affectedAgents: affectedAgents.map((agent) => ({ ...agent })),
  };
}

// ─── Effective digest ─────────────────────────────────────────────────────────

/**
 * 生成「生效边界」自然语言摘要。
 *
 * 规则（来自 WO-202609-23 §2 / 定稿规格 §5.1）：
 * 1. publishedMeasureCount === null 时省略「（对应 M 个已发布指标）」，禁止输出「对应 0 个」。
 * 2. 无行策略：「已授权表均不限制行。」
 * 3. 有行策略的表：逐表输出行级闸门句；其余表写「其余 N 张表不限制行。」。
 * 4. 系统边界句固定不变。
 * 5. mode !== "names" 时，可访问资产句末尾追加 expansionNotice 原文。
 */
export function buildEffectiveDigest(input: DigestInput): string {
  const { connections, tableCount, publishedMeasureCount, toolCount, mode, rowPolicies = [] } = input;

  const connectionStr = connections.join("、");
  const measurePart =
    publishedMeasureCount !== null ? `（对应 ${publishedMeasureCount} 个已发布指标）` : "";
  const notice = expansionNotice(mode);

  // 1. 可访问资产句
  let assetLine = `可访问资产：使用连接 ${connectionStr}，包含 ${tableCount} 张表${measurePart}，生效 ${toolCount} 个 MCP 工具。`;
  if (notice) {
    assetLine = assetLine + notice;
  }

  const lines: string[] = [assetLine];

  // 2. 行级闸门句
  if (rowPolicies.length === 0) {
    lines.push("已授权表均不限制行。");
  } else {
    for (const policy of rowPolicies) {
      lines.push(
        `${policy.table} 已配置行级策略 ${policy.field} = ${policy.value}。取数走受控查询（lucy_query 强制注入过滤）；读定义、新鲜度、实体详情在该表上将被直接拒绝。解释查询不取数，只返回本地安全说明。`
      );
    }
    const unrestrictedCount = tableCount - rowPolicies.length;
    if (unrestrictedCount > 0) {
      lines.push(`其余 ${unrestrictedCount} 张表不限制行。`);
    }
  }

  // 3. 系统边界句（固定）
  lines.push("原始 SQL、旧版 sl_query / sl_read_source、记忆注入属于系统禁止能力，不可授予。");

  return lines.join("\n");
}
