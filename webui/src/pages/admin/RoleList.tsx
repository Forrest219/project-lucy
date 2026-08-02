import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import type { Role } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type RolesResponse = { roles: Role[] };

type SourceFilter = "all" | "yaml" | "template" | "invalid" | "in-use";

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="pl-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function RoleCard({ role, onDelete }: { role: Role; onDelete: () => void }) {
  const isTemplate = role.source === "template";
  const inUse = (role.usageCount ?? 0) > 0;
  const tools = role.tools ?? [];

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
            <span className="font-semibold">{role.id}</span>
            <span
              className={`pl-status-badge ${
                role.source === "template" ? "pl-status-partial" : "pl-status-done"
              }`}
            >
              {role.source ?? "yaml"}
            </span>
            {role.invalid && <span className="pl-status-badge pl-status-validation_failed">invalid</span>}
            {inUse && <span className="pl-status-badge pl-status-included">in use</span>}
          </div>
          {role.description && <p className="text-sm text-fg-muted">{role.description}</p>}
          <div className="text-sm text-fg-muted">
            {role.sourceCount} 个 source · {role.connections?.length ?? 0} 个 connection · {tools.length} 个工具
          </div>
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tools.slice(0, 6).map((tool) => (
                <span key={tool} className="pl-status-badge pl-status-included">
                  {tool}
                </span>
              ))}
              {tools.length > 6 && (
                <span className="pl-status-badge pl-status-not_started">+{tools.length - 6}</span>
              )}
            </div>
          )}
          {(role.warnings?.length ?? 0) > 0 && (
            <ul className="text-xs text-danger list-disc pl-5">
              {role.warnings!.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
          <div className="text-sm">
            <span className="text-fg-muted">{role.usageCount ?? 0} 位 <span className="notranslate" translate="no">Agent</span> 引用</span>
            {inUse && (role.users?.length ?? 0) > 0 && (
              <span className="text-fg-muted"> · {role.users!.map((u) => u.id).join(", ")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {isTemplate ? (
            <>
              <Link to={`/admin/roles/${encodeURIComponent(role.id)}`} className="pl-btn pl-btn--ghost text-sm">
                查看
              </Link>
              <Link
                to={`/admin/roles/${encodeURIComponent(role.id)}?mode=copy`}
                className="pl-btn pl-btn--primary text-sm"
              >
                复制为 YAML Role
              </Link>
            </>
          ) : (
            <>
              <Link to={`/admin/roles/${encodeURIComponent(role.id)}`} className="pl-btn pl-btn--ghost text-sm">
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles")
  });

  const roles = data?.roles ?? [];
  const yamlCount = roles.filter((r) => r.source === "yaml").length;
  const templateCount = roles.filter((r) => r.source === "template").length;
  const invalidCount = roles.filter((r) => r.invalid).length;
  const inUseCount = roles.filter((r) => (r.usageCount ?? 0) > 0).length;

  const filtered = useMemo(() => {
    return roles.filter((role) => {
      if (search) {
        const hay = `${role.id} ${role.description ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      switch (sourceFilter) {
        case "yaml":
          return role.source === "yaml";
        case "template":
          return role.source === "template";
        case "invalid":
          return role.invalid;
        case "in-use":
          return (role.usageCount ?? 0) > 0;
        case "all":
        default:
          return true;
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
        description="管理 access.yaml 中的 role 模板：新建、编辑、删除、复制。每个 role 决定 Agent 可访问的数据源和 MCP 工具。"
        badges={
          <>
            <span>{yamlCount} YAML role</span>
            <span>{templateCount} template</span>
            {invalidCount > 0 ? <span>{invalidCount} invalid</span> : null}
          </>
        }
        actions={
          <>
            <Link to="/admin/roles?mode=copy-template" className="pl-btn pl-btn--secondary text-sm">
              从模板复制
            </Link>
            <Link to="/admin/roles/new" className="pl-btn pl-btn--primary text-sm">
              新建 Role
            </Link>
          </>
        }
      />

      <div className="pl-metric-grid">
        <MetricCard label="YAML role" value={yamlCount} hint="来自 access.yaml" />
        <MetricCard label="Template" value={templateCount} hint="内置只读" />
        <MetricCard label="Invalid" value={invalidCount} hint="配置需修复" />
        <MetricCard label="被引用" value={inUseCount} hint="至少 1 位 Agent 引用" />
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
          aria-label="筛选来源"
        >
          <option value="all">全部</option>
          <option value="yaml">YAML</option>
          <option value="template">Template</option>
          <option value="invalid">Invalid</option>
          <option value="in-use">被引用</option>
        </select>
      </div>

      <p className="text-xs text-fg-muted" data-testid="summary">
        {yamlCount} yaml · {templateCount} template · {invalidCount} invalid
      </p>

      {filtered.length === 0 ? (
        <div className="pl-notice">
          {roles.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">还没有任何 role。创建第一个 role 以开始管理 <span className="notranslate" translate="no">Agent</span> 权限边界。</p>
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
