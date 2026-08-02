import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import type { Role } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type RolesResponse = { roles: Role[] };

type SourceFilter = "formal" | "in-use" | "needs-repair" | "unused" | "templates";

const FILTER_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "formal", label: "全部正式 Role" },
  { value: "in-use", label: "正在服务 Agent" },
  { value: "needs-repair", label: "待修复" },
  { value: "unused", label: "未被 Agent 使用" },
  { value: "templates", label: "参考模板" }
];

function MetricCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: "danger";
}) {
  return (
    <div
      className={`pl-metric-card${tone ? ` pl-metric-card--${tone}` : ""}`}
      data-testid={`role-metric-${label}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

// ─── Role status terminology helpers (M57) ────────────────────────────────────
//
// 这些 helper 把 API 暴露的英文/技术字段映射为产品级中文术语，保证列表页里
// 不会出现裸「template / invalid / in use」，也不会把 invalid 误译为
// 「已停用」或「禁用」。要新增状态时必须走这里，禁止在 JSX 里直接写字面量。

export function roleSourceLabel(role: Pick<Role, "source">): { label: string; tone: "neutral" | "done" } {
  if (role.source === "template") {
    return { label: "参考模板", tone: "neutral" };
  }
  return { label: "正式 Role", tone: "done" };
}

export function roleStatusBadges(role: Role): Array<{ key: string; label: string; tone: string; testId?: string }> {
  const badges: Array<{ key: string; label: string; tone: string; testId?: string }> = [];
  if (role.source === "template") {
    badges.push({ key: "source-template", label: "参考模板", tone: "neutral" });
  } else {
    badges.push({ key: "source-yaml", label: "正式 Role", tone: "done" });
  }
  if (role.invalid) {
    badges.push({
      key: "invalid",
      label: "待修复",
      tone: "danger",
      testId: `role-status-${role.id}-invalid`
    });
  }
  if ((role.usageCount ?? 0) > 0) {
    badges.push({
      key: "in-use",
      label: "正在服务 Agent",
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
    const inUse = (role.usageCount ?? 0) > 0;
    if (inUse) inUseCount += 1;
    if (role.invalid) needsRepairCount += 1;
    if (role.source === "template") {
      templateCount += 1;
    } else {
      formalCount += 1;
      if (!inUse && !role.invalid) unusedFormalCount += 1;
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
          {role.description && <p className="text-sm text-fg-muted">{role.description}</p>}
          <div className="text-sm text-fg-muted">
            {role.sourceCount} 个 source · {role.connections?.length ?? 0} 个 connection ·{" "}
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
                  <li key={idx} className="text-danger">
                    <span data-testid={`role-warning-diagnosis-${role.id}-${idx}`}>{diagnosis}</span>
                    <span className="ml-2 inline-flex items-center gap-1 text-fg-muted">
                      <span aria-hidden>·</span>
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
          <div className="text-sm">
            <span className="text-fg-muted">
              {role.usageCount ?? 0} 位 <span className="notranslate" translate="no">Agent</span> 引用
            </span>
            {inUse && (role.users?.length ?? 0) > 0 && (
              <span className="text-fg-muted"> · {role.users!.map((u) => u.id).join(", ")}</span>
            )}
          </div>
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
              >
                复制
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles")
  });

  const roles = data?.roles ?? [];
  const summary = useMemo(() => summarizeRoles(roles), [roles]);

  const filtered = useMemo(() => {
    return roles.filter((role) => {
      if (search) {
        const hay = `${role.id} ${role.description ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      switch (sourceFilter) {
        case "in-use":
          return (role.usageCount ?? 0) > 0;
        case "needs-repair":
          return role.invalid;
        case "unused":
          return role.source === "yaml" && !role.invalid && (role.usageCount ?? 0) === 0;
        case "templates":
          return role.source === "template";
        case "formal":
        default:
          return role.source === "yaml";
      }
    });
  }, [roles, search, sourceFilter]);

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
            管理 <span className="notranslate" translate="no">Agent</span> 可访问的数据源和{" "}
            <span className="notranslate" translate="no">MCP</span> 工具边界。正式 Role 写入{" "}
            <span className="notranslate" translate="no">access.yaml</span>
            ；参考模板仅用于低频创建辅助。
          </>
        }
        actions={
          <Link to="/admin/roles/new" className="pl-btn pl-btn--primary text-sm">
            新建 Role
          </Link>
        }
      />

      <div className="pl-metric-grid">
        <MetricCard
          label="正式 Role"
          value={summary.formalCount}
          hint="写入 access.yaml"
        />
        <MetricCard
          label="正在服务 Agent"
          value={summary.inUseCount}
          hint="至少 1 个 Agent 引用"
        />
        <MetricCard
          label="待修复"
          value={summary.needsRepairCount}
          hint="权限解析失败，需处理后再分配"
          tone="danger"
        />
        <MetricCard
          label="未被 Agent 使用"
          value={summary.unusedFormalCount}
          hint="正式 Role 中未被引用"
        />
      </div>

      <div className="pl-admin-filterbar">
        <input
          className="pl-input flex-1"
          placeholder="按 role id / 描述搜索"
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
      </div>

      <div
        className="flex flex-wrap items-center gap-2 text-xs text-fg-muted"
        data-testid="role-status-strip"
      >
        <span>
          当前：{summary.formalCount} 个正式 Role · {summary.inUseCount} 个正在服务{" "}
          <span className="notranslate" translate="no">Agent</span>
        </span>
        <span className="inline-flex items-center gap-1 pl-status-badge pl-status-validation_failed">
          {summary.needsRepairCount} 个待修复
        </span>
        <span className="inline-flex items-center gap-1 pl-status-badge pl-status-partial">
          {summary.templateCount} 个参考模板
        </span>
      </div>

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
          ) : (
            "没有匹配的 role"
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
