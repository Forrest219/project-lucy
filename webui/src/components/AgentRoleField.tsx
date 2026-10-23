import { useState, type ReactNode } from "react";
import { LUCY_ADMIN_ROLE_ID } from "../lib/lucyAdminRole";
import type { EffectivePermissionsPreview, Role } from "../lib/types";

/** Short previews stay inline. Longer ones (lucy_admin catalog scope) stay collapsed. */
const INLINE_CAPABILITY_LIMIT = 12;

export function agentRoleIds(agent: { roles?: string[]; role?: string }): string[] {
  if (Array.isArray(agent.roles) && agent.roles.length > 0) return agent.roles;
  if (agent.role) return [agent.role];
  return [];
}

export function roleSelectionSavable(ids: string[], roles: Role[], allowEmpty: boolean): boolean {
  if (ids.length === 0) return allowEmpty;
  return ids.every((id) => roles.some((role) => role.id === id && !role.invalid));
}

export function sameRoleSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const wanted = new Set(right);
  return left.every((id) => wanted.has(id));
}

type RoleOption = {
  id: string;
  invalid: boolean;
  unbound?: boolean;
};

export function AgentRoleField({
  roles,
  selected,
  extraIds = [],
  onChange,
  required = false,
  header
}: {
  roles: Role[];
  selected: string[];
  extraIds?: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  header?: ReactNode;
}) {
  const formalIds = new Set(roles.map((role) => role.id));
  const options: RoleOption[] = [
    ...roles.map((role) => ({ id: role.id, invalid: role.invalid })),
    ...extraIds
      .filter((id) => id && !formalIds.has(id))
      .map((id) => ({ id, invalid: true, unbound: true }))
  ];

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  const business = options.filter((role) => role.id !== LUCY_ADMIN_ROLE_ID);
  const ops = options.filter((role) => role.id === LUCY_ADMIN_ROLE_ID);

  function renderOption(role: RoleOption) {
    const checked = selected.includes(role.id);
    const disabled = role.invalid && !checked;
    return (
      <label className="flex items-center gap-2" key={role.id}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          data-testid="agent-role-option"
          data-role-id={role.id}
          onChange={(event) => toggle(role.id, event.target.checked)}
        />
        <span className="notranslate" translate="no">{role.id}</span>
        {role.id === LUCY_ADMIN_ROLE_ID ? (
          <span className="pl-status-badge pl-status-partial">运维数据面</span>
        ) : null}
        {role.invalid ? (
          <span className="text-xs text-warning">
            {role.unbound ? " · 当前绑定（已失效）" : " · 待修复"}
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          角色{required ? <span className="text-danger"> *</span> : null}
        </span>
        {header}
      </div>
      {options.length === 0 ? (
        <span className="text-xs text-fg-muted">暂无可选角色</span>
      ) : (
        <fieldset className="pl-skill-role-field" data-testid="agent-role-field">
          <legend className="sr-only">角色</legend>
          {business.length > 0 ? (
            <div className="grid gap-1">
              {ops.length > 0 ? <span className="text-xs text-fg-muted">业务角色</span> : null}
              <div className="pl-skill-role-options" data-testid="agent-business-role-options">
                {business.map(renderOption)}
              </div>
            </div>
          ) : null}
          {ops.length > 0 ? (
            <div className="grid gap-1" data-testid="agent-ops-role-group">
              <span className="text-xs text-fg-muted">运维数据面</span>
              <div className="grid gap-1 rounded-md border border-warning-strong bg-warning-soft p-2">
                {ops.map(renderOption)}
              </div>
            </div>
          ) : null}
        </fieldset>
      )}
    </div>
  );
}

export function AgentRoleCapability({
  loading,
  error,
  permissions
}: {
  loading: boolean;
  error?: string;
  permissions?: EffectivePermissionsPreview;
}) {
  const capabilities = permissions?.capabilities ?? [];
  const roleKey = permissions?.roleIds.join("\n") ?? "";
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const expanded = expandedKey === roleKey && capabilities.length > INLINE_CAPABILITY_LIMIT;
  const showList = capabilities.length > 0 && (capabilities.length <= INLINE_CAPABILITY_LIMIT || expanded);

  return (
    <div className="rounded-md border border-border-default bg-bg-base p-3 text-sm" data-testid="agent-role-capability">
      {loading ? <p>正在计算数据能力</p> : null}
      {error ? <p className="text-danger">{error}</p> : null}
      {permissions ? (
        <div className="grid gap-2">
          <p>
            角色{" "}
            <span className="notranslate" translate="no">{permissions.roleIds.join(", ") || "—"}</span>
          </p>
          <p>
            数据能力 <span className="notranslate" translate="no">{capabilities.length}</span> 条
            {capabilities.length > INLINE_CAPABILITY_LIMIT ? (
              <span className="text-fg-muted">。清单较长，不必在这里逐条确认。</span>
            ) : null}
          </p>
          {capabilities.length > INLINE_CAPABILITY_LIMIT ? (
            <button
              type="button"
              className="justify-self-start text-xs text-accent hover:underline"
              onClick={() => setExpandedKey(expanded ? null : roleKey)}
            >
              {expanded ? "收起清单" : `展开 ${capabilities.length} 条`}
            </button>
          ) : null}
          {showList ? (
            <ul className="grid max-h-40 gap-1 overflow-y-auto text-xs text-fg-muted">
              {capabilities.map((capability) => (
                <li key={`${capability.tool}:${capability.sourceKey ?? capability.sourceName}`} className="notranslate" translate="no">
                  {capability.tool}:{capability.sourceName}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
