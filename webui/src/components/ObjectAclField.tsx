import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { apiGet } from "../lib/apiClient";

type Choice = "none" | "roles" | "all";

type Props = {
  /** `roles_allowed` / `allowed_roles` as stored. `undefined` or `[]` means no one. */
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  /** The stored declaration is corrupt; the owner must pick a state explicitly. */
  corrupt?: boolean;
  testId: string;
};

type RoleOption = { id: string; source?: string };

/** Formal Roles only: reference templates cannot be assigned to an Agent, so they cannot match. */
export function useAssignableRoleIds(): string[] {
  const query = useQuery({
    queryKey: ["admin", "roles", "assignable-ids"],
    queryFn: () => apiGet<{ roles: RoleOption[] }>("/api/admin/roles?includeTemplates=false"),
    staleTime: 30_000
  });
  return (query.data?.roles ?? [])
    .filter((role) => role.source !== "template")
    .map((role) => role.id)
    .sort();
}

function choiceOf(value: string[] | undefined): Choice {
  if (value?.includes("*")) return "all";
  return value && value.length > 0 ? "roles" : "none";
}

/**
 * Object authorization (Spec §4.1/4.3): who may discover/read this Wiki page or Skill.
 * Default is "无人可见". "所有角色可见" needs its own confirmation and is not anonymous access.
 * Unknown (deleted) role ids stay visible and can be removed; they are never remapped.
 */
export function ObjectAclField({ value, onChange, corrupt = false, testId }: Props) {
  const groupId = useId();
  const roleIds = useAssignableRoleIds();
  const [choice, setChoice] = useState<Choice>(() => choiceOf(value));
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const selected = (value ?? []).filter((role) => role !== "*");
  const unknown = selected.filter((role) => !roleIds.includes(role));
  const stored = choiceOf(value);

  useEffect(() => {
    setChoice(stored);
    setConfirmingAll(false);
    setConfirmed(false);
  }, [stored]);

  function pick(next: Choice) {
    if (next === "none") {
      setChoice("none");
      setConfirmingAll(false);
      onChange([]);
    } else if (next === "roles") {
      setChoice("roles");
      setConfirmingAll(false);
      if (stored === "all") onChange([]);
    } else {
      setChoice("all");
      setConfirmingAll(stored !== "all");
    }
  }

  function toggle(roleId: string) {
    onChange(selected.includes(roleId) ? selected.filter((item) => item !== roleId) : [...selected, roleId]);
  }

  return (
    <fieldset className="pl-acl-field" data-testid={testId}>
      <legend className="pl-eyebrow">可访问角色</legend>
      {corrupt ? (
        <p className="pl-error" data-testid={`${testId}-corrupt`}>
          当前授权声明已损坏，目前无人可见。请重新选择并保存。
        </p>
      ) : null}
      <label className="pl-acl-option">
        <input checked={choice === "none"} name={groupId} onChange={() => pick("none")} type="radio" />
        <span>无人可见</span>
      </label>
      <label className="pl-acl-option">
        <input checked={choice === "roles"} name={groupId} onChange={() => pick("roles")} type="radio" />
        <span>指定角色</span>
      </label>
      {choice === "roles" ? (
        <div className="pl-acl-roles" data-testid={`${testId}-roles`}>
          {roleIds.length === 0 && unknown.length === 0 ? <p className="pl-notice">暂无可授权的正式 <span className="notranslate" translate="no">Role</span>。</p> : null}
          {roleIds.map((roleId) => (
            <label className="pl-acl-role" key={roleId}>
              <input checked={selected.includes(roleId)} onChange={() => toggle(roleId)} type="checkbox" />
              <span className="notranslate" translate="no">{roleId}</span>
            </label>
          ))}
          {unknown.map((roleId) => (
            <label className="pl-acl-role pl-acl-role--unknown" key={roleId}>
              <input checked onChange={() => toggle(roleId)} type="checkbox" />
              <span className="notranslate" translate="no">{roleId}</span>
              <small>未知角色（已删除或不存在），不会匹配任何 <span className="notranslate" translate="no">Agent</span></small>
            </label>
          ))}
        </div>
      ) : null}
      <label className="pl-acl-option">
        <input checked={choice === "all"} name={groupId} onChange={() => pick("all")} type="radio" />
        <span>所有角色可见</span>
      </label>
      {choice === "all" && confirmingAll ? (
        <div className="pl-acl-confirm" data-testid={`${testId}-all-confirm`}>
          <p className="pl-notice">
            所有已分配正式 <span className="notranslate" translate="no">Role</span> 且开通对应通道的{" "}
            <span className="notranslate" translate="no">Agent</span> 都能读取该内容，包括正文中出现的表名与样例；这不是匿名公开。
          </p>
          <label className="pl-acl-role">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>我确认所有角色可见</span>
          </label>
          <button
            className="pl-btn pl-btn--secondary text-sm"
            data-testid={`${testId}-all-apply`}
            disabled={!confirmed}
            onClick={() => onChange(["*"])}
            type="button"
          >
            确认并应用
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
