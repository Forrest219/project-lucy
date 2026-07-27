// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "../pages/Onboarding";
import type { Agent } from "../lib/types";

const readyAgent: Agent = {
  id: "analyst",
  name: "Analyst",
  enabled: true,
  role: "analyst",
  tokens: [{ hash: "abc", label: "default", created: "2026-06-21T00:00:00.000Z" }]
};

function renderPage(options: { agents?: Agent[] } = {}) {
  const agents = options.agents ?? [readyAgent];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          root: "/tmp/project-lucy",
          ktxAvailable: true,
          connections: [
            { id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }
          ]
        }
      }));
    }
    if (url === "/api/sources") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tables: [
            {
              conn: "mysql-demo",
              schema: "demo",
              table: "orders",
              filePath: "semantic-layer/mysql-demo/_schema/demo.yaml",
              columnCount: 4,
              columnNames: ["id", "amount"],
              hasTableDesc: true,
              hasGrain: true,
              measureCount: 1,
              joinCount: 0,
              wikiRefCount: 0,
              completion: "done",
              mtime: "2026-06-21T00:00:00.000Z"
            }
          ]
        }
      }));
    }
    if (url === "/api/diff") {
      return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
    }
    if (url === "/api/admin/agents") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          agents
        }
      }));
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Onboarding", () => {
  it("summarizes the customer deployment path and copies MCP config", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "上线检查" })).toBeInTheDocument();
    expect(screen.getByText("Deployment readiness")).toBeInTheDocument();
    expect(screen.getByText("Semantic coverage")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("mysql-demo")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:7879/mcp")).toBeInTheDocument();
    expect(screen.getByText("Lucy MCP is ready for Agent delivery")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /复制 .*mcp\.json 配置/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Semantic Tables")).not.toBeInTheDocument();
    expect(screen.queryByText("Checklist")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制 MCP 配置" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer <LUCY_AGENT_TOKEN>"));
  });

  it("shows a not-ready blocker banner with the first failure reason", async () => {
    renderPage({ agents: [] });

    expect(await screen.findByText(/还差/)).toBeInTheDocument();
    expect(screen.getByText("尚未创建 Agent")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开阻塞项" })
    ).toHaveAttribute("href", "/admin/agents");
  });

  it.each([
    ["尚未创建 Agent", []],
    ["启用的 Agent 暂无可用 token", [{ ...readyAgent, tokens: [] }]],
    ["所有 Agent 均已禁用", [{ ...readyAgent, enabled: false }]],
    ["所有 Agent 仍为 legacy allow，需迁移到 role", [{ ...readyAgent, role: undefined, allow: { tables: ["*"], tools: ["*"] } }]]
  ])("explains MCP setup gap: %s", async (message, agents) => {
    renderPage({ agents: agents as Agent[] });

    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
