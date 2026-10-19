/**
 * audit-trust-2026-10-19-r1 / T05c — AssociationRevisionTimeline
 *
 * Contract §5.2 item 4. Renders the original / effective association + history
 * revisions + version, intended for the detail drawer top. The latest
 * revision (highest id, ts DESC) is the effective view; older revisions are
 * listed below it in reverse chronological order.
 *
 * Read-only: never mutates association_revisions. Admin write goes through
 * T03b's POST endpoint.
 */

export type AssociationRevisionTimelineItem = {
  id: number;
  ts: string; // ISO 8601
  originalTurnId: string;
  effectiveTurnId: string | null;
  originalAssociationStatus: string | null;
  effectiveAssociationStatus: string;
  reason: string;
  attributionRuleVersion: string;
  actorKind: string;
  actorId: string | null;
  classificationVersion: string;
};

export type AssociationRevisionTimelineProps = {
  /** Newest first. The first entry is the effective view; remaining are history. */
  revisions: AssociationRevisionTimelineItem[];
  /** Original association status from access_log (the pre-revision truth). */
  originalFromAccessLog?: string | null;
};

export function AssociationRevisionTimeline({
  revisions,
  originalFromAccessLog
}: AssociationRevisionTimelineProps) {
  if (revisions.length === 0) {
    return (
      <div
        className="pl-association-revision-timeline"
        data-testid="association-revision-timeline"
        data-empty="true"
      >
        <span className="pl-association-revision-empty">无修订记录</span>
      </div>
    );
  }

  const latest = revisions[0];

  return (
    <div
      className="pl-association-revision-timeline"
      data-testid="association-revision-timeline"
      data-revision-count={revisions.length}
    >
      <div
        className="pl-association-revision-effective"
        data-testid="association-revision-effective"
      >
        <span className="pl-association-revision-label">生效</span>
        <span className="pl-association-revision-status">{latest.effectiveAssociationStatus}</span>
        <span className="pl-association-revision-meta">
          v{latest.attributionRuleVersion} · {latest.ts}
        </span>
        <span className="pl-association-revision-reason">{latest.reason}</span>
      </div>

      <details
        className="pl-association-revision-history"
        data-testid="association-revision-history"
      >
        <summary>
          历史修订 ({revisions.length - 1})
        </summary>
        <ul className="pl-association-revision-list">
          {originalFromAccessLog ? (
            <li
              className="pl-association-revision-original"
              data-testid="association-revision-original"
              data-status={originalFromAccessLog}
            >
              <span className="pl-association-revision-label">原始 (access_log)</span>
              <span className="pl-association-revision-status">{originalFromAccessLog}</span>
              <span className="pl-association-revision-meta">准入时记录, 不可变</span>
            </li>
          ) : null}
          {revisions.slice(1).map((r) => (
            <li
              key={r.id}
              className="pl-association-revision-item"
              data-testid="association-revision-item"
              data-revision-id={r.id}
              data-effective-status={r.effectiveAssociationStatus}
            >
              <span className="pl-association-revision-label">v{r.attributionRuleVersion}</span>
              <span className="pl-association-revision-status">{r.effectiveAssociationStatus}</span>
              <span className="pl-association-revision-meta">{r.ts}</span>
              <span className="pl-association-revision-reason">{r.reason}</span>
              <span className="pl-association-revision-actor">
                {r.actorKind}:{r.actorId ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}