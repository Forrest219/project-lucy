// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigAudit } from "../pages/admin/ConfigAudit";

function renderConfigAudit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfigAudit />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConfigAudit M34 IA", () => {
  it("renders 配置审计 at the PageHeader title layer while preserving the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { total: 0, entries: [] }
          })
        )
      )
    );

    renderConfigAudit();

    expect(await screen.findByRole("heading", { name: "配置审计" })).toBeInTheDocument();
    // M40: 一级根页面不再渲染面包屑
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "配置变更日志" })).not.toBeInTheDocument();
  });
});
