// @vitest-environment node
/**
 * 访问关系图布局与呈现的**纯计算**断言。
 *
 * Authority: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`
 *   §5.4  节点名称完整落在卡片内；流带只画在列与列之间
 *   §7    SC-07（文字盒与流带通道不相交）、SC-15（页面源码无新增裸十六进制颜色）
 *
 * 这两个断言不需要 DOM，所以放在 node 环境里跑：
 *   - SC-07 的几何自检直接对布局函数采样，不依赖渲染。
 *   - SC-15 直接扫源码，不依赖页面渲染。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  estimateTextWidth,
  layoutAccessMap,
  truncateLabel
} from "../components/admin/AccessMapCanvas";
import type { AccessMapEdge, AccessMapNode } from "../components/admin/AccessMapTypes";

type Point = { x: number; y: number };

function makeNode(
  id: string,
  kind: AccessMapNode["kind"],
  label: string,
  depth: number,
  grantPaths: number
): AccessMapNode {
  return {
    id,
    kind,
    label,
    depth,
    meta: { grantPaths, grantUsers: 1, accessPaths: 0, accessUsers: 0 }
  };
}

function makeEdge(source: string, target: string, grantPaths: number): AccessMapEdge {
  return {
    id: `e|${source}|${target}`,
    source,
    target,
    grantPaths,
    grantUsers: 1,
    accessPaths: 0,
    accessUsers: 0,
    accessCalls: 0,
    state: "dormant",
    confirmedUnauthorized: false,
    reviewEvaluations: [],
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 }
  };
}

function cubicAt(points: [Point, Point, Point, Point], t: number): Point {
  const [p0, p1, p2, p3] = points;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  };
}

function insideBox(point: Point, box: { x: number; y: number; width: number; height: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

describe("访问关系图布局（呈现修订 §5.4）", () => {
  const nodes: AccessMapNode[] = [
    makeNode("agent:a1", "agent", "Agent A", 0, 3),
    makeNode("role:r1", "role", "role_reader", 1, 3),
    makeNode("conn:c1", "connection", "mysql_main", 2, 3),
    makeNode("table:c1::s::t1", "table", "orders", 3, 3),
    makeNode(
      "table:c1::s::a_very_very_very_long_table_name",
      "table",
      "a_very_very_very_long_table_name",
      3,
      1
    )
  ];
  const edges: AccessMapEdge[] = [
    makeEdge("agent:a1", "role:r1", 3),
    makeEdge("role:r1", "conn:c1", 3),
    makeEdge("conn:c1", "table:c1::s::t1", 2),
    makeEdge("conn:c1", "table:c1::s::a_very_very_very_long_table_name", 1)
  ];

  it("SC-07 — 任一节点名称文字盒都不与任一流带通道相交", () => {
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.nodes.length).toBeGreaterThan(0);
    expect(layout.links.length).toBeGreaterThan(0);

    for (const node of layout.nodes) {
      for (const link of layout.links) {
        for (let step = 0; step <= 64; step += 1) {
          const point = cubicAt(link.points, step / 64);
          expect(insideBox(point, node.labelBox)).toBe(false);
        }
      }
    }
  });

  it("SC-07 — 流带只画在列与列之间，不压到任何卡片上", () => {
    const layout = layoutAccessMap(nodes, edges);
    const cardRight = new Map(layout.nodes.map((node) => [node.node.id, node.x + node.width]));
    const cardLeft = new Map(layout.nodes.map((node) => [node.node.id, node.x]));

    for (const link of layout.links) {
      const start = link.points[0].x;
      const end = link.points[3].x;
      // 起点 = 源卡片右缘，终点 = 目标卡片左缘。
      expect(start).toBe(cardRight.get(link.edge.source));
      expect(end).toBe(cardLeft.get(link.edge.target));
      // 流带通道里不夹着任何一张卡片。
      for (const node of layout.nodes) {
        const left = cardLeft.get(node.node.id) as number;
        const right = cardRight.get(node.node.id) as number;
        const overlaps = left < end && right > start;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("SC-07 — 超长名称在卡片内省略，但全名仍可从布局里取回", () => {
    const layout = layoutAccessMap(nodes, edges);
    const long = layout.nodes.find(
      (node) => node.node.id === "table:c1::s::a_very_very_very_long_table_name"
    );
    expect(long).toBeDefined();
    expect(long?.label).not.toBe(long?.node.label);
    expect(long?.label.endsWith("…")).toBe(true);
    expect(long?.node.label).toBe("a_very_very_very_long_table_name");
    // 省略后的宽度必须仍在卡片内。
    expect(estimateTextWidth(long?.label ?? "", 12)).toBeLessThanOrEqual(long?.labelBox.width + 0.001);
  });

  it("列标题按层给出中文层名", () => {
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.columns.map((column) => column.label)).toEqual([
      "Agent",
      "角色",
      "连接",
      "表"
    ]);
  });

  it("超长名称的省略不吞掉整个名字", () => {
    expect(truncateLabel("orders", 148, 12)).toBe("orders");
    expect(truncateLabel("", 148, 12)).toBe("");
    const cut = truncateLabel("x".repeat(200), 148, 12);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThan(200);
  });
});

describe("访问关系图源码的色值约束（SC-15）", () => {
  const adminDir = fileURLToPath(new URL("../components/admin/", import.meta.url));
  const pageFile = fileURLToPath(new URL("../pages/admin/AccessMap.tsx", import.meta.url));

  const files = [
    ...readdirSync(adminDir)
      .filter((name) => name.startsWith("AccessMap") && name.endsWith(".tsx"))
      .map((name) => `${adminDir}${name}`),
    pageFile
  ];

  it("SC-15 — AccessMap*.tsx 里没有裸十六进制颜色", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const matches = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect({ file: file.split("/").pop(), matches }).toEqual({ file: file.split("/").pop(), matches: [] });
    }
  });
});
