// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpPlayground } from "../pages/admin/McpPlayground";

afterEach(() => {
  vi.unstubAllGlobals();
});

type ExecutionStatus = "ok" | "stale" | "unknown" | "unavailable" | "error";

type PermissionsFixture = {
  roleIds: string[];
  connections: string[];
  sources: Array<{ connectionId: string; schema: string; sourceName: string; table: string }>;
};

const defaultPermissions: PermissionsFixture = {
  roleIds: ["analyst"],
  connections: ["mysql-aliyun"],
  sources: [{
    connectionId: "mysql-aliyun",
    schema: "chatbi",
    sourceName: "ai_intl_ad_daily",
    table: "chatbi.ai_intl_ad_daily"
  }]
};

function renderPage(options: {
  entry?: string;
  executionStatus?: ExecutionStatus;
  policyHealthy?: boolean;
  permissions?: PermissionsFixture;
} = {}) {
  const executionStatus = options.executionStatus ?? "stale";
  const policyHealthy = options.policyHealthy ?? true;
  const permissions = options.permissions ?? defaultPermissions;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/effective-permissions")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            roleIds: permissions.roleIds,
            snapshotHash: "hash",
            tools: ["lucy_query"],
            connections: permissions.connections,
            sources: permissions.sources,
            legacyAllow: false
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            agents: [
              { id: "demo", name: "Demo", enabled: true, role: "analyst", tokens: [], stats: {} },
              { id: "off", name: "Off", enabled: false, role: "analyst", tokens: [], stats: {} }
            ]
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
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
              degradedGlobal: !policyHealthy,
              degradedAgents: policyHealthy ? [] : ["demo"],
              accessConfigDigest: "c".repeat(64),
              sourceMapVersion: "d".repeat(64),
              healthy: policyHealthy
            },
            execution: {
              status: executionStatus,
              lastCheckedAt: "2026-09-08T00:00:00.000Z",
              missingConnections: executionStatus === "ok" ? [] : ["mysql-aliyun"],
              loadedConnectionIds: executionStatus === "ok" ? ["mysql-aliyun"] : []
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
            checks: [],
            executionRuntimeAck: false,
            decisionReason: "execution_config_stale"
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/mcp-playground/acl-preview")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            allowed: false,
            decisionReason: "table_forbidden:chatbi.ai_intl_ad_daily",
            decisionReasonLabel: "表未授权",
            roleIds: ["analyst"],
            remediation: {
              primary: { label: "编辑 Role 表范围", href: "/admin/roles/analyst?tab=permissions" },
              secondary: [
                { label: "打开 Agent", href: "/admin/agents/demo" },
                { label: "查看近 7 天同类拒绝", href: "/admin/audit?view=calls" }
              ]
            },
            effectivePermissions: { tools: ["lucy_query"], connections: ["mysql-aliyun"], tableSample: [], tableSampleTruncated: false }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/mcp-playground/live-smoke")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            httpStatus: 200,
            decisionReason: "allowed",
            decisionReasonLabel: "允许执行",
            result: { tools: [] },
            auditHref: "/admin/audit?view=calls&callSource=playground"
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: false, error: { message: `missing ${url} ${init?.method ?? ""}` } }), { status: 404 });
    })
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.entry ?? "/admin/mcp-playground"]}>
        <McpPlayground />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function chooseAgent() {
  await screen.findByRole("option", { name: "Demo (demo)" });
  fireEvent.change(screen.getByTestId("mcp-playground-agent"), { target: { value: "demo" } });
}

describe("McpPlayground", () => {
  it("keeps both checks hidden until an Agent and a task are chosen", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "MCP 调试台" })).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-task-connect")).not.toBeInTheDocument();

    await chooseAgent();
    expect(screen.getByTestId("mcp-playground-role")).toHaveTextContent("analyst");
    expect(screen.queryByRole("option", { name: "Off (off)" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
  });

  it("shows only the Token field on the connect check", async () => {
    renderPage({ executionStatus: "ok" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));

    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-source")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
  });

  it("rejects a pasted client config and does not open the confirm dialog", async () => {
    renderPage({ executionStatus: "ok" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    const token = await screen.findByTestId("mcp-playground-token");
    fireEvent.change(token, {
      target: { value: '{ "mcpServers": { "lucy": { "url": "http://127.0.0.1/mcp" } } }' }
    });

    expect(screen.getByTestId("mcp-playground-token-error")).toHaveTextContent("只粘贴 Token 那一串");
    expect(screen.getByTestId("mcp-playground-run-live")).toBeDisabled();
    fireEvent.click(screen.getByTestId("mcp-playground-run-live"));
    expect(screen.queryByTestId("mcp-playground-live-confirm")).not.toBeInTheDocument();
  });

  it("blocks the connect check when the execution layer is not loaded, and still allows the table check", async () => {
    renderPage({ executionStatus: "stale" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));

    expect(await screen.findByTestId("mcp-playground-execution-block")).toHaveTextContent("问数进程还没加载最新配置。");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mcp-playground-recheck"));
    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "/api/admin/mcp-runtime/canary",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"connectionId\":\"mysql-aliyun\"")
      })
    ));

    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));
    expect(await screen.findByTestId("mcp-playground-connection")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("shows only authorized connections and tables, then one next step", async () => {
    renderPage({ executionStatus: "stale" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));

    const connection = await screen.findByTestId("mcp-playground-connection");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    fireEvent.change(connection, { target: { value: "mysql-aliyun" } });
    const source = await screen.findByTestId("mcp-playground-source");
    fireEvent.change(source, { target: { value: "ai_intl_ad_daily" } });
    fireEvent.click(screen.getByTestId("mcp-playground-run-table"));

    expect(await screen.findByTestId("mcp-playground-result-headline")).toHaveTextContent("不允许");
    expect(screen.getByTestId("decision-reason-label")).toHaveTextContent("表未授权");
    expect(screen.getByText("详情").closest("details")).not.toHaveAttribute("open");
    const action = screen.getByTestId("mcp-playground-result-action");
    expect(action).toHaveTextContent("编辑 Role 表范围");
    expect(action).toHaveAttribute("href", "/admin/roles/analyst?tab=permissions");
    expect(screen.queryByText("查看近 7 天同类拒绝")).not.toBeInTheDocument();
    expect(screen.queryByText(/生效权限快照/)).not.toBeInTheDocument();

    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "/api/admin/mcp-playground/acl-preview",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"tool\":\"lucy_query\"")
      })
    ));
    const previewCall = vi.mocked(globalThis.fetch).mock.calls.find((call) => String(call[0]).includes("acl-preview"));
    expect(JSON.parse(String(previewCall?.[1]?.body))).toEqual({
      agentId: "demo",
      tool: "lucy_query",
      arguments: { connectionId: "mysql-aliyun", sourceName: "ai_intl_ad_daily" }
    });
  });

  it("offers a single Role link when nothing is authorized", async () => {
    renderPage({
      permissions: { roleIds: ["analyst"], connections: [], sources: [] }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));

    const link = await screen.findByTestId("mcp-playground-role-link");
    expect(link).toHaveTextContent("去授权连接");
    expect(link).toHaveAttribute("href", "/admin/roles/analyst?tab=permissions");
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("mcp-playground-role-link")).toHaveLength(1);
  });

  it("offers a single table-scope link when the connection has no visible tables", async () => {
    renderPage({
      permissions: { roleIds: ["analyst"], connections: ["mysql-aliyun"], sources: [] }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));
    fireEvent.change(await screen.findByTestId("mcp-playground-connection"), { target: { value: "mysql-aliyun" } });

    const link = await screen.findByTestId("mcp-playground-role-link");
    expect(link).toHaveTextContent("去编辑表范围");
    expect(screen.queryByTestId("mcp-playground-source")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("mcp-playground-role-link")).toHaveLength(1);
  });

  it("hides table choices when policy runtime is degraded", async () => {
    renderPage({ entry: "/admin/mcp-playground?agentId=demo&mode=dry-run", policyHealthy: false });
    expect(await screen.findByTestId("mcp-playground-policy-block")).toHaveTextContent("策略运行时降级，现在不能判断这张表能不能查。");
    expect(screen.getByTestId("mcp-playground-policy-link")).toHaveAttribute("href", "/admin/config-audit");
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("prefills the table check from an old dry-run link", async () => {
    const args = encodeURIComponent(JSON.stringify({
      connectionId: "mysql-aliyun",
      sourceName: "ai_intl_ad_daily",
      measures: ["ai_intl_ad_daily.revenue"]
    }));
    renderPage({ entry: `/admin/mcp-playground?agentId=demo&mode=dry-run&tool=lucy_query&args=${args}` });

    expect(await screen.findByTestId("mcp-playground-task-table")).toBeChecked();
    await waitFor(() => expect(screen.getByTestId("mcp-playground-connection")).toHaveValue("mysql-aliyun"));
    expect(screen.getByTestId("mcp-playground-source")).toHaveValue("ai_intl_ad_daily");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("opens the connect check from a live-smoke link", async () => {
    renderPage({
      entry: "/admin/mcp-playground?agentId=demo&mode=live-smoke",
      executionStatus: "ok"
    });
    expect(await screen.findByTestId("mcp-playground-task-connect")).toBeChecked();
    expect(screen.getByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-connection")).not.toBeInTheDocument();
  });
});
