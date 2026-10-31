// @vitest-environment jsdom
/**
 * T05b audit-trust 组件测试：AuditTopMetaBar
 * - 固定起止时间 + 时区 + 统计时间 + 同步延迟 + 刷新状态
 * - 同步延迟 > 5s 时挂 pl-status-warning
 * - paused 状态显示原因（如果有）
 * - trailing slot 可选
 *
 * SC-01–SC-05（docs/specs/lucy-20261030-audit-context-bar-spec.md §5）：
 *  1. SC-01 五个标签各自独立于数值节点；
 *  2. SC-02 可见窗口不含 T/Z，原始 ISO 留在 title / data-iso*；
 *  3. SC-03 同日省略结束日期、跨日两端带日期，日界按声明时区计算；
 *  4. SC-04 无法解析的时间原样显示，无效时区回退运行时本地时区；
 *  5. SC-05 延迟 > 5000 挂 pl-status-warning，≤ 5000 不挂。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AuditTopMetaBar } from "../../components/audit-trust/AuditTopMetaBar";

/**
 * 按给定时区（省略 = 运行时本地时区）渲染 `YYYY-MM-DD HH:mm:ss`。
 * 用于独立算出期望值，避免把组件内部实现抄进断言。
 */
function formatInZone(iso: string, zone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  };
  if (zone) options.timeZone = zone;
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

describe("T05b AuditTopMetaBar", () => {
  it("SC-01：五个标签各自独立于数值节点，标签不与数值粘连", () => {
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
    const bar = container.querySelector('[data-testid="audit-top-meta-bar"]');
    const labels = Array.from(bar?.querySelectorAll(".pl-audit-top-meta-label") ?? []);
    // 五个合同标签各出现一次，顺序固定
    expect(labels.map((label) => label.textContent)).toEqual([
      "窗口",
      "时区",
      "统计时间",
      "审计同步延迟",
      "刷新"
    ]);
    for (const label of labels) {
      // 标签节点只装标签文字，数值在同级兄弟节点里
      expect(label.children.length).toBe(0);
      const siblings = Array.from(label.parentElement?.children ?? []);
      const value = siblings.find((node) => node !== label);
      expect(value).toBeTruthy();
      expect(value?.textContent?.trim()).not.toBe("");
      // 标签文本不得把数值吸进来（不得出现「窗口2026-…」这种粘连）
      expect(label.textContent).not.toContain(value?.textContent?.trim() ?? " ");
    }
  });

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

  it("SC-03：日界按声明时区计算，不是按 UTC 算", () => {
    // 15:59:59Z → 上海 10-29 23:59:59；16:00:00Z → 上海 10-30 00:00:00。
    // 上海口径跨日 → 两端都带日期；同一对时刻在 UTC 口径下是同一天。
    const { container: crossDay } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-29T15:59:59.000Z"
        fixedEnd="2026-10-29T16:00:00.000Z"
        zone="Asia/Shanghai"
        statsAt="2026-10-29T16:00:00.000Z"
        refreshState="live"
        syncLagMs={0}
      />
    );
    expect(
      crossDay.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent
    ).toBe("2026-10-29 23:59:59 → 2026-10-30 00:00:00");

    // 16:00:00Z → 上海 10-31 00:00:00；17:00:00Z → 上海 10-31 01:00:00。
    // 上海口径同日 → 省略结束日期；同一对时刻在 UTC 口径下落在 10-30，
    // 日期不同，据此可区分是不是真的按上海时区算的日界。
    const { container: sameDay } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-30T16:00:00.000Z"
        fixedEnd="2026-10-30T17:00:00.000Z"
        zone="Asia/Shanghai"
        statsAt="2026-10-30T17:00:00.000Z"
        refreshState="live"
        syncLagMs={0}
      />
    );
    expect(
      sameDay.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent
    ).toBe("2026-10-31 00:00:00 → 01:00:00");
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

  it("SC-05：警告色挂在延迟数值上，> 5000 挂 pl-status-warning，≤ 5000 不挂", () => {
    const { container: overdue } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={5001}
      />
    );
    const overdueSlot = overdue.querySelector('[data-testid="audit-top-meta-sync-lag"]');
    const overdueValue = overdueSlot?.querySelector(".pl-audit-top-meta-value");
    expect(overdueValue?.classList.contains("pl-status-warning")).toBe(true);
    expect(overdueSlot?.getAttribute("data-overdue")).toBe("true");

    const { container: onThreshold } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-19T00:00:00Z"
        fixedEnd="2026-10-19T23:59:59Z"
        zone="UTC"
        statsAt="2026-10-19T23:59:00Z"
        refreshState="live"
        syncLagMs={5000}
      />
    );
    const thresholdSlot = onThreshold.querySelector('[data-testid="audit-top-meta-sync-lag"]');
    const thresholdValue = thresholdSlot?.querySelector(".pl-audit-top-meta-value");
    expect(thresholdValue?.classList.contains("pl-status-warning")).toBe(false);
    expect(thresholdSlot?.getAttribute("data-overdue")).toBe("false");
  });

  it("SC-04：无法解析的时间原样显示，同步延迟格式不变", () => {
    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-13-99T99:99:99Z"
        fixedEnd="不是时间"
        zone="UTC"
        statsAt="也不是时间"
        refreshState="live"
        syncLagMs={2500}
      />
    );
    // 解析失败 → 原样回显，不抛错、不吞掉
    expect(container.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent).toBe(
      "2026-13-99T99:99:99Z → 不是时间"
    );
    // 统计时间没有相对标签时同样原样回显
    expect(container.querySelector('[data-testid="audit-top-meta-stats-at"] .pl-audit-top-meta-value')?.textContent).toBe(
      "也不是时间"
    );
    // 同步延迟格式不受影响
    expect(container.querySelector('[data-testid="audit-top-meta-sync-lag"]')?.textContent).toContain("2.5 s");
  });

  it("SC-04：时区名无效时回退运行时本地时区，不抛错", () => {
    expect(() =>
      render(
        <AuditTopMetaBar
          fixedStart="2026-10-30T00:00:00.000Z"
          fixedEnd="2026-10-30T01:00:00.000Z"
          zone="Not/AZone"
          statsAt="2026-10-30T01:00:00.000Z"
          refreshState="live"
          syncLagMs={0}
        />
      )
    ).not.toThrow();

    const { container } = render(
      <AuditTopMetaBar
        fixedStart="2026-10-30T00:00:00.000Z"
        fixedEnd="2026-10-30T01:00:00.000Z"
        zone="Not/AZone"
        statsAt="2026-10-30T01:00:00.000Z"
        refreshState="live"
        syncLagMs={0}
      />
    );
    const windowText =
      container.querySelector('[data-testid="audit-top-meta-window"] .pl-audit-top-meta-value')?.textContent ?? "";
    // 有效格式，不泄漏非法时区名，不残留 ISO 记号
    expect(windowText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}$/);
    expect(windowText).not.toContain("Not/AZone");
    expect(windowText).not.toMatch(/[TZ]/);
    // 口径 = 运行时本地时区
    const start = formatInZone("2026-10-30T00:00:00.000Z");
    const end = formatInZone("2026-10-30T01:00:00.000Z");
    expect(windowText).toBe(
      start.slice(0, 10) === end.slice(0, 10)
        ? `${start} → ${end.slice(11)}`
        : `${start} → ${end}`
    );
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