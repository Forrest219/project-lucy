// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

function renderHeatmapTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/audit?tab=heatmap"]}>
        <Routes>
          <Route path="/admin/audit" element={<Audit />} />
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

describe("Admin / Audit heatmap tab (M35)", () => {
  it("renders the heatmap tab content under ?tab=heatmap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/admin/audit/sources")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                connections: ["demo-mysql"],
                schemas: ["dataforai"],
                topTables: [
                  { table: "demo-mysql.dataforai.customers", calls: 12, denied: 1 },
                  { table: "demo-mysql.dataforai.orders", calls: 7, denied: 0 }
                ],
                deniedTables: [{ table: "demo-mysql.dataforai.pii", calls: 3, denied: 3 }]
              }
            })
          );
        }
        // Log tab fetch should not run (enabled: tab === "log"); but if a stray
        // request lands here, return a benign empty payload.
        return new Response(
          JSON.stringify({ ok: true, data: { entries: [], total: 0, summary: {} } })
        );
      })
    );

    renderHeatmapTab();

    expect(await screen.findByRole("heading", { name: "访问日志" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据热力" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "明细" })).toHaveAttribute("aria-selected", "false");

    await waitFor(() => {
      expect(screen.getByText("Top Tables")).toBeInTheDocument();
      expect(screen.getByText("Denied Tables")).toBeInTheDocument();
    });

    expect(screen.getByText("demo-mysql.dataforai.customers")).toBeInTheDocument();
    expect(screen.getByText("demo-mysql.dataforai.pii")).toBeInTheDocument();
  });
});
