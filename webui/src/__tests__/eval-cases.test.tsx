// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseList } from "../pages/eval/CaseList";

function renderCaseList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/eval/cases"]}>
        <Routes>
          <Route path="/eval/cases" element={<CaseList />} />
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

describe("CaseList M34 IA", () => {
  it("renders the renamed PageHeader title and breadcrumbs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/eval/domains") {
          return new Response(JSON.stringify({ ok: true, data: { domains: [] } }));
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    renderCaseList();

    expect(await screen.findByRole("heading", { name: "评测用例" })).toBeInTheDocument();
    // M40: 一级根页面不再渲染面包屑
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Case 管理" })).not.toBeInTheDocument();
  });
});
