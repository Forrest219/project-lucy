import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { apiGet } from "../lib/apiClient";

type Choice = "none" | "roles" | "all";

/**
 * Spec 193 §11 — the Role query has three distinct states. A loading list
 * and a failed list are NOT the same fact as a successfully loaded empty
 * list, and both must block a commit.
 */
export type ObjectAclRoleStatus = "loading" | "error" | "ready";

export type AssignableRoleState = {
  roleIds: string[];
  roleStatus: ObjectAclRoleStatus;
  roleError: string | null;
};

type Props = {
  /** `roles_allowed` / `allowed_roles` as stored. `undefined` or `[]` means no one. */
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  /** The stored declaration is corrupt; the owner must pick a state explicitly. */
  corrupt?: boolean;
  testId: string;
  /**
   * Externally supplied Role query state. Wiki flows own it so they can
   * block a commit while the Role list is loading or failed.
   */
  roleState?: AssignableRoleState;
  /**
   * Externally owned "所有角色可见" confirmation. Wiki flows own it because
   * an initial wildcard declaration (e.g. an uploaded file) needs its own
   * confirmation before it may be committed.
   */
  allConfirmation?: {
    confirmed: boolean;
    onConfirmedChange: (next: boolean) => void;
    label?: string;
  };
  /**
   * A corrupt declaration may not be adopted silently: no choice is
   * pre-selected and the owner has to pick one explicitly.
   */
  requireExplicitChoice?: boolean;
  disabled?: boolean;
};

type RoleOption = { id: string; source?: string };

const ASSIGNABLE_ROLE_QUERY_KEY = ["admin", "roles", "assignable-ids"] as const;

/**
 * Formal Roles only: reference templates cannot be assigned to an Agent, so they cannot match.
 *
 * The loading / error / ready distinction is part of the contract: a caller
 * must never treat "the Role list did not load" as "there is no Role".
 */
export function useAssignableRoleState(): AssignableRoleState {
  const query = useQuery({
    queryKey: ASSIGNABLE_ROLE_QUERY_KEY,
    queryFn: () => apiGet<{ roles: RoleOption[] }>("/api/admin/roles?includeTemplates=false"),
    staleTime: 30_000
  });
  if (query.isPending) {
    return { roleIds: [], roleStatus: "loading", roleError: null };
  }
  if (query.isError) {
    return {
      roleIds: [],
      roleStatus: "error",
      roleError: query.error instanceof Error ? query.error.message : "可授权角色读取失败"
    };
  }
  return {
    roleIds: (query.data?.roles ?? [])
      .filter((role) => role.source !== "template")
      .map((role) => role.id)
      .sort(),
    roleStatus: "ready",
    roleError: null
  };
}

/** Backwards-compatible shorthand: only the assignable Role ids. */
export function useAssignableRoleIds(): string[] {
  return useAssignableRoleState().roleIds;
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
export function ObjectAclField({
  value,
  onChange,
  corrupt = false,
  testId,
  roleState,
  allConfirmation,
  requireExplicitChoice = false,
  disabled = false
}: Props) {
  const groupId = useId();
  const internalRoleState = useAssignableRoleState();
  const effectiveRoleState = roleState ?? internalRoleState;
  const roleIds = effectiveRoleState.roleIds;
  const roleStatus = effectiveRoleState.roleStatus;
  const roleError = effectiveRoleState.roleError;
  const [choice, setChoice] = useState<Choice | null>(() =>
    requireExplicitChoice && corrupt ? null : choiceOf(value)
  );
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const explicitChoiceRef = useRef(false);
  const selected = (value ?? []).filter((role) => role !== "*");
  const stored = choiceOf(value);
  // Unknown Role ids stay visible only when the Role list actually loaded.
  const unknown = roleStatus === "ready" ? selected.filter((role) => !roleIds.includes(role)) : [];
  const allConfirmed = allConfirmation ? allConfirmation.confirmed : confirmed;

  useEffect(() => {
    if (requireExplicitChoice && corrupt && !explicitChoiceRef.current) {
      setChoice(null);
    } else {
      setChoice(stored);
    }
    setConfirmingAll(false);
    setConfirmed(false);
  }, [corrupt, requireExplicitChoice, stored]);

  function pick(next: Choice) {
    explicitChoiceRef.current = true;
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

  const showAllConfirm = choice === "all" && (allConfirmation ? true : confirmingAll);

  return (
    <fieldset
      aria-busy={roleStatus === "loading"}
      className="pl-acl-field"
      data-testid={testId}
      data-role-status={roleStatus}
    >
      <legend className="pl-eyebrow">可访问角色</legend>
      {corrupt ? (
        <p className="pl-error" data-testid={`${testId}-corrupt`}>
          当前授权声明已损坏，目前无人可见。请重新选择并保存。
        </p>
      ) : null}
      <label className="pl-acl-option">
        <input
          checked={choice === "none"}
          disabled={disabled}
          name={groupId}
          onChange={() => pick("none")}
          type="radio"
        />
        <span>无人可见</span>
      </label>
      <label className="pl-acl-option">
        <input
          checked={choice === "roles"}
          disabled={disabled}
          name={groupId}
          onChange={() => pick("roles")}
          type="radio"
        />
        <span>指定角色</span>
      </label>
      <div className="pl-acl-roles" data-testid={`${testId}-roles`}>
        {roleStatus === "loading" ? (
          <p className="pl-notice" data-testid={`${testId}-roles-loading`}>
            正在加载可授权角色…
          </p>
        ) : null}
        {roleStatus === "error" ? (
          <p className="pl-error" data-testid={`${testId}-roles-error`}>
            可授权角色加载失败：{roleError}
          </p>
        ) : null}
        {roleStatus === "ready" && roleIds.length === 0 && unknown.length === 0 ? (
          <p className="pl-notice" data-testid={`${testId}-roles-empty`}>
            暂无可授权的正式 <span className="notranslate" translate="no">Role</span>。
          </p>
        ) : null}
        {choice !== "roles" || roleStatus !== "ready" ? null : (
          <>
            {roleIds.map((roleId) => (
              <label className="pl-acl-role" key={roleId}>
                <input
                  checked={selected.includes(roleId)}
                  disabled={disabled}
                  onChange={() => toggle(roleId)}
                  type="checkbox"
                />
                <span className="notranslate" translate="no">
                  {roleId}
                </span>
              </label>
            ))}
            {unknown.map((roleId) => (
              <label className="pl-acl-role pl-acl-role--unknown" key={roleId}>
                <input
                  checked
                  disabled={disabled}
                  onChange={() => toggle(roleId)}
                  type="checkbox"
                />
                <span className="notranslate" translate="no">
                  {roleId}
                </span>
                <small>
                  未知角色（已删除或不存在），不会匹配任何{" "}
                  <span className="notranslate" translate="no">
                    Agent
                  </span>
                </small>
              </label>
            ))}
          </>
        )}
      </div>
      <label className="pl-acl-option">
        <input
          checked={choice === "all"}
          disabled={disabled}
          name={groupId}
          onChange={() => pick("all")}
          type="radio"
        />
        <span>所有角色可见</span>
      </label>
      {showAllConfirm ? (
        <div className="pl-acl-confirm" data-testid={`${testId}-all-confirm`}>
          <p className="pl-notice">
            所有已分配正式 <span className="notranslate" translate="no">Role</span> 且开通对应通道的{" "}
            <span className="notranslate" translate="no">Agent</span> 都能读取该内容，包括正文中出现的表名与样例；这不是匿名公开。
          </p>
          <label className="pl-acl-role">
            <input
              checked={allConfirmed}
              disabled={disabled}
              onChange={(event) => {
                if (allConfirmation) {
                  allConfirmation.onConfirmedChange(event.target.checked);
                } else {
                  setConfirmed(event.target.checked);
                }
              }}
              type="checkbox"
            />
            <span>{allConfirmation?.label ?? "我确认所有角色可见"}</span>
          </label>
          <button
            className="pl-btn pl-btn--secondary text-sm"
            data-testid={`${testId}-all-apply`}
            disabled={!allConfirmed || disabled}
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
