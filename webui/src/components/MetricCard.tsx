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
  /** Spec 165: in-window line. Null breaks the line. Omitted on every page except call monitor. */
  series?: Array<number | null>;
  seriesLabel?: string;
  seriesTestId?: string;
  /** 调用监控窗内折线的指标键，写成 call-monitor-sparkline-${seriesMetric}。 */
  seriesMetric?: string;
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

function SparklineMarks({
  paths,
  dots
}: {
  paths: string[];
  dots: Array<{ x: number; y: number }>;
}) {
  return (
    <>
      {paths.map((d, index) => (
        <path
          key={`path-${index}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {dots.map((dot, index) => (
        <circle key={`dot-${index}`} cx={dot.x} cy={dot.y} r="1.5" fill="currentColor" />
      ))}
    </>
  );
}

function MetricSparkline({
  values,
  label,
  testId,
  seriesMetric
}: {
  values: Array<number | null>;
  label: string;
  testId?: string;
  seriesMetric?: string;
}) {
  const width = 80;
  const height = 28;
  const pad = 2;
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const min = finite.length > 0 ? Math.min(...finite) : 0;
  const max = finite.length > 0 ? Math.max(...finite) : 0;
  const span = max - min;

  function xAt(index: number): number {
    if (values.length <= 1) return width / 2;
    return pad + (index / (values.length - 1)) * (width - pad * 2);
  }

  function yAt(value: number): number {
    if (span === 0) return height / 2;
    return pad + (1 - (value - min) / span) * (height - pad * 2);
  }

  const paths: string[] = [];
  const dots: Array<{ x: number; y: number }> = [];
  let commands: string[] = [];
  let segmentCount = 0;

  function flush() {
    if (segmentCount === 1 && commands[0]) {
      const match = commands[0].match(/M\s+([\d.]+)\s+([\d.]+)/);
      if (match) dots.push({ x: Number(match[1]), y: Number(match[2]) });
    } else if (commands.length > 1) {
      paths.push(commands.join(" "));
    }
    commands = [];
    segmentCount = 0;
  }

  values.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      flush();
      return;
    }
    const command = segmentCount === 0 ? "M" : "L";
    commands.push(`${command} ${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`);
    segmentCount += 1;
  });
  flush();

  const marks = <SparklineMarks paths={paths} dots={dots} />;
  if (seriesMetric != null) {
    return (
      <svg
        className="pl-metric-sparkline"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        data-testid={`call-monitor-sparkline-${seriesMetric}`}
      >
        {marks}
      </svg>
    );
  }
  return (
    <svg
      className="pl-metric-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-testid={testId}
    >
      {marks}
    </svg>
  );
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
  asOf: _asOf,
  series,
  seriesLabel,
  seriesTestId,
  seriesMetric
}: MetricCardProps) {
  const toneClass = tone ? `pl-metric-card--${tone}` : undefined;
  const titleText = labelText ?? (typeof label === "string" ? label : helpId);

  // Spec 128 D3: non-ok states always render — as main value, never numeric
  const displayValue = state === "ok" ? value : STATE_PLACEHOLDER;
  const displaySubValue =
    state === "ok"
      ? subValue
      : <StateSubValue state={state} unavailableReason={unavailableReason} fallback={subValue} />;
  const showSeries = state === "ok" && series != null && seriesLabel != null;

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
      {showSeries ? (
        <div className="pl-metric-card-value-row">
          <strong className="tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
            {displayValue}
          </strong>
          <MetricSparkline
            values={series ?? []}
            label={seriesLabel ?? ""}
            testId={seriesTestId}
            seriesMetric={seriesMetric}
          />
        </div>
      ) : (
        <strong className="tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
          {displayValue}
        </strong>
      )}
      {displaySubValue ? <small>{displaySubValue}</small> : null}
    </div>
  );
}
