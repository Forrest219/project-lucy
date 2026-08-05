import type { ReactNode } from "react";
import { MetricCard as SharedMetricCard, type MetricCardTone } from "../../components/MetricCard";
import { METRIC_METADATA, type MetricType } from "./constants";

type MetricCardProps = {
  type: MetricType;
  value: ReactNode;
  subValue?: ReactNode;
  tone?: MetricCardTone | "muted";
};

export function MetricCard({ type, value, subValue, tone }: MetricCardProps) {
  const meta = METRIC_METADATA[type];
  const resolvedTone = tone && tone !== "muted" ? tone : undefined;

  return (
    <SharedMetricCard
      label={meta.title}
      value={value}
      help={meta.hint}
      subValue={subValue}
      tone={resolvedTone}
      helpId={type}
      metric={type}
      testId="connection-metric"
    />
  );
}
