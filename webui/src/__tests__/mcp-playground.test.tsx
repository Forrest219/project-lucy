// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpPlayground } from "../pages/admin/McpPlayground";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(entry = "/admin/mcp-playground") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [{ id: "demo", name: "Demo", enabled: true, role: "analyst", tokens: [], stats: {} }] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/admin/mcp-tools")) {
        return new Response(JSON.stringify({ ok: true, data: { tools: [{ name: "lucy_query" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: false, error: { message: "missing" } }), { status: 404 });
    })
  );
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <McpPlayground />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("McpPlayground", () => {
  it("renders page header and dry-run controls", async () => {
    renderPage();
    expect(screen.getByTestId("mcp-playground-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MCP 调试台" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("mcp-playground-run-preview")).toBeInTheDocument());
  });
});
