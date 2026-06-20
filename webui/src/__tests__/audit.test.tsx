// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

function renderAudit() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Audit />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Audit", () => {
  it("redacts sensitive expanded row details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/admin/audit")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 1,
                entries: [
                  {
                    id: 1,
                    ts: "2026-06-20T00:00:00.000Z",
                    userId: "zhangsan",
                    client: "hermes",
                    tool: "sl_query",
                    tables: ["superstore_orders"],
                    argsSummary: { query: "sales", token: "super-secret", nested: { api_key: "abc123", private_key: "private123" } },
                    outcome: "error",
                    errorDetail: "password=leaked\nstack trace line",
                    durationMs: 12,
                    requestId: "req-1"
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderAudit();

    fireEvent.click(await screen.findByText("zhangsan"));
    expect(await screen.findByText("Args：")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("[REDACTED]");
    expect(document.body).not.toHaveTextContent("super-secret");
    expect(document.body).not.toHaveTextContent("abc123");
    expect(document.body).not.toHaveTextContent("private123");
    expect(document.body).not.toHaveTextContent("password=leaked");
    expect(document.body).not.toHaveTextContent("stack trace line");
  });
});
