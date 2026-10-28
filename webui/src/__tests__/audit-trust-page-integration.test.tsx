// @vitest-environment jsdom
/**
 * 批 C-1 集成用例：Audit.tsx 挂载 audit-trust 六组件 + 八桶替换 + E7 去截断。
 *
 * 守的不变量（20261019 规格 §5 / §4.4、U2）：
 *  1. 执行状态展示的是**八桶** `primary_status`，不是旧三桶 `outcome`；
 *  2. 执行 / 关联 / 覆盖三条轴**互相独立** —— 「执行成功 + 归属待核验」
 *     必须同时可见，不能被单绿 badge 遮蔽；
 *  3. 覆盖轴无客户端证据时显示「后续动作不可见」，**不得**出现「未外发」；
 *  4. E7：涉及数据表不再出现「等 N 个」，抽屉默认展开全部；
 *  5. 返回规模未知时显示「—」并带空值原因，**不得**写成 0；
 *  6. 顶部元条显示固定窗口、时区、统计时间、刷新状态、审计同步延迟。
 *
 * 注：页面 mount 时 `since` 会被 effect 重算一次（既有行为），查询键因此
 * 变化并触发二次加载。所有断言一律等到**稳定态**（`waitFor`），不在加载
 * 窗口里取样。
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

type CallEntry = Record<string, unknown>;

const ENTRY_BASE = {
  ts: "2026-06-20T00:00:00.000Z",
  userId: "zhangsan",
  tool: "sl_query",
  outcome: "ok",
  durationMs: 12,
  requestId: "req-1"
};

function callsResponse(entries: CallEntry[]) {
  return {
    ok: true,
    data: {
      total: entries.length,
      projection: { complete: true, cursor: 10, latestSeq: 10, lag: 0, delayMs: 1234 },
      summary: {
        protocolCalls: 0,
        businessCalls: entries.length,
        deniedCalls: 0,
        dataBearingCalls: 0,
        primaryStatus: {
          succeeded: 1,
          failed: 0,
          denied: 0,
          budget_stopped: 0,
          cancelled: 0,
          timeout: 0,
          indeterminate: 0,
          unknown: 0
        },
        primaryStatusClosed: true,
        legacyOutcome: { ok: 1, error: 0, denied: 0 }
      },
      entries
    }
  };
}

function stubAuditApi(entries: CallEntry[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/audit/association-revisions")) {
      return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
    }
    if (url.includes("/api/admin/audit/turns")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            total: 0,
            entries: [],
            summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
            referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
          }
        }),
        { status: 200 }
      );
    }
    if (url.startsWith("/api/admin/audit")) {
      return new Response(JSON.stringify(callsResponse(entries)), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: { agents: [] } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAudit(initialUrl = "/admin/audit?tab=calls") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Audit />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** 等到该行真正渲染出来（页面会二次加载，不能在加载窗口取样）。 */
async function waitForRow(id: number) {
  await waitFor(() => expect(screen.getByTestId(`audit-primary-status-${id}`)).toBeInTheDocument());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("批 C-1：Audit.tsx 挂载 audit-trust 组件", () => {
  it("状态列展示八桶主状态，而不是旧三桶 outcome", async () => {
    stubAuditApi([{ ...ENTRY_BASE, id: 1, primaryStatus: "succeeded" }]);
    renderAudit();

    await waitForRow(1);
    const badge = screen.getByTestId("audit-primary-status-1");
    expect(badge.getAttribute("data-primary-status")).toBe("succeeded");
    expect(badge).toHaveTextContent("执行成功");
    // 旧 outcome 不得作为执行状态徽章出现
    expect(screen.queryByText("旧：成功")).not.toBeInTheDocument();
  });

  it("八桶汇总按固定顺序逐桶列出，legacy 直方图单列", async () => {
    stubAuditApi([{ ...ENTRY_BASE, id: 1, primaryStatus: "succeeded" }]);
    renderAudit();

    await waitFor(() =>
      expect(screen.getByTestId("audit-primary-status-summary")).toBeInTheDocument()
    );
    const summary = screen.getByTestId("audit-primary-status-summary");
    for (const bucket of [
      "succeeded",
      "failed",
      "denied",
      "budget_stopped",
      "cancelled",
      "timeout",
      "indeterminate",
      "unknown"
    ]) {
      expect(summary.querySelector(`[data-testid="audit-primary-status-count-${bucket}"]`)).not.toBeNull();
    }
    expect(screen.getByTestId("audit-legacy-outcome-histogram")).toHaveTextContent("旧 outcome（legacy）");
  });

  it("三轴独立：执行成功 + 归属待核验 + 覆盖不可见同时可见，不被单绿 badge 遮蔽", async () => {
    stubAuditApi([
      {
        ...ENTRY_BASE,
        id: 7,
        primaryStatus: "succeeded",
        executionStatus: "succeeded",
        associationStatus: "legacy_unverified"
      }
    ]);
    renderAudit();

    await waitForRow(7);
    const execution = screen.getByTestId("audit-status-execution");
    const association = screen.getByTestId("audit-status-association");
    const coverage = screen.getByTestId("audit-status-coverage");

    expect(execution.getAttribute("data-status")).toBe("succeeded");
    expect(execution).toHaveTextContent("执行成功");
    // 关联轴独立：执行成功**不**让关联变成已完成
    expect(association.getAttribute("data-status")).toBe("legacy_unverified");
    expect(association).toHaveTextContent("归属待核验");
    // 覆盖轴独立：无客户端证据 → 后续动作不可见（禁止「未外发」）
    expect(coverage.getAttribute("data-status")).toBe("unknown");
    expect(coverage).toHaveTextContent("后续动作不可见");
    expect(document.body.textContent ?? "").not.toContain("未外发");
  });

  it("覆盖轴在有受控客户端上报证据时才显示「客户端已采集」", async () => {
    stubAuditApi([
      {
        ...ENTRY_BASE,
        id: 8,
        primaryStatus: "succeeded",
        executionStatus: "succeeded",
        associationStatus: "confirmed",
        clientEventId: "ce-1"
      }
    ]);
    renderAudit();

    await waitForRow(8);
    expect(screen.getByTestId("audit-status-coverage").getAttribute("data-status")).toBe("observed");
    expect(screen.getByTestId("client-coverage-pill")).toHaveTextContent("客户端已采集");
  });

  it("E7：涉及数据表不再写「等 N 个」", async () => {
    stubAuditApi([{ ...ENTRY_BASE, id: 9, primaryStatus: "succeeded" }]);
    renderAudit();

    await waitForRow(9);
    expect(document.body.textContent ?? "").not.toContain("等 ");
  });

  it("返回规模未知时显示「—」且带空值原因，不写成 0", async () => {
    stubAuditApi([
      { ...ENTRY_BASE, id: 10, primaryStatus: "succeeded", nullReason: "not_collected" }
    ]);
    renderAudit();

    await waitForRow(10);
    const rowset = screen.getByTestId("readonly-sql-rowset");
    expect(rowset.getAttribute("data-status")).toBe("not_collected");
    expect(screen.getByTestId("readonly-sql-rows").textContent).toContain("—");
    expect(screen.getByTestId("readonly-sql-rows").textContent).not.toContain("0");
    expect(screen.getByTestId("readonly-sql-status")).toHaveTextContent("未采集");
  });

  it("顶部元条显示固定窗口、时区、统计时间、刷新状态与审计同步延迟", async () => {
    stubAuditApi([{ ...ENTRY_BASE, id: 11, primaryStatus: "succeeded" }]);
    renderAudit();

    await waitFor(() => expect(screen.getByTestId("audit-top-meta-bar")).toBeInTheDocument());
    expect(screen.getByTestId("audit-top-meta-window")).toBeInTheDocument();
    expect(screen.getByTestId("audit-top-meta-zone")).toBeInTheDocument();
    expect(screen.getByTestId("audit-top-meta-stats-at")).toBeInTheDocument();
    expect(screen.getByTestId("audit-top-meta-refresh").getAttribute("data-state")).toBe("live");
    // 审计同步延迟来自服务端投影状态（真实观测值，不是编造）
    await waitFor(() =>
      expect(screen.getByTestId("audit-top-meta-sync-lag").getAttribute("data-lag-ms")).toBe("1234")
    );
  });

  it("暂停刷新会冻结刷新状态", async () => {
    stubAuditApi([{ ...ENTRY_BASE, id: 12, primaryStatus: "succeeded" }]);
    renderAudit();

    await waitForRow(12);
    fireEvent.click(screen.getByTestId("audit-refresh-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("audit-top-meta-refresh").getAttribute("data-state")).toBe("paused")
    );
  });
});
