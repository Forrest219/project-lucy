import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export type MetricCardTone = "success" | "warning" | "danger";

export type MetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  /** Metric definition shown in ⓘ tooltip. Required for every List KPI card. */
  help: string;
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
};

export function MetricCard({
  label,
  value,
  help,
  subValue,
  tone,
  testId,
  helpId,
  labelText,
  metric
}: MetricCardProps) {
  const toneClass = tone ? `pl-metric-card--${tone}` : undefined;
  const titleText = labelText ?? (typeof label === "string" ? label : helpId);

  return (
    <div
      className={["pl-metric-card", "pl-metric-card--with-help", toneClass].filter(Boolean).join(" ")}
      data-testid={testId}
      data-metric={metric}
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
      <strong className="tabular-nums">{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </div>
  );
}
