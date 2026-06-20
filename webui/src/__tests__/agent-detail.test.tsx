// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDetail } from "../pages/admin/AgentDetail";

function renderAgentDetail() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/agents/zhangsan"]}>
        <Routes>
          <Route path="/admin/agents/:userId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentDetail", () => {
  it("requires dry-run diff preview before saving edits", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan" && !init) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              version: "v1",
              agent: {
                id: "zhangsan",
                name: "张三",
                enabled: true,
                tokens: [],
                allow: { tables: ["dataforai.superstore_orders"], tools: ["sl_query"] },
                stats: { callsLast7d: 1, deniedLast7d: 0, topTables: [] }
              }
            }
          })
        );
      }
      if (url === "/api/admin/mcp-tools") {
        return new Response(JSON.stringify({ ok: true, data: { tools: [{ name: "sl_query", globalDenied: false }] } }));
      }
      if (url === "/api/admin/agents/zhangsan" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { diff: "+ name: 张三编辑", proposedYaml: "yaml" } }));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { written: true, agent: { id: "zhangsan", name: "张三编辑", enabled: true, tokens: [], allow: { tables: [], tools: [] } } }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAgentDetail();

    expect(await screen.findByDisplayValue("张三")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    fireEvent.change(await screen.findByDisplayValue("张三"), { target: { value: "张三编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));

    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();
    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true);
      expect(dryRunCall).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false);
      expect(saveCall).toBeTruthy();
    });
  });
});
