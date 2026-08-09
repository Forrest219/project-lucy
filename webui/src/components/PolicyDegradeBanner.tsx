import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { apiGet } from "../lib/apiClient";
import type { PolicyRuntimeStatus } from "../lib/types";

/**
 * Spec 98 §8.4 — Admin top banner when EffectivePolicy is degraded.
 * Shown on /admin/* routes only.
 */
export function PolicyDegradeBanner() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  const { data } = useQuery({
    queryKey: ["admin", "policy-runtime"],
    queryFn: () => apiGet<PolicyRuntimeStatus>("/api/admin/policy-runtime"),
    enabled: isAdmin,
    refetchInterval: 15_000,
    staleTime: 5_000
  });

  if (!isAdmin || !data || data.healthy) return null;

  const scope = data.degradedGlobal
    ? "全部 Agent 的 DataPlane（全局降级）"
    : `受影响 Agent：${data.degradedAgents.join(", ") || "（未知）"}`;

  return (
    <div
      className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger"
      data-testid="policy-degrade-banner"
      role="alert"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong>策略运行时降级</strong>
        <span>{scope}</span>
        {data.policyVersion ? (
          <span className="font-mono text-xs notranslate" translate="no">
            policyVersion={data.policyVersion.slice(0, 12)}…
          </span>
        ) : null}
        <Link className="underline" to="/admin/config-audit">
          查看配置审计
        </Link>
        <span className="text-xs text-fg-muted">
          恢复步骤见 <span className="notranslate" translate="no">docs/access-control/runbook-policy-degrade.md</span>
        </span>
      </div>
    </div>
  );
}
