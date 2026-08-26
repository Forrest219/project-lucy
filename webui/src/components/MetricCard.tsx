import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { MetricState } from "../lib/kpiContracts";

export type MetricCardTone = "success" | "warning" | "danger";

export type MetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  /** Metric definition shown in ⓘ tooltip. Required for every List KPI card. Accepts ReactNode. */
  help: ReactNode;
  /** Current-context subline (window, denominator, empty state). */
  subValue?: ReactNode;
  tone?: MetricCardTone;
  testId?: string;
  /** Stable id for help button test id and optional data-metric. */
  helpId: string;
  /** Accessible title when `label` is not a plain string. */
  labelText?: string;
  /** Optional Connections-style data-metric attribute. */
  metric?: string;
  /**
   * Spec 128 §3.1 — metric state.
   * Defaults to "ok" for backward-compatible static config cards.
   *
   * State rendering rules (D3):
   *   ok        → render `value` prop as-is
   *   no_data   → render "—" + "所选范围内无数据"
   *   unavailable → render "—" + "数据源不可用"
   *   partial   → render "—" + warning from `unavailableReason` (NEVER numeric)
   */
  state?: MetricState;
  /** Human-readable reason shown when state=partial or state=unavailable. */
  unavailableReason?: string;
  /** ISO 8601 timestamp for freshness labeling. */
  asOf?: string;
};

const STATE_PLACEHOLDER = "—";

function StateSubValue({
  state,
  unavailableReason,
  fallback
}: {
  state: MetricState;
  unavailableReason?: string;
  fallback?: ReactNode;
}): ReactNode {
  if (state === "no_data") {
    return <span>所选范围内无数据</span>;
  }
  if (state === "unavailable") {
    return <span>{unavailableReason ?? "数据源不可用"}</span>;
  }
  if (state === "partial") {
    return <span>⚠ {unavailableReason ?? "数据不完整"}</span>;
  }
  return fallback ?? null;
}

export function MetricCard({
  label,
  value,
  help,
  subValue,
  tone,
  testId,
  helpId,
  labelText,
  metric,
  state = "ok",
  unavailableReason,
  asOf: _asOf
}: MetricCardProps) {
  const toneClass = tone ? `pl-metric-card--${tone}` : undefined;
  const titleText = labelText ?? (typeof label === "string" ? label : helpId);

  // Spec 128 D3: non-ok states always render — as main value, never numeric
  const displayValue = state === "ok" ? value : STATE_PLACEHOLDER;
  const displaySubValue =
    state === "ok"
      ? subValue
      : <StateSubValue state={state} unavailableReason={unavailableReason} fallback={subValue} />;

  return (
    <div
      className={["pl-metric-card", "pl-metric-card--with-help", toneClass].filter(Boolean).join(" ")}
      data-testid={testId}
      data-metric={metric}
      data-metric-state={state !== "ok" ? state : undefined}
    >
      <div className="pl-metric-card-title">
        <span>{label}</span>
        <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="pl-icon-help"
                aria-label={`${titleText} 说明`}
                data-testid={`metric-help-${helpId}`}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="pl-metric-tooltip"
                side="top"
                sideOffset={8}
                collisionPadding={8}
              >
                <p className="pl-metric-tooltip-text" data-testid="metric-tooltip-hint">
                  {help}
                </p>
                <Tooltip.Arrow className="pl-metric-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <strong className="tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
        {displayValue}
      </strong>
      {displaySubValue ? <small>{displaySubValue}</small> : null}
    </div>
  );
}
