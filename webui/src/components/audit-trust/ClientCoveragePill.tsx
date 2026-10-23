/**
 * audit-trust-2026-10-19-r1 / T05c — ClientCoveragePill
 *
 * Contract §5.2 item 5. Renders the controlled-client collection coverage for
 * a single access_log row. The "未外发" wording is FORBIDDEN — coverage
 * states are "客户端已采集" / "采集缺口" / "后续动作不可见". Per Plan §4 T05
 * "没有客户端证据显示「后续动作不可见」, 不能显示「未外发」".
 */

export type ClientCoveragePillProps = {
  observed: boolean;
  /** When observed=false, surface a short reason (e.g. "no_controlled_client", "gap"). */
  reason?: string;
  /** Optional time range for the gap window. */
  gapWindow?: { from: string; to: string };
};

export function ClientCoveragePill({ observed, reason, gapWindow }: ClientCoveragePillProps) {
  if (observed) {
    return (
      <span
        className="pl-client-coverage-pill pl-status-success"
        data-testid="client-coverage-pill"
        data-observed="true"
        data-state="observed"
        aria-label="客户端已采集"
      >
        客户端已采集
      </span>
    );
  }
  if (gapWindow) {
    return (
      <span
        className="pl-client-coverage-pill pl-status-warning"
        data-testid="client-coverage-pill"
        data-observed="false"
        data-state="gap"
        data-gap-from={gapWindow.from}
        data-gap-to={gapWindow.to}
        aria-label="采集缺口"
      >
        采集缺口 ({gapWindow.from} → {gapWindow.to})
      </span>
    );
  }
  return (
    <span
      className="pl-client-coverage-pill pl-status-neutral"
      data-testid="client-coverage-pill"
      data-observed="false"
      data-state="unknown"
      data-reason={reason ?? "unknown"}
      aria-label="后续动作不可见"
    >
      后续动作不可见{reason ? `（${reason}）` : ""}
    </span>
  );
}