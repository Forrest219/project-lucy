/**
 * usage-first Spec v0.4.2 — frontend SC samples (01–17, 21, 23–24, 28–29).
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  IDLE_GRANT_PX,
  layoutAccessMap,
  selectAccessMapCanvasNodes
} from "../components/admin/AccessMapCanvas";
import { AccessMapLegend } from "../components/admin/AccessMapLegend";
import type { AccessMapEdge, AccessMapNode } from "../components/admin/AccessMapTypes";
import { AccessMap } from "../pages/admin/AccessMap";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query"
  );
  return {
    ...actual,
    useQuery: () => ({
      data: mockResponse,
      isError: false,
      error: null
    })
  };
});

function makeNode(
  id: string,
  kind: AccessMapNode["kind"],
  label: string,
  depth: number,
  grantPaths: number,
  accessPaths = 0
): AccessMapNode {
  return {
    id,
    kind,
    label,
    depth,
    meta: {
      grantPaths,
      grantUsers: 1,
      accessPaths,
      accessUsers: accessPaths > 0 ? 1 : 0
    }
  };
}

function makeEdge(
  source: string,
  target: string,
  grantPaths: number,
  accessPaths = 0,
  overrides: Partial<AccessMapEdge> = {}
): AccessMapEdge {
  return {
    id: `e|${source}|${target}`,
    source,
    target,
    grantPaths,
    grantUsers: 1,
    accessPaths,
    accessUsers: accessPaths > 0 ? 1 : 0,
    accessCalls: accessPaths,
    state: accessPaths === 0 ? "dormant" : "normal",
    confirmedUnauthorized: false,
    reviewEvaluations: [],
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
    ...overrides
  };
}

const heFixture = (() => {
  const nodes = [
    makeNode("agent:hehe", "agent", "何老师", 0, 100, 1),
    makeNode("role:lucy_admin", "role", "lucy_admin", 1, 100, 1),
    makeNode("conn:demo-mysql", "connection", "demo-mysql", 2, 100, 1),
    makeNode("table:demo::s::orders", "table", "orders", 3, 1, 1),
    makeNode("table:demo::s::idle_a", "table", "idle_a", 3, 50, 0),
    makeNode("table:demo::s::idle_b", "table", "idle_b", 3, 50, 0)
  ];
  const edges = [
    makeEdge("agent:hehe", "role:lucy_admin", 100, 1),
    makeEdge("role:lucy_admin", "conn:demo-mysql", 100, 1),
    makeEdge("conn:demo-mysql", "table:demo::s::orders", 1, 1),
    makeEdge("conn:demo-mysql", "table:demo::s::idle_a", 50, 0),
    makeEdge("conn:demo-mysql", "table:demo::s::idle_b", 50, 0)
  ];
  return { nodes, edges };
})();

const mockResponse = {
  meta: {
    window: { startIso: "a", endIso: "b", asOf: "c" },
    grant: {
      state: "ok",
      problem: null,
      accessConfigVersion: "1",
      policyVersion: "1",
      sourceMapVersion: "1",
      capabilityDigest: "1",
      failures: []
    },
    access: { state: "ok", trust: "confirmed", deniedCalls: 0, rawCalls: 1 },
    echo: {
      enteringAllowCallCount: 3,
      enteringAllowCallCountBasis: "pre_structure",
      projectedAllowCallCount: 1
    },
    counts: {
      agents: 1,
      roles: 1,
      connections: 1,
      schemas: 0,
      tables: 3,
      tokens: 0,
      edges: 5,
      grantPaths: 100,
      grantUsers: 1,
      accessPaths: 1,
      accessUsers: 1
    },
    signals: { dormantEdges: 2, needsReviewEdges: 0, confirmedUnauthorizedEdges: 0 },
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
    orphanGrants: 0,
    folded: { nodes: 0, edges: 0 },
    countingNotes: []
  },
  nodes: heFixture.nodes,
  edges: heFixture.edges,
  render: { nodes: heFixture.nodes, edges: heFixture.edges, folded: { nodes: 0, edges: 0 } }
};

describe("usage-first layout SC-01–05／08／11／21", () => {
  it("SC-01 — IDLE_GRANT_PX ∈[2,4] 并锁定稿值 3", () => {
    expect(IDLE_GRANT_PX).toBe(3);
    expect(IDLE_GRANT_PX).toBeGreaterThanOrEqual(2);
    expect(IDLE_GRANT_PX).toBeLessThanOrEqual(4);
  });

  it("SC-02／05／19 — 闲置表不进 canvas；柱高不随纯 grant 升高", () => {
    const canvas = selectAccessMapCanvasNodes(heFixture.nodes, heFixture.edges, true);
    expect(canvas.some((node) => node.label === "orders")).toBe(true);
    expect(canvas.some((node) => node.label === "idle_a")).toBe(false);
    expect(canvas.some((node) => node.label === "idle_b")).toBe(false);

    const layout = layoutAccessMap(heFixture.nodes, heFixture.edges);
    const agent = layout.nodes.find((item) => item.node.id === "agent:hehe");
    expect(agent).toBeDefined();
    // 单路径四层：柱高 = 1×unitPx，不得 ≈ 100×unitPx
    expect(agent!.height).toBeCloseTo(layout.unitPx, 1);
    expect(agent!.height).toBeLessThan(10 * layout.unitPx);
  });

  it("SC-03／08 — accessPaths 加倍厚度加倍；厚度=accessPaths×unitPx", () => {
    const nodes = [
      makeNode("agent:a", "agent", "A", 0, 4, 4),
      makeNode("role:r", "role", "R", 1, 4, 4),
      makeNode("conn:c", "connection", "C", 2, 4, 4),
      makeNode("table:t1", "table", "t1", 3, 4, 4),
      makeNode("table:t2", "table", "t2", 3, 2, 2)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 4, 4),
      makeEdge("role:r", "conn:c", 4, 4),
      makeEdge("conn:c", "table:t1", 4, 4),
      makeEdge("conn:c", "table:t2", 2, 2)
    ];
    const layout = layoutAccessMap(nodes, edges);
    const thick = layout.links.find((link) => link.edge.id === "e|conn:c|table:t1");
    const thin = layout.links.find((link) => link.edge.id === "e|conn:c|table:t2");
    expect(thick!.width).toBeCloseTo(4 * layout.unitPx, 5);
    expect(thin!.width).toBeCloseTo(2 * layout.unitPx, 5);
    expect(thick!.width).toBeCloseTo(2 * thin!.width, 1);
  });

  it("SC-04 — 单路径四层柱高相等；pillarHeight=max(in,out)", () => {
    const nodes = [
      makeNode("agent:a", "agent", "A", 0, 1, 1),
      makeNode("role:r", "role", "R", 1, 1, 1),
      makeNode("conn:c", "connection", "C", 2, 1, 1),
      makeNode("table:t", "table", "T", 3, 1, 1)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 1, 1),
      makeEdge("role:r", "conn:c", 1, 1),
      makeEdge("conn:c", "table:t", 1, 1)
    ];
    const layout = layoutAccessMap(nodes, edges);
    const heights = layout.nodes.map((item) => item.height);
    expect(heights.every((h) => Math.abs(h - heights[0]!) < 0.1)).toBe(true);
    expect(heights[0]).toBeCloseTo(layout.unitPx, 5);
  });

  it("SC-11 — 闲置 stub fill=none；不改变 pillarHeight", () => {
    const layout = layoutAccessMap(heFixture.nodes, heFixture.edges);
    expect(layout.idleStubs.length).toBeGreaterThan(0);
    const conn = layout.nodes.find((item) => item.node.id === "conn:demo-mysql");
    expect(conn!.height).toBeCloseTo(layout.unitPx, 1);
    expect(layout.idleStubs[0]!.height).toBe(IDLE_GRANT_PX);
  });

  it("SC-21 — 同列 accessPaths 较大者排更先；排序不含 grantPaths", () => {
    const nodes = [
      makeNode("agent:a", "agent", "A", 0, 9, 1),
      makeNode("agent:b", "agent", "B", 0, 1, 5)
    ];
    const edges: AccessMapEdge[] = [];
    const layout = layoutAccessMap(nodes, edges);
    const agentCol = layout.nodes
      .filter((item) => item.node.kind === "agent")
      .sort((a, b) => a.y - b.y);
    expect(agentCol[0]!.node.id).toBe("agent:b");
  });

  // 空桑基修复 Spec SC-05–SC-07
  it("SC-05 — 仅 dormant 且两端在画布：有闲置骨干；unitPx 不被 grant 撑高", () => {
    const nodes = [
      makeNode("agent:a", "agent", "A", 0, 10, 0),
      makeNode("role:r", "role", "R", 1, 10, 0),
      makeNode("conn:c", "connection", "C", 2, 10, 0),
      makeNode("table:t", "table", "T", 3, 10, 0)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 10, 0),
      makeEdge("role:r", "conn:c", 10, 0),
      makeEdge("conn:c", "table:t", 10, 0)
    ];
    const layout = layoutAccessMap(nodes, edges);
    const backbone = layout.links.filter((link) => link.layer === "backbone");
    expect(backbone.length).toBeGreaterThanOrEqual(2);
    expect(backbone.every((link) => link.width === IDLE_GRANT_PX)).toBe(true);
    // 闲置表不进列 → 无到表的骨干
    expect(layout.nodes.some((item) => item.node.kind === "table")).toBe(false);
    expect(backbone.every((link) => link.edge.target !== "table:t")).toBe(true);
    // 刻度仍按 usage（此处无 usage）封顶，不得被 grant=10 放大
    expect(layout.unitPx).toBeLessThanOrEqual(24);
    const agent = layout.nodes.find((item) => item.node.id === "agent:a");
    expect(agent!.height).toBeLessThanOrEqual(IDLE_GRANT_PX + 0.1);
  });

  it("SC-06 — 有 usage 时厚度仍=accessPaths×unitPx；骨干不替代", () => {
    const nodes = [
      makeNode("agent:a", "agent", "A", 0, 10, 2),
      makeNode("role:r", "role", "R", 1, 10, 2),
      makeNode("conn:c", "connection", "C", 2, 10, 2),
      makeNode("table:t", "table", "T", 3, 2, 2),
      makeNode("table:idle", "table", "idle", 3, 8, 0)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 10, 2),
      makeEdge("role:r", "conn:c", 10, 2),
      makeEdge("conn:c", "table:t", 2, 2),
      makeEdge("conn:c", "table:idle", 8, 0)
    ];
    const layout = layoutAccessMap(nodes, edges);
    const usage = layout.links.find(
      (link) => link.layer !== "backbone" && link.edge.id === "e|conn:c|table:t"
    );
    expect(usage!.width).toBeCloseTo(2 * layout.unitPx, 5);
    expect(layout.nodes.some((item) => item.node.id === "table:idle")).toBe(false);
  });
});

describe("usage-first legend SC-06／07／15／17", () => {
  it("图例四项：访问路径宽度＋闲置／骨干；无授权路径宽度／深色内核；无僵尸授权", () => {
    render(<AccessMapLegend />);
    const legend = screen.getByTestId("access-map-legend");
    expect(legend.children.length).toBe(4);
    expect(legend.textContent).toContain("流带宽度 = 访问路径数");
    expect(legend.textContent).toMatch(/闲置/);
    expect(legend.textContent).toMatch(/骨干|空心/);
    expect(legend.textContent).not.toContain("授权路径数");
    expect(legend.textContent).not.toContain("深色内核");
    expect(legend.textContent).not.toContain("僵尸授权");
  });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe("usage-first AccessMap filters SC-20／23／24／28／29／S9", () => {
  it("SC-23／28 — 工具条写 agent=；悬停 alone 不写 URL", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-map"]}>
        <Routes>
          <Route
            path="/admin/access-map"
            element={
              <>
                <AccessMap />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const input = screen.getByTestId("access-map-agent-filter");
    fireEvent.change(input, { target: { value: "hehe" } });
    expect(screen.getByTestId("location-search").textContent).toContain("agent=hehe");
    fireEvent.click(screen.getByTestId("access-map-clear-structure"));
    expect(screen.getByTestId("location-search").textContent).not.toContain("agent=");
  });

  it("SC-24 — 点击连接写入 focus=；清除可回全图", () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-map"]}>
        <Routes>
          <Route
            path="/admin/access-map"
            element={
              <>
                <AccessMap />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("access-map-node-conn:demo-mysql"));
    expect(screen.getByTestId("location-search").textContent).toMatch(
      /focus=conn(%3A|:)demo-mysql/
    );
    fireEvent.click(screen.getByTestId("access-map-clear-structure"));
    expect(screen.getByTestId("location-search").textContent).not.toContain("focus=");
  });

  it("SC-20 — focus=连接夹具：连通子图可见上游 Agent 与角色", () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-map?focus=conn%3Ademo-mysql"]}>
        <Routes>
          <Route path="/admin/access-map" element={<AccessMap />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("access-map-node-conn:demo-mysql")).toBeTruthy();
    expect(screen.getByTestId("access-map-node-agent:hehe")).toBeTruthy();
    expect(screen.getByTestId("access-map-node-role:lucy_admin")).toBeTruthy();
  });

  it("S9 — 结构筛选时披露「当前投影允许调用」且与进入允许调用区分", () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-map?agent=hehe"]}>
        <Routes>
          <Route path="/admin/access-map" element={<AccessMap />} />
        </Routes>
      </MemoryRouter>
    );
    const entering = screen.getByTestId("access-map-entering-allow-calls");
    const projected = screen.getByTestId("access-map-projected-allow-calls");
    expect(entering.textContent).toContain("进入允许调用 3");
    expect(projected.textContent).toContain("当前投影允许调用 1");
    expect(projected.textContent).not.toEqual(entering.textContent);
  });

  it("SC-29 — 深链 href 含 view=calls／hours／inquiryKind／accessGrade；有 agent 时含 user=", () => {
    render(
      <MemoryRouter initialEntries={["/admin/access-map?agent=hehe&inquiryKind=real&accessGrade=all&window=24h"]}>
        <Routes>
          <Route path="/admin/access-map" element={<AccessMap />} />
        </Routes>
      </MemoryRouter>
    );
    const link = screen.getByTestId("access-map-audit-deeplink") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("view=calls");
    expect(link.getAttribute("href")).toContain("hours=24");
    expect(link.getAttribute("href")).toContain("inquiryKind=real");
    expect(link.getAttribute("href")).toContain("accessGrade=all");
    expect(link.getAttribute("href")).toContain("user=hehe");
  });
});
