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

type CanaryFixture = {
  status: "pass" | "fail" | "blocked";
  checks: Array<{ name: string; status: "pass" | "fail" | "blocked"; detail: string }>;
  decisionReason: string;
};

type ExecutionFixture = {
  status: ExecutionStatus;
  connectionIds?: string[];
  missingConnections?: string[];
  unknownConnections?: string[];
  loadedConnectionIds?: string[];
  lastError?: string;
};

const defaultCanary: CanaryFixture = {
  status: "blocked",
  checks: [{ name: "execution_query", status: "blocked", detail: "当前配置摘要尚无成功查询证据" }],
  decisionReason: "execution_canary_blocked"
};

function renderPage(options: {
  entry?: string;
  executionStatus?: ExecutionStatus;
  executionStatusAfterCanary?: ExecutionStatus;
  execution?: ExecutionFixture;
  executionAfterCanary?: ExecutionFixture;
  lastError?: string;
  policyHealthy?: boolean;
  permissions?: PermissionsFixture;
  canary?: CanaryFixture;
  previewAllowed?: boolean;
  live?: { httpStatus: number; decisionReason: string; decisionReasonLabel: string };
} = {}) {
  let executionStatus = options.executionStatus ?? "stale";
  let executionFixture = options.execution;
  const policyHealthy = options.policyHealthy ?? true;
  const permissions = options.permissions ?? defaultPermissions;
  const canary = options.canary ?? defaultCanary;
  const live = options.live ?? { httpStatus: 200, decisionReason: "allowed", decisionReasonLabel: "允许执行" };
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
        const shaped = executionFixture;
        const connectionIds = shaped?.connectionIds ?? ["mysql-aliyun"];
        return new Response(JSON.stringify({
          ok: true,
          data: {
            endpoint: { upstreamHost: "127.0.0.1", upstreamPort: 7878 },
            config: {
              projectRoot: "/tmp/project-lucy",
              ktxYamlDigest: "a".repeat(64),
              connectionIds,
              updatedAt: "2026-09-08T00:00:00.000Z"
            },
            catalog: {
              connectionIds,
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
            execution: shaped ? {
              status: shaped.status,
              lastCheckedAt: "2026-09-08T00:00:00.000Z",
              ...(shaped.missingConnections ? { missingConnections: shaped.missingConnections } : {}),
              ...(shaped.unknownConnections ? { unknownConnections: shaped.unknownConnections } : {}),
              ...(shaped.loadedConnectionIds ? { loadedConnectionIds: shaped.loadedConnectionIds } : {}),
              ...(shaped.lastError ? { lastError: shaped.lastError } : {})
            } : {
              status: executionStatus,
              lastCheckedAt: "2026-09-08T00:00:00.000Z",
              missingConnections: executionStatus === "ok" ? [] : ["mysql-aliyun"],
              loadedConnectionIds: executionStatus === "ok" ? ["mysql-aliyun"] : [],
              ...(options.lastError && executionStatus !== "ok" ? { lastError: options.lastError } : {})
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/mcp-runtime/canary")) {
        if (options.executionAfterCanary) executionFixture = options.executionAfterCanary;
        if (options.executionStatusAfterCanary) executionStatus = options.executionStatusAfterCanary;
        const requested = init?.body ? JSON.parse(String(init.body)) as { connectionId?: string } : {};
        return new Response(JSON.stringify({
          ok: true,
          data: {
            connectionId: requested.connectionId || "mysql-aliyun",
            status: canary.status,
            checks: canary.checks,
            executionRuntimeAck: canary.status === "pass",
            decisionReason: canary.decisionReason
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/admin/mcp-playground/acl-preview")) {
        return new Response(JSON.stringify({
          ok: true,
          data: options.previewAllowed
            ? {
                allowed: true,
                decisionReason: "allowed",
                decisionReasonLabel: "允许执行",
                roleIds: ["analyst"],
                remediation: {
                  primary: { label: "编辑 Role 表范围", href: "/admin/roles/analyst?tab=permissions" },
                  secondary: []
                },
                effectivePermissions: { tools: ["lucy_query"], connections: ["mysql-aliyun"], tableSample: [], tableSampleTruncated: false }
              }
            : {
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
            httpStatus: live.httpStatus,
            decisionReason: live.decisionReason,
            decisionReasonLabel: live.decisionReasonLabel,
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

    const block = await screen.findByTestId("mcp-playground-execution-block");
    expect(block).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程还没加载 mysql-aliyun");
    expect(screen.getByTestId("mcp-playground-recheck")).toHaveTextContent("检测 mysql-aliyun");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mcp-playground-recheck"));
    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-run-live")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-connect").textContent ?? "").not.toMatch(/这次检测了什么|技术详情|execution_|rel_|ktx\.yaml|还不能确认|还不能判断|还不能检查/);
    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "/api/admin/mcp-runtime/canary",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"connectionId\":\"mysql-aliyun\"")
      })
    ));
    const canaryCall = vi.mocked(globalThis.fetch).mock.calls.find((call) => String(call[0]).includes("mcp-runtime/canary"));
    expect(JSON.parse(String(canaryCall?.[1]?.body))).toMatchObject({
      connectionId: "mysql-aliyun",
      agentId: "demo"
    });

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

    const result = await screen.findByTestId("mcp-playground-preview-result");
    expect(result).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("Demo（demo）不能查 ai_intl_ad_daily");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("表未授权");
    expect(screen.getByText("技术详情").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("decision-reason-code")).toHaveTextContent("table_forbidden:chatbi.ai_intl_ad_daily");
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

  it("shows a failed recheck instead of leaving the connect card unchanged", async () => {
    renderPage({
      executionStatus: "stale",
      canary: {
        status: "fail",
        checks: [{ name: "execution_query", status: "fail", detail: "执行层未加载磁盘中已存在的连接" }],
        decisionReason: "execution_config_stale"
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.click(await screen.findByTestId("mcp-playground-recheck"));

    const block = await screen.findByTestId("mcp-playground-execution-block");
    expect(block).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程还没加载 mysql-aliyun");
    expect(screen.queryByText("这次检测了什么")).not.toBeInTheDocument();
    expect(screen.queryByText("技术详情")).not.toBeInTheDocument();
    expect(screen.queryByTestId("decision-reason-code")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-recheck")).toHaveTextContent("检测 mysql-aliyun");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("reveals the Token field after a recheck and the execution layer become ready", async () => {
    renderPage({
      executionStatus: "stale",
      executionStatusAfterCanary: "ok",
      canary: {
        status: "pass",
        checks: [{ name: "execution_query", status: "pass", detail: "当前配置摘要已有成功只读查询证据" }],
        decisionReason: "allowed"
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.click(await screen.findByTestId("mcp-playground-recheck"));

    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-run-live")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
    expect(screen.queryByText("允许执行")).not.toBeInTheDocument();
    expect(screen.queryByTestId("decision-reason-code")).not.toBeInTheDocument();
  });

  it("shows the token field when a connection has no load record", async () => {
    renderPage({ executionStatus: "unknown" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-run-live")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-connect").textContent ?? "").not.toMatch(/还没有|加载记录|这次检测了什么|技术详情/);
  });

  it("shows the execution error when the query process is down", async () => {
    renderPage({
      executionStatus: "error",
      lastError: "upstream closed",
      execution: {
        status: "error",
        connectionIds: ["demo-mysql"],
        lastError: "upstream closed"
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    const block = await screen.findByTestId("mcp-playground-execution-block");
    expect(block).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程不可用。upstream closed");
    expect(screen.queryByTestId("mcp-playground-recheck")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
    expect(screen.queryByText("这次检测了什么")).not.toBeInTheDocument();
    expect(screen.queryByText("技术详情")).not.toBeInTheDocument();
  });

  it("paints an allow verdict without repeating the audit label or a fix link", async () => {
    renderPage({ previewAllowed: true });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));
    fireEvent.change(await screen.findByTestId("mcp-playground-connection"), { target: { value: "mysql-aliyun" } });
    fireEvent.change(await screen.findByTestId("mcp-playground-source"), { target: { value: "ai_intl_ad_daily" } });
    fireEvent.click(screen.getByTestId("mcp-playground-run-table"));

    const result = await screen.findByTestId("mcp-playground-preview-result");
    expect(result).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("Demo（demo）可以查 ai_intl_ad_daily");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("连接");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("mysql-aliyun");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("这是权限预览，没有真正查数。");
    expect(screen.queryByText("允许执行")).not.toBeInTheDocument();
    expect(screen.queryByText("allowed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-result-action")).not.toBeInTheDocument();
    expect(screen.queryByText("技术详情")).not.toBeInTheDocument();
  });

  it("reports a live smoke connect result without the audit dual line", async () => {
    renderPage({ executionStatus: "ok" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.change(await screen.findByTestId("mcp-playground-token"), { target: { value: "lucy_test_token" } });
    fireEvent.click(screen.getByTestId("mcp-playground-run-live"));
    fireEvent.click(await screen.findByTestId("mcp-playground-confirm-live"));

    const result = await screen.findByTestId("mcp-playground-live-result");
    expect(result).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("Demo（demo）能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("已向本机");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("拉取工具列表，并写入访问日志。");
    expect(screen.getByTestId("mcp-playground-result-action")).toHaveAttribute("href", "/admin/audit?view=calls&callSource=playground");
    expect(screen.queryByText("允许执行")).not.toBeInTheDocument();
    expect(screen.queryByTestId("decision-reason-code")).not.toBeInTheDocument();
  });

  it("reports a refused live smoke connect with the specific reason", async () => {
    renderPage({
      executionStatus: "ok",
      live: { httpStatus: 401, decisionReason: "token_revoked", decisionReasonLabel: "Token 不可用" }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.change(await screen.findByTestId("mcp-playground-token"), { target: { value: "lucy_test_token" } });
    fireEvent.click(screen.getByTestId("mcp-playground-run-live"));
    fireEvent.click(await screen.findByTestId("mcp-playground-confirm-live"));

    const result = await screen.findByTestId("mcp-playground-live-result");
    expect(result).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("Demo（demo）不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("Token 不可用");
    expect(screen.queryByText("技术详情")).not.toBeInTheDocument();
    expect(screen.queryByTestId("decision-reason-code")).not.toBeInTheDocument();
  });

  it("drops the previous verdict when the task changes", async () => {
    renderPage({ executionStatus: "stale" });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.click(await screen.findByTestId("mcp-playground-recheck"));
    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-playground-task-table"));
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    expect(await screen.findByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程还没加载");
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("keeps an inconclusive load check off the connect card", async () => {
    renderPage({
      execution: {
        status: "unknown",
        connectionIds: ["demo-mysql"],
        unknownConnections: ["demo-mysql"]
      },
      canary: {
        status: "blocked",
        checks: [
          { name: "config", status: "pass", detail: "连接存在于当前 ktx.yaml" },
          { name: "catalog", status: "pass", detail: "最近 Catalog reload：rel_20261019_142826_211" },
          { name: "policy", status: "pass", detail: "Agent 的生效权限包含该连接" },
          { name: "execution_tools_list", status: "pass", detail: "KTX MCP Runtime 可达；此检查不证明连接已加载" },
          { name: "execution_query", status: "blocked", detail: "当前 KTX 版本无连接加载自省，且当前配置摘要尚无成功查询证据" }
        ],
        decisionReason: "execution_canary_blocked"
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    expect(await screen.findByTestId("mcp-playground-token")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-execution-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-recheck")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-playground-connect").textContent ?? "").not.toMatch(/这次检测了什么|技术详情|execution_|rel_|ktx\.yaml|还不能确认|还不能判断|还不能检查|Catalog reload/);
  });

  it("checks a connection that is not loaded before one that has no record", async () => {
    renderPage({
      execution: {
        status: "stale",
        connectionIds: ["demo-mysql", "invest-db", "mysql-aliyun"],
        loadedConnectionIds: ["demo-mysql"],
        missingConnections: ["invest-db"],
        unknownConnections: ["mysql-aliyun"]
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));

    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(await screen.findByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程还没加载 invest-db");
    expect(screen.getByTestId("mcp-playground-result-detail")).not.toHaveTextContent("demo-mysql");
    expect(screen.getByTestId("mcp-playground-result-detail")).not.toHaveTextContent("mysql-aliyun");
    expect(screen.getByTestId("mcp-playground-recheck")).toHaveTextContent("检测 invest-db");
    expect(screen.queryByText("这次检测了什么")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mcp-playground-token")).not.toBeInTheDocument();
  });

  it("names the next unloaded connection after one confirmed load failure is cleared", async () => {
    renderPage({
      execution: {
        status: "stale",
        connectionIds: ["demo-mysql", "invest-db", "mysql-aliyun"],
        loadedConnectionIds: ["demo-mysql"],
        missingConnections: ["invest-db", "mysql-aliyun"]
      },
      executionAfterCanary: {
        status: "stale",
        connectionIds: ["demo-mysql", "invest-db", "mysql-aliyun"],
        loadedConnectionIds: ["demo-mysql", "invest-db"],
        missingConnections: ["mysql-aliyun"]
      },
      canary: {
        status: "pass",
        checks: [{ name: "execution_query", status: "pass", detail: "当前配置摘要已有成功只读查询证据" }],
        decisionReason: "allowed"
      }
    });
    await chooseAgent();
    fireEvent.click(screen.getByTestId("mcp-playground-task-connect"));
    fireEvent.click(await screen.findByTestId("mcp-playground-recheck"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-playground-result-detail")).toHaveTextContent("问数进程还没加载 mysql-aliyun");
    });
    expect(screen.getByTestId("mcp-playground-result-headline")).toHaveTextContent("不能连上");
    expect(screen.getByTestId("mcp-playground-result-detail")).not.toHaveTextContent("demo-mysql");
    expect(screen.getByTestId("mcp-playground-result-detail")).not.toHaveTextContent("invest-db");
    expect(screen.getByTestId("mcp-playground-recheck")).toHaveTextContent("检测 mysql-aliyun");
    expect(screen.queryByText("这次检测了什么")).not.toBeInTheDocument();
    expect(screen.queryByText("技术详情")).not.toBeInTheDocument();
  });
});
