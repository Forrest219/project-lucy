/**
 * audit-trust-2026-10-19-r1 / T05a — AuditStatusTriad
 *
 * Contract §5.2. Three orthogonal judgment axes for a single audit row:
 *   - execution (succeeded / failed / not_executed / interrupted / unknown)
 *   - association (confirmed / candidate / unassigned / conflict / legacy_unverified)
 *   - coverage (observed / gap / unknown)
 *
 * Each axis carries its own badge + text + color; the same row may show
 * "yes" on one axis and "no" on another without forcing a single "success"
 * verdict. Design System §01-foundations-color.md semantic palette only;
 * no new visual mode introduced here.
 *
 * Notes:
 *   - Never collapse to a single "✓" badge; even when execution=succeeded,
 *     the association and coverage axes remain independent.
 *   - "未外发" wording is FORBIDDEN — coverage shows "后续动作不可见" or
 *     "未知" only. Per Contract §5 + Plan §4 T05.
 */

export type ExecutionAxis =
  | "succeeded"
  | "failed"
  | "not_executed"
  | "interrupted"
  | "unknown";

export type AssociationAxis =
  | "confirmed"
  | "candidate"
  | "unassigned"
  | "conflict"
  | "legacy_unverified";

export type CoverageAxis = "observed" | "gap" | "unknown";

export type AuditStatusTriadProps = {
  execution: ExecutionAxis;
  association: AssociationAxis;
  coverage: CoverageAxis;
  /** Optional override labels for the badges (UI 主术语). */
  executionLabel?: string;
  associationLabel?: string;
  coverageLabel?: string;
};

const EXECUTION_PALETTE: Record<ExecutionAxis, string> = {
  succeeded: "pl-status-success",
  failed: "pl-status-error",
  not_executed: "pl-status-warning",
  interrupted: "pl-status-warning",
  unknown: "pl-status-neutral"
};

const ASSOCIATION_PALETTE: Record<AssociationAxis, string> = {
  confirmed: "pl-status-success",
  candidate: "pl-status-info",
  unassigned: "pl-status-neutral",
  conflict: "pl-status-error",
  legacy_unverified: "pl-status-warning"
};

const COVERAGE_PALETTE: Record<CoverageAxis, string> = {
  observed: "pl-status-success",
  gap: "pl-status-warning",
  unknown: "pl-status-neutral"
};

const EXECUTION_TEXT: Record<ExecutionAxis, string> = {
  succeeded: "执行成功",
  failed: "执行失败",
  not_executed: "未执行",
  interrupted: "中断",
  unknown: "未知"
};

const ASSOCIATION_TEXT: Record<AssociationAxis, string> = {
  confirmed: "已确认关联",
  candidate: "候选关联",
  unassigned: "未关联",
  conflict: "关联冲突",
  legacy_unverified: "归属待核验"
};

const COVERAGE_TEXT: Record<CoverageAxis, string> = {
  observed: "客户端已采集",
  gap: "采集缺口",
  unknown: "后续动作不可见"
};

export function AuditStatusTriad({
  execution,
  association,
  coverage,
  executionLabel,
  associationLabel,
  coverageLabel
}: AuditStatusTriadProps) {
  const execLabel = executionLabel ?? EXECUTION_TEXT[execution];
  const assocLabel = associationLabel ?? ASSOCIATION_TEXT[association];
  const covLabel = coverageLabel ?? COVERAGE_TEXT[coverage];

  return (
    <div
      className="pl-audit-status-triad"
      data-testid="audit-status-triad"
      aria-label="审计状态三轴判定"
    >
      <span
        className={`pl-status-badge ${EXECUTION_PALETTE[execution]}`}
        data-testid="audit-status-execution"
        data-status={execution}
      >
        {execLabel}
      </span>
      <span
        className={`pl-status-badge ${ASSOCIATION_PALETTE[association]}`}
        data-testid="audit-status-association"
        data-status={association}
      >
        {assocLabel}
      </span>
      <span
        className={`pl-status-badge ${COVERAGE_PALETTE[coverage]}`}
        data-testid="audit-status-coverage"
        data-status={coverage}
      >
        {covLabel}
      </span>
    </div>
  );
}