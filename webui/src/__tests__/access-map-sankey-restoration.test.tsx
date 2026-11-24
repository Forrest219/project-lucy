/**
 * Spec lucy-20261117-access-map-sankey-restoration — 前端 SC-A2／A3／A6／B1–B6（D0＝C）。
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  AccessMapCanvas,
  GHOST_MAX,
  GHOST_MIN,
  UNIT_MIN,
  layoutAccessMap
} from "../components/admin/AccessMapCanvas";
import { AccessMapLegend } from "../components/admin/AccessMapLegend";
import type { AccessMapEdge, AccessMapNode } from "../components/admin/AccessMapTypes";

function node(
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
    meta: { grantPaths, grantUsers: 1, accessPaths, accessUsers: accessPaths > 0 ? 1 : 0 }
  };
}

function edge(source: string, target: string, grantPaths: number, accessPaths = 0): AccessMapEdge {
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
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 }
  };
}

/** N 个 Agent 各 1 条访问路径，共用 role→conn→table。 */
function manyAgents(count: number) {
  const nodes: AccessMapNode[] = [
    node("role:r", "role", "R", 1, count, count),
    node("conn:c", "connection", "C", 2, count, count),
    node("table:t", "table", "T", 3, count, count)
  ];
  const edges: AccessMapEdge[] = [edge("role:r", "conn:c", count, count), edge("conn:c", "table:t", count, count)];
  for (let i = 0; i < count; i += 1) {
    const id = `agent:a${String(i).padStart(3, "0")}`;
    nodes.push(node(id, "agent", `A${i}`, 0, 1, 1));
    edges.push(edge(id, "role:r", 1, 1));
  }
  return { nodes, edges };
}

/** 1 个连接，usage 表 1 张（orders），闲置表 idleCount 张。 */
function idleFixture(idleCount: number) {
  const nodes: AccessMapNode[] = [
    node("agent:a", "agent", "A", 0, 1 + idleCount, 1),
    node("role:r", "role", "R", 1, 1 + idleCount, 1),
    node("conn:c", "connection", "C", 2, 1 + idleCount, 1),
    node("table:orders", "table", "orders", 3, 1, 1)
  ];
  const edges: AccessMapEdge[] = [
    edge("agent:a", "role:r", 1 + idleCount, 1),
    edge("role:r", "conn:c", 1 + idleCount, 1),
    edge("conn:c", "table:orders", 1, 1)
  ];
  for (let i = 0; i < idleCount; i += 1) {
    const id = `table:idle_${String(i).padStart(3, "0")}`;
    nodes.push(node(id, "table", `idle_${i}`, 3, 1, 0));
    edges.push(edge("conn:c", id, 1, 0));
  }
  return { nodes, edges };
}

/** 零访问：2 个连接，各若干闲置表。 */
function grantsOnly() {
  const nodes: AccessMapNode[] = [
    node("agent:a", "agent", "A", 0, 8, 0),
    node("role:r", "role", "R", 1, 8, 0),
    node("conn:c1", "connection", "C1", 2, 5, 0),
    node("conn:c2", "connection", "C2", 2, 3, 0)
  ];
  const edges: AccessMapEdge[] = [
    edge("agent:a", "role:r", 8, 0),
    edge("role:r", "conn:c1", 5, 0),
    edge("role:r", "conn:c2", 3, 0)
  ];
  for (let i = 0; i < 5; i += 1) {
    nodes.push(node(`table:c1_${i}`, "table", `c1_${i}`, 3, 1, 0));
    edges.push(edge("conn:c1", `table:c1_${i}`, 1, 0));
  }
  for (let i = 0; i < 3; i += 1) {
    nodes.push(node(`table:c2_${i}`, "table", `c2_${i}`, 3, 1, 0));
    edges.push(edge("conn:c2", `table:c2_${i}`, 1, 0));
  }
  return { nodes, edges };
}

function usageThicknesses(layout: ReturnType<typeof layoutAccessMap>): Record<string, number> {
  return Object.fromEntries(
    layout.links.filter((link) => link.layer === "usage").map((link) => [link.edge.id, link.width])
  );
}

describe("SC-A3 — 刻度下限与单调增高", () => {
  it("UNIT_MIN 为 2px", () => {
    expect(UNIT_MIN).toBe(2);
  });

  it("N＝1…80 个活跃 Agent：unitPx ≥ UNIT_MIN；每个使用节点柱高 > 0；contentHeight 单调不减", () => {
    let previousHeight = 0;
    for (let n = 1; n <= 80; n += 1) {
      const { nodes, edges } = manyAgents(n);
      const layout = layoutAccessMap(nodes, edges);
      expect(layout.unitPx, `N=${n}`).toBeGreaterThanOrEqual(UNIT_MIN);
      const usageNodes = layout.nodes.filter((item) => (item.node.meta.accessPaths ?? 0) > 0);
      for (const item of usageNodes) {
        expect(item.height, `N=${n} ${item.node.id}`).toBeGreaterThanOrEqual(UNIT_MIN - 1e-9);
      }
      for (const link of layout.links.filter((l) => l.layer === "usage")) {
        expect(link.width, `N=${n} ${link.edge.id}`).toBeGreaterThanOrEqual(UNIT_MIN - 1e-9);
      }
      expect(layout.contentHeight, `N=${n}`).toBeGreaterThanOrEqual(previousHeight - 1e-6);
      previousHeight = layout.contentHeight;
    }
  });

  it("42 个 Agent（真实塌缩场景）：没有零高使用柱", () => {
    const { nodes, edges } = manyAgents(42);
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.nodes.filter((item) => item.height <= 0.05 && (item.node.meta.accessPaths ?? 0) > 0)).toHaveLength(0);
    expect(layout.contentHeight).toBeGreaterThan(640);
  });
});

describe("D0＝C — 闲置授权聚合节点与幽灵层", () => {
  it("SC-B1 零访问：表列只有每连接 1 个聚合节点；每个聚合节点有一条厚度 ∈[GHOST_MIN,GHOST_MAX] 的幽灵带", () => {
    const { nodes, edges } = grantsOnly();
    const layout = layoutAccessMap(nodes, edges);
    const tableColumn = layout.nodes.filter((item) => item.node.kind === "table");
    expect(tableColumn).toHaveLength(2);
    const labels = tableColumn.map((item) => item.node.label).sort();
    expect(labels).toEqual(["闲置授权 · 3 张表", "闲置授权 · 5 张表"]);
    for (const item of tableColumn) {
      const incoming = layout.links.filter(
        (link) => link.layer === "ghost" && link.edge.target === item.node.id
      );
      expect(incoming, item.node.label).toHaveLength(1);
      expect(incoming[0]!.width).toBeGreaterThanOrEqual(GHOST_MIN);
      expect(incoming[0]!.width).toBeLessThanOrEqual(GHOST_MAX);
    }
    // 没有任何使用流带
    expect(layout.links.filter((link) => link.layer === "usage")).toHaveLength(0);
  });

  it("SC-B1 幽灵带厚度：1 条授权取下限，海量授权取上限", () => {
    const small = layoutAccessMap(...(Object.values(idleFixture(1)) as [AccessMapNode[], AccessMapEdge[]]));
    const aggSmall = small.links.find(
      (link) => link.layer === "ghost" && link.edge.target.startsWith("idle-agg:")
    );
    expect(aggSmall!.width).toBe(GHOST_MIN);
    const big = layoutAccessMap(...(Object.values(idleFixture(300)) as [AccessMapNode[], AccessMapEdge[]]));
    const aggBig = big.links.find(
      (link) => link.layer === "ghost" && link.edge.target.startsWith("idle-agg:")
    );
    expect(aggBig!.width).toBe(GHOST_MAX);
  });

  it("SC-B2 聚合 k 只数该连接内「无任何访问路径」的表；有访问的表仍按使用节点进列", () => {
    const { nodes, edges } = idleFixture(7);
    const layout = layoutAccessMap(nodes, edges);
    const tables = layout.nodes.filter((item) => item.node.kind === "table");
    expect(tables.map((item) => item.node.label).sort()).toEqual(["orders", "闲置授权 · 7 张表"]);
    const aggregate = tables.find((item) => item.node.id.startsWith("idle-agg:"));
    expect(aggregate!.node.meta.idleTableIds).toHaveLength(7);
  });

  it("SC-B2 聚合按 census 计数：渲染图里闲置表已被折叠时，k 仍是全量闲置表数", () => {
    const full = idleFixture(7);
    const foldedRender = {
      nodes: full.nodes.filter((item) => !item.id.startsWith("table:idle_")),
      edges: full.edges.filter((item) => !item.target.startsWith("table:idle_"))
    };
    const layout = layoutAccessMap(foldedRender.nodes, foldedRender.edges, {
      census: { nodes: full.nodes, edges: full.edges }
    });
    const labels = layout.nodes.filter((item) => item.node.kind === "table").map((item) => item.node.label);
    expect(labels).toContain("闲置授权 · 7 张表");
  });

  it("SC-B3 闲置表 1→100：使用带厚度、使用柱高、刻度全部不变", () => {
    const base = layoutAccessMap(idleFixture(1).nodes, idleFixture(1).edges);
    const many = layoutAccessMap(idleFixture(100).nodes, idleFixture(100).edges);
    expect(many.unitPx).toBe(base.unitPx);
    expect(usageThicknesses(many)).toEqual(usageThicknesses(base));
    const usagePillars = (layout: typeof base) =>
      Object.fromEntries(
        layout.nodes.filter((item) => (item.node.meta.accessPaths ?? 0) > 0).map((item) => [item.node.id, item.height])
      );
    expect(usagePillars(many)).toEqual(usagePillars(base));
  });

  it("使用边上的授权余量画成幽灵带：同一条边既有使用带也有幽灵带，且幽灵带不进刻度", () => {
    const { nodes, edges } = idleFixture(10);
    const layout = layoutAccessMap(nodes, edges);
    const usage = layout.links.find((l) => l.layer === "usage" && l.edge.id === "e|agent:a|role:r");
    const ghost = layout.links.find((l) => l.layer === "ghost" && l.edge.id === "e|agent:a|role:r");
    expect(usage).toBeDefined();
    expect(ghost).toBeDefined();
    expect(usage!.width).toBeCloseTo(1 * layout.unitPx, 5);
    // 余量 10 条 × 0.5 → 5，低于下限，取 GHOST_MIN
    expect(ghost!.width).toBe(GHOST_MIN);
  });

  it("纯闲置端点的 Agent 仍在画布上，有授权余量的幽灵带，不是零高发丝", () => {
    const { nodes, edges } = grantsOnly();
    const layout = layoutAccessMap(nodes, edges);
    const agent = layout.nodes.find((item) => item.node.id === "agent:a");
    expect(agent).toBeDefined();
    expect(agent!.ghostHeight).toBeGreaterThanOrEqual(GHOST_MIN);
  });

  it("访问面不可用时不声称「闲置」：没有聚合节点", () => {
    const { nodes, edges } = grantsOnly();
    const layout = layoutAccessMap(nodes, edges, { accessOk: false });
    expect(layout.nodes.some((item) => item.node.id.startsWith("idle-agg:"))).toBe(false);
    expect(layout.nodes.some((item) => item.node.kind === "table")).toBe(false);
  });
});

describe("D0＝C — 图例与交互（SC-B4／B5／B6）", () => {
  it("SC-B4 图例恰四项，第 2 项为幽灵层文案，不含「流带宽度 = 授权路径数」", () => {
    render(<AccessMapLegend />);
    const legend = screen.getByTestId("access-map-legend");
    expect(legend.children.length).toBe(4);
    expect(legend.children[1]!.textContent).toContain(
      "虚线轮廓 = 闲置授权（示意宽度，封顶，不与实心带同尺度）"
    );
    expect(legend.textContent).not.toContain("流带宽度 = 授权路径数");
    expect(legend.textContent).toContain("流带宽度 = 访问路径数");
  });

  function renderCanvas(idleCount = 3) {
    const full = idleFixture(idleCount);
    const rendered = {
      nodes: full.nodes.filter((item) => !item.id.startsWith("table:idle_")),
      edges: full.edges.filter((item) => !item.target.startsWith("table:idle_"))
    };
    render(
      <MemoryRouter>
        <AccessMapCanvas
          nodes={rendered.nodes}
          edges={rendered.edges}
          censusNodes={full.nodes}
          censusEdges={full.edges}
          summary="测试"
        />
      </MemoryRouter>
    );
    return full;
  }

  it("SC-B5 点击聚合节点打开闲置清单，行数＝k；点行打开该表的边抽屉", () => {
    renderCanvas(3);
    fireEvent.click(screen.getByTestId("access-map-node-idle-agg:conn:c"));
    const list = screen.getByTestId("access-map-idle-grant-list");
    const rows = within(list).getAllByTestId(/^access-map-idle-grant-row-/);
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[0]!);
    expect(screen.getByTestId("access-map-edge-drawer")).toBeTruthy();
    expect(screen.getByTestId("access-map-edge-detail").textContent).toContain("table:idle_000");
  });

  it("SC-B6 幽灵带悬停：写「调用 0 次」，不写使用带的调用次数", () => {
    renderCanvas(3);
    // agent→role 边有 1 次使用，幽灵带是它的授权余量
    const ghost = screen.getByTestId("access-map-ghost-e|agent:a|role:r");
    fireEvent.mouseEnter(ghost.closest("g")!);
    const tip = screen.getByTestId("access-map-hover-tip");
    expect(tip.textContent).toContain("调用 0 次");
    expect(tip.textContent).not.toMatch(/调用 [1-9]\d* 次/);
  });

  it("聚合节点悬浮标题不冒充 Agent 计数", () => {
    renderCanvas(3);
    const title = screen
      .getByTestId("access-map-node-idle-agg:conn:c")
      .querySelector("title")!.textContent!;
    expect(title).toContain("闲置授权 · 3 张表");
    expect(title).not.toContain("个 Agent");
  });
});
