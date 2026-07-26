// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../app/App";

function StubPage({ name }: { name: string }) {
  return <div data-testid="route-page">{name}</div>;
}

vi.mock("../pages/Catalog", () => ({ Catalog: () => <StubPage name="Catalog" /> }));
vi.mock("../pages/JoinEditor", () => ({ JoinEditor: () => <StubPage name="JoinEditor" /> }));
vi.mock("../pages/Onboarding", () => ({ Onboarding: () => <StubPage name="Onboarding" /> }));
vi.mock("../pages/Review", () => ({ Review: () => <StubPage name="Review" /> }));
vi.mock("../pages/TableEditor", () => ({ TableEditor: () => <StubPage name="TableEditor" /> }));
vi.mock("../pages/WikiEditor", () => ({ WikiEditor: () => <StubPage name="WikiEditor" /> }));
vi.mock("../pages/admin/AgentList", () => ({ AgentList: () => <StubPage name="AgentList" /> }));
vi.mock("../pages/admin/AgentDetail", () => ({ AgentDetail: () => <StubPage name="AgentDetail" /> }));
vi.mock("../pages/admin/NewToken", () => ({ NewToken: () => <StubPage name="NewToken" /> }));
vi.mock("../pages/admin/Audit", () => ({ Audit: () => <StubPage name="Audit" /> }));
vi.mock("../pages/eval/CaseList", () => ({ CaseList: () => <StubPage name="CaseList" /> }));
vi.mock("../pages/eval/CaseEditor", () => ({ CaseEditor: () => <StubPage name="CaseEditor" /> }));
vi.mock("../pages/eval/RunList", () => ({ RunList: () => <StubPage name="RunList" /> }));
vi.mock("../pages/eval/RunDetail", () => ({ RunDetail: () => <StubPage name="RunDetail" /> }));
vi.mock("../pages/eval/Monitor", () => ({ Monitor: () => <StubPage name="Monitor" /> }));
vi.mock("../pages/connections/ConnectionOverview", () => ({ ConnectionOverview: () => <StubPage name="ConnectionOverview" /> }));
vi.mock("../pages/connections/TableWhitelist", () => ({ TableWhitelist: () => <StubPage name="TableWhitelist" /> }));
vi.mock("../pages/connections/ConnectionTest", () => ({ ConnectionTest: () => <StubPage name="ConnectionTest" /> }));

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { root: "/tmp/project-lucy", connections: [{ name: "mysql-aliyun" }], ktxAvailable: true }
        })
      );
    }
    if (url === "/api/connections") {
      return new Response(JSON.stringify({ ok: true, data: { connections: [] } }));
    }
    if (url.startsWith("/api/sources/mysql-aliyun/dataforai/superstore_orders")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            model: {
              conn: "mysql-aliyun",
              schema: "dataforai",
              table: "superstore_orders",
              filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
              descriptions: {},
              columns: []
            },
            rawYaml: "",
            completion: "done"
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal(
    "fetch",
    fetchMock
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppFrame />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppFrame shell", () => {
  it.each([
    ["/onboarding", "Onboarding", "上线检查"],
    ["/connections", "ConnectionOverview", "连接概览"],
    ["/connections/whitelist", "TableWhitelist", "表白名单"],
    ["/connections/test", "ConnectionTest", "连通测试"],
    ["/", "Catalog", "表目录"],
    ["/wiki", "WikiEditor", "Wiki 文档"],
    ["/review", "Review", "变更审阅"],
    ["/eval/cases", "CaseList", "Case 管理"],
    ["/eval/runs", "RunList", "运行历史"],
    ["/eval/monitor", "Monitor", "趋势监控"],
    ["/admin/agents", "AgentList", "Agent 实例"],
    ["/admin/audit", "Audit", "访问日志"]
  ])("renders route %s and marks active navigation", (path, pageName, activeLink) => {
    renderAt(path);
    expect(screen.getByTestId("route-page")).toHaveTextContent(pageName);
    expect(screen.getByRole("link", { name: activeLink })).toHaveAttribute("aria-current", "page");
  });

  it("marks source and join pages as table catalog navigation", () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "表目录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");
  });

  it("shows source context in the topbar", async () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders");
    expect(await screen.findByText("mysql-aliyun")).toBeInTheDocument();
    expect(screen.getAllByText("dataforai").length).toBeGreaterThan(0);
    expect(await screen.findByText("完成度 done")).toBeInTheDocument();
  });

  it("derives connection topbar facts from project data only", async () => {
    const { fetchMock } = renderAt("/connections");
    expect(await screen.findByText("/tmp/project-lucy")).toBeInTheDocument();
    expect(screen.getByText("1 个连接")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/project");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/connections");
  });

  it("marks admin agent context pages as agent navigation", () => {
    renderAt("/admin/agents/zhangsan/tokens/new");
    expect(screen.getByRole("link", { name: "Agent 实例" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("NewToken");
  });
});
