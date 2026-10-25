/**
 * Lucy v0.25 P1 — L25-14 R3: 行权限视图的状态徽章与快照身份.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.3（快照身份）, §6.2（独立行权限视图）; P1-D6（不可满足不是空集授权值）.
 *
 * Why this component exists instead of a plain status string: P1-1 §6.2
 * requires that 「无授权」, 「不可满足」, 「编译失败」and 「空筛选」are four
 * DIFFERENT states that never share one empty state. Folding them into one
 * 「无数据」label is exactly the misread the Spec forbids.
 *
 * The state is never carried by color alone: every badge renders its own text.
 */
import clsx from "clsx";

export type RowPolicyViewStatus =
  | "ok"
  | "no_applicable_grant"
  | "final_rows_unsatisfiable"
  | "compile_failed"
  | "no_match"
  | "unavailable";

const STATUS_LABELS: Record<RowPolicyViewStatus, string> = {
  ok: "行约束可判定",
  no_applicable_grant: "无授权",
  final_rows_unsatisfiable: "不可满足",
  compile_failed: "编译失败",
  no_match: "空筛选",
  unavailable: "快照不可用"
};

const STATUS_TONES: Record<RowPolicyViewStatus, string> = {
  ok: "pl-status-done",
  no_applicable_grant: "pl-status-not_started",
  final_rows_unsatisfiable: "pl-status-validation_failed",
  compile_failed: "pl-status-validation_failed",
  no_match: "pl-status-not_started",
  unavailable: "pl-status-validation_failed"
};

export function rowPolicyStatusLabel(status: RowPolicyViewStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function RowPolicyStateBadge({
  status,
  reason
}: {
  status: RowPolicyViewStatus;
  /** The machine reason behind the state, shown as-is (not translated). */
  reason?: string;
}) {
  return (
    <span className="grid gap-1">
      <span className={clsx("pl-status-badge", STATUS_TONES[status])} data-testid={`row-policy-status-${status}`}>
        {rowPolicyStatusLabel(status)}
      </span>
      {reason ? (
        <span className="text-xs text-fg-muted notranslate" translate="no" data-testid="row-policy-status-reason">
          {reason}
        </span>
      ) : null}
    </span>
  );
}

/** The four snapshot identity fields every P1 surface publishes (P1-1 §3.3). */
export type RowPolicySnapshotIdentity = {
  configVersion: string;
  policyVersion: string;
  sourceMapVersion: string;
  capabilityDigest: string;
};

export function RowPolicySnapshotBadge({ identity }: { identity: RowPolicySnapshotIdentity }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" data-testid="row-policy-snapshot">
      {(
        [
          ["配置版本", identity.configVersion],
          ["策略版本", identity.policyVersion],
          ["Source Map 版本", identity.sourceMapVersion],
          ["能力摘要", identity.capabilityDigest]
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt>{label}</dt>
          <dd className="notranslate" translate="no">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
