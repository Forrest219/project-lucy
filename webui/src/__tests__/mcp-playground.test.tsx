// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      if (url.includes("/api/admin/mcp-runtime/status")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            endpoint: { upstreamHost: "127.0.0.1", upstreamPort: 7878 },
            config: {
              projectRoot: "/tmp/project-lucy",
              ktxYamlDigest: "a".repeat(64),
              connectionIds: ["mysql-aliyun"],
              updatedAt: "2026-09-08T00:00:00.000Z"
            },
            catalog: {
              connectionIds: ["mysql-aliyun"],
              lastByConnection: {
                "mysql-aliyun": { id: "rel_1", status: "success", finishedAt: "2026-09-08T00:00:00.000Z" }
              }
            },
            policy: {
              policyVersion: "b".repeat(64),
              degradedGlobal: false,
              degradedAgents: [],
              accessConfigDigest: "c".repeat(64),
              sourceMapVersion: "d".repeat(64),
              healthy: true
            },
            execution: {
              status: "stale",
              lastCheckedAt: "2026-09-08T00:00:00.000Z",
              missingConnections: ["mysql-aliyun"]
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/mcp-runtime/canary")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            connectionId: "mysql-aliyun",
            status: "blocked",
            checks: [{ name: "execution_query", status: "blocked", detail: "尚无查询证据" }],
            executionRuntimeAck: false,
            decisionReason: "execution_canary_blocked"
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
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

  it("shows layered runtime status and reruns the execution canary", async () => {
    renderPage();
    const runtime = await screen.findByTestId("mcp-runtime-status-mysql-aliyun");
    expect(within(runtime).getByText("Config")).toHaveAttribute("translate", "no");
    expect(within(runtime).getByText("MCP Execution")).toHaveClass("notranslate");
    expect(within(runtime).getByTestId("mcp-runtime-remediation")).toHaveTextContent(
      "配置已写入，但 MCP 执行层尚未确认加载。请重启或 reload MCP 执行进程后重新检测。"
    );

    fireEvent.click(within(runtime).getByRole("button", { name: "重新检测执行层" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "/api/admin/mcp-runtime/canary",
      expect.objectContaining({ method: "POST" })
    ));
  });
});
