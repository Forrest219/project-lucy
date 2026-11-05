// @vitest-environment node
/**
 * 访问关系图**几何语言**的纯计算断言。
 *
 * Authority: `docs/specs/lucy-20261101-access-map-geometry-spec.md` v0.2
 *   §5.1  细柱（宽度常量、计量高度无地板）
 *   §5.2  labelBlock（首左 / 中上 / 末右）与强制避碰
 *   §5.3  刻度封顶、密度预算、稀疏占比
 *   §5.4  四态面积流带、按对端 y 分槽、计量与命中解耦
 *   §7    SC-01–SC-10（几何侧）
 *
 * 这些断言不需要 DOM，所以放在 node 环境里跑：直接对布局函数采样，不依赖渲染。
 * 组件侧断言（SC-05 / SC-07 / SC-11–SC-14）见 `access-map.test.tsx`。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCESS_MAP_CANVAS_MIN_HEIGHT,
  ACCESS_MAP_COLUMN_GAP,
  DENSE_BUDGET_H,
  MAX_PX_PER_PATH,
  MIN_HIT_PX,
  NODE_GAP,
  PILLAR_WIDTH,
  estimateTextWidth,
  layoutAccessMap,
  truncateLabel,
  type AccessMapLayout
} from "../components/admin/AccessMapCanvas";
import type { AccessMapEdge, AccessMapEdgeState, AccessMapNode } from "../components/admin/AccessMapTypes";

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

function makeNode(
  id: string,
  kind: AccessMapNode["kind"],
  label: string,
  depth: number,
  grantPaths: number,
  accessPaths?: number
): AccessMapNode {
  // usage-first：几何夹具默认访问路径=授权路径，否则画布不进使用节点。
  const access = accessPaths ?? grantPaths;
  return {
    id,
    kind,
    label,
    depth,
    meta: { grantPaths, grantUsers: 1, accessPaths: access, accessUsers: access > 0 ? 1 : 0 }
  };
}

function makeEdge(
  source: string,
  target: string,
  grantPaths: number,
  overrides: Partial<AccessMapEdge> = {}
): AccessMapEdge {
  const accessPaths = overrides.accessPaths ?? grantPaths;
  return {
    id: `e|${source}|${target}`,
    source,
    target,
    grantPaths,
    grantUsers: 1,
    accessPaths,
    accessUsers: accessPaths > 0 ? 1 : 0,
    accessCalls: accessPaths,
    state: (accessPaths === 0 ? "dormant" : "normal") as AccessMapEdgeState,
    confirmedUnauthorized: false,
    reviewEvaluations: [],
    snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
    ...overrides
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

function insideBox(point: Point, box: Box): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * `DEMO_SPARSE_9`（geometry Spec D12）：与当前 demo 同构的比例基线夹具。
 *
 * 3 个 Agent × 3 条路径；角色分流（两个 Agent 走 reader，一个走 writer）；
 * 1 个连接；3 张表。全部为 normal 态，图面里没有状态行。
 */
function demoSparse9(): { nodes: AccessMapNode[]; edges: AccessMapEdge[] } {
  const nodes: AccessMapNode[] = [
    makeNode("agent:a", "agent", "Agent A", 0, 3),
    makeNode("agent:b", "agent", "Agent B", 0, 3),
    makeNode("agent:c", "agent", "Agent C", 0, 3),
    makeNode("role:reader", "role", "role_reader", 1, 6),
    makeNode("role:writer", "role", "role_writer", 1, 3),
    makeNode("conn:mysql_main", "connection", "mysql_main", 2, 9),
    makeNode("table:t1", "table", "orders", 3, 3),
    makeNode("table:t2", "table", "customers", 3, 3),
    makeNode("table:t3", "table", "payments", 3, 3)
  ];
  const edges: AccessMapEdge[] = [
    makeEdge("agent:a", "role:reader", 3, { state: "normal" }),
    makeEdge("agent:b", "role:reader", 3, { state: "normal" }),
    makeEdge("agent:c", "role:writer", 3, { state: "normal" }),
    makeEdge("role:reader", "conn:mysql_main", 6, { state: "normal" }),
    makeEdge("role:writer", "conn:mysql_main", 3, { state: "normal" }),
    makeEdge("conn:mysql_main", "table:t1", 3, { state: "normal" }),
    makeEdge("conn:mysql_main", "table:t2", 3, { state: "normal" }),
    makeEdge("conn:mysql_main", "table:t3", 3, { state: "normal" })
  ];
  return { nodes, edges };
}

/** 一条边的「主面积」：授权面积（normal/dormant/overflow）或需复核的独立警示面积。 */
function mainBand(layout: AccessMapLayout, edgeId: string) {
  return layout.links.find((link) => link.edge.id === edgeId)?.band ?? null;
}

describe("访问关系图几何语言（geometry Spec §5）", () => {
  it("SC-01 — 导出 PILLAR_WIDTH ∈ [12,20]；流节点布局宽等于该常量，且不再是 168 的定宽卡片", () => {
    expect(PILLAR_WIDTH).toBeGreaterThanOrEqual(12);
    expect(PILLAR_WIDTH).toBeLessThanOrEqual(20);
    expect(PILLAR_WIDTH).not.toBe(168);

    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.nodes.length).toBe(9);
    for (const item of layout.nodes) {
      expect(item.width).toBe(PILLAR_WIDTH);
      expect(item.width).not.toBe(168);
    }
  });

  it("SC-02 — labelBlock 完整（名称 + 副标题 + 状态）；首列在柱左、末列在柱右、中间列在柱上方", () => {
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));

    const first = byId.get("agent:a");
    const middle = byId.get("role:reader");
    const last = byId.get("table:t1");
    expect(first).toBeDefined();
    expect(middle).toBeDefined();
    expect(last).toBeDefined();

    // 首列：整块在柱左，右缘距柱左 ≥ 6px。
    expect(first!.labelBlock.x + first!.labelBlock.width).toBeLessThanOrEqual(first!.x - 6);
    // 末列：整块在柱右，左缘距柱右 ≥ 6px。
    expect(last!.labelBlock.x).toBeGreaterThanOrEqual(last!.x + last!.width + 6);
    // 中间列：整块在柱上方（底缘不越过柱顶）。
    expect(middle!.labelBlock.y + middle!.labelBlock.height).toBeLessThanOrEqual(middle!.y + 0.001);

    // 名称、副标题、状态行都存在。
    expect(first!.labelBlock.name).toBe("Agent A");
    expect(first!.labelBlock.subtitle).toMatch(/路径/);
    expect(first!.labelBlock.status).toBeNull();

    // 有异常边的节点带状态行。
    const withDormant = layoutAccessMap(
      [
        makeNode("agent:a", "agent", "Agent A", 0, 2),
        makeNode("table:t", "table", "orders", 1, 2)
      ],
      [makeEdge("agent:a", "table:t", 2, { state: "dormant" })]
    );
    const stateful = withDormant.nodes.find((item) => item.labelBlock.status !== null);
    expect(stateful?.labelBlock.status).toBe("闲置授权");
    expect(stateful?.labelBlock.statusState).toBe("dormant");
  });

  it("SC-03 — 导出 MAX_PX_PER_PATH === 24；布局 unitPx ≤ 24（无刻度抬升）", () => {
    expect(MAX_PX_PER_PATH).toBe(24);
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.unitPx).toBeLessThanOrEqual(MAX_PX_PER_PATH);
    expect(layout.unitPx).toBeGreaterThan(0);
  });

  it("SC-04 — DEMO_SPARSE_9 的 contentHeight ∈ [280, 420]，且显著小于「无封顶撑满预算」的对照高度", () => {
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.contentHeight).toBeGreaterThanOrEqual(280);
    expect(layout.contentHeight).toBeLessThanOrEqual(420);

    // 对照：把刻度封顶放开，预算会撑满，图形被放大成「粉肉块」。
    const uncapped = layoutAccessMap(nodes, edges, { maxPxPerPath: 100000 });
    expect(uncapped.unitPx).toBeGreaterThan(MAX_PX_PER_PATH);
    expect(uncapped.contentHeight).toBeGreaterThan(DENSE_BUDGET_H - 60);
    expect(uncapped.contentHeight).toBeGreaterThan(layout.contentHeight * 1.4);
  });

  it("SC-05 — 主视觉是填充面积 path，不是「单 path + 超粗 stroke」", () => {
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    const band = mainBand(layout, "e|conn:mysql_main|table:t1");
    expect(band).not.toBeNull();
    // 面积 path 是闭合的填充区域。
    expect(band!.path.startsWith("M")).toBe(true);
    expect(band!.path.trim().endsWith("Z")).toBe(true);
    // 厚度是计量值，不是节点高。
    const node = layout.nodes.find((item) => item.node.id === "conn:mysql_main");
    expect(band!.thickness).toBeCloseTo(3 * layout.unitPx, 5);
    expect(band!.thickness).toBeLessThan(node!.height);
    // 上缘 / 下缘采样可用（避碰自检的事实源）。
    expect(band!.upper.length).toBeGreaterThan(4);
    expect(band!.lower.length).toBeGreaterThan(4);
  });

  it("SC-06 — 计量厚度 = accessPaths × unitPx；访问路径加倍则厚度加倍（无命中地板介入）", () => {
    const nodes = [
      makeNode("agent:a", "agent", "Agent A", 0, 4, 4),
      makeNode("role:r", "role", "role_reader", 1, 4, 4),
      makeNode("conn:c", "connection", "mysql_main", 2, 4, 4),
      makeNode("table:t1", "table", "orders", 3, 4, 4),
      makeNode("table:t2", "table", "payments", 3, 2, 2)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 4, { state: "normal", accessPaths: 4 }),
      makeEdge("role:r", "conn:c", 4, { state: "normal", accessPaths: 4 }),
      makeEdge("conn:c", "table:t1", 4, { state: "normal", accessPaths: 4 }),
      makeEdge("conn:c", "table:t2", 2, { state: "normal", accessPaths: 2 })
    ];
    const layout = layoutAccessMap(nodes, edges);
    const thick = mainBand(layout, "e|conn:c|table:t1");
    const thin = mainBand(layout, "e|conn:c|table:t2");
    expect(thick).not.toBeNull();
    expect(thin).not.toBeNull();
    expect(thick!.thickness).toBeCloseTo(2 * thin!.thickness, 1);
    expect(thick!.thickness).toBeCloseTo(4 * layout.unitPx, 5);
    // 命中地板不进计量。
    expect(MIN_HIT_PX).toBe(8);
    expect(thin!.thickness).toBeCloseTo(2 * layout.unitPx, 5);
  });

  it("SC-07 — usage-first 四态：normal／overflow／needs_review 主厚度=accessPaths；dormant 不进流带；无深色内核", () => {
    const nodes = [
      makeNode("agent:a", "agent", "Agent A", 0, 4, 4),
      makeNode("role:r", "role", "role_reader", 1, 4, 4),
      makeNode("conn:c", "connection", "mysql_main", 2, 4, 4),
      makeNode("table:t1", "table", "orders", 3, 4, 2),
      makeNode("table:t2", "table", "payments", 3, 4, 0),
      makeNode("table:t3", "table", "ledger", 3, 0, 2)
    ];
    const edges = [
      makeEdge("agent:a", "role:r", 4, { state: "normal", accessPaths: 4 }),
      makeEdge("role:r", "conn:c", 4, { state: "normal", accessPaths: 4 }),
      makeEdge("conn:c", "table:t1", 4, { state: "normal", accessPaths: 2, accessUsers: 1, accessCalls: 5 }),
      makeEdge("conn:c", "table:t2", 4, { state: "dormant", accessPaths: 0 }),
      makeEdge("conn:c", "table:t3", 0, {
        state: "needs_review",
        accessPaths: 2,
        accessUsers: 1,
        accessCalls: 3
      })
    ];
    const layout = layoutAccessMap(nodes, edges);

    const normal = layout.links.find((link) => link.edge.id === "e|conn:c|table:t1");
    expect(normal?.band?.kind).toBe("grant");
    expect(normal?.kernel).toBeNull();
    expect(normal!.band!.thickness).toBeCloseTo(2 * layout.unitPx, 5);

    const dormant = layout.links.find((link) => link.edge.id === "e|conn:c|table:t2");
    expect(dormant).toBeUndefined();
    expect(layout.idleStubs.length).toBeGreaterThan(0);

    const review = layout.links.find((link) => link.edge.id === "e|conn:c|table:t3");
    expect(review?.band?.kind).toBe("review");
    expect(review?.midlinePath).toBeTruthy();
    expect(review!.band!.thickness).toBeCloseTo(2 * layout.unitPx, 5);

    const overflowNodes = [
      makeNode("agent:a", "agent", "Agent A", 0, 2, 4),
      makeNode("role:r", "role", "role_reader", 1, 2, 4),
      makeNode("conn:c", "connection", "mysql_main", 2, 2, 4),
      makeNode("table:t1", "table", "orders", 3, 2, 4)
    ];
    const overflowLayout = layoutAccessMap(overflowNodes, [
      makeEdge("agent:a", "role:r", 2, { state: "normal", accessPaths: 4 }),
      makeEdge("role:r", "conn:c", 2, { state: "normal", accessPaths: 4 }),
      makeEdge("conn:c", "table:t1", 2, {
        state: "overflow",
        accessPaths: 4,
        accessUsers: 1,
        accessCalls: 9
      })
    ]);
    const overflow = overflowLayout.links.find((link) => link.edge.id === "e|conn:c|table:t1");
    expect(overflow?.kernel).toBeNull();
    expect(overflow!.band!.thickness).toBeCloseTo(4 * overflowLayout.unitPx, 5);
    expect(overflow?.outlinePath).toBeTruthy();
  });

  it("SC-08 — 同柱入 / 出槽位不重叠、不越柱；出边按目标 y、入边按源 y 排序", () => {
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));

    for (const node of layout.nodes) {
      const outgoing = layout.links.filter((link) => link.edge.source === node.node.id);
      const incoming = layout.links.filter((link) => link.edge.target === node.node.id);

      for (const group of [outgoing, incoming]) {
        // 不越柱：槽位整体落在柱体内。
        for (const link of group) {
          const slot = group === outgoing ? link.sourceSlot : link.targetSlot;
          expect(slot.top).toBeGreaterThanOrEqual(-0.001);
          expect(slot.top + slot.height).toBeLessThanOrEqual(node.height + 0.001);
        }
        // 不重叠：按槽位起点排序后互不相接。
        const sorted = [...group].sort((a, b) => {
          const sa = group === outgoing ? a.sourceSlot : a.targetSlot;
          const sb = group === outgoing ? b.sourceSlot : b.targetSlot;
          return sa.top - sb.top;
        });
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = group === outgoing ? sorted[i - 1].sourceSlot : sorted[i - 1].targetSlot;
          const cur = group === outgoing ? sorted[i].sourceSlot : sorted[i].targetSlot;
          expect(cur.top).toBeGreaterThanOrEqual(prev.top + prev.height - 0.001);
        }
      }

      // 出边按目标节点 y（再 id）排序；入边按源节点 y（再 id）排序。
      const outOrder = outgoing
        .slice()
        .sort((a, b) => a.sourceSlot.top - b.sourceSlot.top)
        .map((link) => {
          const target = byId.get(link.edge.target);
          return { y: target?.y ?? 0, id: link.edge.target };
        });
      for (let i = 1; i < outOrder.length; i += 1) {
        const prev = outOrder[i - 1];
        const cur = outOrder[i];
        expect(cur.y > prev.y || (cur.y === prev.y && cur.id > prev.id)).toBe(true);
      }
      const inOrder = incoming
        .slice()
        .sort((a, b) => a.targetSlot.top - b.targetSlot.top)
        .map((link) => {
          const source = byId.get(link.edge.source);
          return { y: source?.y ?? 0, id: link.edge.source };
        });
      for (let i = 1; i < inOrder.length; i += 1) {
        const prev = inOrder[i - 1];
        const cur = inOrder[i];
        expect(cur.y > prev.y || (cur.y === prev.y && cur.id > prev.id)).toBe(true);
      }
    }
  });

  it("SC-09 — labelBlock 互不重叠，且不与任一面积带的上下缘采样相交", () => {
    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);

    // ① 标签块之间互不重叠。
    const blocks = layout.nodes.map((item) => item.labelBlock);
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        expect(boxesOverlap(blocks[i], blocks[j])).toBe(false);
      }
    }

    // ② 标签块不与面积带的上下缘采样相交（含带的上缘与下缘，不只中线）。
    for (const block of blocks) {
      for (const link of layout.links) {
        const samples = [
          ...(link.band ? [...link.band.upper, ...link.band.lower] : []),
          ...(link.kernel ? [...link.kernel.upper, ...link.kernel.lower] : [])
        ];
        for (const point of samples) {
          expect(insideBox(point, block)).toBe(false);
        }
      }
    }
  });

  it("SC-10 — 列间距常量 > 240；稀疏图暴露居中 / 缩槽策略钩子", () => {
    expect(ACCESS_MAP_COLUMN_GAP).toBeGreaterThan(240);
    expect(NODE_GAP).toBeGreaterThanOrEqual(12);

    const { nodes, edges } = demoSparse9();
    const layout = layoutAccessMap(nodes, edges);
    expect(layout.columns.length).toBe(4);
    expect(layout.columns[1].x - layout.columns[0].x).toBe(ACCESS_MAP_COLUMN_GAP);

    // 极稀疏图（一条 1 路径边）被标记为稀疏：图面不撑满槽位，改为垂直居中。
    const sparse = layoutAccessMap(
      [makeNode("agent:a", "agent", "Agent A", 0, 1), makeNode("table:t", "table", "orders", 1, 1)],
      [makeEdge("agent:a", "table:t", 1, { state: "normal" })]
    );
    expect(sparse.sparse).toBe(true);
    expect(sparse.contentHeight).toBeLessThan(sparse.slotReferenceHeight * 0.65);

    // 主图容器仍保留视口相关的最小高度策略（chart-first 合同不变）。
    expect(ACCESS_MAP_CANVAS_MIN_HEIGHT).toMatch(/clamp\(/);
    expect(ACCESS_MAP_CANVAS_MIN_HEIGHT).toContain("vh");
  });
});

describe("访问关系图源码的色值约束（SC-14）", () => {
  const adminDir = fileURLToPath(new URL("../components/admin/", import.meta.url));
  const pageFile = fileURLToPath(new URL("../pages/admin/AccessMap.tsx", import.meta.url));

  const files = [
    ...readdirSync(adminDir)
      .filter((name) => name.startsWith("AccessMap") && name.endsWith(".tsx"))
      .map((name) => `${adminDir}${name}`),
    pageFile
  ];

  it("SC-14 — AccessMap*.tsx 里没有裸十六进制颜色", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const matches = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect({ file: file.split("/").pop(), matches }).toEqual({ file: file.split("/").pop(), matches: [] });
    }
  });
});

/**
 * Spec 20261104 页壳源码合同（SC-01–SC-03、SC-16）：不挂载凭证清单／折叠口径／SignalNotes；
 * 无「桑基图」页标题；表组件换成小时明细列。
 */
describe("访问关系图小时明细页壳源码（Spec 20261104）", () => {
  const pageFile = fileURLToPath(new URL("../pages/admin/AccessMap.tsx", import.meta.url));
  const tableFile = fileURLToPath(new URL("../components/admin/AccessMapTable.tsx", import.meta.url));
  const typesFile = fileURLToPath(new URL("../components/admin/AccessMapTypes.tsx", import.meta.url));

  it("SC-01／SC-02／SC-03 — AccessMap 页不挂载 CredentialList／SignalNotes／methodology details", () => {
    const source = readFileSync(pageFile, "utf-8");
    expect(source).not.toMatch(/AccessMapCredentialList/);
    expect(source).not.toMatch(/AccessMapSignalNotes/);
    expect(source).not.toMatch(/access-map-methodology-snapshot/);
    expect(source).not.toMatch(/<details/);
    expect(source).toMatch(/access-map-window-range/);
    expect(source).toMatch(/access-map-snapshot-coverage/);
    expect(source).toMatch(/access-map-resident-line/);
  });

  it("SC-05／SC-06 — AccessMapTable 为小时明细列，inquiryKind null → 无关联", () => {
    const source = readFileSync(tableFile, "utf-8");
    expect(source).toMatch(/access-map-hourly-detail/);
    expect(source).toMatch(/小时/);
    expect(source).toMatch(/允许调用/);
    expect(source).toMatch(/拒绝调用/);
    expect(source).not.toMatch(/access-map-table-nodes/);
    expect(source).not.toMatch(/>节点</);
    expect(source).not.toMatch(/>关系</);
    expect(source).toMatch(/无关联/);
  });

  it("SC-16 — 页标题不含桑基图；类型含 detail／hasMore／inquiryKind null", () => {
    const page = readFileSync(pageFile, "utf-8");
    const types = readFileSync(typesFile, "utf-8");
    expect(page).toMatch(/title="访问关系图"/);
    expect(page).not.toMatch(/桑基图/);
    expect(types).toMatch(/AccessMapHourlyDetail/);
    expect(types).toMatch(/hasMore/);
    expect(types).toMatch(/inquiryKind: AccessMapDetailInquiryKind \| null/);
  });
});


describe("文字宽度估算与省略（既有能力，保持）", () => {
  it("超长名称的省略不吞掉整个名字", () => {
    expect(truncateLabel("orders", 148, 12)).toBe("orders");
    expect(truncateLabel("", 148, 12)).toBe("");
    const cut = truncateLabel("x".repeat(200), 148, 12);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThan(200);
  });

  it("宽度估算随字号变化", () => {
    expect(estimateTextWidth("orders", 12)).toBeGreaterThan(estimateTextWidth("orders", 10));
  });
});
