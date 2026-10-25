/**
 * Lucy v0.25 P1-2 — 授权摘要技术详情（默认折叠）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4.1（技术 YAML 默认折叠）、
 *     §7（Design System：技术详情渐进披露）、§2.1（快照身份）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B7）
 *
 * 技术详情是**可复制的完整标识**，不是装饰。它只展示快照身份与降级信息，不展示任何
 * 秘密：Token 明文、数据库口令都不在这份数据里（服务端不会下发）。
 */
import type { AuthorizationSummary } from "./AuthorizationTypes";

export function AuthorizationTechnicalDetails({ summary }: { summary: AuthorizationSummary }) {
  const { summaryContext } = summary;
  const technical = {
    subject: summaryContext.subject,
    basis: summaryContext.basis,
    configVersion: summaryContext.configVersion,
    policyVersion: summaryContext.policyVersion,
    sourceMapVersion: summaryContext.sourceMapVersion,
    capabilityDigest: summaryContext.capabilityDigest,
    snapshotHash: summaryContext.snapshotHash,
    candidateDigest: summaryContext.candidateDigest,
    state: summaryContext.state,
    problem: summaryContext.problem,
    failures: summaryContext.failures,
    legacyAllow: summary.legacyAllow,
    roleContributions: summary.roleContributions,
    diagnostics: summary.diagnostics
  };

  return (
    <details className="grid gap-2" data-testid="authorization-technical-details">
      <summary className="cursor-pointer text-sm font-medium">技术详情</summary>
      <pre
        className="notranslate overflow-x-auto rounded border bg-fg-subtle p-2 text-[12px]"
        translate="no"
        data-testid="authorization-technical-body"
      >
        {JSON.stringify(technical, null, 2)}
      </pre>
    </details>
  );
}
