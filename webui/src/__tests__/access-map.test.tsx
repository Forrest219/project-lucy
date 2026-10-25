// @vitest-environment jsdom
/**
 * Lucy v0.25 P1-3 — 访问关系图前端行为测试。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.5  Token 只过滤访问层，UI 必须显式提示
 *   §5.4  折叠只影响渲染，表格视图展示全量
 *   §5.5  降级矩阵
 *   §7.5  关系图 / 数据表 切换
 *   §10   SC-09 / SC-10
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessMap } from "../pages/admin/AccessMap";
import type { AccessMapResponse } from "../components/admin/AccessMapTypes";

function makeNode(
  id: string,
  kind: AccessMapResponse["nodes"][number]["kind"],
  label: string,
  depth: number,
  meta: Record<string, unknown> = {},
  parentId?: string
): AccessMapResponse["nodes"][number] {
  return {
    id,
    kind,
    label,
    depth,
    ...(parentId ? { parentId } : {}),
    meta: {
      grantPaths: 0,
      grantUsers: 0,
      accessPaths: 0,
      accessUsers: 0,
      ...meta
    }
  };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<AccessMapResponse["edges"][number]> = {}
): AccessMapResponse["edges"][number] {
  return {
    id: `e|${source}|${target}`,
    source,
    target,
    grantPaths: 0,
    grantUsers: 0,
    accessPaths: 0,
    accessUsers: 0,
    accessCalls: 0,
    state: "normal",
    confirmedUnauthorized: false,
    reviewEvaluations: [],
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
    ...overrides
  };
}

function makeResponse(overrides: Partial<AccessMapResponse> = {}): AccessMapResponse {
  const nodes = [
    makeNode("agent:agent_a", "agent", "AGENT A", 0, {
      enabled: true,
      roleIds: ["role_reader"],
      tokenCount: 2,
      grantPaths: 2,
      grantUsers: 1
    }),
    makeNode("role:role_reader", "role", "role_reader", 1, { grantPaths: 2, grantUsers: 1 }),
    makeNode("conn:mysql_main", "connection", "mysql_main", 2, { grantPaths: 2, grantUsers: 1 }),
    makeNode("table:mysql_main::finance::orders", "table", "orders", 3, {
      physicalTable: "finance.orders",
      grantPaths: 2,
      grantUsers: 1
    }),
    makeNode(
      "token:agent_a::p0-demo",
      "token",
      "p0-demo",
      -1,
      { label: "p0-demo", status: "active", callCount: 4 },
      "agent:agent_a"
    ),
    makeNode(
      "token:agent_a::p1-other",
      "token",
      "p1-other",
      -1,
      { label: "p1-other", status: "active", callCount: 7 },
      "agent:agent_a"
    )
  ];
  const edges = [
    makeEdge("agent:agent_a", "role:role_reader", { grantPaths: 2, grantUsers: 1 }),
    makeEdge("role:role_reader", "conn:mysql_main", { grantPaths: 2, grantUsers: 1 }),
    makeEdge("conn:mysql_main", "table:mysql_main::finance::orders", {
      grantPaths: 2,
      grantUsers: 1,
      accessPaths: 0,
      state: "dormant"
    })
  ];
  return {
    meta: {
      window: {
        startIso: "2026-10-18T00:00:00.000Z",
        endIso: "2026-10-25T00:00:00.000Z",
        asOf: "2026-10-25T00:00:00.000Z"
      },
      grant: {
        state: "ok",
        problem: null,
        accessConfigVersion: "cfg-1",
        policyVersion: "pol-1",
        sourceMapVersion: "smap-1",
        capabilityDigest: "cap-1",
        failures: []
      },
      access: {
        state: "ok",
        trust: "confirmed",
        deniedCalls: 3,
        rawCalls: 11
      },
      counts: {
        agents: 1,
        roles: 1,
        connections: 1,
        schemas: 0,
        tables: 1,
        tokens: 2,
        edges: 3,
        grantPaths: 2,
        grantUsers: 1,
        accessPaths: 1,
        accessUsers: 1
      },
      signals: {
        dormantEdges: 1,
        needsReviewEdges: 1,
        confirmedUnauthorizedEdges: 1
      },
      snapshotCoverage: { reviewPaths: 1, matched: 0, missingOrInvalid: 1, ratio: 0 },
      orphanGrants: 0,
      folded: { nodes: 0, edges: 0 },
      countingNotes: [],
      ...(overrides.meta ?? {})
    },
    nodes,
    edges,
    render: {
      nodes,
      edges,
      folded: { nodes: 0, edges: 0 }
    },
    ...overrides
  };
}

function renderPage(initialEntry = "/admin/access-map") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/access-map" element={<AccessMap />} />
          <Route path="/admin/config-audit" element={<div data-testid="config-audit-page">config audit</div>} />
          <Route path="/admin/agents" element={<div data-testid="agents-page">agents</div>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
}

function stubAccessMap(response: AccessMapResponse, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(status === 200 ? { ok: true, data: response } : { ok: false, error: { code: "INVALID_ACCESS_MAP_PARAMETER", message: "统计窗口只能是 24h、168h 或 720h" } }), {
      status
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccessMap 页面", () => {
  it("渲染图与信号条，并披露快照覆盖率不解释为低越权率", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const signalBar = screen.getByTestId("access-map-signal-bar");
    expect(within(signalBar).getByTestId("access-map-signal-dormant")).toHaveTextContent("僵尸授权 1 条");
    expect(within(signalBar).getByTestId("access-map-signal-needs-review")).toHaveTextContent("需复核 1 条");
    expect(within(signalBar).getByTestId("access-map-signal-confirmed")).toHaveTextContent("确凿越权 1 条");

    const coverage = screen.getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("需复核记录 1 条");
    expect(coverage).toHaveTextContent("可关联快照 0 条");
    expect(coverage).toHaveTextContent("覆盖率 0%");
    expect(coverage).toHaveTextContent("快照覆盖率低不代表越权率低");
  });

  /**
   * SC-10（webui/docs/187-access-relation-sankey-spec.md §10）：
   * 「需复核档的 UI 文案不含「越权」二字；确凿越权档文案含「调用当时授权亦不覆盖」」。
   *
   * 断言按**档位**逐个取证，不能拿整个信号条来断言 —— 信号条里还有覆盖率提示，
   * 它必须提到「越权率」（SC-13），那是另一句话。
   */
  it("SC-10 — 需复核档文案不含「越权」；确凿越权档单独标注来源为调用当时的授权快照", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    // ① 第一档：按钮与档位说明都不得出现「越权」二字。
    const needsReview = screen.getByTestId("access-map-signal-needs-review");
    expect(needsReview.textContent).not.toContain("越权");
    expect(needsReview).toHaveTextContent("需复核");
    const needsReviewNote = screen.getByTestId("access-map-signal-needs-review-note");
    expect(needsReviewNote.textContent).not.toContain("越权");
    expect(needsReviewNote).toHaveTextContent("当前授权无对应路径");

    // ② 第二档：必须写明判定来源是**调用当时**的授权快照。
    const confirmed = screen.getByTestId("access-map-signal-confirmed");
    expect(confirmed).toHaveTextContent("确凿越权");
    expect(confirmed).toHaveTextContent("确凿越权 1 条");
    const confirmedSource = screen.getByTestId("access-map-signal-confirmed-source");
    expect(confirmedSource).toHaveTextContent("调用当时授权亦不覆盖");
    expect(confirmedSource).toHaveTextContent("调用当时的授权快照");

    // ③ 两档的来源标注必须各自独立：第一档说明里没有「越权」，第二档说明里才有。
    expect(needsReviewNote.textContent).not.toBe(confirmedSource.textContent);
    expect(confirmedSource.textContent).toContain("越权");
  });

  it("点击 Token 只过滤访问层，并显式提示授权层不受影响", async () => {
    const response = makeResponse();
    const fetchMock = stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const firstRequest = String(fetchMock.mock.calls[0][0]);
    expect(firstRequest).not.toContain("token=");

    const credential = screen.getByTestId("access-map-credential-list");
    const tokenButton = within(credential).getByTestId("access-map-token-token:agent_a::p0-demo");
    tokenButton.click();

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("token=p0-demo"))).toBe(true);
    });

    const notice = await screen.findByTestId("access-map-token-filter-notice");
    expect(notice).toHaveTextContent("已按 Token");
    expect(notice).toHaveTextContent("p0-demo");
    expect(notice).toHaveTextContent("过滤访问层，授权层不受影响");
  });

  it("表格视图展示全量边（折叠只影响渲染）", async () => {
    const response = makeResponse();
    response.render = {
      nodes: response.nodes.slice(0, 2),
      edges: response.edges.slice(0, 1),
      folded: { nodes: 3, edges: 2 }
    };
    response.meta.folded = { nodes: 3, edges: 2 };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.getByTestId("access-map-folded-badge")).toHaveTextContent("已折叠 3 个节点");

    screen.getByTestId("access-map-view-table").click();
    await waitFor(() => expect(screen.getByTestId("access-map-table")).toBeInTheDocument());
    const edgeTable = screen.getByTestId("access-map-table-edges");
    expect(within(edgeTable).getAllByRole("row")).toHaveLength(response.edges.length + 1);
    // SC-09：屏幕阅读器要能读出全部节点与边 —— 节点清单也必须在表格视图里。
    const nodeTable = screen.getByTestId("access-map-table-nodes");
    const flowNodeCount = response.nodes.filter((node) => node.kind !== "token").length;
    expect(within(nodeTable).getAllByRole("row")).toHaveLength(flowNodeCount + 1);
  });

  it("授权面不可用：不渲染图，给出三态原因与配置审计入口", async () => {
    const response = makeResponse();
    response.meta.grant.state = "unavailable";
    response.meta.grant.problem = "access_config_path_mismatch";
    response.nodes = [];
    response.edges = [];
    response.render = { nodes: [], edges: [], folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("access-map-grant-unavailable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("access-map-grant-unavailable")).toHaveTextContent(
      "授权配置路径不一致"
    );
    expect(screen.queryByTestId("access-map-canvas")).not.toBeInTheDocument();
    expect(screen.getByText("前往配置审计")).toBeInTheDocument();
  });

  it("访问面不可用：授权骨架照常渲染，并提示审计数据不可用", async () => {
    const response = makeResponse();
    response.meta.access.state = "unavailable";
    response.meta.access.reason = "审计数据不可用";
    stubAccessMap(response);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("access-map-access-unavailable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("access-map-access-unavailable")).toHaveTextContent("审计数据不可用");
    expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument();
  });

  it("URL 参数全部透传到接口（可分享）", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage(
      "/admin/access-map?agent=agent_a&role=role_reader&table=mysql_main%3A%3Afinance%3A%3Aorders&connection=mysql_main&window=24h&layer=schema&trust=include_candidate&view=table"
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("agent=agent_a");
    expect(url).toContain("role=role_reader");
    expect(url).toContain("window=24h");
    expect(url).toContain("layer=schema");
    expect(url).toContain("trust=include_candidate");
    expect(url).toContain("view=table");
    expect(url).toContain("connection=mysql_main");
    expect(url).toContain("table=mysql_main%3A%3Afinance%3A%3Aorders");
  });

  it("非法 URL 参数 → 服务端 400，页面显示错误而不是空图", async () => {
    stubAccessMap(makeResponse(), 400);
    renderPage("/admin/access-map?window=48h");
    await waitFor(() => expect(screen.getByTestId("access-map-error")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-error")).toHaveTextContent("统计窗口只能是 24h、168h 或 720h");
    expect(screen.queryByTestId("access-map-canvas")).not.toBeInTheDocument();
  });

  it("无节点时给出空态与 Agent 凭据入口", async () => {
    const response = makeResponse();
    response.nodes = [];
    response.edges = [];
    response.render = { nodes: [], edges: [], folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-empty")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-empty")).toHaveTextContent("尚无 Agent 授权关系");
    expect(screen.getByText("前往 Agent 凭据")).toBeInTheDocument();
  });
});

/**
 * P1-4：访问面不可用时，信号条**不得用 0 冒充真实计数**（P1-3 §5.5 / SC-07）。
 *
 * 服务端只在 `access.state === "ok"` 分支里赋值 `rawCalls` / `deniedCalls`，
 * 不可用时它们停在 0。
 */
describe("访问面不可用时的信号条口径（P1-4）", () => {
  it("不显示「0 次」，改写「暂不可用」", async () => {
    const response = makeResponse();
    response.meta.access.state = "unavailable";
    response.meta.access.reason = "审计数据不可用";
    stubAccessMap(response);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("access-map-signal-bar")).toBeInTheDocument());
    const calls = screen.getByTestId("access-map-signal-calls");
    expect(calls).not.toHaveTextContent("0 次");
    expect(calls).toHaveTextContent("原始调用数暂不可用");
    expect(calls).toHaveTextContent("被拒绝的访问尝试暂不可用");
  });

  it("访问面可用时照常显示真实计数", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-signal-bar")).toBeInTheDocument());
    const calls = screen.getByTestId("access-map-signal-calls");
    expect(calls).toHaveTextContent("原始调用数 11 次");
    expect(calls).toHaveTextContent("被拒绝的访问尝试 3 次");
  });
});

/**
 * P2-10：边明细面板要有键盘可达入口（SC-09）。
 *
 * SVG `<path onClick>` 只能靠鼠标触发；徽标列表里的按钮是等价的键盘入口。
 */
describe("边明细的键盘可达入口（P2-10）", () => {
  it("非 normal 边有可聚焦按钮，点击打开同一个明细面板", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const edgeId = "e|conn:mysql_main|table:mysql_main::finance::orders";
    const button = screen.getByTestId(`access-map-edge-badge-button-${edgeId}`);
    // 键盘可达 = 真按钮 + 未禁用。
    expect(button.tagName).toBe("BUTTON");
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-expanded", "false");

    expect(screen.queryByTestId("access-map-edge-detail")).not.toBeInTheDocument();
    button.click();
    await waitFor(() => expect(screen.getByTestId("access-map-edge-detail")).toBeInTheDocument());
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("access-map-edge-detail")).toHaveTextContent("mysql_main");
  });
});
