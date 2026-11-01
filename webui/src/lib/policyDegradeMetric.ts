import type { PolicyRuntimeStatus } from "./types";

export type PolicyDegradeIssue = {
  agentId: string;
  reason: string;
};

/**
 * Flatten policy-runtime into issue rows. Global outage is one synthetic row.
 */
export function issuesFromPolicyStatus(data: PolicyRuntimeStatus): PolicyDegradeIssue[] {
  if (data.degradedGlobal) return [{ agentId: "", reason: "access_config_unreadable" }];
  if (data.issues && data.issues.length > 0) return data.issues;
  return data.degradedAgents.map((agentId) => ({ agentId, reason: "role_resolution_failed" }));
}

export type TemporarilyUnableToQueryMetric = {
  /** Distinct roster Agents that cannot query; global → roster size. */
  count: number;
  global: boolean;
  /** Rows for the expand panel (global keeps the synthetic issue). */
  issues: PolicyDegradeIssue[];
};

/**
 * Agent 名册 Spec §5.1.1 — fourth KPI value from policy-runtime ∩ current roster.
 * Deleted Agent ids that only linger in policy-runtime do not count.
 */
export function deriveTemporarilyUnableToQueryMetric(
  data: PolicyRuntimeStatus,
  rosterAgentIds: Iterable<string>
): TemporarilyUnableToQueryMetric {
  const roster = new Set(rosterAgentIds);
  if (data.healthy) {
    return { count: 0, global: false, issues: [] };
  }
  if (data.degradedGlobal) {
    return {
      count: roster.size,
      global: true,
      issues: issuesFromPolicyStatus(data)
    };
  }
  const raw = issuesFromPolicyStatus(data).filter((issue) => issue.agentId && roster.has(issue.agentId));
  const seen = new Set<string>();
  const issues: PolicyDegradeIssue[] = [];
  for (const issue of raw) {
    if (!seen.has(issue.agentId)) {
      seen.add(issue.agentId);
    }
    issues.push(issue);
  }
  return { count: seen.size, global: false, issues };
}
