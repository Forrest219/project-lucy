import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/apiClient";
import { policyDegradeCopy } from "../lib/policyDegradeCopy";
import {
  issuesFromPolicyStatus,
  type PolicyDegradeIssue
} from "../lib/policyDegradeMetric";
import type { PolicyRuntimeStatus } from "../lib/types";

export type PolicyDegradeScope = {
  /** When set, only this Agent (and a global outage) is shown. */
  agentId?: string;
  /** Display names keyed by Agent id. */
  agentNames?: Record<string, string>;
};

function visibleIssues(issues: PolicyDegradeIssue[], scope?: PolicyDegradeScope): PolicyDegradeIssue[] {
  if (!scope?.agentId) return issues;
  return issues.filter((issue) => issue.agentId === "" || issue.agentId === scope.agentId);
}

function RepairText({ text, roleId }: { text: string; roleId?: string }) {
  if (!roleId || !text.includes("{{role}}")) return <>{text}</>;
  const [before, after] = text.split("{{role}}");
  return (
    <>
      {before}
      <span className="notranslate" translate="no">{roleId}</span>
      {after}
    </>
  );
}

/**
 * Shared issue list + repair links for policy degrade surfaces
 * (Agent detail banner, Agent roster KPI expand).
 */
export function PolicyDegradeIssueList({
  issues,
  agentNames,
  scopeAgentId
}: {
  issues: PolicyDegradeIssue[];
  agentNames?: Record<string, string>;
  /** When set, hide "打开这个 Agent" for that same Agent page. */
  scopeAgentId?: string;
}) {
  return (
    <>
      <ul>
        {issues.map((issue) => {
          const copy = policyDegradeCopy(issue.reason);
          const name = issue.agentId ? (agentNames?.[issue.agentId] || issue.agentId) : "";
          const onThisAgent = Boolean(scopeAgentId && scopeAgentId === issue.agentId);
          return (
            <li key={`${issue.agentId}:${issue.reason}`}>
              {name ? (
                <>
                  <span className="notranslate" translate="no">{name}</span>
                  {"："}
                </>
              ) : null}
              <RepairText roleId={copy.roleId} text={copy.text} />
              {issue.agentId || copy.roleId ? (
                <span className="pl-policy-degrade-notice-actions">
                  {issue.agentId && !onThisAgent ? (
                    <Link to={`/admin/agents/${encodeURIComponent(issue.agentId)}`}>
                      打开这个 <span className="notranslate" translate="no">Agent</span>
                    </Link>
                  ) : null}
                  {copy.roleId ? (
                    <Link to={`/admin/roles/${encodeURIComponent(copy.roleId)}`}>去修改角色</Link>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="pl-policy-degrade-notice-foot">保存成功后，这条提示会消失。</p>
    </>
  );
}

/**
 * Quiet, in-page notice when EffectivePolicy cannot be applied.
 * Mount on Agent detail (scoped). Agent roster uses the KPI expand instead.
 */
export function PolicyDegradeNotice({ scope }: { scope?: PolicyDegradeScope } = {}) {
  const { data } = useQuery({
    queryKey: ["admin", "policy-runtime"],
    queryFn: () => apiGet<PolicyRuntimeStatus>("/api/admin/policy-runtime"),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false
  });

  if (!data || data.healthy) return null;
  const issues = visibleIssues(issuesFromPolicyStatus(data), scope);
  if (issues.length === 0) return null;

  const global = data.degradedGlobal;
  const title = global ? "所有 Agent 暂时不能查数" : "有 Agent 暂时不能查数";

  return (
    <section
      className="pl-policy-degrade-notice"
      data-testid="policy-degrade-banner"
      role="status"
    >
      <p className="pl-policy-degrade-notice-title">{title}</p>
      <PolicyDegradeIssueList
        issues={issues}
        agentNames={scope?.agentNames}
        scopeAgentId={scope?.agentId}
      />
    </section>
  );
}

export function PolicyDegradeRepairText({ reason }: { reason: string }) {
  const copy = policyDegradeCopy(reason);
  return (
    <Fragment>
      <RepairText roleId={copy.roleId} text={copy.text} />
    </Fragment>
  );
}
