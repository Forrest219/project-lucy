import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import type { Role } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";

type RolesResponse = { roles: Role[] };

type SourceFilter = "formal" | "in-use" | "needs-repair" | "unused" | "templates";

const FILTER_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "formal", label: "全部正式 Role" },
  { value: "in-use", label: "使用中" },
  { value: "needs-repair", label: "待修复" },
  { value: "unused", label: "未引用" },
  { value: "templates", label: "参考模板" }
];

const METRIC_ITEMS: Array<{
  label: string;
  help: ReactNode;
  hint: string;
  valueKey: keyof RoleSummary;
  testId: string;
  helpId: string;
}> = [
  {
    label: "Role 总数",
    help: <>统计正式 <span className="notranslate" translate="no">Role</span>（写入 access 配置、非参考模板）的数量。</>,
    hint: "正式 Role（不含参考模板）",
    valueKey: "formalCount",
    testId: "metric-role-count",
    helpId: "role-count"
  },
  {
    label: "使用中",
    help: <>至少被 1 个 <span className="notranslate" translate="no">Agent</span> 引用的正式 <span className="notranslate" translate="no">Role</span> 数量。</>,
    hint: "至少 1 个 Agent 引用",
    valueKey: "inUseCount",
    testId: "metric-in-use",
    helpId: "in-use"
  },
  {
    label: "未引用",
    help: <>正式 <span className="notranslate" translate="no">Role</span> 中尚未绑定任何 <span className="notranslate" translate="no">Agent</span> 的数量。</>,
    hint: "正式 Role 暂无 Agent 绑定",
    valueKey: "unusedFormalCount",
    testId: "metric-unused",
    helpId: "unused"
  },
  {
    label: "解析异常",
    help: <>正式 <span className="notranslate" translate="no">Role</span> 权限解析失败的数量；请用筛选「待修复」查看，不在此卡点击筛选。</>,
    hint: "正式 Role 权限解析失败",
    valueKey: "needsRepairCount",
    testId: "metric-invalid",
    helpId: "invalid"
  }
];

function formatConfigUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

// ─── Role status terminology helpers (M57 / Spec 76) ──────────────────────────
//
// 这些 helper 把 API 暴露的英文/技术字段映射为产品级中文术语，保证列表页里
// 不会出现裸「template / invalid / in use」，也不会把 invalid 误译为
// 「已停用」或「禁用」。要新增状态时必须走这里，禁止在 JSX 里直接写字面量。

export function roleStatusBadges(role: Role): Array<{ key: string; label: string; tone: string; testId?: string }> {
  const badges: Array<{ key: string; label: string; tone: string; testId?: string }> = [];
  if (role.source === "template") {
    badges.push({ key: "source-template", label: "参考模板", tone: "neutral" });
  } else {
    badges.push({ key: "source-yaml", label: "正式", tone: "done" });
  }
  if (role.invalid) {
    badges.push({
      key: "invalid",
      label: "待修复",
      tone: "danger",
      testId: `role-status-${role.id}-invalid`
    });
  }
  if (role.source === "yaml" && (role.usageCount ?? 0) > 0) {
    badges.push({
      key: "in-use",
      label: "使用中",
      tone: "included",
      testId: `role-status-${role.id}-in-use`
    });
  }
  return badges;
}

export function roleWarningDiagnosis(warning: string): { diagnosis: string; technical: string } {
  const trimmed = warning.trim();
  if (trimmed.startsWith("role_resolution_failed")) {
    return {
      diagnosis: "权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。",
      technical: trimmed
    };
  }
  return {
    diagnosis: "权限配置需检查：系统返回了未识别的校验信息。",
    technical: trimmed
  };
}

export type RoleSummary = {
  formalCount: number;
  inUseCount: number;
  needsRepairCount: number;
  unusedFormalCount: number;
  templateCount: number;
};

export function summarizeRoles(roles: Role[]): RoleSummary {
  let formalCount = 0;
  let inUseCount = 0;
  let needsRepairCount = 0;
  let unusedFormalCount = 0;
  let templateCount = 0;
  for (const role of roles) {
    if (role.source === "template") {
      templateCount += 1;
      continue;
    }
    // Formal (yaml) only — Spec 76 hard rule
    formalCount += 1;
    const inUse = (role.usageCount ?? 0) > 0;
    if (inUse) inUseCount += 1;
    if (role.invalid) {
      needsRepairCount += 1;
    } else if (!inUse) {
      unusedFormalCount += 1;
    }
  }
  return { formalCount, inUseCount, needsRepairCount, unusedFormalCount, templateCount };
}

function badgeClass(tone: string): string {
  switch (tone) {
    case "done":
      return "pl-status-done";
    case "included":
      return "pl-status-included";
    case "danger":
      return "pl-status-validation_failed";
    case "neutral":
    default:
      return "pl-status-partial";
  }
}

function RoleCard({ role, onDelete }: { role: Role; onDelete: () => void }) {
  const isTemplate = role.source === "template";
  const inUse = (role.usageCount ?? 0) > 0;
  const tools = role.tools ?? [];
  const badges = roleStatusBadges(role);
  const connections = role.connections?.length ?? 0;

  return (
    <div
      data-testid="role-card"
      data-role-id={role.id}
      data-source={role.source}
      className={`pl-card ${role.invalid ? "border-danger-strong" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold notranslate" translate="no">
              {role.id}
            </span>
            {badges.map((badge) => (
              <span
                key={badge.key}
                className={`pl-status-badge ${badgeClass(badge.tone)}`}
                data-testid={badge.testId}
              >
                {badge.label}
              </span>
            ))}
          </div>
          {role.description && (
            <p className="text-sm text-fg-muted">
              <span className="text-fg-muted">说明：</span>
              {role.description}
            </p>
          )}
          <div className="text-sm text-fg-muted">
            <span>数据范围：</span>
            {role.sourceCount} 个 source · {connections} 个 connection
          </div>
          <div className="text-sm text-fg-muted">
            <span
              className="notranslate"
              translate="no"
              data-testid={`role-allowed-tools-count-${role.id}`}
            >
              允许的 MCP 工具：{tools.length} 个
            </span>
          </div>
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tools.slice(0, 6).map((tool) => (
                <span key={tool} className="pl-status-badge pl-status-included notranslate" translate="no">
                  {tool}
                </span>
              ))}
              {tools.length > 6 && (
                <span className="pl-status-badge pl-status-not_started">+{tools.length - 6}</span>
              )}
            </div>
          )}
          {(role.warnings?.length ?? 0) > 0 && (
            <ul className="grid gap-1 text-xs" data-testid={`role-warnings-${role.id}`}>
              {role.warnings!.map((w, idx) => {
                const { diagnosis, technical } = roleWarningDiagnosis(w);
                return (
                  <li key={idx} className="grid gap-0.5 text-danger">
                    <span data-testid={`role-warning-diagnosis-${role.id}-${idx}`}>{diagnosis}</span>
                    {isTemplate && (
                      <span className="text-fg-muted" data-testid={`role-warning-template-note-${role.id}-${idx}`}>
                        该条目是参考模板；当前环境可能缺少对应连接或表，不代表已落盘正式 Role 故障。
                      </span>
                    )}
                    <span className="inline-flex flex-wrap items-center gap-1 text-fg-muted">
                      <span>技术详情：</span>
                      <code
                        className="notranslate rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px]"
                        translate="no"
                        data-testid={`role-warning-tech-${role.id}-${idx}`}
                      >
                        {technical}
                      </code>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="text-sm text-fg-muted">
            <span>
              引用 <span className="notranslate" translate="no">Agent</span>：{role.usageCount ?? 0} 个
            </span>
            {inUse && (role.users?.length ?? 0) > 0 && (
              <span>
                {" "}
                ·{" "}
                <span className="notranslate" translate="no">
                  {role.users!.map((u) => u.id).join(", ")}
                </span>
              </span>
            )}
          </div>
          {isTemplate ? (
            <div className="text-sm text-fg-muted">内置参考模板</div>
          ) : role.configUpdatedAt ? (
            <div className="text-sm text-fg-muted">
              配置最近写入：{formatConfigUpdatedAt(role.configUpdatedAt)}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {isTemplate ? (
            <>
              <Link
                to={`/admin/roles/${encodeURIComponent(role.id)}`}
                className="pl-btn pl-btn--ghost text-sm"
              >
                查看
              </Link>
            </>
          ) : (
            <>
              <Link
                to={`/admin/roles/${encodeURIComponent(role.id)}`}
                className="pl-btn pl-btn--ghost text-sm"
              >
                编辑
              </Link>
              <Link
                to={`/admin/roles/${encodeURIComponent(role.id)}?mode=copy`}
                className="pl-btn pl-btn--ghost text-sm"
                aria-label={`基于 ${role.id} 新建 Role`}
                title="基于此 Role 创建新的正式 Role"
              >
                基于此新建
              </Link>
              <button
                type="button"
                className="pl-btn pl-btn--danger text-sm"
                onClick={onDelete}
                aria-label={`删除 ${role.id}`}
                disabled={inUse}
                title={inUse ? "无法删除被引用的 role" : undefined}
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function RoleList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("formal");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [tableFilter, setTableFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles")
  });

  const roles = data?.roles ?? [];
  const summary = useMemo(() => summarizeRoles(roles), [roles]);

  const connectionOptions = useMemo(
    () => [...new Set(roles.flatMap((role) => role.connections))].sort(),
    [roles]
  );
  const toolOptions = useMemo(
    () => [...new Set(roles.flatMap((role) => role.tools))].sort(),
    [roles]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tableQ = tableFilter.trim().toLowerCase();
    return roles.filter((role) => {
      if (q) {
        const hay = [
          role.id,
          role.description ?? "",
          ...role.connections,
          ...role.tools,
          ...(role.sourceNames ?? [])
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (connectionFilter && !role.connections.includes(connectionFilter)) return false;
      if (toolFilter && !role.tools.includes(toolFilter)) return false;
      if (tableQ) {
        const names = role.sourceNames ?? [];
        if (names.length === 0) return false;
        if (!names.some((name) => name.toLowerCase().includes(tableQ))) return false;
      }
      switch (sourceFilter) {
        case "in-use":
          return role.source === "yaml" && (role.usageCount ?? 0) > 0;
        case "needs-repair":
          return role.source === "yaml" && role.invalid;
        case "unused":
          return role.source === "yaml" && !role.invalid && (role.usageCount ?? 0) === 0;
        case "templates":
          return role.source === "template";
        case "formal":
        default:
          return role.source === "yaml";
      }
    });
  }, [roles, search, sourceFilter, connectionFilter, toolFilter, tableFilter]);

  const filterLabel = FILTER_OPTIONS.find((opt) => opt.value === sourceFilter)?.label ?? sourceFilter;
  const capabilityActive = Boolean(connectionFilter || toolFilter || tableFilter.trim());
  const unresolvedTableRoles = useMemo(
    () =>
      tableFilter.trim()
        ? roles.filter(
            (role) =>
              role.source === "yaml" &&
              role.invalid &&
              (role.sourceNames ?? []).length === 0
          ).length
        : 0,
    [roles, tableFilter]
  );

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error) return <div className="pl-notice">加载失败：{(error as Error).message}</div>;

  function handleDelete(role: Role) {
    navigate(`/admin/roles/${encodeURIComponent(role.id)}?mode=delete`);
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="角色权限"
        description={
          <>
            管理角色的数据库连接、数据表与 <span className="notranslate" translate="no">MCP</span> 工具授权范围。
          </>
        }
        actions={
          <Link to="/admin/roles/new" className="pl-btn pl-btn--primary text-sm">
            新建 Role
          </Link>
        }
      />

      <div className="pl-metric-grid" data-testid="role-metric-grid">
        {METRIC_ITEMS.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={summary[metric.valueKey]}
            help={metric.help}
            subValue={metric.hint}
            helpId={metric.helpId}
            testId={metric.testId}
          />
        ))}
      </div>

      {summary.needsRepairCount > 0 ? (
        <p className="text-xs text-fg-muted" data-testid="role-invalid-notice">
          有 {summary.needsRepairCount} 个正式 Role 解析异常，可通过筛选「待修复」查看。
        </p>
      ) : null}

      <div className="pl-admin-filterbar flex flex-wrap gap-2">
        <input
          className="pl-input flex-1 min-w-[12rem]"
          placeholder="按标识 / 说明 / 连接 / 工具 / 表名搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="搜索 role"
        />
        <select
          className="pl-input w-40"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          aria-label="筛选角色范围"
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="pl-input w-44"
          value={connectionFilter}
          onChange={(e) => setConnectionFilter(e.target.value)}
          aria-label="按连接筛选"
          data-testid="role-filter-connection"
        >
          <option value="">全部连接</option>
          {connectionOptions.map((id) => (
            <option key={id} value={id} className="notranslate" translate="no">
              {id}
            </option>
          ))}
        </select>
        <select
          className="pl-input w-48 notranslate"
          translate="no"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          aria-label="按 MCP 工具筛选"
          data-testid="role-filter-tool"
        >
          <option value="" className="notranslate" translate="no">
            全部 MCP 工具
          </option>
          {toolOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          className="pl-input w-44"
          placeholder="按表名筛选"
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          aria-label="按表筛选"
          data-testid="role-filter-table"
        />
      </div>

      {(sourceFilter !== "formal" || capabilityActive) && (
        <div className="text-xs text-fg-muted" data-testid="role-current-filter">
          当前筛选：{filterLabel}
          {connectionFilter ? ` · 连接 ${connectionFilter}` : ""}
          {toolFilter ? ` · 工具 ${toolFilter}` : ""}
          {tableFilter.trim() ? ` · 表 ${tableFilter.trim()}` : ""}
          （{filtered.length}）
          {sourceFilter === "needs-repair" && filtered.length === 0 && !search.trim() && !capabilityActive
            ? " · 没有正式 Role 待修复"
            : null}
          {filtered.length === 0 && tableFilter.trim()
            ? " · 没有匹配当前表条件的 Role"
            : null}
          {tableFilter.trim() && unresolvedTableRoles > 0
            ? " · 部分 Role 无法解析表范围，不会出现在按表筛选结果中"
            : null}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="pl-notice">
          {roles.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">
                还没有任何 role。创建第一个 role 以开始管理{" "}
                <span className="notranslate" translate="no">Agent</span> 权限边界。
              </p>
              <Link to="/admin/roles/new" className="pl-btn pl-btn--primary text-sm">
                新建第一个 Role
              </Link>
            </div>
          ) : sourceFilter === "needs-repair" && !search.trim() && !capabilityActive ? (
            "没有正式 Role 待修复"
          ) : tableFilter.trim() ? (
            "没有匹配当前表条件的 Role"
          ) : (
            "没有匹配的 Role"
          )}
        </div>
      ) : (
        <div className="grid gap-3" data-testid="role-list">
          {filtered.map((role) => (
            <RoleCard key={role.id} role={role} onDelete={() => handleDelete(role)} />
          ))}
        </div>
      )}
    </div>
  );
}
