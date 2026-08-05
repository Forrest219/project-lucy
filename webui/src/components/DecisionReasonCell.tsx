import { decisionReasonDetail, decisionReasonLabel } from "../lib/decisionReasonLabels";

type DecisionReasonCellProps = {
  code?: string | null;
  label?: string | null;
  detail?: string | null;
};

export function DecisionReasonCell({ code, label, detail }: DecisionReasonCellProps) {
  const resolvedCode = code?.trim() || "—";
  const extra = detail?.trim() || decisionReasonDetail(code);
  const primary = label?.trim() || decisionReasonLabel(code);
  const resolvedLabel = extra ? `${primary}（${extra}）` : primary;

  return (
    <div className="pl-decision-reason" data-testid="decision-reason-cell">
      <div className="pl-decision-reason-label" data-testid="decision-reason-label">
        {resolvedLabel}
      </div>
      <div
        className="pl-decision-reason-code font-mono text-xs text-fg-muted notranslate"
        translate="no"
        data-testid="decision-reason-code"
      >
        {resolvedCode}
      </div>
    </div>
  );
}
