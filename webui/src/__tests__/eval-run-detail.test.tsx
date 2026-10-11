// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunDetail } from "../pages/eval/RunDetail";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RunDetail v2", () => {
  it("shows the three outcomes, the as-of date, and leaves not answered out of the rate", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/eval/runs?")) {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, runs: [] } }));
      }
      return new Response(JSON.stringify({
        ok: true,
        data: {
          id: 7,
          domain: "sales",
          status: "succeeded",
          startedAt: "2026-10-11T00:00:00.000Z",
          triggeredBy: "offline",
          trigger: "import",
          passCount: 1,
          failCount: 1,
          totalCases: 2,
          resultVersion: 2,
          notAnsweredCount: 1,
          asOf: "2026-10-11",
          results: [
            { caseId: "a", status: "PASS", outcome: "answered_ok", window: { start: "2026-10-01", end: "2026-10-11" } },
            { caseId: "b", status: "FAIL", outcome: "answered_wrong" },
            { caseId: "c", status: "ERROR", outcome: "not_answered" }
          ]
        }
      }));
    }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/eval/runs/7"]}>
          <Routes>
            <Route path="/eval/runs/:runId" element={<RunDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("答对了")).toBeInTheDocument();
    expect(screen.getByText("答错了")).toBeInTheDocument();
    expect(screen.getByText("没答出来")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("2026-10-11")).toBeInTheDocument();
  });
});
