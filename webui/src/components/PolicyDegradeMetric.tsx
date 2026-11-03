import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/apiClient";
import { deriveTemporarilyUnableToQueryMetric } from "../lib/policyDegradeMetric";
import type { PolicyRuntimeStatus } from "../lib/types";
import { MetricCard } from "./MetricCard";
import { PolicyDegradeIssueList } from "./PolicyDegradeBanner";

type PolicyDegradeMetricProps = {
  rosterAgentIds: string[];
  agentNames: Record<string, string>;
};

/**
 * Agent 名册 Spec §5.1.1 — fixed fourth KPI for Agents temporarily unable to query.
 */
export function PolicyDegradeMetric({ rosterAgentIds, agentNames }: PolicyDegradeMetricProps) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin", "policy-runtime"],
    queryFn: () => apiGet<PolicyRuntimeStatus>("/api/admin/policy-runtime"),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false
  });

  const failed = query.isError;
  const metric =
    query.isSuccess && query.data
      ? deriveTemporarilyUnableToQueryMetric(query.data, rosterAgentIds)
      : null;
  const count = metric?.count ?? 0;
  const global = metric?.global ?? false;
  const showExpand = !failed && count > 0 && metric != null;
  const tone = failed || count === 0 ? undefined : global ? "danger" : "warning";
  const subValue = failed
    ? undefined
    : count === 0
      ? "当前无此异常"
      : global
        ? "全部 Agent"
        : "需修复角色或配置";

  return (
    <div className="pl-policy-degrade-metric" data-testid="metric-temporarily-unable-to-query">
      <MetricCard
        label="暂时不能查数"
        labelText="暂时不能查数"
        value={failed ? "—" : count}
        state={failed ? "unavailable" : "ok"}
        unavailableReason="数据源不可用"
        help="因 EffectivePolicy 无法应用而暂停查数的 Agent 个数。0 表示当前无此异常；全局降级时等于本页 Agent 总数。与「可用 Token／无可用 Token」不是同一个指标。"
        subValue={subValue}
        tone={tone}
        helpId="temporarily-unable-to-query-agents"
        testId="metric-temporarily-unable-to-query-card"
      />
      {showExpand ? (
        <div className="pl-policy-degrade-metric-expand">
          <button
            type="button"
            className="pl-policy-degrade-metric-toggle"
            aria-expanded={open}
            data-testid="policy-degrade-metric-toggle"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起修复说明" : "查看修复说明"}
          </button>
          {open ? (
            <div
              className={`pl-policy-degrade-notice pl-policy-degrade-metric-panel${global ? " pl-policy-degrade-metric-panel--danger" : ""}`}
              data-testid="policy-degrade-metric-panel"
              role="status"
            >
              <PolicyDegradeIssueList issues={metric.issues} agentNames={agentNames} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
