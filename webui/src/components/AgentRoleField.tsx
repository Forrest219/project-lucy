import type { ReactNode } from "react";
import type { EffectivePermissionsPreview, Role } from "../lib/types";

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
          <div className="pl-skill-role-options">
            {options.map((role) => {
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
                  {role.invalid ? (
                    <span className="text-xs text-warning">
                      {role.unbound ? " · 当前绑定（已失效）" : " · 待修复"}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
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
            数据能力 <span className="notranslate" translate="no">{permissions.capabilities?.length ?? 0}</span> 条
          </p>
          {permissions.capabilities && permissions.capabilities.length > 0 ? (
            <ul className="grid gap-1 text-xs text-fg-muted">
              {permissions.capabilities.map((capability) => (
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
