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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFirstExistingTextFile } from "../../scripts/lib/readFirstExistingTextFile";
import { AccessMap } from "../pages/admin/AccessMap";
import { traceAccessMapChain, traceAccessMapSubjectChain } from "../components/admin/AccessMapCanvas";
import {
  accessMapEdgeHoverConclusion,
  accessMapEdgeStateLabel,
  type AccessMapHourlyDetail,
  type AccessMapHourlyDetailRow,
  type AccessMapResponse
} from "../components/admin/AccessMapTypes";

function makeNode(
  id: string,
  kind: AccessMapResponse["nodes"][number]["kind"],
  label: string,
  depth: number,
  meta: Record<string, unknown> = {},
  parentId?: string
): AccessMapResponse["nodes"][number] {
  const grantPaths = typeof meta.grantPaths === "number" ? meta.grantPaths : 0;
  // usage-first：未显式给 accessPaths 时，跟随 grantPaths，避免画布空节点。
  const accessPaths =
    typeof meta.accessPaths === "number" ? meta.accessPaths : grantPaths;
  return {
    id,
    kind,
    label,
    depth,
    ...(parentId ? { parentId } : {}),
    meta: {
      grantUsers: 0,
      accessUsers: accessPaths > 0 ? 1 : 0,
      ...meta,
      // Force computed path counts after `...meta` without duplicate keys.
      accessPaths,
      grantPaths
    }
  };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<AccessMapResponse["edges"][number]> = {}
): AccessMapResponse["edges"][number] {
  const grantPaths = overrides.grantPaths ?? 0;
  const accessPaths =
    overrides.accessPaths ??
    (overrides.state === "dormant" ? 0 : grantPaths > 0 ? grantPaths : 0);
  return {
    id: `e|${source}|${target}`,
    source,
    target,
    grantUsers: 0,
    accessUsers: accessPaths > 0 ? 1 : 0,
    accessCalls: accessPaths,
    state: overrides.state ?? (accessPaths === 0 && grantPaths > 0 ? "dormant" : "normal"),
    confirmedUnauthorized: false,
    reviewEvaluations: [],
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
    ...overrides,
    // Force path counts after `...overrides` without duplicate keys.
    accessPaths: overrides.accessPaths ?? accessPaths,
    grantPaths: overrides.grantPaths ?? grantPaths
  };
}

function makeDetailRow(
  overrides: Partial<AccessMapHourlyDetailRow> = {}
): AccessMapHourlyDetailRow {
  return {
    hour: "2026-10-24T10:00:00+08:00",
    agentId: "agent_a",
    roleId: "role_reader",
    connectionId: "mysql_main",
    schema: "finance",
    table: "orders",
    inquiryKind: "real",
    accessGrade: "query",
    allowCalls: 2,
    denyCalls: 0,
    ...overrides
  };
}

function makeDetail(overrides: Partial<AccessMapHourlyDetail> = {}): AccessMapHourlyDetail {
  const rows = overrides.rows ?? [makeDetailRow()];
  return {
    hasMore: false,
    totalRowCount: rows.length,
    limit: 200,
    offset: 0,
    ...overrides,
    rows
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
      echo: {
        enteringAllowCallCount: 11,
        enteringAllowCallCountBasis: "pre_structure"
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
    detail: makeDetail(),
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

describe("闲置授权文案与悬停结论（lucy-20261105 Spec SC-01／SC-02）", () => {
  it("SC-01 — dormant 短标签为闲置授权", () => {
    expect(accessMapEdgeStateLabel("dormant")).toBe("闲置授权");
  });

  it("SC-02 — 术语标准 Dormant Grant 主术语为闲置授权，禁止列含僵尸授权", () => {
    const terminology = readFileSync(
      resolve(process.cwd(), "docs/00-product-terminology-standard.md"),
      "utf8"
    );
    const dormantRow = terminology
      .split("\n")
      .find((line) => line.includes("Dormant Grant"));
    expect(dormantRow).toBeTruthy();
    const cells = (dormantRow as string).split("|").map((cell) => cell.trim());
    // | Canonical | UI 主术语 | 允许补充 | 禁止文案 | 说明 |
    expect(cells[2]).toBe("闲置授权");
    expect(cells[4]).toContain("僵尸授权");
  });

  it("四态悬停结论句逐字固定", () => {
    expect(accessMapEdgeHoverConclusion("dormant")).toBe("有授权，窗口内未调用");
    expect(accessMapEdgeHoverConclusion("normal")).toBe("有授权，窗口内有调用");
    expect(accessMapEdgeHoverConclusion("needs_review")).toBe(
      "窗口内有调用，当前授权对不上（需复核）"
    );
    expect(accessMapEdgeHoverConclusion("overflow")).toBe("窗口内有调用，且超出当前授权");
  });

  it("SC-14 — ops 触发词无僵尸授权且含闲置授权", () => {
    // Demo template skills/ is gitignored — omit. Prefer skills/ over wiki/ so the
    // first existing path is the skill asset that carries 闲置授权 trigger words.
    const candidates = [
      resolve(process.cwd(), "../skills/lucy-ops/ops-questioning.md"),
      resolve(process.cwd(), "../config/skills/lucy-ops/ops-questioning.md"),
      resolve(process.cwd(), "config/ops-evidence/skills/lucy-ops/ops-questioning.md"),
      resolve(process.cwd(), "../wiki/lucy-ops/ops-questioning.md"),
      resolve(process.cwd(), "../config/wiki/lucy-ops/ops-questioning.md"),
      resolve(process.cwd(), "config/ops-evidence/wiki/lucy-ops/ops-questioning.md")
    ];
    const { path, text } = readFirstExistingTextFile(candidates);
    expect(text, path).toContain("闲置授权");
    expect(text, path).not.toContain("僵尸授权");
  });

  it("SC-14 — 缺文件时失败信息含全部候选", () => {
    const candidates = [
      resolve(process.cwd(), "__missing__/ops-questioning-a.md"),
      resolve(process.cwd(), "__missing__/ops-questioning-b.md")
    ];
    expect(() => readFirstExistingTextFile(candidates)).toThrowError(
      /none of the candidate files exist; candidates:/
    );
    try {
      readFirstExistingTextFile(candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(candidates[0]);
      expect(message).toContain(candidates[1]);
    }
  });
});

describe("AccessMap 页面", () => {
  it("渲染关系图；信号不再占首屏大卡，覆盖率在常驻行披露", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-signal-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-methodology-snapshot")).not.toBeInTheDocument();

    const coverage = screen.getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("快照：可关联 0／需复核 1 · 缺失 1");
    expect(coverage).toHaveTextContent("低覆盖率不代表低越权率");
  });

  it("图例短行保留需复核／确凿越权分项；长口径 note 不再挂默认 DOM", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-legend")).toBeInTheDocument());

    const legend = screen.getByTestId("access-map-legend");
    expect(legend).toHaveTextContent("虚线 = 需复核");
    expect(legend).toHaveTextContent("实线 = 确凿越权");
    expect(screen.queryByTestId("access-map-signal-needs-review-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-confirmed-source")).not.toBeInTheDocument();
  });

  it("默认页无凭证清单与 Token 过滤入口；切换筛选不写 token", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByText("凭证清单")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-token-filter-notice")).not.toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("access-map-window")).getByRole("tab", { name: "近 24 小时" })
    );
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("window=24h"));
    expect(lastRequestUrl(fetchMock)).not.toContain("token=");
  });

  it("数据表展示小时明细列，不再用节点／关系汇总表", async () => {
    const response = makeResponse({
      detail: makeDetail({
        rows: [
          makeDetailRow({ inquiryKind: null, denyCalls: 1, allowCalls: 0 }),
          makeDetailRow({ hour: "2026-10-24T11:00:00+08:00", table: "customers", allowCalls: 3 })
        ]
      })
    });
    response.render = {
      nodes: response.nodes.slice(0, 2),
      edges: response.edges.slice(0, 1),
      folded: { nodes: 3, edges: 2 }
    };
    response.meta.folded = { nodes: 3, edges: 2 };
    stubAccessMap(response);
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-table")).toBeInTheDocument());

    expect(screen.getByTestId("access-map-folded-badge")).toHaveTextContent("已折叠 3 个节点");
    expect(screen.queryByTestId("access-map-table-nodes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-table-edges")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "节点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "关系" })).not.toBeInTheDocument();

    const table = screen.getByTestId("access-map-hourly-detail");
    for (const header of ["小时", "Agent", "角色", "连接", "Schema", "表", "问询种类", "访问等级", "允许调用", "拒绝调用"]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.getByTestId("access-map-detail-inquiry-0")).toHaveTextContent("无关联");
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

  it("URL 参数全部透传到接口（可分享）；非法 trust 首屏原样发出", async () => {
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
    // Spec 20261105 SC-05：非法 trust 不得先删改再请求
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
 * P1-4／Spec 20261104 §5.5：访问面不可用时表区不得用空成功明细冒充。
 */
describe("访问面不可用时的表区说明（P1-4／hourly-detail）", () => {
  it("表视图给出审计不可用 notice，而不是「无调用」空表", async () => {
    const response = makeResponse();
    response.meta.access.state = "unavailable";
    response.meta.access.reason = "审计数据不可用";
    response.detail = null;
    stubAccessMap(response);
    renderPage("/admin/access-map?view=table");

    await waitFor(() =>
      expect(screen.getByTestId("access-map-table-access-unavailable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("access-map-table-access-unavailable")).toHaveTextContent(
      "审计数据不可用"
    );
    expect(screen.queryByTestId("access-map-table-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-hourly-detail")).not.toBeInTheDocument();
  });

  it("访问面可用时表视图展示小时明细", async () => {
    stubAccessMap(makeResponse());
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-hourly-detail")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-detail-row-0")).toHaveTextContent("orders");
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
      makeEdge("agent:agent_a", "role:role_reader", {
        grantPaths: 2,
        grantUsers: 1,
        state: "dormant"
      }),
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

    // 闲置授权 → stub（空心），不含 warning。
    const dormant = screen.getByTestId("access-map-idle-stub-shape-agent:agent_a");
    expect(dormant.getAttribute("fill")).toBe("none");
    expect(dormant.getAttribute("class")).not.toContain("warning");

    // 需复核：warning 面积 + 虚线中线（状态不只靠颜色区分）。
    const needsReview = screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main");
    expect(needsReview.getAttribute("class")).toContain("fill-warning");
    const midline = screen.getByTestId("access-map-midline-e|role:role_reader|conn:mysql_main");
    expect(midline.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(midline.getAttribute("class")).toContain("stroke-warning-strong");

    // 确凿越权：danger 填充使用带 + danger 实线轮廓；无深色内核。
    const overflow = screen.getByTestId(
      "access-map-ribbon-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    expect(overflow.getAttribute("class")).toContain("danger");
    expect(overflow.getAttribute("stroke-dasharray")).toBeNull();
    const outline = screen.getByTestId(
      "access-map-outline-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    expect(outline.getAttribute("class")).toContain("stroke-danger-strong");
    expect(outline.getAttribute("stroke-dasharray")).toBeNull();
    expect(
      screen.queryByTestId("access-map-kernel-e|conn:mysql_main|table:mysql_main::finance::orders")
    ).not.toBeInTheDocument();
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

  it("SC-12 — 数据表为小时明细，标识列带 notranslate", async () => {
    stubAccessMap(
      makeResponse({
        detail: makeDetail({ rows: [makeDetailRow({ inquiryKind: null })] })
      })
    );
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-hourly-detail")).toBeInTheDocument());

    const table = screen.getByTestId("access-map-hourly-detail");
    expect(within(table).getByRole("columnheader", { name: "小时" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "节点" })).not.toBeInTheDocument();
    expect(screen.getByTestId("access-map-detail-inquiry-0")).toHaveTextContent("无关联");

    const agentHeader = within(table).getByRole("columnheader", { name: "Agent" });
    expect(agentHeader.className).toContain("notranslate");
    expect(agentHeader).toHaveAttribute("translate", "no");
  });

  it("SC-13 — 默认页无凭证清单；切换窗口不写 token", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-token-filter-notice")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("access-map-window")).getByRole("tab", { name: "近 24 小时" }));
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("window=24h"));
    expect(lastRequestUrl(fetchMock)).not.toContain("token=");
  });

  it("SC-14 — 常驻行与主工具条关键 test id 仍可找到", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const alwaysPresent = [
      "access-map-canvas",
      "access-map-svg",
      "access-map-node-list",
      "access-map-edge-badges",
      "access-map-legend",
      "access-map-resident-line",
      "access-map-window-range",
      "access-map-snapshot-coverage",
      "access-map-snapshot-id",
      "access-map-filter-status",
      "access-map-view-map",
      "access-map-view-table",
      "access-map-window",
      "access-map-layer",
      "access-map-inquiry-kind",
      "access-map-access-grade",
      "access-map-search",
      "access-map-search-submit"
    ];
    for (const id of alwaysPresent) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Spec 20261105 SC-01：无关联口径下拉／hint
    expect(screen.queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-trust-hint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-methodology-snapshot")).not.toBeInTheDocument();
  });
});

/**
 * 访问关系图 ↔ 访问日志口径对齐（audit-echo Spec §7 组件侧）。
 *
 * Authority: `docs/specs/lucy-20261102-access-map-audit-echo-spec.md`
 *   SC-01–SC-09、SC-17–SC-18
 */
describe("访问关系图 audit-echo 工具条与弱入口（Spec §7 组件侧）", () => {
  it("SC-01／SC-06 — 主工具条无「问询计入」分段与 trust-hint", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-toolbar")).toBeInTheDocument());

    const toolbar = screen.getByTestId("access-map-toolbar");
    expect(toolbar.textContent ?? "").not.toContain("问询计入");
    expect(within(toolbar).queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(within(toolbar).queryByTestId("access-map-trust-hint")).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole("tablist", { name: "问询计入" })).not.toBeInTheDocument();
  });

  it("SC-02 — 问询种类／访问等级下拉选项文案与审计一致", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-inquiry-kind")).toBeInTheDocument());

    const kind = screen.getByTestId("access-map-inquiry-kind");
    expect([...kind.querySelectorAll("option")].map((el) => el.textContent)).toEqual([
      "管理相关",
      "真实问询",
      "未上报问询",
      "会话访问",
      "全部种类"
    ]);

    const grade = screen.getByTestId("access-map-access-grade");
    expect([...grade.querySelectorAll("option")].map((el) => el.textContent)).toEqual([
      "全部",
      "排除连接",
      "连接",
      "浏览",
      "准备",
      "问询动作",
      "查数",
      "运维操作",
      "未分级"
    ]);
  });

  it("SC-03 — 缺省请求不写 inquiryKind／accessGrade，交给服务端缺省", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain("inquiryKind=");
    expect(url).not.toContain("accessGrade=");
  });

  it("SC-04 — 常驻行无关联口径下拉；现状静态「关联口径：已确认关联」", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-resident-line")).toBeInTheDocument());

    const resident = screen.getByTestId("access-map-resident-line");
    expect(within(resident).queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(within(resident).queryByTestId("access-map-trust-hint")).not.toBeInTheDocument();

    const status = within(resident).getByTestId("access-map-filter-status");
    expect(status).toHaveTextContent("关联口径：已确认关联");
    expect(status).toHaveTextContent("问询种类：管理相关");
    expect(status).toHaveTextContent("访问等级：排除连接");
  });

  it("SC-05 — 常驻现状行为「关联口径：…」，无「问询计入」", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-filter-status")).toBeInTheDocument());

    const status = screen.getByTestId("access-map-filter-status");
    expect(status).toHaveTextContent("关联口径：已确认关联");
    expect(status.textContent ?? "").not.toContain("问询计入");
  });

  it("SC-07 — 切换问询种类写 URL 并重请求", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-inquiry-kind")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("access-map-inquiry-kind"), { target: { value: "all" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("inquiryKind=all"));

    fireEvent.change(screen.getByTestId("access-map-inquiry-kind"), { target: { value: "" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("inquiryKind="));
  });

  it("SC-08 — 切换访问等级写 URL 并重请求", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-access-grade")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("access-map-access-grade"), { target: { value: "connect" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("accessGrade=connect"));

    fireEvent.change(screen.getByTestId("access-map-access-grade"), { target: { value: "" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("accessGrade="));
  });

  it("SC-09 — 默认请求不写 trust；切换其它筛选后仍无 include_candidate", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-inquiry-kind")).toBeInTheDocument());
    expect(screen.queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("trust=");

    fireEvent.change(screen.getByTestId("access-map-inquiry-kind"), { target: { value: "all" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("inquiryKind=all"));
    expect(lastRequestUrl(fetchMock)).not.toContain("trust=");
  });

  it("SC-17 — 工具条各列仅标签+单控件（定位列除外）", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-toolbar")).toBeInTheDocument());

    const toolbar = screen.getByTestId("access-map-toolbar");
    const columns = [...toolbar.children].filter((child) =>
      (child as HTMLElement).classList.contains("flex-col")
    ) as HTMLElement[];
    // 统计窗口 / Schema 层 / 问询种类 / 访问等级 / Agent / 连接 / 定位
    expect(columns).toHaveLength(7);
    for (const column of columns.slice(0, 4)) {
      // 标签 + 单控件根（分段或下拉）；禁止旧 trust-hint 那种列内多行说明。
      const controlRoots = column.querySelectorAll("select, .pl-segmented-control");
      expect(controlRoots).toHaveLength(1);
      expect(column.querySelectorAll("p")).toHaveLength(0);
      expect(within(column).queryByTestId("access-map-trust-hint")).not.toBeInTheDocument();
    }
  });

  it("SC-18 — 可见文案无「问询计入」；E 空时提示点名筛选，不声称全量无访问", async () => {
    const response = makeResponse();
    response.meta.echo = {
      enteringAllowCallCount: 0,
      enteringAllowCallCountBasis: "pre_structure"
    };
    response.meta.counts.accessPaths = 0;
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-empty-access")).toBeInTheDocument());

    expect(document.body.textContent ?? "").not.toContain("问询计入");
    const notice = screen.getByTestId("access-map-empty-access");
    expect(notice).toHaveTextContent("问询种类");
    expect(notice).toHaveTextContent("管理相关");
    expect(notice).toHaveTextContent("访问等级");
    expect(notice).toHaveTextContent("排除连接");
    expect(notice.textContent ?? "").not.toContain("无访问日志");
    expect(notice.textContent ?? "").not.toContain("系统无访问");
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
 * 呈现修订 §5.1 + Spec 20261104：页头 → 工具条 → Tab → 图例 → 图区 → 常驻行（无凭证清单）。
 */
describe("页面阅读顺序（呈现修订 §5.1／hourly-detail）", () => {
  it("页头 → 工具条 → 视图切换 → 图例短行 → 图区 → 常驻行；无凭证清单", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    const root = container.firstElementChild as HTMLElement;
    const children = [...root.children] as HTMLElement[];
    const has = (element: HTMLElement, testId: string): boolean =>
      element.getAttribute("data-testid") === testId ||
      element.querySelector(`[data-testid="${testId}"]`) !== null;
    const indexOf = (predicate: (element: HTMLElement) => boolean): number =>
      children.findIndex(predicate);

    const header = indexOf((element) => element.tagName === "HEADER");
    const tabbar = indexOf((element) => has(element, "access-map-view-map"));
    const legend = indexOf((element) => has(element, "access-map-legend"));
    const workspace = indexOf((element) => has(element, "access-map-canvas"));
    const resident = indexOf((element) => has(element, "access-map-resident-line"));

    expect(header).toBe(0);
    expect(tabbar).toBeGreaterThan(header);
    expect(legend).toBeGreaterThan(tabbar);
    expect(legend).toBeLessThan(workspace);
    expect(resident).toBeGreaterThan(workspace);
    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-methodology-snapshot")).not.toBeInTheDocument();
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

  it("SC-02 — 无折叠「口径与快照」；常驻口径行始终可见", async () => {
    stubAccessMap(makeResponse());
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(container.querySelector("#access-map-methodology")).toBeNull();
    expect(container.querySelector("#access-map-snapshot")).toBeNull();
    expect(screen.queryByTestId("access-map-methodology-snapshot")).not.toBeInTheDocument();
    expect(screen.getByTestId("access-map-resident-line")).toBeInTheDocument();
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
    expect(text).toContain("访问路径数");
    expect(text).not.toContain("深色内核");
    expect(text).toContain("闲置授权");
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

  it("SC-04 — 常驻行有窗口起止、覆盖率压缩句与快照 id；无长口径 note", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-resident-line")).toBeInTheDocument());

    const resident = screen.getByTestId("access-map-resident-line");
    for (const id of [
      "access-map-snapshot-id",
      "access-map-snapshot-coverage",
      "access-map-window-range",
      "access-map-filter-status"
    ]) {
      expect(within(resident).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(resident).queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(within(resident).getByTestId("access-map-filter-status")).toHaveTextContent(
      "关联口径：已确认关联"
    );

    expect(screen.queryByTestId("access-map-signal-needs-review-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-calls")).not.toBeInTheDocument();

    const coverage = within(resident).getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("快照：可关联 0／需复核 1 · 缺失 1");
    expect(coverage).toHaveTextContent("低覆盖率不代表低越权率");
    expect(within(resident).getByTestId("access-map-snapshot-id")).toHaveTextContent(
      "config cfg-1 · policy pol-1"
    );
    expect(within(resident).getByTestId("access-map-window-range")).toHaveTextContent(
      "2026-10-18T00:00:00.000Z"
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

    // 悬停**可见**的面积流带（不是只依赖内核；需复核没有内核）。
    const ribbon = screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main");
    fireEvent.mouseOver(ribbon);

    const tip = await screen.findByTestId("access-map-hover-tip");
    expect(tip).toHaveTextContent("→");
    expect(tip).toHaveTextContent("role_reader");
    expect(tip).toHaveTextContent("mysql_main");
    expect(tip).toHaveTextContent("窗口内有调用，当前授权对不上（需复核）");
    expect(tip).toHaveTextContent("调用 3 次");
    expect(tip).not.toHaveTextContent("访问路径");
    expect(tip).not.toHaveTextContent("状态：");
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

  it("SC-11 — 无凭证清单与 Token 过滤 UI", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-token-filter-notice")).not.toBeInTheDocument();
    expect(screen.queryByText("凭证清单")).not.toBeInTheDocument();
  });

  it("SC-12 — 常驻行关键 test id 可找到；页面不出现「桑基图」", async () => {
    const response = makeResponse();
    response.meta.grant.state = "partial";
    response.meta.grant.failures = [{ subjectId: "agent_x", reason: "access_config_missing" }];
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());

    for (const id of [
      "access-map-canvas",
      "access-map-legend",
      "access-map-partial-notice",
      "access-map-view-map",
      "access-map-view-table",
      "access-map-resident-line",
      "access-map-snapshot-id",
      "access-map-snapshot-coverage",
      "access-map-window-range"
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("桑基");
  });
});

/**
 * 访问关系图**几何语言**的组件侧断言。
 *
 * Authority: `docs/specs/lucy-20261101-access-map-geometry-spec.md` v0.2
 *   §5.4  四态面积流带（授权面积 / 独立警示面积 / 内核夹紧 / danger 轮廓）
 *   §5.6  着色 token
 *   §7    SC-05、SC-07、SC-11–SC-14（组件侧）
 *
 * 布局侧断言（SC-01–SC-10 的几何部分）在 `access-map-layout.test.tsx`。
 */
describe("访问关系图几何语言（geometry Spec §7 组件侧）", () => {
  /** 一张覆盖四种边状态的图：normal / needs_review / dormant / overflow 各一条。 */
  function fourStateResponse(): AccessMapResponse {
    const response = makeResponse();
    const customers = makeNode("table:mysql_main::finance::customers", "table", "customers", 3, {
      physicalTable: "finance.customers",
      grantPaths: 1,
      grantUsers: 1
    });
    response.nodes = [...response.nodes, customers];
    response.edges = [
      makeEdge("agent:agent_a", "role:role_reader", {
        grantPaths: 2,
        grantUsers: 1,
        accessPaths: 1,
        accessUsers: 1,
        accessCalls: 2,
        state: "normal"
      }),
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
      }),
      makeEdge("conn:mysql_main", "table:mysql_main::finance::customers", {
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
    return response;
  }

  async function renderFourState(): Promise<void> {
    stubAccessMap(fourStateResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());
  }

  it("SC-05 — 主视觉是填充面积 path；不是「单 path + 超粗 stroke」", async () => {
    await renderFourState();

    const ribbon = screen.getByTestId("access-map-ribbon-e|agent:agent_a|role:role_reader");
    // 面积：闭合填充区域。
    expect(ribbon.getAttribute("d")?.trim().endsWith("Z")).toBe(true);
    expect(ribbon.getAttribute("class")).toMatch(/fill-/);
    // 没有拿描边宽度当厚度。
    expect(ribbon.getAttribute("stroke-width")).toBeNull();
    // usage-first：主视觉是单层使用填充带，无深色内核。
    expect(
      screen.queryByTestId("access-map-kernel-e|agent:agent_a|role:role_reader")
    ).not.toBeInTheDocument();
  });

  it("SC-07 — usage-first 四态：normal／overflow 使用带；dormant→stub；needs_review 虚线；无深色内核", async () => {
    await renderFourState();

    const normalRibbon = screen.getByTestId("access-map-ribbon-e|agent:agent_a|role:role_reader");
    expect(normalRibbon).toBeInTheDocument();
    expect(
      screen.queryByTestId("access-map-kernel-e|agent:agent_a|role:role_reader")
    ).not.toBeInTheDocument();

    // dormant：不进流带，走闲置 stub。
    expect(
      screen.queryByTestId("access-map-ribbon-e|conn:mysql_main|table:mysql_main::finance::orders")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("access-map-idle-stub-conn:mysql_main")).toBeInTheDocument();

    // needs_review：警示面积 + 虚线中线，没有内核。
    expect(screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main")).toBeInTheDocument();
    expect(
      screen.queryByTestId("access-map-kernel-e|role:role_reader|conn:mysql_main")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("access-map-midline-e|role:role_reader|conn:mysql_main")
    ).toBeInTheDocument();

    // overflow：使用带 + danger 实线轮廓；无内核。
    expect(
      screen.getByTestId("access-map-ribbon-e|conn:mysql_main|table:mysql_main::finance::customers")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("access-map-kernel-e|conn:mysql_main|table:mysql_main::finance::customers")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("access-map-outline-e|conn:mysql_main|table:mysql_main::finance::customers")
    ).toBeInTheDocument();
  });

  it("SC-11 — 状态不只靠颜色：dormant stub 不带 warning；needs_review 虚线；overflow / 确凿越权 danger 实线", async () => {
    await renderFourState();

    const dormantStub = screen.getByTestId("access-map-idle-stub-shape-conn:mysql_main");
    expect(dormantStub.getAttribute("class")).not.toContain("warning");
    expect(dormantStub.getAttribute("fill")).toBe("none");

    const midline = screen.getByTestId("access-map-midline-e|role:role_reader|conn:mysql_main");
    expect(midline.getAttribute("stroke-dasharray")).toBeTruthy();

    const outline = screen.getByTestId(
      "access-map-outline-e|conn:mysql_main|table:mysql_main::finance::customers"
    );
    expect(outline.getAttribute("class")).toContain("stroke-danger-strong");
    expect(outline.getAttribute("stroke-dasharray")).toBeNull();

    const overflowRibbon = screen.getByTestId(
      "access-map-ribbon-e|conn:mysql_main|table:mysql_main::finance::customers"
    );
    expect(overflowRibbon.getAttribute("class")).toMatch(/danger|accent/);
  });

  it("SC-12 — 悬停可见使用带／闲置 stub 出浮层，浮层含从→到与三段式结论", async () => {
    await renderFourState();

    // dormant → stub；悬停 stub 出闲置授权浮层。
    const dormant = screen.getByTestId("access-map-idle-stub-conn:mysql_main");
    fireEvent.mouseOver(dormant);
    const dormantTip = await screen.findByTestId("access-map-hover-tip");
    expect(dormantTip).toHaveTextContent("→");
    expect(dormantTip).toHaveTextContent("有授权，窗口内未调用");
    expect(dormantTip).toHaveTextContent("调用 0 次");
    expect(dormantTip).not.toHaveTextContent("访问路径");
    expect(dormantTip).not.toHaveTextContent("状态：");
    expect(dormantTip).not.toHaveTextContent("僵尸授权");
    expect(dormantTip.closest("svg")).toBeNull();
    fireEvent.mouseOut(dormant);

    // normal 的授权面积同样可悬停。
    await waitFor(() =>
      expect(screen.queryByTestId("access-map-hover-tip")).not.toBeInTheDocument()
    );
    const normal = screen.getByTestId("access-map-ribbon-e|agent:agent_a|role:role_reader");
    fireEvent.mouseOver(normal);
    const normalTip = await screen.findByTestId("access-map-hover-tip");
    expect(normalTip).toHaveTextContent("AGENT A");
    expect(normalTip).toHaveTextContent("role_reader");
    expect(normalTip).toHaveTextContent("有授权，窗口内有调用");
    expect(normalTip).toHaveTextContent("调用 2 次");
  });

  it("SC-13 — 点击闲置 stub→清单→边抽屉；点击 needs_review 带直接开抽屉", async () => {
    await renderFourState();

    fireEvent.click(screen.getByTestId("access-map-idle-stub-conn:mysql_main"));
    const list = await screen.findByTestId("access-map-idle-grant-list");
    expect(list).toBeInTheDocument();
    const row = screen.getByTestId(
      "access-map-idle-grant-row-e|conn:mysql_main|table:mysql_main::finance::orders"
    );
    fireEvent.click(row);
    const drawer = await screen.findByTestId("access-map-edge-drawer");
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId("access-map-edge-detail")).toHaveTextContent("闲置授权");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("access-map-edge-drawer")).not.toBeInTheDocument()
    );

    const review = screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main");
    fireEvent.click(review);
    expect(await screen.findByTestId("access-map-edge-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("access-map-edge-detail")).toHaveTextContent("需复核");
  });

  it("闲置授权悬停 — needs_review／overflow 结论与确凿越权括注", async () => {
    await renderFourState();

    fireEvent.mouseOver(screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main"));
    const reviewTip = await screen.findByTestId("access-map-hover-tip");
    expect(reviewTip).toHaveTextContent("窗口内有调用，当前授权对不上（需复核）");
    expect(reviewTip).toHaveTextContent("调用 3 次");
    expect(reviewTip).not.toHaveTextContent("访问路径");
    expect(reviewTip).not.toHaveTextContent("（确凿越权：调用当时授权亦不覆盖）");
    fireEvent.mouseOut(screen.getByTestId("access-map-ribbon-e|role:role_reader|conn:mysql_main"));
    await waitFor(() => expect(screen.queryByTestId("access-map-hover-tip")).not.toBeInTheDocument());

    fireEvent.mouseOver(
      screen.getByTestId("access-map-ribbon-e|conn:mysql_main|table:mysql_main::finance::customers")
    );
    const overflowTip = await screen.findByTestId("access-map-hover-tip");
    expect(overflowTip).toHaveTextContent("窗口内有调用，且超出当前授权");
    expect(overflowTip).toHaveTextContent("调用 5 次");
    expect(overflowTip).toHaveTextContent("（确凿越权：调用当时授权亦不覆盖）");
  });

  it("闲置授权悬停 — 访问面不可用时降级，不以调用 0 次冒充", async () => {
    const response = fourStateResponse();
    response.meta.access = {
      ...response.meta.access,
      state: "unavailable",
      reason: "audit_db_unavailable",
      rawCalls: 0,
      deniedCalls: 0
    };
    // 夹具故意带 confirmedUnauthorized，降级时仍不得出括注。
    response.edges = response.edges.map((edge) =>
      edge.state === "dormant" ? { ...edge, confirmedUnauthorized: true } : edge
    );
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-svg")).toBeInTheDocument());

    const stub = screen.getByTestId("access-map-idle-stub-conn:mysql_main");
    fireEvent.mouseOver(stub);
    const tip = await screen.findByTestId("access-map-hover-tip");
    expect(tip).toHaveTextContent("授权面可读，调用情况暂不可用");
    expect(tip).toHaveTextContent("调用情况暂不可用");
    expect(tip.textContent ?? "").not.toMatch(/调用 \d+ 次/);
    expect(tip).not.toHaveTextContent("有授权，窗口内未调用");
    expect(tip).not.toHaveTextContent("（确凿越权：调用当时授权亦不覆盖）");

    const title = stub.querySelector("title");
    expect(title?.textContent ?? "").not.toMatch(/调用 \d+ 次/);
    expect(title?.textContent ?? "").not.toContain("僵尸授权");
  });

  it("SC-15 — AccessMap 向 Canvas 传入 accessOk（源码合同）", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/pages/admin/AccessMap.tsx"), "utf-8");
    expect(pageSource).toMatch(/accessOk=\{response\.meta\.access\.state === "ok"\}/);
  });

  it("SC-14 — 没有新增运行时依赖，也没有裸十六进制颜色", async () => {
    // jsdom 环境下 import.meta.url 不是 file:，改用进程工作目录（= webui/）定位。
    const canvasSource = readFileSync(
      resolve(process.cwd(), "src/components/admin/AccessMapCanvas.tsx"),
      "utf-8"
    );
    // 依赖只来自 react / radix / 本地模块。
    const imports = [...canvasSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1] as string);
    for (const specifier of imports) {
      expect(
        specifier.startsWith(".") ||
          specifier === "react" ||
          specifier.startsWith("@radix-ui/"),
        `意外的新增依赖：${specifier}`
      ).toBe(true);
    }
    // 没有裸 hex（着色走语义层 token）。
    expect(canvasSource.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);

    // 依赖清单里没有图表库。
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = Object.keys(pkg.dependencies ?? {});
    expect(dependencyNames.filter((name) => name.startsWith("d3"))).toEqual([]);
  });
});

describe("链路高亮与列头 KPI", () => {
  it("点击节点点亮整条上下游，卡片改成这条链路的数，且不把图收成子图", async () => {
    const response = makeResponse();
    response.nodes = [
      ...response.nodes,
      makeNode("agent:other", "agent", "其他", 0, { grantPaths: 1, grantUsers: 1 }),
      makeNode("role:other", "role", "other_role", 1, { grantPaths: 1, grantUsers: 1 })
    ];
    response.edges = [
      ...response.edges,
      makeEdge("agent:other", "role:other", { grantPaths: 1, grantUsers: 1 })
    ];
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    const fetchMock = stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-node-agent:agent_a")).toBeInTheDocument());

    const agentLabel = screen.getByTestId("access-map-label-agent:agent_a");
    expect(agentLabel.textContent).not.toContain("条路径");
    expect(agentLabel.textContent).not.toContain("闲置授权");
    expect(screen.getByTestId("access-map-column-card-value-0")).toHaveTextContent("2");
    expect(screen.getByTestId("access-map-column-card-0")).toHaveTextContent("有授权");
    expect(screen.getByTestId("access-map-column-card-0")).toHaveTextContent("有问询");

    fireEvent.click(screen.getByTestId("access-map-node-agent:agent_a"));

    // usage-first S8：点击 Agent 持久写入 agent=（可与链路高亮并存）。
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("agent=agent_a"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-role:role_reader")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-conn:mysql_main")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-table:mysql_main::finance::orders")).toHaveAttribute(
      "data-chain",
      "on"
    );
    expect(screen.getByTestId("access-map-node-agent:other")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-node-role:other")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-link-e|agent:agent_a|role:role_reader")).toHaveAttribute(
      "data-chain",
      "on"
    );
    expect(screen.getByTestId("access-map-link-e|agent:other|role:other")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-column-card-value-0")).toHaveTextContent("1");
    expect(screen.getByTestId("access-map-chain-caption")).toHaveTextContent("AGENT A");

    fireEvent.click(screen.getByTestId("access-map-chain-clear"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).not.toHaveAttribute("data-chain");
    expect(screen.getByTestId("access-map-column-card-value-0")).toHaveTextContent("2");
  });

  it("confirmed-only — 图例与现状静态「关联口径：已确认关联」；无下拉", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-legend-trust")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-legend-trust")).toHaveTextContent("关联口径：已确认关联");
    expect(screen.getByTestId("access-map-filter-status")).toHaveTextContent("关联口径：已确认关联");
    expect(screen.queryByTestId("access-map-trust")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-trust-hint")).not.toBeInTheDocument();
  });

  it("环上的节点不会挡住侧面接进来的上游", () => {
    const edges = [makeEdge("A", "B"), makeEdge("B", "A"), makeEdge("C", "B")];
    const chain = traceAccessMapChain("A", edges);
    expect([...chain.nodes].sort()).toEqual(["A", "B", "C"]);
    expect(chain.edges.has("e|C|B")).toBe(true);
  });

  it("钉住一个人后，共享下游只计他自己的问询，悬停别人不改这条链路", async () => {
    const shared = {
      grantPaths: 2,
      grantUsers: 2,
      accessPaths: 1,
      accessUsers: 1,
      grantAgentIds: ["agent_a", "agent_b"],
      accessAgentIds: ["agent_b"]
    };
    const response = makeResponse({
      nodes: [
        makeNode("agent:agent_a", "agent", "AGENT A", 0, { grantPaths: 1, grantUsers: 1, accessPaths: 0 }),
        makeNode("agent:agent_b", "agent", "AGENT B", 0, { grantPaths: 1, grantUsers: 1, accessPaths: 1 }),
        makeNode("role:shared", "role", "shared", 1, shared),
        makeNode("conn:shared", "connection", "shared", 2, shared),
        makeNode("table:shared", "table", "shared", 3, shared)
      ],
      edges: [
        makeEdge("agent:agent_a", "role:shared", {
          grantPaths: 1,
          grantUsers: 1,
          accessPaths: 0,
          state: "dormant"
        }),
        makeEdge("agent:agent_b", "role:shared", { grantPaths: 1, grantUsers: 1, accessPaths: 1 }),
        makeEdge("role:shared", "conn:shared", { grantPaths: 2, grantUsers: 2, accessPaths: 1 }),
        makeEdge("conn:shared", "table:shared", { grantPaths: 2, grantUsers: 2, accessPaths: 1 })
      ]
    });
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-node-agent:agent_a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("access-map-label-agent:agent_a"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-agent:agent_b")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-node-role:shared")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-column-card-1")).toHaveTextContent("有问询 0");
    expect(screen.getByTestId("access-map-column-card-1")).toHaveTextContent("闲置授权 1");
    expect(screen.getByTestId("access-map-chain-caption")).toHaveTextContent("AGENT A");

    fireEvent.mouseEnter(screen.getByTestId("access-map-node-agent:agent_b"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-agent:agent_b")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-chain-caption")).toHaveTextContent("AGENT A");

    fireEvent.click(screen.getByTestId("access-map-node-agent:agent_a").querySelector("rect") as Element);
    expect(screen.queryByTestId("access-map-chain-caption")).not.toBeInTheDocument();
  });

  it("Esc 先灭掉高亮，指针还停着也不会立刻亮回来，再按一次才清 URL 聚焦", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage("/admin/access-map?focus=agent%3Aagent_a");
    await waitFor(() => expect(screen.getByTestId("access-map-node-agent:agent_a")).toBeInTheDocument());

    fireEvent.mouseEnter(screen.getByTestId("access-map-node-agent:agent_a"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("access-map-node-agent:agent_a")).not.toHaveAttribute("data-chain");
    expect(lastRequestUrl(fetchMock)).toContain("focus=agent%3Aagent_a");

    fireEvent.mouseEnter(screen.getByTestId("access-map-node-agent:agent_a"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).not.toHaveAttribute("data-chain");

    fireEvent.mouseLeave(screen.getByTestId("access-map-node-agent:agent_a"));
    fireEvent.mouseEnter(screen.getByTestId("access-map-node-agent:agent_a"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("focus="));
  });

  it("折叠只影响画法，列头按真实表计数，卡片不在横向滚动区里", async () => {
    const tables = [1, 2, 3, 4, 5].map((index) =>
      makeNode(`table:t${index}`, "table", `t${index}`, 3, {
        grantPaths: 1,
        accessPaths: index === 1 ? 1 : 0,
        grantAgentIds: ["agent_a"],
        accessAgentIds: index === 1 ? ["agent_a"] : []
      })
    );
    const response = makeResponse();
    const kept = response.nodes.filter((node) => node.kind !== "table");
    const keptEdges = response.edges.filter((edge) => !edge.target.startsWith("table:"));
    response.nodes = [...kept, ...tables];
    response.edges = [
      ...keptEdges,
      ...tables.map((table) =>
        makeEdge("conn:mysql_main", table.id, {
          grantPaths: 1,
          grantUsers: 1,
          accessPaths: (table.meta.accessPaths as number) ?? 0,
          state: ((table.meta.accessPaths as number) ?? 0) > 0 ? "normal" : "dormant"
        })
      )
    ];
    response.render = {
      nodes: [
        ...kept,
        makeNode("other:table:3", "table", "其他（5）", 3, {
          grantPaths: 5,
          accessPaths: 1,
          foldedMemberIds: tables.map((table) => table.id)
        })
      ],
      edges: [
        ...keptEdges,
        makeEdge("conn:mysql_main", "other:table:3", { grantPaths: 5, accessPaths: 1 })
      ],
      folded: { nodes: 4, edges: 4 }
    };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-node-other:table:3")).toBeInTheDocument());

    expect(screen.getByTestId("access-map-column-card-value-3")).toHaveTextContent("5");
    expect(screen.getByTestId("access-map-column-card-3")).toHaveTextContent("有问询 1");
    expect(screen.getByTestId("access-map-column-card-3")).toHaveTextContent("闲置授权 4");
    expect(
      screen.getByTestId("access-map-plot-scroll").contains(screen.getByTestId("access-map-column-cards"))
    ).toBe(false);

    fireEvent.click(screen.getByTestId("access-map-node-button-agent:agent_a"));
    expect(screen.getByTestId("access-map-column-card-value-3")).toHaveTextContent("5");
    expect(screen.getByTestId("access-map-node-other:table:3")).toHaveAttribute("data-chain", "on");
  });

  it("共用连接时，别人的专属表不算进当前链路，点表也不会把对方算进主体", async () => {
    const response = makeResponse({
      nodes: [
        makeNode("agent:agent_a", "agent", "AGENT A", 0, {
          grantPaths: 1,
          grantUsers: 1,
          accessPaths: 1,
          accessAgentIds: ["agent_a"]
        }),
        makeNode("agent:agent_b", "agent", "AGENT B", 0, {
          grantPaths: 1,
          grantUsers: 1,
          accessPaths: 1,
          accessAgentIds: ["agent_b"]
        }),
        makeNode("role:ra", "role", "RA", 1, {
          grantPaths: 1,
          accessPaths: 1,
          grantAgentIds: ["agent_a"],
          accessAgentIds: ["agent_a"]
        }),
        makeNode("role:rb", "role", "RB", 1, {
          grantPaths: 1,
          accessPaths: 1,
          grantAgentIds: ["agent_b"],
          accessAgentIds: ["agent_b"]
        }),
        makeNode("conn:c", "connection", "C", 2, {
          grantPaths: 2,
          accessPaths: 2,
          grantAgentIds: ["agent_a", "agent_b"],
          accessAgentIds: ["agent_a", "agent_b"]
        }),
        makeNode("table:ta", "table", "TA", 3, {
          grantPaths: 1,
          accessPaths: 1,
          grantAgentIds: ["agent_a"],
          accessAgentIds: ["agent_a"]
        }),
        makeNode("table:tb", "table", "TB", 3, {
          grantPaths: 1,
          accessPaths: 1,
          grantAgentIds: ["agent_b"],
          accessAgentIds: ["agent_b"]
        })
      ],
      edges: [
        makeEdge("agent:agent_a", "role:ra", { grantPaths: 1, accessPaths: 1 }),
        makeEdge("agent:agent_b", "role:rb", { grantPaths: 1, accessPaths: 1 }),
        makeEdge("role:ra", "conn:c", { grantPaths: 1, accessPaths: 1 }),
        makeEdge("role:rb", "conn:c", { grantPaths: 1, accessPaths: 1 }),
        makeEdge("conn:c", "table:ta", { grantPaths: 1, accessPaths: 1 }),
        makeEdge("conn:c", "table:tb", { grantPaths: 1, accessPaths: 1 })
      ]
    });
    response.render = { nodes: response.nodes, edges: response.edges, folded: { nodes: 0, edges: 0 } };
    stubAccessMap(response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-node-agent:agent_a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("access-map-node-agent:agent_a"));
    expect(screen.getByTestId("access-map-node-table:ta")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-conn:c")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-table:tb")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-node-agent:agent_b")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-node-role:rb")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-column-card-value-3")).toHaveTextContent("1");
    expect(screen.getByTestId("access-map-column-card-3")).toHaveTextContent("有授权 1");

    fireEvent.click(screen.getByTestId("access-map-node-agent:agent_a"));
    fireEvent.click(screen.getByTestId("access-map-node-table:ta"));
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");
    expect(screen.getByTestId("access-map-node-agent:agent_b")).toHaveAttribute("data-chain", "off");
    expect(screen.getByTestId("access-map-column-card-value-0")).toHaveTextContent("1");
    expect(screen.getByTestId("access-map-node-table:tb")).toHaveAttribute("data-chain", "off");
  });

  it("键盘列表的悬停和离开也遵守 Esc 抑制，没有高亮时 Esc 清聚焦", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage("/admin/access-map?focus=agent%3Aagent_a");
    await waitFor(() => expect(screen.getByTestId("access-map-node-button-agent:agent_a")).toBeInTheDocument());

    const listA = screen.getByTestId("access-map-node-button-agent:agent_a");
    const listRole = screen.getByTestId("access-map-node-button-role:role_reader");
    fireEvent.mouseEnter(listA);
    expect(screen.getByTestId("access-map-node-agent:agent_a")).toHaveAttribute("data-chain", "on");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("access-map-node-agent:agent_a")).not.toHaveAttribute("data-chain");
    expect(lastRequestUrl(fetchMock)).toContain("focus=agent%3Aagent_a");

    fireEvent.mouseLeave(listA);
    fireEvent.mouseEnter(listRole);
    expect(screen.getByTestId("access-map-node-role:role_reader")).toHaveAttribute("data-chain", "on");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("access-map-node-role:role_reader")).not.toHaveAttribute("data-chain");
    expect(lastRequestUrl(fetchMock)).toContain("focus=agent%3Aagent_a");

    fireEvent.mouseEnter(listRole);
    expect(screen.getByTestId("access-map-node-role:role_reader")).not.toHaveAttribute("data-chain");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).not.toContain("focus="));
  });

  it("主体裁剪不会把共享连接另一侧的表留在链路里", () => {
    const nodes = [
      makeNode("agent:agent_a", "agent", "A", 0),
      makeNode("role:ra", "role", "RA", 1, { grantAgentIds: ["agent_a"], accessAgentIds: [] }),
      makeNode("conn:c", "connection", "C", 2, {
        grantAgentIds: ["agent_a", "agent_b"],
        accessAgentIds: []
      }),
      makeNode("table:tb", "table", "TB", 3, { grantAgentIds: ["agent_b"], accessAgentIds: [] })
    ];
    const edges = [
      makeEdge("agent:agent_a", "role:ra"),
      makeEdge("role:ra", "conn:c"),
      makeEdge("conn:c", "table:tb")
    ];
    const chain = traceAccessMapSubjectChain(
      ["agent:agent_a"],
      nodes,
      edges,
      new Set(["agent_a"])
    );
    expect(chain.nodes.has("table:tb")).toBe(false);
    expect(chain.nodes.has("conn:c")).toBe(true);
  });
});

/**
 * Spec 20261104 访问关系图小时明细表 — 页壳／表列／§5.5（SC-01–SC-06、SC-15、SC-16、SC-18）。
 */
describe("访问关系图小时明细页壳（Spec 20261104 §8 组件）", () => {
  it("SC-01 — 默认页无凭证清单、无 access-map-credential-list", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-canvas")).toBeInTheDocument());
    expect(screen.queryByTestId("access-map-credential-list")).not.toBeInTheDocument();
    expect(screen.queryByText("凭证清单")).not.toBeInTheDocument();
  });

  it("SC-02 — 无 Token 过滤控件；切换筛选不写 token", async () => {
    const fetchMock = stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-inquiry-kind")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("access-map-inquiry-kind"), { target: { value: "real" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("inquiryKind=real"));
    expect(lastRequestUrl(fetchMock)).not.toContain("token=");
    expect(screen.queryByTestId("access-map-token-filter-notice")).not.toBeInTheDocument();
  });

  it("SC-03 — 无折叠口径 details；有常驻现状／窗口／覆盖率／快照哈希", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-resident-line")).toBeInTheDocument());
    expect(screen.queryByTestId("access-map-methodology-snapshot")).not.toBeInTheDocument();
    expect(screen.getByTestId("access-map-filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("access-map-window-range")).toBeInTheDocument();
    expect(screen.getByTestId("access-map-snapshot-coverage")).toBeInTheDocument();
    expect(screen.getByTestId("access-map-snapshot-id")).toHaveTextContent("config cfg-1 · policy pol-1");
  });

  it("SC-04 — 长口径 note test id 不在默认 DOM", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-resident-line")).toBeInTheDocument());
    expect(screen.queryByTestId("access-map-signal-needs-review-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-confirmed-source")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-map-signal-calls")).not.toBeInTheDocument();
  });

  it("SC-05／SC-06 — 数据表为小时列；inquiryKind=null 显示「无关联」", async () => {
    stubAccessMap(
      makeResponse({
        detail: makeDetail({
          rows: [makeDetailRow({ inquiryKind: null, allowCalls: 0, denyCalls: 2 })]
        })
      })
    );
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-hourly-detail")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "节点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "关系" })).not.toBeInTheDocument();
    const table = screen.getByTestId("access-map-hourly-detail");
    expect(within(table).getByRole("columnheader", { name: "小时" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "允许调用" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "拒绝调用" })).toBeInTheDocument();
    expect(screen.getByTestId("access-map-detail-inquiry-0")).toHaveTextContent("无关联");
  });

  it("SC-16 — 标识列 notranslate；无「桑基图」标题", async () => {
    stubAccessMap(makeResponse());
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-hourly-detail")).toBeInTheDocument());
    const table = screen.getByTestId("access-map-hourly-detail");
    for (const name of ["Agent", "角色", "连接", "Schema", "表"]) {
      const header = within(table).getByRole("columnheader", { name });
      expect(header.className).toContain("notranslate");
      expect(header).toHaveAttribute("translate", "no");
    }
    expect(screen.getByTestId("page-header").textContent ?? "").not.toContain("桑基");
    expect(document.body.textContent ?? "").not.toContain("桑基图");
  });

  it("SC-18 — 常驻行可见窗口起止与覆盖率压缩句；不暗示低越权率", async () => {
    stubAccessMap(makeResponse());
    renderPage();
    await waitFor(() => expect(screen.getByTestId("access-map-window-range")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-window-range")).toHaveTextContent(
      "窗口起止：2026-10-18T00:00:00.000Z ~ 2026-10-25T00:00:00.000Z"
    );
    const coverage = screen.getByTestId("access-map-snapshot-coverage");
    expect(coverage).toHaveTextContent("快照：可关联 0／需复核 1 · 缺失 1");
    expect(coverage).toHaveTextContent("低覆盖率不代表低越权率");
  });

  describe("SC-15 — §5.5 表视图状态矩阵", () => {
    it("grant unavailable：授权 notice；禁止空明细冒充", async () => {
      const response = makeResponse();
      response.meta.grant.state = "unavailable";
      response.meta.grant.problem = "access_unreadable";
      response.nodes = [];
      response.edges = [];
      response.render = { nodes: [], edges: [], folded: { nodes: 0, edges: 0 } };
      response.detail = undefined;
      stubAccessMap(response);
      renderPage("/admin/access-map?view=table");
      await waitFor(() =>
        expect(screen.getByTestId("access-map-grant-unavailable")).toBeInTheDocument()
      );
      expect(screen.queryByTestId("access-map-hourly-detail")).not.toBeInTheDocument();
      expect(screen.queryByTestId("access-map-table-empty")).not.toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toMatch(/无调用/);
    });

    it("access unavailable：表区 notice，禁止无说明空表", async () => {
      const response = makeResponse();
      response.meta.access.state = "unavailable";
      response.meta.access.reason = "重建失败";
      response.detail = null;
      stubAccessMap(response);
      renderPage("/admin/access-map?view=table");
      await waitFor(() =>
        expect(screen.getByTestId("access-map-table-access-unavailable")).toBeInTheDocument()
      );
      expect(screen.queryByTestId("access-map-table-empty")).not.toBeInTheDocument();
      expect(screen.queryByTestId("access-map-hourly-detail")).not.toBeInTheDocument();
    });

    it("真实零行：空态可调筛选；不用「尚无 Agent 授权关系」", async () => {
      stubAccessMap(
        makeResponse({
          detail: makeDetail({ rows: [], totalRowCount: 0, hasMore: false })
        })
      );
      renderPage("/admin/access-map?view=table");
      await waitFor(() => expect(screen.getByTestId("access-map-table-empty")).toBeInTheDocument());
      expect(screen.getByTestId("access-map-table-empty")).toHaveTextContent("没有调用明细");
      expect(screen.getByTestId("access-map-table-empty").textContent ?? "").not.toContain(
        "尚无 Agent 授权关系"
      );
    });

    it("deny-only：拒绝行必须展示", async () => {
      stubAccessMap(
        makeResponse({
          detail: makeDetail({
            rows: [makeDetailRow({ allowCalls: 0, denyCalls: 4, inquiryKind: null })]
          })
        })
      );
      renderPage("/admin/access-map?view=table");
      await waitFor(() => expect(screen.getByTestId("access-map-detail-row-0")).toBeInTheDocument());
      expect(screen.getByTestId("access-map-detail-row-0")).toHaveTextContent("4");
      expect(screen.getByTestId("access-map-detail-inquiry-0")).toHaveTextContent("无关联");
    });

    it("分页越界：提示回到第一页，不得声称无调用", async () => {
      stubAccessMap(
        makeResponse({
          detail: makeDetail({
            rows: [],
            totalRowCount: 12,
            hasMore: false,
            limit: 200,
            offset: 500
          })
        })
      );
      renderPage("/admin/access-map?view=table&detailOffset=500");
      await waitFor(() =>
        expect(screen.getByTestId("access-map-table-page-overflow")).toBeInTheDocument()
      );
      expect(screen.getByTestId("access-map-table-page-overflow")).toHaveTextContent("本页没有数据");
      expect(screen.getByTestId("access-map-table-page-overflow").textContent ?? "").not.toContain(
        "无调用"
      );
      expect(screen.getByTestId("access-map-table-back-first-page")).toBeInTheDocument();
    });

    it("partial：保留 notice，且已读明细仍可见", async () => {
      const response = makeResponse({
        detail: makeDetail({ rows: [makeDetailRow({ table: "orders", allowCalls: 1 })] })
      });
      response.meta.grant.state = "partial";
      response.meta.grant.failures = [{ subjectId: "agent_x", reason: "access_config_missing" }];
      stubAccessMap(response);
      renderPage("/admin/access-map?view=table");
      await waitFor(() =>
        expect(screen.getByTestId("access-map-partial-notice")).toBeInTheDocument()
      );
      expect(screen.getByTestId("access-map-detail-row-0")).toHaveTextContent("orders");
    });

    it("grant 空 + access ok：不挡表视图", async () => {
      stubAccessMap(
        makeResponse({
          nodes: [],
          edges: [],
          render: { nodes: [], edges: [], folded: { nodes: 0, edges: 0 } },
          detail: makeDetail({
            rows: [makeDetailRow({ allowCalls: 0, denyCalls: 2 })]
          })
        })
      );
      renderPage("/admin/access-map?view=table");
      await waitFor(() => expect(screen.getByTestId("access-map-hourly-detail")).toBeInTheDocument());
      expect(screen.queryByTestId("access-map-empty")).not.toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toContain("尚无 Agent 授权关系");
      expect(screen.getByTestId("access-map-detail-row-0")).toHaveTextContent("2");
    });
  });

  it("分页：URL 读写 detailOffset；筛选变更重置 offset；展示 hasMore", async () => {
    const fetchMock = stubAccessMap(
      makeResponse({
        detail: makeDetail({
          rows: [makeDetailRow()],
          hasMore: true,
          totalRowCount: 40,
          limit: 200,
          offset: 0
        })
      })
    );
    renderPage("/admin/access-map?view=table");
    await waitFor(() => expect(screen.getByTestId("access-map-detail-has-more")).toBeInTheDocument());
    expect(screen.getByTestId("access-map-detail-page-summary")).toHaveTextContent("还有更多");

    fireEvent.click(screen.getByTestId("access-map-detail-next"));
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("detailOffset=200"));

    fireEvent.change(screen.getByTestId("access-map-inquiry-kind"), { target: { value: "all" } });
    await waitFor(() => expect(lastRequestUrl(fetchMock)).toContain("inquiryKind=all"));
    expect(lastRequestUrl(fetchMock)).not.toContain("detailOffset=");
  });
});
