// @vitest-environment jsdom
//
// 伴生缺陷 C-1 / C-2 的回归（Spec §5.4，SC-18 / SC-19，INV-2）。
//
// C-1：`AuditReconciliation` 的问询 ID 输入框把 `e.target.value.trim()` 写回
//       受控 state ⇒ state ≠ DOM 值 ⇒ React 回写 node.value ⇒ IME 组合可被打断，
//       且用户输入的首尾空格被静默抹除。
// C-2：`CaseEditor` 的期望指标输入框把 `value={arr.join(", ")}` 绑给输入框，
//       onChange 里立刻 split/trim/filter 写回 ⇒ 用户键入的 `", "` 被立即抹掉。
//
// 断言口径：**受控输入框的值必须是用户输入的原文**；规范化只发生在下游消费点。

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditReconciliation } from "../pages/admin/AuditReconciliation";
import { CaseEditor } from "../pages/eval/CaseEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SC-18：AuditReconciliation 问询 ID 输入框保留原文", () => {
  it("输入带首尾空格的文本后输入框保留原文，请求按 trim 后的值发起", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit/reconciliation/usage")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              reconciliationContext: { watermarkSeq: 1, snapshotId: "s", metricUnit: "tool_call" },
              asOfProof: { ok: true },
              tokenReconciliation: {
                configuredSnapshot: { capturedAt: "2026-10-28T00:00:00.000Z", configVersion: "v1", available: true, unavailableReason: null, total: 1, enabled: 1, disabled: 0, expired: 0 },
                activeWindow: { from: "x", to: "y", timezone: "UTC", metricUnit: "tool_call", protocolEventsExcluded: 0, identityCount: 1, totalCallCount: 1 },
                unknownIdentity: { count: 0, reasons: [] },
                differences: [],
                anomaly: { activeGreaterThanConfigured: false, flagged: false, reason: "" },
                completeness: { numerator: 1, denominator: 1, ratio: 1, ratioNullReason: null }
              },
              calls: { items: [], nextCursor: null, complete: true, totalMatched: 0, returned: 0 }
            }
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: { inquiry: {} } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/audit-reconciliation?range=7d"]}>
          <AuditReconciliation />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const input = (await screen.findByTestId(
      "reconciliation-inquiry-input"
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "  turn-42  " } });

    // 原文留在输入框里。
    expect(input).toHaveValue("  turn-42  ");

    // 消费点规范化：请求按 trim 后的值发起。
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(calls.some((url) => url.includes("/inquiries/turn-42?"))).toBe(true);
      expect(calls.some((url) => url.includes("/inquiries/%20%20turn-42"))).toBe(false);
    });
  });
});

describe("SC-19：CaseEditor 期望指标输入框可键入「, 」", () => {
  function renderEditor() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/eval/cases/superstore/new"]}>
          <Routes>
            <Route path="/eval/cases/:domain/:caseId" element={<CaseEditor />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  async function openQuestionTab() {
    fireEvent.click(screen.getByRole("button", { name: "问题 & 期望" }));
    return (await screen.findByPlaceholderText(
      "weighted_discount, profit_margin"
    )) as HTMLInputElement;
  }

  it("受控值是原文；键入分隔符与空格不会被立即抹掉", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }))
    );
    renderEditor();

    const input = await openQuestionTab();

    fireEvent.change(input, { target: { value: "weighted_discount, " } });

    // 「, 」必须原样留在输入框里——旧写法会立刻把它抹成 "weighted_discount"。
    expect(input).toHaveValue("weighted_discount, ");

    fireEvent.change(input, { target: { value: "weighted_discount, profit_margin" } });
    expect(input).toHaveValue("weighted_discount, profit_margin");
  });

  it("解析值只用于下游：提交时按解析后的数组提交", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/eval/cases/") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, data: { diff: "", proposedYaml: "" } }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderEditor();

    const input = await openQuestionTab();

    fireEvent.change(input, { target: { value: "weighted_discount, profit_margin" } });
    // 问法必填，否则保存会被前端拦下。
    const question = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(question, { target: { value: "问法" } });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter((call) => call[1] !== undefined);
      expect(posts.length).toBeGreaterThan(0);
      const body = JSON.parse(String((posts[posts.length - 1][1] as RequestInit).body));
      expect(body.case.expected_measures).toEqual(["weighted_discount", "profit_margin"]);
    });
  });
});
