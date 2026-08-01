import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { METRIC_METADATA, type MetricType } from "./constants";

type MetricCardProps = {
  type: MetricType;
  value: ReactNode;
  subValue?: ReactNode;
  tone?: "success" | "warning" | "danger" | "muted";
};

export function MetricCard({ type, value, subValue, tone }: MetricCardProps) {
  const meta = METRIC_METADATA[type];

  const toneClass = tone ? `pl-metric-card--${tone}` : undefined;

  return (
    <div
      className={["pl-metric-card", "pl-metric-card--with-help", toneClass].filter(Boolean).join(" ")}
      data-testid="connection-metric"
      data-metric={type}
    >
      <div className="pl-metric-card-title">
        <span>{meta.title}</span>
        <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="pl-icon-help"
                aria-label={`${meta.title} 管理含义`}
                data-testid={`metric-help-${type}`}
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
                <p className="pl-metric-tooltip-title" data-testid="metric-tooltip-title">{meta.title} · 管理含义</p>
                <div>
                  <span>关注问题：</span>
                  <p>{meta.question}</p>
                </div>
                <div>
                  <span>定义：</span>
                  <p>{meta.description}</p>
                </div>
                <div className="pl-metric-tooltip-rule">
                  <span>健康标准：</span>
                  {meta.healthyRule}
                </div>
                <Tooltip.Arrow className="pl-metric-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <strong>{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </div>
  );
}
