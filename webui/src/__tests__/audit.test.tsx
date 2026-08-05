// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      <MemoryRouter initialEntries={["/admin/audit?tab=calls"]}>
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [], referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 } } }));
      }
      if (url.startsWith("/api/admin/audit")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 1,
              summary: {
                businessCalls: 1,
                protocolCalls: 2,
                deniedCalls: 1,
                dataBearingCalls: 1
              },
              entries: [
                {
                  id: 1,
                  ts: "2026-06-20T00:00:00.000Z",
                  userId: "zhangsan",
                  tokenLabel: "hermes-laptop",
                  tokenHashPrefix: "sha256:feedbeef456",
                  client: "hermes",
                  tool: "sl_query",
                  tables: ["superstore_orders"],
                  argsSummary: { query: "sales", token: "super-secret", nested: { api_key: "api-key-secret-value", private_key: "private123" } },
                  outcome: "error",
                  errorDetail: "password=leaked\nstack trace line",
                  durationMs: 12,
                  requestId: "req-1",
                  roleIds: ["kx_readonly"],
                  permissionSnapshotHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                  effectiveTablesCount: 7,
                  decisionReason: "tool_denied"
                }
              ]
            }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    renderAudit();

    expect(await screen.findByRole("heading", { name: "访问日志" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "问询记录" })).toBeInTheDocument();
    expect(screen.queryByText("业务调用")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "调用流水" }));
    expect(await screen.findByText("tool_denied")).toBeInTheDocument();
    await waitFor(() => expect(String(fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/admin/audit?"))?.[0] ?? "")).toContain("includeProtocol=false"));

    fireEvent.click(await screen.findByText("zhangsan"));
    expect(await screen.findByText("Args：")).toBeInTheDocument();
    // M39 polish: the "Token" word is wrapped in a notranslate span for
    // translation defense, which splits the text node. Use a custom
    // matcher to assert the text content across the wrapping span.
    expect(
      screen.getByText((_content, element) => {
        return element?.textContent?.trim() === "Token：";
      })
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent("hermes-laptop");
    expect(screen.getByText("角色：")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("kx_readonly");
    expect(screen.getByText("权限快照：")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("7 张有效表");
    expect(document.body).toHaveTextContent("[REDACTED]");
    expect(document.body).not.toHaveTextContent("super-secret");
    expect(document.body).not.toHaveTextContent("api-key-secret-value");
    expect(document.body).not.toHaveTextContent("private123");
    expect(document.body).not.toHaveTextContent("password=leaked");
    expect(document.body).not.toHaveTextContent("stack trace line");
  });
});
