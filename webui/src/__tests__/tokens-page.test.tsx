// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tokens } from "../pages/admin/Tokens";
import type { TokensResponse } from "../lib/types";

const MOCK_TOKENS_RESPONSE: TokensResponse = {
  tokens: [
    {
      hashPrefix: "sha256:aaaa0000",
      label: "cursor-desk-xingchen",
      created: "2026-08-20",
      expires_at: "2026-12-31",
      device_name: "xingchen-mbp",
      agent: {
        id: "analyst_zhang",
        name: "张分析师",
        enabled: true,
        roles: ["bi_analyst"]
      },
      last_used: "2026-08-28T10:00:00.000Z",
      last_tool: "sl_query",
      last_outcome: "allow",
      last_ip: "192.168.1.100",
      last_client: "cursor",
      last_client_version: "0.45.0",
      last_device_name_seen: "xingchen-mbp",
      distinct_ips_7d: 1,
      status: "available"
    },
    {
      hashPrefix: "sha256:bbbb1111",
      label: "hermes-agent-prod",
      created: "2026-06-01",
      expires_at: "2026-07-01",
      device_name: null,
      agent: {
        id: "prod_worker",
        name: "生产机器人",
        enabled: true,
        roles: ["data_viewer"]
      },
      last_used: "2026-07-01T08:00:00.000Z",
      status: "expired"
    }
  ],
  stats: {
    totalTokens: 2,
    availableTokens: 1,
    activeLast7dTokens: 1,
    expiringSoonTokens: 0,
    expiredTokens: 1
  }
};

function renderTokens(initialUrl = "/admin/tokens") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/admin/tokens" element={<Tokens />} />
          <Route path="/admin/tokens/new" element={<div>New Token Page</div>} />
          <Route path="/admin/agents/:userId" element={<div>Agent Page</div>} />
          <Route path="/admin/audit" element={<div>Audit Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Tokens (/admin/tokens)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders page header, KPI cards, and token inventory table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: MOCK_TOKENS_RESPONSE }))
      )
    );

    renderTokens();

    // Verify header and primary action
    expect(await screen.findByRole("heading", { name: /Token 凭据/ })).toBeInTheDocument();
    expect(screen.getByTestId("create-token-btn")).toBeInTheDocument();

    // Verify KPI metrics
    const kpiSection = screen.getByTestId("token-kpis");
    expect(kpiSection).toHaveTextContent("可用 Token");
    expect(kpiSection).toHaveTextContent("近 7 天活跃");
    expect(kpiSection).toHaveTextContent("已过期 / 停用");

    // Verify tokens table rows
    await screen.findByTestId("token-row-cursor-desk-xingchen");
    const table = screen.getByTestId("tokens-table");
    expect(table).toHaveTextContent("cursor-desk-xingchen");
    expect(table).toHaveTextContent("张分析师");
    expect(table).toHaveTextContent("bi_analyst");
    expect(table).toHaveTextContent("xingchen-mbp");
    expect(table).toHaveTextContent("hermes-agent-prod");
    expect(table).toHaveTextContent("已过期");
  });

  it("handles revoke modal confirmation flow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/admin/tokens")) {
        return new Response(JSON.stringify({ ok: true, data: MOCK_TOKENS_RESPONSE }));
      }
      if (url.includes("/tokens/cursor-desk-xingchen") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, data: { written: true, revokedAt: "2026-08-29" } }));
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();

    const row = await screen.findByTestId("token-row-cursor-desk-xingchen");
    const revokeBtn = row.querySelector("button[title='定向吊销']");
    expect(revokeBtn).not.toBeNull();
    fireEvent.click(revokeBtn!);

    // Check modal appears
    expect(await screen.findByRole("heading", { name: /确认吊销 cursor-desk-xingchen/ })).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "确认吊销" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/agents/analyst_zhang/tokens/cursor-desk-xingchen"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
