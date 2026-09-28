// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseEditor } from "../pages/eval/CaseEditor";
import { RunDetail } from "../pages/eval/RunDetail";

function renderRoute(initialEntry: string, path: string, element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Eval detail PageHeader context", () => {
  it("keeps Case domain and case_type in the metadata form instead of the PageHeader", async () => {
    renderRoute(
      "/eval/cases/demo_superstore/new",
      "/eval/cases/:domain/:caseId",
      <CaseEditor />
    );

    expect(await screen.findByRole("heading", { name: "新建评测用例" })).toBeInTheDocument();
    expect(screen.queryByTestId("page-header-badges")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("demo_superstore")).toBeInTheDocument();
    expect(screen.getByDisplayValue("single_turn")).toBeInTheDocument();
  });

  it("keeps only run status in the PageHeader and leaves domain and pass rate in the summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/eval/runs/42") {
          return new Response(JSON.stringify({
            ok: true,
            data: {
              id: 42,
              domain: "demo_superstore",
              status: "succeeded",
              startedAt: "2026-09-28T01:00:00.000Z",
              finishedAt: "2026-09-28T01:01:00.000Z",
              triggeredBy: "test",
              passCount: 1,
              failCount: 0,
              totalCases: 1,
              results: []
            }
          }));
        }
        if (url === "/api/eval/runs?domain=demo_superstore&limit=50") {
          return new Response(JSON.stringify({ ok: true, data: { total: 1, runs: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderRoute("/eval/runs/42", "/eval/runs/:runId", <RunDetail />);

    const badges = await screen.findByTestId("page-header-badges");
    expect(badges).toHaveTextContent("succeeded");
    expect(badges).not.toHaveTextContent("demo_superstore");
    expect(badges).not.toHaveTextContent("通过率");
    expect(screen.getByText("demo_superstore")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
