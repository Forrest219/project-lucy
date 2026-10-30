// @vitest-environment jsdom
/**
 * T05b audit-trust 组件测试：AuditTopMetaBar
 * - 固定起止时间 + 时区 + 统计时间 + 同步延迟 + 刷新状态
 * - 同步延迟 > 5s 时挂 pl-status-warning
 * - paused 状态显示原因（如果有）
 * - trailing slot 可选
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AuditTopMetaBar } from "../../components/audit-trust/AuditTopMetaBar";

describe("T05b AuditTopMetaBar", () => {
  it("renders fixed window, zone, stats-at, refresh, lag with data-testids", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="Asia/Shanghai"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={120}
      />
    );
    expect(container.querySelector('[data-testid="audit-top-meta-bar"]')).not.toBeNull();
    const windowSlot = container.querySelector('[data-testid="audit-top-meta-window"]');
    const windowValue = windowSlot?.querySelector(".pl-audit-top-meta-value");
    expect(windowSlot?.querySelector(".pl-audit-top-meta-label")?.textContent).toBe("窗口");
    expect(windowValue?.textContent).toBe("2026-10-19 08:00:00 → 2026-10-20 07:59:59");
    expect(windowValue?.textContent).not.toMatch(/T|Z/);
    expect(windowValue?.getAttribute("data-iso-start")).toBe("2026-10-19T00:00:00Z");
    expect(windowValue?.getAttribute("data-iso-end")).toBe("2026-10-19T23:59:59Z");
    expect(windowValue?.getAttribute("title")).toContain("2026-10-19T00:00:00Z");
    expect(container.querySelector('[data-testid="audit-top-meta-zone"]')?.textContent).toBe(
      "Asia/Shanghai"
    );
    const stats = container.querySelector('[data-testid="audit-top-meta-stats-at"]');
    expect(stats?.querySelector(".pl-audit-top-meta-label")?.textContent).toBe("统计时间");
    expect(stats?.querySelector(".pl-audit-top-meta-value")?.textContent).toBe("2026-10-20 07:59:00");
    expect(stats?.querySelector(".pl-audit-top-meta-value")?.getAttribute("data-iso")).toBe(
      "2026-10-19T23:59:00Z"
    );
  });

  it("omits the end date when both instants fall on the same zone calendar day", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-30T01:00:00.000Z"
        fixedEnd="2026-10-30T02:51:55.000Z"
        zone="Asia/Shanghai"
        statsAt="2026-10-30T02:51:53.000Z"
        statsLabel="刚刚"
        refreshState="live"
        syncLagMs={0}
      />
    );
    expect(container.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent).toBe(
      "2026-10-30 09:00:00 → 10:51:55"
    );
    expect(container.querySelector('[data-testid="audit-top-meta-stats-at"] .pl-audit-top-meta-value')?.textContent).toBe(
      "刚刚"
    );
  });

  it("keeps both dates when the zone calendar day differs", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-23T02:00:00.000Z"
        fixedEnd="2026-10-30T02:50:35.000Z"
        zone="UTC"
        statsAt="2026-10-30T02:50:15.000Z"
        refreshState="live"
        syncLagMs={0}
      />
    );
    expect(container.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent).toBe(
      "2026-10-23 02:00:00 → 2026-10-30 02:50:35"
    );
  });

  it("flags sync lag > 5s with pl-status-warning + data-overdue", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={12345}
      />
    );
    const lag = container.querySelector('[data-testid="audit-top-meta-sync-lag"]');
    expect(lag?.getAttribute("data-overdue")).toBe("true");
    expect(lag?.getAttribute("data-lag-ms")).toBe("12345");
    expect(lag?.textContent).toContain("s");
  });

  it("does NOT flag lag <= 5s", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={4500}
      />
    );
    const lag = container.querySelector('[data-testid="audit-top-meta-sync-lag"]');
    expect(lag?.getAttribute("data-overdue")).toBe("false");
  });

  it("renders paused state with optional reason", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="paused"
        pauseReason="fixed-filter-locked"
        syncLagMs={0}
      />
    );
    const refresh = container.querySelector('[data-testid="audit-top-meta-refresh"]');
    expect(refresh?.getAttribute("data-state")).toBe("paused");
    expect(refresh?.textContent).toContain("已暂停");
    expect(refresh?.textContent).toContain("fixed-filter-locked");
  });

  it("renders live state without pauseReason", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={0}
      />
    );
    const refresh = container.querySelector('[data-testid="audit-top-meta-refresh"]');
    expect(refresh?.textContent).toContain("实时");
  });

  it("formats lag in ms / s / min", () => {
    const { container: c1 } = render(
      <AuditTopMetaBar
        fixedStart="s"
        fixedEnd="e"
        zone="UTC"
        statsAt="s"
        refreshState="live"
        syncLagMs={500}
      />
    );
    expect(c1.textContent).toContain("500 ms");
    const { container: c2 } = render(
      <AuditTopMetaBar
        fixedStart="s"
        fixedEnd="e"
        zone="UTC"
        statsAt="s"
        refreshState="live"
        syncLagMs={2500}
      />
    );
    expect(c2.textContent).toMatch(/2\.5 s/);
    const { container: c3 } = render(
      <AuditTopMetaBar
        fixedStart="s"
        fixedEnd="e"
        zone="UTC"
        statsAt="s"
        refreshState="live"
        syncLagMs={120000}
      />
    );
    expect(c3.textContent).toMatch(/2\.0 min/);
  });

  it("renders trailing slot when provided", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="s"
        fixedEnd="e"
        zone="UTC"
        statsAt="s"
        refreshState="live"
        syncLagMs={0}
        trailing={<span data-testid="trailing-slot">trailing-content</span>}
      />
    );
    expect(container.querySelector('[data-testid="trailing-slot"]')?.textContent).toBe(
      "trailing-content"
    );
  });
});