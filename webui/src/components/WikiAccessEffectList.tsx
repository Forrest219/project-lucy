import { Fragment } from "react";
import { wikiAffectedAgentCount, wikiRoleEffectLabel } from "../lib/wikiAccess";
import type { WikiAccessRoleEffect } from "../lib/types";

export type WikiAccessEffectStatus = "loading" | "error" | "ready";

export type WikiAccessEffectListProps = {
  /** One entry per declared Role. */
  effects: readonly WikiAccessRoleEffect[];
  /** `loading` / `error` are NOT an empty Role list — they block a commit. */
  status?: WikiAccessEffectStatus;
  error?: string | null;
  /** Declared Role count; `null` for 所有角色可见 / 授权异常. */
  declaredRoleCount?: number | null;
  testId?: string;
};

/**
 * Render one sentence that may contain the protected `Agent` term.
 * The registered wording is fixed, so only the term itself is defended.
 */
function EffectState({ text }: { text: string }) {
  const parts = text.split("Agent");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? (
            <span className="notranslate" translate="no">
              Agent
            </span>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Spec 193 §4.2 — one row per declared Role with exactly one channel state.
 *
 * The declared Role count and the affected Agent count are two different
 * facts and are labelled separately: `N 个角色` vs `受影响 Agent 数`.
 */
export function WikiAccessEffectList({
  effects,
  status = "ready",
  error = null,
  declaredRoleCount,
  testId = "wiki-access-effects"
}: WikiAccessEffectListProps) {
  if (status === "loading") {
    return (
      <p className="pl-notice" data-testid={`${testId}-loading`}>
        正在加载角色通道效果…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="pl-error" data-testid={`${testId}-error`}>
        角色通道效果加载失败：{error ?? "未知错误"}
      </p>
    );
  }

  const roleCount = declaredRoleCount ?? effects.length;
  const affectedAgents = wikiAffectedAgentCount(effects);

  return (
    <div className="pl-wiki-access-effects" data-testid={testId}>
      <div className="pl-wiki-access-effects-summary">
        <span
          className="pl-wiki-access-count"
          data-testid={`${testId}-declared-count`}
        >
          {roleCount} 个角色
        </span>
        <span className="pl-wiki-access-count" data-testid={`${testId}-agent-count`}>
          受影响{" "}
          <span className="notranslate" translate="no">
            Agent
          </span>{" "}
          数 {affectedAgents}
        </span>
      </div>
      {effects.length === 0 ? (
        <p className="pl-notice" data-testid={`${testId}-empty`}>
          当前没有声明角色。
        </p>
      ) : (
        <ul className="pl-wiki-access-effect-list">
          {effects.map((effect) => (
            <li
              className="pl-wiki-access-effect-row"
              data-role-id={effect.role_id}
              data-testid={`${testId}-row-${effect.role_id}`}
              key={effect.role_id}
            >
              <code className="pl-wiki-access-role-id notranslate" translate="no">
                {effect.role_id}
              </code>
              <span
                className="pl-wiki-access-effect-state"
                data-testid={`${testId}-state-${effect.role_id}`}
              >
                <EffectState text={wikiRoleEffectLabel(effect)} />
              </span>
              {!effect.known ? null : (
                <span
                  className="pl-wiki-access-effect-agents"
                  data-testid={`${testId}-agents-${effect.role_id}`}
                >
                  受影响{" "}
                  <span className="notranslate" translate="no">
                    Agent
                  </span>{" "}
                  数 {effect.assigned_agent_count}
                </span>
              )}
              {effect.assigned_agent_ids.length === 0 ? null : (
                <span
                  className="pl-wiki-access-effect-agent-ids"
                  data-testid={`${testId}-agent-ids-${effect.role_id}`}
                >
                  {effect.assigned_agent_ids.map((agentId) => (
                    <code className="notranslate" key={agentId} translate="no">
                      {agentId}
                    </code>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
