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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** 图面列标题（SVG 内的中文层名）。 */
function columnLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-column-label]")].map(
    (element) => element.getAttribute("data-column-label") ?? ""
  );
}

/** 最近一次接口请求的 URL —— URL 参数是否落到接口上的唯一事实源。 */
function lastRequestUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const calls = fetchMock.mock.calls.map((call) => String(call[0]));
  return calls[calls.length - 1] ?? "";
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
  it("渲染关系图；信号不再占首屏大卡，覆盖率口径仍在弱入口里披露", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    // 图优先（chart-first D2）：默认首屏不再有信号卡。
    expect(screen.queryByTestId("access-map-signal-bar")).not.toBeInTheDocument();

    // 覆盖率披露没有消失，只是沉到弱入口。
    const coverage = screen.getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("需复核记录 1 条");
    expect(coverage).toHaveTextContent("可关联快照 0 条");
    expect(coverage).toHaveTextContent("覆盖率 0%");
    expect(coverage).toHaveTextContent("快照覆盖率低不代表越权率低");
  });

  /**
   * 两档措辞（webui/docs/187-access-relation-sankey-spec.md §10）：
   * 「需复核档的 UI 文案不含「越权」二字；确凿越权档文案含「调用当时授权亦不覆盖」」。
   *
   * 断言按**档位**逐个取证，不能拿整个弱入口来断言 —— 弱入口里还有覆盖率提示，
   * 它必须提到「越权率」（SC-13），那是另一句话。
   *
   * chart-first 之后这两段档位说明仍在 DOM 里，只是搬进了图下弱入口。
   */
  it("两档措辞：需复核档不含「越权」；确凿越权档单独标注来源为调用当时的授权快照", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    // ① 第一档：档位说明不得出现「越权」二字。
    const needsReviewNote = screen.getByTestId("access-map-signal-needs-review-note");
    expect(needsReviewNote.textContent).not.toContain("越权");
    expect(needsReviewNote).toHaveTextContent("需复核");
    expect(needsReviewNote).toHaveTextContent("当前授权无对应路径");

    // ② 第二档：必须写明判定来源是**调用当时**的授权快照。
    const confirmedSource = screen.getByTestId("access-map-signal-confirmed-source");
    expect(confirmedSource).toHaveTextContent("确凿越权");
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
 * P1-4：访问面不可用时，口径说明**不得用 0 冒充真实计数**（P1-3 §5.5 / SC-07）。
 *
 * 服务端只在 `access.state === "ok"` 分支里赋值 `rawCalls` / `deniedCalls`，
 * 不可用时它们停在 0。
 */
describe("访问面不可用时的口径说明（P1-4）", () => {
  it("不显示「0 次」，改写「暂不可用」", async () => {
    const response = makeResponse();
    response.meta.access.state = "unavailable";
    response.meta.access.reason = "审计数据不可用";
    stubAccessMap(response);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("access-map-signal-calls")).toBeInTheDocument());
    const calls = screen.getByTestId("access-map-signal-calls");
    expect(calls).not.toHaveTextContent("0 次");
    expect(calls).toHaveTextContent("原始调用数暂不可用");
    expect(calls).toHaveTextContent("被拒绝的访问尝试暂不可用");
  });

  it("访问面可用时照常显示真实计数", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-signal-calls")).toBeInTheDocument());
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

/**
 * 呈现修订 Spec 的验收断言。
 *
 * Authority: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` §7
 *
 * SC-01–SC-13 在这里落断言；SC-14（既有 test id 仍可找到）、SC-15（无裸十六进制）
 * 与几何自检（SC-07 的前半段）另有落点，见 `access-map-layout.test.tsx`。
 * SC-16 是命令级门禁（`npm run lint:terminology`），不在单测里冒充。
 */
describe("访问关系图阅读降噪（呈现修订 Spec §7）", () => {
  // quiet-reading SC-01（三张指标卡可见）与 SC-02（ⓘ 口径说明）已被 chart-first
  // SC-01 取代：三张指标卡与它们的 ⓘ 按钮从默认页壳移除（chart-first §5.2 / §5.8）。
  // 新断言见文件末尾「访问关系图图优先呈现（chart-first Spec §7）」。

  it("SC-03 — 视图与统计窗口的选中态都不使用 pl-btn--primary", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-view-map")).toBeInTheDocument());

    const viewMap = screen.getByTestId("access-map-view-map");
    const viewTable = screen.getByTestId("access-map-view-table");
    expect(viewMap.className).toContain("pl-admin-tab--active");
    expect(viewMap.className).not.toContain("pl-btn--primary");
    expect(viewTable.className).not.toContain("pl-btn--primary");

    const windowControl = screen.getByTestId("access-map-window");
    expect(windowControl.className).toContain("pl-segmented-control");
    for (const item of windowControl.querySelectorAll("button")) {
      expect(item.className).not.toContain("pl-btn--primary");
    }
    expect(windowControl.querySelector(".pl-segmented-control-item--active")).not.toBeNull();
  });

  it("SC-04 — 统计窗口可见文案是「近 N 天/小时」，写进 URL 的仍是 24h/168h/720h", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-window")).toBeInTheDocument());

    const windowControl = screen.getByTestId("access-map-window");
    const labels = [...windowControl.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["近 24 小时", "近 7 天", "近 30 天"]);

    const sevenDay = windowControl.querySelectorAll("button")[1];
    sevenDay.click();
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("window=168h"));
    expect(lastRequestUrl(fetchMock)).not.toContain("window=近");
  });

  it("SC-05 — 页头不出现哈希；弱入口里的快照哈希文本与现网一致", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-snapshot-id")).toBeInTheDocument());

    // 哈希不在页头：页头区域里不出现 config / policy 哈希。
    const header = screen.getByTestId("page-header");
    expect(header.textContent).not.toContain("cfg-1");
    expect(header.textContent).not.toContain("pol-1");
    expect(container.querySelector("header")).not.toBeNull();

    const snapshot = screen.getByTestId("access-map-snapshot-id");
    expect(snapshot).toHaveTextContent("config cfg-1 · policy pol-1");
  });

  it("SC-06 — 列标题按层出现；layer=schema 时多出 Schema 列", async () => {
    const flat = makeResponse();
    stubAccessMap(flat);
    const { container: flatContainer } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());
    expect(columnLabels(flatContainer)).toEqual(["Agent", "角色", "连接", "表"]);

    cleanup();
    const schema = makeResponse();
    schema.nodes.push(
      makeNode("schema:mysql_main::finance", "schema", "finance", 3, { grantPaths: 2, grantUsers: 1 })
    );
    schema.nodes = schema.nodes.map((node) =>
      node.kind === "table" ? { ...node, depth: 4 } : node
    );
    schema.edges.push(
      makeEdge("schema:mysql_main::finance", "table:mysql_main::finance::orders", {
        grantPaths: 2,
        grantUsers: 1,
        accessPaths: 0,
        state: "dormant"
      })
    );
    schema.render = { nodes: schema.nodes, edges: schema.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(schema);
    const { container: schemaContainer } = renderPage("/admin/access-map?layer=schema");
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());
    expect(columnLabels(schemaContainer)).toEqual(["Agent", "角色", "连接", "Schema", "表"]);
  });

  it("SC-07 — 超长名称在卡片内省略，title 给出全名", async () => {
    const longLabel = "table_with_an_extremely_long_name_that_cannot_fit_in_the_card";
    const response = makeResponse();
    response.nodes = response.nodes.map((node) =>
      node.kind === "table" ? { ...node, label: longLabel } : node
    );
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());

    const group = screen.getByTestId("access-map-node-table:mysql_main::finance::orders");
    const title = group.querySelector("title");
    expect(title?.textContent).toContain(longLabel);
    const texts = [...group.querySelectorAll("text")].map((text) => text.textContent ?? "");
    expect(texts.some((text) => text.endsWith("…"))).toBe(true);
    expect(texts).not.toContain(longLabel);
  });

  it("SC-08 — 僵尸授权流带不含 warning；需复核为 warning 虚线；确凿越权内核为 danger 实线", async () => {
    const response = makeResponse();
    response.edges = [
      makeEdge("agent:agent_a", "role:role_reader", { grantPaths: 2, grantUsers: 1 }),
      makeEdge("role:role_reader", "conn:mysql_main", {
        grantPaths: 0,
        accessPaths: 1,
        accessUsers: 1,
        accessCalls: 3,
        state: "needs_review"
      }),
      makeEdge("conn:mysql_main", "table:mysql_main::finance::orders", {
        grantPaths: 1,
        grantUsers: 1,
        accessPaths: 2,
        accessUsers: 1,
        accessCalls: 5,
        state: "overflow",
        confirmedUnauthorized: true
      })
    ];
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());

    const ribbonOf = (edgeId: string): SVGElement => {
      const group = screen.getByTestId(`access-map-link-${edgeId}`);
      return group.querySelector("path:not([data-testid])") as SVGElement;
    };

    // 僵尸授权（dormant）与正常授权同色：流带本体不含 warning。
    const dormant = ribbonOf("e|agent:agent_a|role:role_reader");
    expect(dormant.getAttribute("class")).toContain("stroke-brand");
    expect(dormant.getAttribute("class")).not.toContain("warning");
    expect(dormant.getAttribute("stroke-dasharray")).toBeNull();

    // 需复核：warning 虚线。
    const needsReview = ribbonOf("e|role:role_reader|conn:mysql_main");
    expect(needsReview.getAttribute("class")).toContain("stroke-warning-strong");
    expect(needsReview.getAttribute("stroke-dasharray")).toBeTruthy();

    // 确凿越权：danger 实线（内核与流带都是）。
    const overflow = ribbonOf("e|conn:mysql_main|table:mysql_main::finance::orders");
    expect(overflow.getAttribute("class")).toContain("stroke-danger-strong");
    expect(overflow.getAttribute("stroke-dasharray")).toBeNull();
    const kernel = screen.getByTestId(
      "access-map-kernel-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    expect(kernel.getAttribute("class")).toContain("stroke-danger-strong");
    expect(kernel.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("SC-09 — 图下清单视觉隐藏、不占布局高度，但按钮仍可聚焦，test id 仍在", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-node-list")).toBeInTheDocument());

    const nodeList = screen.getByTestId("access-map-node-list");
    const edgeBadges = screen.getByTestId("access-map-edge-badges");
    for (const list of [nodeList, edgeBadges]) {
      expect(list.className).toContain("sr-only");
      expect(list.className).not.toContain("hidden");
      expect(list.getAttribute("aria-hidden")).toBeNull();
      expect(list.getAttribute("style") ?? "").not.toContain("display: none");
    }

    const nodeButton = screen.getByTestId("access-map-node-button-agent:agent_a");
    expect(nodeButton).toBeEnabled();
    nodeButton.focus();
    expect(document.activeElement).toBe(nodeButton);

    const edgeButton = screen.getByTestId(
      "access-map-edge-badge-button-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    expect(edgeButton).toBeEnabled();
    edgeButton.focus();
    expect(document.activeElement).toBe(edgeButton);
  });

  it("SC-10 — 边明细在右侧抽屉里，不在图下方的文档流里", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const button = screen.getByTestId(
      "access-map-edge-badge-button-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    button.click();
    await waitFor(() => expect(screen.getByTestId("access-map-edge-detail")).toBeInTheDocument());

    const drawer = screen.getByTestId("access-map-edge-drawer");
    const detail = screen.getByTestId("access-map-edge-detail");
    expect(drawer.contains(detail)).toBe(true);
    // 明细不再落在画布下方的文档流里。
    expect(screen.getByTestId("access-map-canvas").contains(detail)).toBe(false);
  });

  it("SC-11 — focus 存在时可见「全图 / {节点名}」；回到全图后 URL 不再带 focus", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage("/admin/access-map?focus=table%3Amysql_main%3A%3Afinance%3A%3Aorders");
    // 等数据到位：面包屑上的节点名来自响应里的节点清单。
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-back-to-full")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "聚焦位置" });
    expect(nav).toHaveTextContent("全图 / orders");
    expect(lastRequestUrl(fetchMock)).toContain("focus=");

    screen.getByTestId("access-map-back-to-full").click();
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("focus="));
  });

  it("SC-12 — 数据表类型列是中文层名，两张表都有可见标题", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-view-table")).toBeInTheDocument());

    screen.getByTestId("access-map-view-table").click();
    await waitFor(() => expect(screen.getByTestId("access-map-table")).toBeInTheDocument());

    const nodeSection = screen.getByTestId("access-map-table-nodes");
    expect(within(nodeSection).getByRole("heading", { name: "节点" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关系" })).toBeInTheDocument();

    const kinds = [...nodeSection.querySelectorAll("tbody tr td:nth-child(2)")].map(
      (cell) => cell.textContent
    );
    expect(kinds).toEqual(["Agent", "角色", "连接", "表"]);
  });

  it("SC-13 — 凭证区是表；Token 提示句逐字固定；再次点击清除过滤", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-credential-list")).toBeInTheDocument());

    const credential = screen.getByTestId("access-map-credential-list");
    expect(credential.querySelector("table")).not.toBeNull();
    expect(within(credential).getByRole("columnheader", { name: "窗口内调用" })).toBeInTheDocument();
    expect(within(credential).getByRole("columnheader", { name: "Agent" })).toBeInTheDocument();
    // 表头 + 该 Agent 的 2 个 Token。
    expect(within(credential).getAllByRole("row")).toHaveLength(3);
    // Agent 分组在 DOM 里保留（每个 Agent 一个 tbody）。
    expect(credential.querySelectorAll("tbody")).toHaveLength(1);

    const tokenButton = within(credential).getByTestId("access-map-token-token:agent_a::p0-demo");
    tokenButton.click();

    const notice = await screen.findByTestId("access-map-token-filter-notice");
    expect(notice.textContent).toBe("已按 Token p0-demo 过滤访问层，授权层不受影响。");
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("token=p0-demo"));

    within(screen.getByTestId("access-map-credential-list"))
      .getByTestId("access-map-token-token:agent_a::p0-demo")
      .click();
    await waitFor(() =>
      expect(screen.queryByTestId("access-map-token-filter-notice")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("token="));
  });

  it("SC-14 — 既有 access-map test id 仍然可找到", async () => {
    const response = makeResponse();
    response.meta.orphanGrants = 3;
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const alwaysPresent = [
      "access-map-canvas",
      "access-map-svg",
      "access-map-node-list",
      "access-map-edge-badges",
      "access-map-legend",
      "access-map-legend-trust",
      "access-map-legend-window",
      "access-map-snapshot-coverage",
      "access-map-signal-calls",
      "access-map-signal-needs-review-note",
      "access-map-signal-confirmed-source",
      "access-map-orphan-grants",
      "access-map-snapshot-id",
      "access-map-credential-list",
      "access-map-view-map",
      "access-map-view-table",
      "access-map-window",
      "access-map-layer",
      "access-map-trust",
      "access-map-search",
      "access-map-search-submit"
    ];
    for (const id of alwaysPresent) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

/**
 * 呈现修订 §5.5 的 Esc 分段语义。
 *
 * Esc：抽屉开着 → 只关抽屉；抽屉关着且有聚焦 → 清聚焦。
 * 任何时候都不因为 Esc 改动信号筛选。
 */
describe("Esc 的两段语义（呈现修订 §5.5）", () => {
  it("抽屉开着时 Esc 只关抽屉；抽屉关着后 Esc 才清聚焦", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage("/admin/access-map?focus=agent%3Aagent_a");
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const badge = screen.getByTestId(
      "access-map-edge-badge-button-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    badge.click();
    await waitFor(() => expect(screen.getByTestId("access-map-edge-drawer")).toBeInTheDocument());

    // ① 抽屉开着：Esc 关抽屉，focus 与筛选都不动。
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("access-map-edge-drawer")).not.toBeInTheDocument()
    );
    expect(lastRequestUrl(fetchMock)).toContain("focus=agent%3Aagent_a");

    // ② 抽屉关着：Esc 清聚焦。
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("focus="));
  });
});

/**
 * 呈现修订 §5.1 的阅读顺序。
 *
 * 首屏阅读顺序固定为：页头 → 工具条 → 三张指标卡 → 折叠区 → 主工作区 → 凭证清单。
 * 这条顺序是本次修订的主要目的，所以单独断言一次，而不是靠「元素都在」顺带覆盖。
 */
describe("页面阅读顺序（呈现修订 §5.1）", () => {
  it("页头 → 工具条 → 视图切换 → 图例短行 → 图区 → 弱入口 → 凭证清单", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const root = container.firstElementChild as HTMLElement;
    const children = [...root.children] as HTMLElement[];
    // 注意：test id 可能就落在这一层元素自己身上，所以要 `getAttribute` + `querySelector` 两条都查。
    const has = (element: HTMLElement, testId: string): boolean =>
      element.getAttribute("data-testid") === testId ||
      element.querySelector(`[data-testid="${testId}"]`) !== null;
    const indexOf = (predicate: (element: HTMLElement) => boolean): number =>
      children.findIndex(predicate);

    const header = indexOf((element) => element.tagName === "HEADER");
    const tabbar = indexOf((element) => has(element, "access-map-view-map"));
    const legend = indexOf((element) => has(element, "access-map-legend"));
    const workspace = indexOf((element) => has(element, "access-map-canvas"));
    const weakEntry = indexOf((element) => has(element, "access-map-methodology-snapshot"));
    const credentials = indexOf((element) => has(element, "access-map-credential-list"));

    expect(header).toBe(0);
    expect(tabbar).toBeGreaterThan(header);
    // 图例短行贴在图正上方。
    expect(legend).toBeGreaterThan(tabbar);
    expect(legend).toBeLessThan(workspace);
    // 弱入口在图下方。
    expect(weakEntry).toBeGreaterThan(workspace);
    expect(credentials).toBeGreaterThan(weakEntry);
  });
});

/**
 * 访问关系图图优先呈现（chart-first）。
 *
 * Authority: `docs/specs/lucy-20261101-access-map-chart-first-spec.md` §7
 *   SC-01  默认首屏没有三张信号 Metric Card
 *   SC-02  两个独立宽条消失，只剩一个「口径与快照」弱入口（默认关）
 *   SC-03  图例短行在图正上方，只有四项线型释义，不含窗口 ISO
 *   SC-04  弱入口里能找到口径全文、覆盖率、快照 id
 *   SC-05  partial 降级保留事实与「前往配置审计」
 *   SC-06  关系图／数据表与统计窗口的选中态都不用 pl-btn--primary
 *   SC-07  列间距常量加大；主图容器有 min-height 策略
 *   SC-08  悬停节点／边有可读浮层（不只靠 SVG <title>）
 *   SC-09  着色回归（僵尸授权中性 / 需复核 warning 虚线 / 确凿越权 danger 实线）
 *   SC-10  点击边仍开既有抽屉
 *   SC-11  Token 过滤提示句保持原文
 *   SC-12  既有关键 test id 仍可找到；页面不出现「桑基图」
 *   SC-13  无裸十六进制颜色（落在 `access-map-layout.test.tsx`）
 *   SC-14  `npm run lint:terminology`（命令级门禁，不在单测里冒充）
 */
describe("访问关系图图优先呈现（chart-first Spec §7）", () => {
  it("SC-01 — 默认首屏没有三张信号 Metric Card", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-signal-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-dormant")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-needs-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-confirmed")).not.toBeInTheDocument();
    expect(container.querySelector(".pl-metric-grid--three")).toBeNull();
    expect(container.querySelector(".pl-metric-card")).toBeNull();
  });

  it("SC-02 — 两个独立宽条消失，只剩一个「口径与快照」弱入口（默认关）", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(container.querySelector("#access-map-methodology")).toBeNull();
    expect(container.querySelector("#access-map-snapshot")).toBeNull();

    const weak = screen.getByTestId("access-map-methodology-snapshot");
    expect(weak.tagName).toBe("DETAILS");
    expect(weak).not.toHaveAttribute("open");
    expect(within(weak).getByText("口径与快照")).toBeInTheDocument();
  });

  it("SC-03 — 图例短行在图正上方，只有四项线型释义，不含窗口 ISO", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const legend = screen.getByTestId("access-map-legend");
    const canvas = screen.getByTestId("access-map-canvas");

    // 文档序：图例在图区之前。
    expect(legend.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 短行只有四项。
    expect(legend.children).toHaveLength(4);
    const text = legend.textContent ?? "";
    expect(text).toContain("流带宽度");
    expect(text).toContain("深色内核");
    expect(text).toContain("虚线 = 需复核");
    expect(text).toContain("实线 = 确凿越权");

    // 短行里不放窗口 ISO 起止，也不再放访问口径 —— 那两样在弱入口里。
    expect(text).not.toContain("2026-10-18T00:00:00.000Z");
    expect(text).not.toContain("统计窗口");
    expect(text).not.toContain("访问口径");

    // 「需复核」那一项不得出现「越权」。
    const needsReviewItem = [...legend.children].find((child) =>
      child.textContent?.includes("需复核")
    );
    expect(needsReviewItem).toBeDefined();
    expect(needsReviewItem?.textContent).not.toContain("越权");
  });

  it("SC-04 — 弱入口里能找到口径全文、覆盖率、调用数与快照 id", async () => {
    const response = makeResponse();
    response.meta.orphanGrants = 3;
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const weak = screen.getByTestId("access-map-methodology-snapshot");
    for (const id of [
      "access-map-snapshot-id",
      "access-map-snapshot-coverage",
      "access-map-signal-needs-review-note",
      "access-map-signal-confirmed-source",
      "access-map-signal-calls",
      "access-map-orphan-grants",
      "access-map-legend-trust",
      "access-map-legend-window"
    ]) {
      expect(within(weak).getByTestId(id)).toBeInTheDocument();
    }

    // 需复核档的说明不含「越权」；覆盖率提醒仍保留。
    const note = within(weak).getByTestId("access-map-signal-needs-review-note");
    expect(note.textContent).not.toContain("越权");
    const coverage = within(weak).getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("快照覆盖率低不代表越权率低");
    // 快照 id 文案逐字固定。
    expect(within(weak).getByTestId("access-map-snapshot-id")).toHaveTextContent(
      "config cfg-1 · policy pol-1"
    );
  });

  it("SC-05 — partial 降级保留事实与「前往配置审计」", async () => {
    const response = makeResponse();
    response.meta.grant.state = "partial";
    response.meta.grant.failures = [{ subjectId: "agent_x", reason: "access_config_missing" }];
    stubAccessMap(response);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("access-map-partial-notice")).toBeInTheDocument()
    );

    const notice = screen.getByTestId("access-map-partial-notice");
    expect(notice).toHaveTextContent("1 个 Agent 授权未能解析，结果不完整。");
    expect(notice).toHaveTextContent("前往配置审计");
    // 降级用轻量 notice，不做成与指标卡同级的大卡。
    expect(notice.className).toContain("pl-notice");
    expect(notice.className).not.toContain("pl-metric-card");
  });

  it("SC-06 — 关系图／数据表与统计窗口的选中态都不用 pl-btn--primary", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-view-map")).toBeInTheDocument());

    const viewMap = screen.getByTestId("access-map-view-map");
    const viewTable = screen.getByTestId("access-map-view-table");
    expect(viewMap.className).toContain("pl-admin-tab--active");
    expect(viewMap.className).not.toContain("pl-btn--primary");
    expect(viewTable.className).not.toContain("pl-btn--primary");

    const windowControl = screen.getByTestId("access-map-window");
    for (const item of windowControl.querySelectorAll("button")) {
      expect(item.className).not.toContain("pl-btn--primary");
    }
    expect(windowControl.querySelector(".pl-segmented-control-item--active")).not.toBeNull();
  });

  it("SC-07 — 主图容器有 min-height 策略", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const canvas = screen.getByTestId("access-map-canvas");
    expect(canvas.style.minHeight).toBeTruthy();
    expect(canvas.style.minHeight).toMatch(/vh|px/);
  });

  it("SC-08 — 悬停节点出现可读浮层（不是只靠 SVG <title>）", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-hover-tip")).not.toBeInTheDocument();

    const group = screen.getByTestId("access-map-node-agent:agent_a");
    const rect = group.querySelector("rect") as SVGElement;
    fireEvent.mouseOver(rect);

    const tip = await screen.findByTestId("access-map-hover-tip");
    // 名称（全名）、副标题计数要点、类型中文名。
    expect(tip).toHaveTextContent("AGENT A");
    expect(tip).toHaveTextContent("个 Agent");
    expect(tip).toHaveTextContent("类型");
    // 浮层是 HTML 浮层，不是 SVG <title>。
    expect(tip.tagName).not.toBe("title");
    expect(tip.closest("svg")).toBeNull();

    fireEvent.mouseOut(rect);
    await waitFor(() =>
      expect(screen.queryByTestId("access-map-hover-tip")).not.toBeInTheDocument()
    );
  });

  it("SC-08 — 悬停边出现可读浮层，含从→到与状态文案", async () => {
    const response = makeResponse();
    response.edges = [
      makeEdge("agent:agent_a", "role:role_reader", { grantPaths: 2, grantUsers: 1 }),
      makeEdge("role:role_reader", "conn:mysql_main", {
        grantPaths: 0,
        accessPaths: 1,
        accessUsers: 1,
        accessCalls: 3,
        state: "needs_review"
      }),
      makeEdge("conn:mysql_main", "table:mysql_main::finance::orders", {
        grantPaths: 2,
        grantUsers: 1,
        accessPaths: 0,
        state: "dormant"
      })
    ];
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const kernel = screen.getByTestId("access-map-kernel-e|role:role_reader|conn:mysql_main");
    fireEvent.mouseOver(kernel);

    const tip = await screen.findByTestId("access-map-hover-tip");
    expect(tip).toHaveTextContent("→");
    expect(tip).toHaveTextContent("role_reader");
    expect(tip).toHaveTextContent("mysql_main");
    expect(tip).toHaveTextContent("访问路径 1 条");
    expect(tip).toHaveTextContent("需复核");
    expect(tip.closest("svg")).toBeNull();
  });

  it("SC-10 — 点击边仍开既有抽屉", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const button = screen.getByTestId(
      "access-map-edge-badge-button-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    button.click();
    await waitFor(() => expect(screen.getByTestId("access-map-edge-detail")).toBeInTheDocument());

    const drawer = screen.getByTestId("access-map-edge-drawer");
    expect(drawer.contains(screen.getByTestId("access-map-edge-detail"))).toBe(true);
  });

  it("SC-11 — Token 过滤提示句逐字不变", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("access-map-credential-list")).toBeInTheDocument()
    );

    const credential = screen.getByTestId("access-map-credential-list");
    within(credential).getByTestId("access-map-token-token:agent_a::p0-demo").click();

    const notice = await screen.findByTestId("access-map-token-filter-notice");
    expect(notice.textContent).toBe("已按 Token p0-demo 过滤访问层，授权层不受影响。");
  });

  it("SC-12 — 迁入弱入口的 test id 仍可找到；页面不出现「桑基图」", async () => {
    // partial 降级态：让 `access-map-partial-notice` 也在场（它按需渲染）。
    const response = makeResponse();
    response.meta.grant.state = "partial";
    response.meta.grant.failures = [{ subjectId: "agent_x", reason: "access_config_missing" }];
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    // 仍在页面上的关键 test id。
    for (const id of [
      "access-map-canvas",
      "access-map-legend",
      "access-map-partial-notice",
      "access-map-view-map",
      "access-map-view-table",
      "access-map-credential-list"
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    // 迁进弱入口的也在。
    const weak = screen.getByTestId("access-map-methodology-snapshot");
    for (const id of [
      "access-map-snapshot-id",
      "access-map-snapshot-coverage",
      "access-map-signal-needs-review-note",
      "access-map-signal-confirmed-source",
      "access-map-legend-trust",
      "access-map-legend-window"
    ]) {
      expect(within(weak).getByTestId(id)).toBeInTheDocument();
    }

    // 页面标题与正文都不使用「桑基图」。
    expect(document.body.textContent ?? "").not.toContain("桑基");
  });
});
