/**
 * Lucy v0.25 P1-3 — 访问关系图 SVG 画布。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.1  双层对照（授权面积 = 授权路径数；内核 = 访问路径数，起点对齐）
 *   §4.4  边状态与视觉表现
 *   §7.1  布局（分层从左到右；层内按出流权重降序、id 字典序）
 *   §7.2  节点与边交互（悬停高亮、点击下钻、悬停浮层、点击边看明细）
 *   §7.5  无障碍等价视图（aria 摘要 + 节点列表可聚焦跳转）
 *   §9    Design System（只用语义层 token，禁止裸 hex）
 *
 * 几何语言: `docs/specs/lucy-20261101-access-map-geometry-spec.md` v0.2
 *   §5.1  细柱（`PILLAR_WIDTH`）；计量柱高 = flow × unitPx，**没有高度地板**
 *   §5.2  `labelBlock`（名称 + 副标题 + 状态）；首列在柱左 / 中间列在柱上 / 末列在柱右
 *   §5.3  刻度封顶（`MAX_PX_PER_PATH = 24`）；密度预算；稀疏图居中而不是放大
 *   §5.4  四态面积流带；按对端 y 分槽；计量厚度与命中区解耦
 *   §5.5  列间距与横向滚动；§5.6 着色 token；§5.7 与 quiet-reading §5.3 的关系
 *
 * 前序呈现: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`
 *   §5.3  流带着色（僵尸授权流带回到中性；需复核 warning 虚线；确凿越权 danger 实线）
 *   §5.5  边明细进右侧抽屉；Esc 先关抽屉
 *   §5.7  图下清单视觉隐藏但仍可聚焦
 *
 * 布局是**自研**的轻量分层布局，不是 d3-sankey：
 * Spec §8.1 建议引入 `d3-sankey`，但实施计划的硬约束是「不新增运行时依赖」，
 * 两条约束冲突时以实施计划为准。因此这里用纯计算实现同样的语义：
 * 分层 → 层内稳定排序 → 计量柱高 → 刻度封顶 → 面积流带 → 内核。
 *
 * 颜色只用语义层 token：授权面积 `brand`、访问内核 `accent`；
 * 需复核用 `warning`、确凿越权用 `danger`；且**状态不只靠颜色区分**
 * （需复核为虚线中线、确凿越权为 danger 实线轮廓，并带文字状态行）。
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import {
  ACCESS_MAP_CONFIRMED_UNAUTHORIZED_HOVER_NOTE,
  ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CALLS,
  ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CONCLUSION,
  accessMapEdgeHoverConclusion,
  accessMapEdgeStateLabel,
  accessMapNodeKindLabel,
  accessMapNodeSubtitle,
  type AccessMapEdge,
  type AccessMapEdgeState,
  type AccessMapNode,
  type AccessMapNodeKind
} from "./AccessMapTypes";

/** 边悬停／title 的调用段：访问面可用才写真实次数。 */
function accessMapEdgeHoverCallsText(edge: AccessMapEdge, accessOk: boolean): string {
  if (!accessOk) return ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CALLS;
  return `调用 ${edge.accessCalls} 次`;
}

function accessMapEdgeHoverConclusionText(edge: AccessMapEdge, accessOk: boolean): string {
  if (!accessOk) return ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CONCLUSION;
  const base = accessMapEdgeHoverConclusion(edge.state);
  if (edge.confirmedUnauthorized) {
    return `${base}${ACCESS_MAP_CONFIRMED_UNAUTHORIZED_HOVER_NOTE}`;
  }
  return base;
}

function accessMapEdgeTitleText(
  edge: AccessMapEdge,
  accessOk: boolean,
  labelOf: (id: string) => string
): string {
  const relation = `${labelOf(edge.source)} → ${labelOf(edge.target)}`;
  const state = accessMapEdgeStateLabel(edge.state);
  const calls = accessMapEdgeHoverCallsText(edge, accessOk);
  return `${relation}：授权路径 ${edge.grantPaths} 条 · ${calls} · ${state}`;
}

/** 细柱宽度：取代旧的 168px 定宽卡片。 */
export const PILLAR_WIDTH = 16;
/** 单条路径的最大计量厚度（刻度封顶）。 */
export const MAX_PX_PER_PATH = 24;
/** 同柱相邻节点之间的最小间隔。 */
export const NODE_GAP = 16;
/** 透明命中区的最小厚度（**只用于命中**，不参与计量）。 */
export const MIN_HIT_PX = 8;
/**
 * 闲置授权端点示意厚度（usage-first Spec §5.4）。
 * 不进柱高／不进列密度；锁定稿值 ∈[2,4]。
 */
export const IDLE_GRANT_PX = 3;
/**
 * 列间距必须大于卡片宽度，否则流带通道会压到下一列的卡片上。
 *
 * chart-first Spec §5.6：列间距加大，让四栏流带的弧度可读。
 * 放不下时图区横向滚动（§5.4），不缩 SVG、不做窄屏重排。
 */
export const ACCESS_MAP_COLUMN_GAP = 300;
/**
 * 图区主容器的最小高度策略（chart-first Spec §5.6）。
 *
 * 图区要**显著高于**工具条 + 图例占用的那一小条，否则读者第一眼看到的还是
 * 「上面有一堆控件，下面才是图」。用视口高度的比例表达，比写死像素更贴近
 * 「剩余视口高度」的真实意图；同时给上下限，避免超矮视口被撑爆、
 * 超高视口把图区拉成一大片空白。上限 720px 与图面自身高度同量级。
 */
export const ACCESS_MAP_CANVAS_MIN_HEIGHT = "clamp(420px, 58vh, 720px)";
/** 密度预算高度：刻度按「填满这个高度」反推，再被 `MAX_PX_PER_PATH` 封顶。 */
export const DENSE_BUDGET_H = 640;
const PADDING = 28;
/**
 * 列标题已经挪到 SVG 外的 KPI 卡，图内不再留一行标题。
 * 保留一小段上边距，避免最上面的外标贴死画布边缘。
 */
const COLUMN_HEADER_HEIGHT = 8;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 15;
/** 标签块的最大宽度（超出省略）。 */
const LABEL_MAX_WIDTH = 168;
/** 首列 / 末列标签块与柱的水平间距。 */
const LABEL_GAP = 8;
/** 中间列标签块底缘与柱顶的间距（Spec §5.2：≤ 4px）。 */
const LABEL_PILLAR_GAP = 2;
/** 标签块与流带 / 相邻柱之间的最小净距。 */
const LABEL_MARGIN = 2;

/**
 * React 的 `SVGAttributes` 没有声明 `translate`，但它是 HTML 全局属性、
 * SVG 元素同样支持。受保护 DOM 要求所有 connection / schema / table /
 * role / token 标识加 `translate="no"`，这里用一个窄断言补上，运行时行为不变。
 */
const translateNo = { translate: "no" } as SVGProps<SVGTextElement>;

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

export type AccessMapLayoutColumn = {
  depth: number;
  kind: AccessMapNodeKind;
  /** 列标题（中文层名）。 */
  label: string;
  x: number;
};

/** 外标块：名称 + 副标题 + 状态行（geometry Spec §5.2）。 */
export type AccessMapLabelBlock = {
  /** 可见名称（超长时尾部省略）。 */
  name: string;
  /** 完整名称（留在 `<title>` 与抽屉里）。 */
  fullName: string;
  /** 副标题（N 个 Agent · M 条路径）。 */
  subtitle: string;
  /** 状态行（僵尸授权 / 需复核 / 访问超出授权）；无异常边时为 null。 */
  status: string | null;
  statusState: AccessMapEdgeState | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AccessMapLayoutNode = {
  node: AccessMapNode;
  /** 柱体左上角。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 兼容旧字段：可见名称。 */
  label: string;
  /** 兼容旧字段：外标块绘制盒。 */
  labelBox: Box;
  /** 外标块（名称 + 副标题 + 状态）。 */
  labelBlock: AccessMapLabelBlock;
};

/** 一条边在某根柱上占用的槽位（相对柱顶）。 */
export type AccessMapBandSlot = {
  top: number;
  height: number;
  index: number;
};

/** 面积流带的几何：填充 path + 上下缘采样（避碰的事实源）。 */
export type AccessMapBandGeometry = {
  kind: "grant" | "review";
  path: string;
  thickness: number;
  sourceSlot: AccessMapBandSlot;
  targetSlot: AccessMapBandSlot;
  /** 中线采样点。 */
  center: Point[];
  /** 上缘采样点。 */
  upper: Point[];
  /** 下缘采样点。 */
  lower: Point[];
  /** 内核是否与授权同顶（顶对齐）。 */
  topAligned: boolean;
  /** 中线的三次贝塞尔控制点（命中层复用同一曲线）。 */
  curve: [Point, Point, Point, Point];
};

export type AccessMapLayoutLink = {
  edge: AccessMapEdge;
  /** 主面积 path（授权面积，或需复核的独立警示面积）。 */
  path: string;
  /** 主面积厚度。 */
  width: number;
  /** 内核面积 path（dormant / needs_review 没有内核）。 */
  kernelPath: string | null;
  kernelWidth: number;
  /** 内核比例（相对流带长度）。 */
  kernelRatio: number;
  /** 主中线的三次贝塞尔控制点。 */
  points: [Point, Point, Point, Point];
  /** 主面积几何。 */
  band: AccessMapBandGeometry | null;
  /** 授权面积（needs_review 为 null）。 */
  grantArea: AccessMapBandGeometry | null;
  /** 需复核的独立警示面积。 */
  reviewArea: AccessMapBandGeometry | null;
  /** 访问内核。 */
  kernel: AccessMapBandGeometry | null;
  /** 需复核的虚线中线。 */
  midlinePath: string | null;
  /** 越权的 danger 实线轮廓。 */
  outlinePath: string | null;
  sourceSlot: AccessMapBandSlot;
  targetSlot: AccessMapBandSlot;
  /** 透明命中 path（厚度 ≥ `MIN_HIT_PX`，不参与计量）。 */
  hitPaths: string[];
};

/** 闲置授权端点细空心示意（不撑柱）。 */
export type AccessMapIdleStub = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  idleEdges: AccessMapEdge[];
};

export type AccessMapLayout = {
  nodes: AccessMapLayoutNode[];
  links: AccessMapLayoutLink[];
  /** 闲置端点示意（fill=none；不进 pillarHeight）。 */
  idleStubs: AccessMapIdleStub[];
  columns: AccessMapLayoutColumn[];
  width: number;
  /** SVG 高度（= contentHeight）。 */
  height: number;
  /** 图面实际高度。 */
  contentHeight: number;
  /** 本次布局使用的刻度（px / 路径）。 */
  unitPx: number;
  /** 稀疏图：图面不足槽位 65%，改为垂直居中而不是放大。 */
  sparse: boolean;
  /** 槽位参考高度（稀疏判定基准）。 */
  slotReferenceHeight: number;
};

/** usage-first：节点流量 = 访问路径数。 */
function flowOf(node: AccessMapNode): number {
  return node.meta.accessPaths ?? 0;
}

/** usage-first：边计量权重 = 访问路径数（闲置边不进流带，走 stub）。 */
function edgeWeight(edge: AccessMapEdge): number {
  return edge.accessPaths;
}

function isIdleGrantEdge(edge: AccessMapEdge): boolean {
  return edge.grantPaths > 0 && edge.accessPaths === 0;
}

function isUsageEdge(edge: AccessMapEdge): boolean {
  return edge.accessPaths > 0;
}

/**
 * 画布节点集（Spec §5.1）：使用活跃 ∪ 闲置端点；闲置表永不进列。
 */
export function selectAccessMapCanvasNodes(
  nodes: AccessMapNode[],
  edges: AccessMapEdge[],
  accessOk: boolean
): AccessMapNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const usageNodes = nodes.filter(
    (node) => node.kind !== "token" && (node.meta.accessPaths ?? 0) > 0
  );

  if (!accessOk) {
    // §5.6：访问面不可用时按闲置端点示意；仍禁止闲置表进列。
    return nodes.filter((node) => {
      if (node.kind === "token" || node.kind === "table") return false;
      return (node.meta.grantPaths ?? 0) > 0;
    });
  }

  const idleEndpointIds = new Set<string>();
  for (const edge of edges) {
    if (!isIdleGrantEdge(edge)) continue;
    const source = byId.get(edge.source);
    if (!source) continue;
    if (source.kind === "table" || source.kind === "token") continue;
    if ((source.meta.accessPaths ?? 0) > 0) continue;
    idleEndpointIds.add(source.id);
  }

  const seen = new Set(usageNodes.map((node) => node.id));
  const idleEndpoints = [...idleEndpointIds]
    .map((id) => byId.get(id))
    .filter((node): node is AccessMapNode => Boolean(node));
  for (const node of idleEndpoints) seen.add(node.id);
  return [...usageNodes, ...idleEndpoints];
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

/** 采样一条三次贝塞尔。 */
function sampleCubic(points: [Point, Point, Point, Point], steps = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i += 1) out.push(cubicAt(points, i / steps));
  return out;
}

/** 纵向偏移一条曲线（用来造上下缘）。 */
function offsetCurve(points: [Point, Point, Point, Point], dy: number): [Point, Point, Point, Point] {
  return [
    { x: points[0].x, y: points[0].y + dy },
    { x: points[1].x, y: points[1].y + dy },
    { x: points[2].x, y: points[2].y + dy },
    { x: points[3].x, y: points[3].y + dy }
  ];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function cubicPath(points: [Point, Point, Point, Point]): string {
  const [p0, p1, p2, p3] = points;
  return `M${round1(p0.x)},${round1(p0.y)} C${round1(p1.x)},${round1(p1.y)} ${round1(p2.x)},${round1(
    p2.y
  )} ${round1(p3.x)},${round1(p3.y)}`;
}

/**
 * 由中线造出**面积** path（闭合填充区域）。
 *
 * 几何 Spec §5.4：主视觉是填充面积，不是「一条超粗描边」。
 */
function areaPath(
  upper: [Point, Point, Point, Point],
  lower: [Point, Point, Point, Point]
): string {
  const back: [Point, Point, Point, Point] = [
    lower[3],
    lower[2],
    lower[1],
    lower[0]
  ];
  return `${cubicPath(upper)} L${round1(back[0].x)},${round1(back[0].y)} ${cubicPath(back).slice(
    1
  )} Z`;
}

/** 估算文字宽度：拉丁字符约 0.55em，中日韩字符约 1em。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += /[⺀-鿿豈-﫿＀-｠]/.test(char) ? 1 : 0.55;
  }
  return units * fontSize;
}

/** 超出可用宽度时尾部省略；全名留在 `<title>` 与抽屉里。 */
export function truncateLabel(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const ellipsisWidth = estimateTextWidth("…", fontSize);
  let width = 0;
  let out = "";
  for (const char of text) {
    const charWidth = estimateTextWidth(char, fontSize);
    if (width + charWidth + ellipsisWidth > maxWidth) break;
    out += char;
    width += charWidth;
  }
  return out.length === 0 ? "…" : `${out}…`;
}

/** 状态行的展示优先级：越权 > 需复核 > 僵尸授权。 */
const LABEL_STATUS_PRIORITY: AccessMapEdgeState[] = ["overflow", "needs_review", "dormant"];

type LabelMeasure = {
  name: string;
  fullName: string;
  subtitle: string;
  status: string | null;
  statusState: AccessMapEdgeState | null;
  width: number;
  height: number;
};

function measureLabel(node: AccessMapNode, statusState: AccessMapEdgeState | null): LabelMeasure {
  const name = truncateLabel(node.label, LABEL_MAX_WIDTH, LABEL_FONT_SIZE);
  // 副标题和状态仍留在数据里（悬停、无障碍、布局测试），但不再占图面：
  // 图上每个节点都写「N 个 Agent · M 条路径 / 僵尸授权」会把流向淹没。
  // 这些数改由列头 KPI 卡承担。
  const subtitle = accessMapNodeSubtitle(node);
  const status = statusState ? accessMapEdgeStateLabel(statusState) : null;
  const width = estimateTextWidth(name, LABEL_FONT_SIZE);
  const height = LABEL_LINE_HEIGHT;
  return { name, fullName: node.label, subtitle, status, statusState, width, height };
}

/** 布局可选项。`maxPxPerPath` 只用于「刻度封顶」的对照实验与测试。 */
export type AccessMapLayoutOptions = {
  maxPxPerPath?: number;
  /** 访问面是否可用；false 时仅闲置示意（§5.6）。 */
  accessOk?: boolean;
};

type NodeBox = {
  node: AccessMapNode;
  columnIndex: number;
  nodeIndex: number;
  x: number;
  y: number;
  pillarHeight: number;
  measure: LabelMeasure;
};

type BuiltBand = {
  link: AccessMapLayoutLink;
  sourceSlot: AccessMapBandSlot;
  targetSlot: AccessMapBandSlot;
};

/**
 * 分层布局。
 *
 * 计量只用一把全局刻度：`厚度 = 权重 × unitPx`，**没有最小厚度地板**；
 * 可见性与点击便利性由透明命中层（`MIN_HIT_PX`）解决，不污染计量。
 */
export function layoutAccessMap(
  nodes: AccessMapNode[],
  edges: AccessMapEdge[],
  options?: AccessMapLayoutOptions
): AccessMapLayout {
  const maxPxPerPath = options?.maxPxPerPath ?? MAX_PX_PER_PATH;
  const accessOk = options?.accessOk ?? true;
  const flowNodes = selectAccessMapCanvasNodes(nodes, edges, accessOk);
  const usageNodeIds = new Set(
    flowNodes.filter((node) => (node.meta.accessPaths ?? 0) > 0).map((node) => node.id)
  );
  const depths = [...new Set(flowNodes.map((node) => node.depth))].sort((a, b) => a - b);

  // S7：列内 usageNodes 按 accessPaths 降序；闲置端点置列底。
  const columns = depths.map((depth) => {
    const column = flowNodes.filter((node) => node.depth === depth);
    const usage = column
      .filter((node) => usageNodeIds.has(node.id))
      .sort((a, b) => flowOf(b) - flowOf(a) || a.id.localeCompare(b.id));
    const idle = column
      .filter((node) => !usageNodeIds.has(node.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    return [...usage, ...idle];
  });

  const contentTop = PADDING + COLUMN_HEADER_HEIGHT;
  const usableForUnit = DENSE_BUDGET_H - PADDING * 2 - COLUMN_HEADER_HEIGHT;

  // 状态标记：取该节点相邻边上出现过的非正常状态。
  const markerStates = new Map<string, Set<AccessMapEdgeState>>();
  for (const edge of edges) {
    if (edge.state === "normal") continue;
    for (const nodeId of [edge.source, edge.target]) {
      const states = markerStates.get(nodeId) ?? new Set<AccessMapEdgeState>();
      states.add(edge.state);
      markerStates.set(nodeId, states);
    }
  }

  const measures = new Map<string, LabelMeasure>();
  for (const node of flowNodes) {
    const states = markerStates.get(node.id);
    const statusState = states
      ? LABEL_STATUS_PRIORITY.find((state) => states.has(state)) ?? null
      : null;
    measures.set(node.id, measureLabel(node, statusState));
  }

  // 只保留两端都落在图上的边；使用流带仅 accessPaths>0（且 accessOk）。
  const placedIds = new Set(flowNodes.map((node) => node.id));
  const activeEdges = edges.filter(
    (edge) => placedIds.has(edge.source) && placedIds.has(edge.target)
  );
  const usageEdges = accessOk ? activeEdges.filter(isUsageEdge) : [];

  // 柱高 = max(入槽, 出槽) 使用厚度；闲置 stub 不进。
  const outSum = new Map<string, number>();
  const inSum = new Map<string, number>();
  for (const edge of usageEdges) {
    const weight = edgeWeight(edge);
    outSum.set(edge.source, (outSum.get(edge.source) ?? 0) + weight);
    inSum.set(edge.target, (inSum.get(edge.target) ?? 0) + weight);
  }
  const flowOfNode = (node: AccessMapNode): number => {
    if (!accessOk) return 0;
    return Math.max(outSum.get(node.id) ?? 0, inSum.get(node.id) ?? 0);
  };

  // 密度只计使用节点（闲置端点不进 NODE_GAP 分母）。
  const columnFlow = columns.map((column) =>
    column
      .filter((node) => usageNodeIds.has(node.id))
      .reduce((sum, node) => sum + flowOfNode(node), 0)
  );

  // 左右留白：首列标签在柱左、末列标签在柱右，都得在 SVG 里放得下。
  const leftGutter =
    columns.length > 0
      ? Math.max(
          ...columns[0].map((node) => (measures.get(node.id)?.width ?? 0) + LABEL_GAP)
        )
      : 0;
  const rightGutter =
    columns.length > 0
      ? Math.max(
          ...columns[columns.length - 1].map(
            (node) => (measures.get(node.id)?.width ?? 0) + LABEL_GAP
          )
        )
      : 0;
  const columnX = columns.map((_, index) => PADDING + leftGutter + index * ACCESS_MAP_COLUMN_GAP);

  // 刻度：先按密度预算反推，再被 `MAX_PX_PER_PATH` 封顶。
  // gapReserve 只计使用节点（§5.1）。
  const reserveOf = (index: number): number => {
    const column = columns[index].filter((node) => usageNodeIds.has(node.id));
    const gaps = Math.max(0, column.length - 1) * NODE_GAP;
    const isMiddle = index > 0 && index < columns.length - 1;
    const labels = isMiddle
      ? column.reduce((sum, node) => sum + (measures.get(node.id)?.height ?? 0) + LABEL_PILLAR_GAP, 0)
      : 0;
    return gaps + labels;
  };
  const rawUnits = columns.map((_, index) => {
    if ((columnFlow[index] ?? 0) <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, usableForUnit - reserveOf(index)) / (columnFlow[index] as number);
  });
  const finiteUnits = rawUnits.filter((value) => Number.isFinite(value));
  const rawUnit = finiteUnits.length > 0 ? Math.min(...finiteUnits) : maxPxPerPath;
  let unitPx = Math.min(rawUnit, maxPxPerPath);

  /**
   * 按给定刻度做一次完整布局（含标签避碰迭代）。
   */
  function build(currentUnit: number): {
    boxes: Map<string, NodeBox>;
    links: AccessMapLayoutLink[];
    columnHeights: number[];
    labelTops: Map<string, number>;
    maxColumnHeight: number;
  } {
    // extra[列][节点]：为了给标签块腾出避让空间而在该节点**之前**插入的额外高度。
    const extra: number[][] = columns.map((column) => column.map(() => 0));
    let boxes = new Map<string, NodeBox>();
    let links: AccessMapLayoutLink[] = [];
    let labelTops = new Map<string, number>();
    let columnHeights: number[] = [];

    // 标签避碰是迭代求解：把标签块往上挪需要空间，空间不够就把该节点的
    // 整块内容往下挪（`extra`），再重算流带。收敛是几何级数的（每轮缺口
    // 缩小约一个量级），所以给足轮数；每轮只处理第一个需要让位的节点，
    // 保证单调收敛、不会来回振荡。
    for (let round = 0; round < 160; round += 1) {
      // ① 步进与柱位置。
      boxes = new Map<string, NodeBox>();
      const heights: number[] = [];
      columns.forEach((column, columnIndex) => {
        const isMiddle = columnIndex > 0 && columnIndex < columns.length - 1;
        let cursor = contentTop;
        column.forEach((node, nodeIndex) => {
          const measure = measures.get(node.id) as LabelMeasure;
          let pillarHeight = flowOfNode(node) * currentUnit;
          if (!accessOk) pillarHeight = Math.min(IDLE_GRANT_PX, Math.max(pillarHeight, IDLE_GRANT_PX));
          cursor += extra[columnIndex][nodeIndex] ?? 0;
          let y: number;
          if (isMiddle) {
            // 中间列：标签块在柱**上方**。
            y = cursor + measure.height + LABEL_PILLAR_GAP;
          } else {
            // 首 / 末列：标签块在柱侧面，柱体在步进单元里居中。
            y = cursor + (Math.max(pillarHeight, measure.height) - pillarHeight) / 2;
          }
          boxes.set(node.id, {
            node,
            columnIndex,
            nodeIndex,
            x: columnX[columnIndex] as number,
            y,
            pillarHeight,
            measure
          });
          cursor = isMiddle
            ? cursor + measure.height + LABEL_PILLAR_GAP + pillarHeight + NODE_GAP
            : cursor + Math.max(pillarHeight, measure.height) + NODE_GAP;
        });
        heights.push(cursor - contentTop - NODE_GAP);
      });

      // ② 槽位与面积流带（仅使用边）。
      const built = buildBands(boxes, currentUnit, usageEdges);
      links = built.links;

      // ③ 标签避碰：中间列的标签块必须整块落在流带上下缘之上。
      let changed = false;
      const nextLabelTops = new Map<string, number>();
      for (const column of boxes.values()) {
        const isMiddle = column.columnIndex > 0 && column.columnIndex < columns.length - 1;
        if (!isMiddle) {
          nextLabelTops.set(column.node.id, column.y);
          continue;
        }
        const labelWidth = column.measure.width;
        const labelX = column.x + PILLAR_WIDTH / 2 - labelWidth / 2;
        const minEdge = bandEdgeCeiling(links, column, labelX, labelWidth);
        const topMax = Math.min(
          column.y - LABEL_PILLAR_GAP - column.measure.height,
          minEdge - LABEL_MARGIN - column.measure.height
        );
        const previous = previousPillarBottom(boxes, column);
        const topMin = Math.max(previous + LABEL_MARGIN, contentTop);
        if (topMax < topMin - 0.01) {
          extra[column.columnIndex][column.nodeIndex] =
            (extra[column.columnIndex][column.nodeIndex] ?? 0) + (topMin - topMax);
          changed = true;
          break;
        }
        nextLabelTops.set(column.node.id, topMax);
      }
      if (!changed) {
        labelTops = nextLabelTops;
        columnHeights = heights;
        break;
      }
      labelTops = nextLabelTops;
      columnHeights = heights;
    }

    return {
      boxes,
      links,
      columnHeights,
      labelTops,
      maxColumnHeight: columnHeights.length > 0 ? Math.max(...columnHeights) : 0
    };
  }

  let built = build(unitPx);
  // 密度预算：实测列高超预算就按比例回缩刻度（**不放宽** MAX_PX_PER_PATH）。
  for (let i = 0; i < 8; i += 1) {
    if (built.maxColumnHeight <= usableForUnit + 0.5) break;
    unitPx = unitPx * (usableForUnit / built.maxColumnHeight);
    built = build(unitPx);
  }

  const { boxes, links, labelTops } = built;

  const placed: AccessMapLayoutNode[] = [];
  for (const box of boxes.values()) {
    const measure = box.measure;
    const isMiddle = box.columnIndex > 0 && box.columnIndex < columns.length - 1;
    let labelBox: Box;
    if (isMiddle) {
      const labelX = box.x + PILLAR_WIDTH / 2 - measure.width / 2;
      const top = labelTops.get(box.node.id) ?? box.y - LABEL_PILLAR_GAP - measure.height;
      labelBox = { x: labelX, y: top, width: measure.width, height: measure.height };
    } else if (box.columnIndex === 0) {
      labelBox = {
        x: box.x - LABEL_GAP - measure.width,
        y: box.y + (box.pillarHeight - measure.height) / 2,
        width: measure.width,
        height: measure.height
      };
    } else {
      labelBox = {
        x: box.x + PILLAR_WIDTH + LABEL_GAP,
        y: box.y + (box.pillarHeight - measure.height) / 2,
        width: measure.width,
        height: measure.height
      };
    }
    placed.push({
      node: box.node,
      x: box.x,
      y: box.y,
      width: PILLAR_WIDTH,
      height: box.pillarHeight,
      label: measure.name,
      labelBox,
      labelBlock: {
        name: measure.name,
        fullName: measure.fullName,
        subtitle: measure.subtitle,
        status: measure.status,
        statusState: measure.statusState,
        x: labelBox.x,
        y: labelBox.y,
        width: labelBox.width,
        height: labelBox.height
      }
    });
  }

  const contentHeight = Math.max(
    contentTop + (built.maxColumnHeight || 0) + PADDING,
    contentTop + PADDING
  );

  // §5.4：闲置出边的目标表可能不进列；stub 只要求源端点在画布上。
  const idleBySource = new Map<string, AccessMapEdge[]>();
  for (const edge of edges) {
    if (!placedIds.has(edge.source)) continue;
    if (accessOk) {
      if (!isIdleGrantEdge(edge)) continue;
    } else if (edge.grantPaths <= 0) {
      continue;
    }
    const list = idleBySource.get(edge.source) ?? [];
    list.push(edge);
    idleBySource.set(edge.source, list);
  }
  const idleStubs: AccessMapIdleStub[] = [];
  for (const [nodeId, idleEdges] of idleBySource) {
    const box = boxes.get(nodeId);
    if (!box) continue;
    idleStubs.push({
      nodeId,
      x: box.x + PILLAR_WIDTH,
      y: box.y + Math.max(0, box.pillarHeight - IDLE_GRANT_PX),
      width: Math.max(12, ACCESS_MAP_COLUMN_GAP * 0.08),
      height: IDLE_GRANT_PX,
      idleEdges
    });
  }

  return {
    nodes: placed,
    links,
    idleStubs,
    columns: columns.map((column, index) => ({
      depth: depths[index] as number,
      kind: column[0]?.kind ?? "table",
      label: accessMapNodeKindLabel(column[0]?.kind ?? "table"),
      x: columnX[index] as number
    })),
    width:
      PADDING * 2 +
      leftGutter +
      rightGutter +
      Math.max(0, columns.length - 1) * ACCESS_MAP_COLUMN_GAP +
      PILLAR_WIDTH,
    height: contentHeight,
    contentHeight,
    unitPx,
    sparse: contentHeight < DENSE_BUDGET_H * 0.65,
    slotReferenceHeight: DENSE_BUDGET_H
  };

  /**
   * 分配槽位并造出四态面积流带。
   *
   * 出边槽位按**目标节点的 y**排序（再按 id），入边槽位按**源节点的 y**排序：
   * 这样流带少交叉，读者一眼能看出路径走向。
   */
  function buildBands(
    nodeBoxes: Map<string, NodeBox>,
    currentUnit: number,
    scopedEdges: AccessMapEdge[]
  ): { links: AccessMapLayoutLink[] } {
    const outgoing = new Map<string, AccessMapEdge[]>();
    const incoming = new Map<string, AccessMapEdge[]>();
    for (const edge of scopedEdges) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    }
    const byId = new Map(scopedEdges.map((edge) => [edge.id, edge]));
    const orderOf = (edge: AccessMapEdge, mode: "out" | "in"): { y: number; id: string } => {
      const counterpartId = mode === "out" ? edge.target : edge.source;
      const counterpart = nodeBoxes.get(counterpartId);
      return { y: counterpart?.y ?? 0, id: counterpartId };
    };
    for (const list of outgoing.values()) {
      list.sort((a, b) => {
        const oa = orderOf(a, "out");
        const ob = orderOf(b, "out");
        return oa.y - ob.y || oa.id.localeCompare(ob.id);
      });
    }
    for (const list of incoming.values()) {
      list.sort((a, b) => {
        const oa = orderOf(a, "in");
        const ob = orderOf(b, "in");
        return oa.y - ob.y || oa.id.localeCompare(ob.id);
      });
    }

    const sourceSlot = new Map<string, AccessMapBandSlot>();
    const targetSlot = new Map<string, AccessMapBandSlot>();
    for (const [nodeId, list] of outgoing) {
      let cursor = 0;
      list.forEach((edge, index) => {
        const height = edgeWeight(edge) * currentUnit;
        sourceSlot.set(edge.id, { top: cursor, height, index });
        cursor += height;
      });
      void nodeId;
    }
    for (const [nodeId, list] of incoming) {
      let cursor = 0;
      list.forEach((edge, index) => {
        const height = edgeWeight(edge) * currentUnit;
        targetSlot.set(edge.id, { top: cursor, height, index });
        cursor += height;
      });
      void nodeId;
    }

    const links: AccessMapLayoutLink[] = [];
    for (const edge of scopedEdges) {
      const source = nodeBoxes.get(edge.source);
      const target = nodeBoxes.get(edge.target);
      const srcSlot = sourceSlot.get(edge.id);
      const tgtSlot = targetSlot.get(edge.id);
      if (!source || !target || !srcSlot || !tgtSlot) continue;

      const x0 = source.x + PILLAR_WIDTH;
      const x1 = target.x;
      const gap = x1 - x0;
      const isReview = edge.state === "needs_review";
      // usage-first §5.3：主厚度 = accessPaths × unitPx；无授权外带／深色内核双层。
      const bandThickness = edge.accessPaths * currentUnit;
      const y0 = source.y + srcSlot.top + bandThickness / 2;
      const y1 = target.y + tgtSlot.top + bandThickness / 2;
      const curve: [Point, Point, Point, Point] = [
        { x: x0, y: y0 },
        { x: x0 + gap / 3, y: y0 },
        { x: x1 - gap / 3, y: y1 },
        { x: x1, y: y1 }
      ];

      const makeBand = (
        kind: "grant" | "review",
        centerCurve: [Point, Point, Point, Point],
        thickness: number
      ): AccessMapBandGeometry => {
        const half = thickness / 2;
        const upperCurve = offsetCurve(centerCurve, -half);
        const lowerCurve = offsetCurve(centerCurve, half);
        return {
          kind,
          path: areaPath(upperCurve, lowerCurve),
          thickness,
          sourceSlot: srcSlot,
          targetSlot: tgtSlot,
          center: sampleCubic(centerCurve),
          upper: sampleCubic(upperCurve),
          lower: sampleCubic(lowerCurve),
          topAligned: true,
          curve: centerCurve
        };
      };

      const band = makeBand(isReview ? "review" : "grant", curve, bandThickness);
      const midlinePath = isReview ? cubicPath(curve) : null;
      const outlinePath =
        edge.state === "overflow" || edge.confirmedUnauthorized ? band.path : null;

      const hitPaths: string[] = [];
      const hitThickness = Math.max(band.thickness, MIN_HIT_PX);
      const half = hitThickness / 2;
      hitPaths.push(
        areaPath(offsetCurve(band.curve, -half), offsetCurve(band.curve, half))
      );

      links.push({
        edge,
        path: band.path,
        width: bandThickness,
        kernelPath: null,
        kernelWidth: 0,
        kernelRatio: 1,
        points: curve,
        band,
        grantArea: isReview ? null : band,
        reviewArea: isReview ? band : null,
        kernel: null,
        midlinePath,
        outlinePath,
        sourceSlot: srcSlot,
        targetSlot: tgtSlot,
        hitPaths
      });
    }
    void byId;
    return { links };
  }

  /** 上一根柱的底缘（同一列、上一节点）。 */
  function previousPillarBottom(allBoxes: Map<string, NodeBox>, box: NodeBox): number {
    const column = columns[box.columnIndex] ?? [];
    const previousNode = column[box.nodeIndex - 1];
    if (!previousNode) return contentTop - LABEL_MARGIN;
    const previousBox = allBoxes.get(previousNode.id);
    if (!previousBox) return contentTop - LABEL_MARGIN;
    return previousBox.y + previousBox.pillarHeight;
  }

  /**
   * 标签块所在 x 区间内，相关流带上缘的**最高点**（y 最小值）。
   *
   * 标签块必须整块位于这条上缘之上，所以取的是最小 y（最高点）。
   */
  function bandEdgeCeiling(
    allLinks: AccessMapLayoutLink[],
    box: NodeBox,
    labelX: number,
    labelWidth: number
  ): number {
    const labelRight = labelX + labelWidth;
    let ceiling = Number.POSITIVE_INFINITY;
    for (const link of allLinks) {
      const touchesSource = link.edge.source === box.node.id;
      const touchesTarget = link.edge.target === box.node.id;
      if (!touchesSource && !touchesTarget) continue;
      const elements = [link.band, link.kernel].filter(Boolean) as AccessMapBandGeometry[];
      for (const element of elements) {
        for (const point of element.upper) {
          const withinLabel = point.x >= labelX - 0.01 && point.x <= labelRight + 0.01;
          if (!withinLabel) continue;
          if (point.y < ceiling) ceiling = point.y;
        }
      }
    }
    if (!Number.isFinite(ceiling)) return box.y + Number.POSITIVE_INFINITY;
    return ceiling;
  }
}

function nodeFillClass(node: AccessMapNode): string {
  if (node.meta.unresolved) return "fill-fg-subtle";
  switch (node.kind) {
    case "agent":
      return "fill-fg-strong";
    case "role":
      return "fill-fg-default";
    case "connection":
      return "fill-fg-muted";
    case "schema":
      return "fill-border-strong";
    default:
      return "fill-brand";
  }
}

/**
 * usage-first §5.3 四态主填充：使用带（无授权外带）。
 * 确凿越权 danger；需复核 warning；overflow／normal 用 access（accent）。
 */
function bandFillClass(edge: AccessMapEdge): string {
  if (edge.confirmedUnauthorized) return "fill-danger-strong";
  if (edge.state === "needs_review") return "fill-warning";
  if (edge.state === "overflow") return "fill-accent";
  return "fill-accent";
}

/** @deprecated usage-first 不再画深色内核；保留供旧测试引用。 */
function kernelFillClass(edge: AccessMapEdge): string {
  if (edge.confirmedUnauthorized) return "fill-danger-strong";
  if (edge.state === "overflow") return "fill-danger-strong";
  return "fill-accent";
}
void kernelFillClass;

/**
 * 状态文字的着色。
 *
 * 僵尸授权走中性色：警告色留给需复核与确凿越权，僵尸授权的数量放在指标卡上。
 */
const COLUMN_CARD_INDEX = ["①", "②", "③", "④", "⑤", "⑥"] as const;

/**
 * 从一个节点沿边的方向走完上下游。
 *
 * 只往下游走出去的边、只往上游走进来的边，不从中途节点横穿到兄弟分支。
 * 点「何老师」时亮的是他能到达的角色、连接和表；共用同一角色的其他人不会被点亮。
 */
export function traceAccessMapChain(
  nodeId: string,
  edges: AccessMapEdge[]
): { nodes: Set<string>; edges: Set<string> } {
  const outgoing = new Map<string, AccessMapEdge[]>();
  const incoming = new Map<string, AccessMapEdge[]>();
  for (const edge of edges) {
    const out = outgoing.get(edge.source);
    if (out) out.push(edge);
    else outgoing.set(edge.source, [edge]);
    const inc = incoming.get(edge.target);
    if (inc) inc.push(edge);
    else incoming.set(edge.target, [edge]);
  }

  const reached = new Set<string>([nodeId]);
  const edgeIds = new Set<string>();
  // 上下游各自记「从哪个方向来过」。共用一个集合时，环上的节点被下游先标过，
  // 上游就不再展开，会漏掉从环侧面接进来的人。
  const seenDown = new Set<string>([nodeId]);
  const seenUp = new Set<string>([nodeId]);

  const down = [nodeId];
  while (down.length > 0) {
    const current = down.pop() as string;
    for (const edge of outgoing.get(current) ?? []) {
      edgeIds.add(edge.id);
      reached.add(edge.target);
      if (!seenDown.has(edge.target)) {
        seenDown.add(edge.target);
        down.push(edge.target);
      }
    }
  }

  const up = [nodeId];
  while (up.length > 0) {
    const current = up.pop() as string;
    for (const edge of incoming.get(current) ?? []) {
      edgeIds.add(edge.id);
      reached.add(edge.source);
      if (!seenUp.has(edge.source)) {
        seenUp.add(edge.source);
        up.push(edge.source);
      }
    }
  }

  return { nodes: reached, edges: edgeIds };
}

function agentIdOf(nodeId: string): string {
  return nodeId.startsWith("agent:") ? nodeId.slice("agent:".length) : nodeId;
}

/**
 * 卡片按「当前主体」计授权和问询。
 *
 * 没钉住时看节点自己的路径数。钉住某个 Agent 后，共享的角色、连接、表只算这个人自己的
 * `grantAgentIds` / `accessAgentIds`，别人的问询不再算进他的卡。
 */
export function summarizeAccessMapColumn(
  columnNodes: AccessMapNode[],
  subjectAgentIds: Set<string> | null
): { nodeCount: number; granted: number; queried: number; dormant: number } {
  let granted = 0;
  let queried = 0;
  let dormant = 0;
  for (const node of columnNodes) {
    if (node.kind === "token") continue;
    let hasGrant = false;
    let hasAccess = false;
    if (!subjectAgentIds) {
      hasGrant = (node.meta.grantPaths ?? 0) > 0;
      hasAccess = (node.meta.accessPaths ?? 0) > 0;
    } else if (node.kind === "agent") {
      const mine = subjectAgentIds.has(agentIdOf(node.id));
      hasGrant = mine && (node.meta.grantPaths ?? 0) > 0;
      hasAccess = mine && (node.meta.accessPaths ?? 0) > 0;
    } else {
      hasGrant = (node.meta.grantAgentIds ?? []).some((id) => subjectAgentIds.has(id));
      hasAccess = (node.meta.accessAgentIds ?? []).some((id) => subjectAgentIds.has(id));
    }
    if (hasGrant) granted += 1;
    if (hasAccess) queried += 1;
    if (hasGrant && !hasAccess) dormant += 1;
  }
  return {
    nodeCount: columnNodes.filter((node) => node.kind !== "token").length,
    granted,
    queried,
    dormant
  };
}

function attributionAgentIds(node: AccessMapNode): string[] {
  return [...(node.meta.grantAgentIds ?? []), ...(node.meta.accessAgentIds ?? [])];
}

function hasAttribution(node: AccessMapNode): boolean {
  return node.meta.grantAgentIds !== undefined || node.meta.accessAgentIds !== undefined;
}

/**
 * 主体来自被点中的节点本身，不从「沿边能走到谁」反推。
 * 点一张只属于 A 的表时，不能因为连接也被 B 使用就把 B 算进主体。
 * 节点上没有归因数组时返回 null，退回纯方向遍历，兼容旧数据。
 */
export function subjectAgentIdsForPin(
  pinned: AccessMapNode | null,
  censusNodes: AccessMapNode[]
): Set<string> | null {
  if (!pinned) return null;
  if (pinned.kind === "agent") return new Set([agentIdOf(pinned.id)]);
  const members = (pinned.meta.foldedMemberIds ?? [])
    .map((id) => censusNodes.find((node) => node.id === id))
    .filter((node): node is AccessMapNode => Boolean(node));
  const sources = members.length > 0 ? members : [pinned];
  if (!sources.some(hasAttribution)) return null;
  return new Set(sources.flatMap(attributionAgentIds));
}

function nodeTouchesSubject(node: AccessMapNode, subject: Set<string>): boolean {
  if (node.kind === "agent") return subject.has(agentIdOf(node.id));
  if (!hasAttribution(node)) return true;
  return attributionAgentIds(node).some((id) => subject.has(id));
}

/**
 * 在方向遍历上再按主体裁剪。共享连接的下游若只属于别人，就不进入链路，
 * 高亮和节点总数都不算它。
 */
export function traceAccessMapSubjectChain(
  seedIds: string[],
  nodes: AccessMapNode[],
  edges: AccessMapEdge[],
  subject: Set<string> | null
): { nodes: Set<string>; edges: Set<string> } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, AccessMapEdge[]>();
  const incoming = new Map<string, AccessMapEdge[]>();
  for (const edge of edges) {
    const from = outgoing.get(edge.source) ?? [];
    from.push(edge);
    outgoing.set(edge.source, from);
    const to = incoming.get(edge.target) ?? [];
    to.push(edge);
    incoming.set(edge.target, to);
  }
  const allowed = (id: string): boolean => {
    if (!subject) return true;
    const node = byId.get(id);
    return Boolean(node && nodeTouchesSubject(node, subject));
  };
  const reached = new Set<string>();
  const edgeIds = new Set<string>();
  const seenDown = new Set<string>();
  const seenUp = new Set<string>();
  for (const seed of seedIds) {
    if (!byId.has(seed)) continue;
    reached.add(seed);
    seenDown.add(seed);
    seenUp.add(seed);
  }
  const down = [...reached];
  while (down.length > 0) {
    const current = down.pop() as string;
    for (const edge of outgoing.get(current) ?? []) {
      if (!allowed(edge.target)) continue;
      edgeIds.add(edge.id);
      reached.add(edge.target);
      if (!seenDown.has(edge.target)) {
        seenDown.add(edge.target);
        down.push(edge.target);
      }
    }
  }
  const up = [...reached];
  for (const id of up) seenUp.add(id);
  while (up.length > 0) {
    const current = up.pop() as string;
    for (const edge of incoming.get(current) ?? []) {
      if (!allowed(edge.source)) continue;
      edgeIds.add(edge.id);
      reached.add(edge.source);
      if (!seenUp.has(edge.source)) {
        seenUp.add(edge.source);
        up.push(edge.source);
      }
    }
  }
  return { nodes: reached, edges: edgeIds };
}

/** 把未折叠链路上的节点映射回画面上的柱子和流带。折叠柱子只要有一个成员在链上就亮。 */
export function paintAccessMapChain(
  census: { nodes: Set<string> },
  renderNodes: AccessMapNode[],
  renderEdges: AccessMapEdge[]
): { nodes: Set<string>; edges: Set<string> } {
  const nodeIds = new Set<string>();
  for (const node of renderNodes) {
    if (census.nodes.has(node.id)) {
      nodeIds.add(node.id);
      continue;
    }
    if ((node.meta.foldedMemberIds ?? []).some((id) => census.nodes.has(id))) nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of renderEdges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) edgeIds.add(edge.id);
  }
  return { nodes: nodeIds, edges: edgeIds };
}


export type AccessMapCanvasProps = {
  /** 画出来的节点（可能已折叠成「其他」）。 */
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  /**
   * 未折叠的全量节点。KPI 用这份计数，「其他（5）」不能算成 1。
   * 不传时退回 `nodes`。
   */
  censusNodes?: AccessMapNode[];
  censusEdges?: AccessMapEdge[];
  focusNodeId?: string | null;
  /**
   * Esc 且抽屉关闭、也没有链路高亮时，清除 URL 聚焦（呈现修订 §5.5）。
   * 抽屉开着时 Esc 只关抽屉，由 Radix Dialog 自己处理。
   * 有链路高亮时，第一次 Esc 只取消高亮，图保持全图。
   */
  onClearFocus?: () => void;
  /**
   * 持久筛选：点击 Agent → 写 `agent=`（S8）；点击连接 → 写 `focus=`（S6）。
   * 悬停预览不得调用本回调。
   */
  onPersistStructureFilter?: (node: AccessMapNode) => void;
  /** 无障碍摘要：节点数、边数、信号计数。 */
  summary: string;
  /**
   * 访问面是否可用（`meta.access.state === "ok"`）。
   * false 时悬停不得用「有／未调用」或「调用 0 次」冒充真实结果。
   */
  accessOk?: boolean;
};

/**
 * 悬停浮层的内容（chart-first Spec §5.6）。
 *
 * **不**把原生 SVG `<title>` 当作唯一用户可读提示：`<title>` 只在部分浏览器
 * 里以极慢的原生 tooltip 出现、不能换行、样式不受控，读者读不到「这条边是
 * 什么状态」。所以这里另起一个 HTML 浮层，`<title>` 保留作为无障碍补充。
 */
type AccessMapHoverTip =
  | { kind: "node"; node: AccessMapNode; x: number; y: number }
  | { kind: "edge"; edge: AccessMapEdge; x: number; y: number }
  | {
      kind: "idle-stub";
      nodeLabel: string;
      idleCount: number;
      grantPaths: number;
      x: number;
      y: number;
    };

export function AccessMapCanvas({
  nodes,
  edges,
  censusNodes,
  censusEdges,
  focusNodeId,
  onClearFocus,
  onPersistStructureFilter,
  summary,
  accessOk = true
}: AccessMapCanvasProps) {
  const layout = useMemo(
    () => layoutAccessMap(nodes, edges, { accessOk }),
    [nodes, edges, accessOk]
  );
  const populationNodes = censusNodes ?? nodes;
  const populationEdges = censusEdges ?? edges;
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  /** Esc 之后，指针还停在节点上时不再用悬停把高亮补回来，直到离开再进入。 */
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<AccessMapHoverTip | null>(null);
  const [idleList, setIdleList] = useState<{
    nodeLabel: string;
    edges: AccessMapEdge[];
  } | null>(null);

  /** 边的两端用**节点名**呈现；找不到就退回原始 id，不出现空白。 */
  const labelOfNode = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node.label]));
    return (nodeId: string): string => byId.get(nodeId) ?? nodeId;
  }, [nodes]);

  const pinnedNode = useMemo(
    () => nodes.find((node) => node.id === pinnedNodeId) ?? null,
    [nodes, pinnedNodeId]
  );
  const resolveChain = (node: AccessMapNode | null) => {
    if (!node) return null;
    const seeds =
      node.meta.foldedMemberIds && node.meta.foldedMemberIds.length > 0
        ? node.meta.foldedMemberIds
        : [node.id];
    const subject = subjectAgentIdsForPin(node, populationNodes);
    const census = traceAccessMapSubjectChain(seeds, populationNodes, populationEdges, subject);
    return {
      subject,
      censusNodes: census.nodes,
      paint: paintAccessMapChain(census, nodes, edges)
    };
  };
  /**
   * 没钉住时，悬停预览整条链路。已经钉住之后，悬停只出浮层，不再改亮哪条、也不改卡片。
   * 链路按主体裁剪：共用连接不会把别人的专属表算进来。
   */
  const pinnedView = useMemo(
    () => resolveChain(pinnedNode),
    // resolveChain 只依赖下面这几项；钉住节点变了才重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinnedNode, populationNodes, populationEdges, nodes, edges]
  );
  const hoveredNode = useMemo(
    () => nodes.find((node) => node.id === hoveredNodeId) ?? null,
    [nodes, hoveredNodeId]
  );
  const hoverChain = useMemo(() => {
    if (pinnedNodeId || hoverSuppressed || !hoveredNode) return null;
    return resolveChain(hoveredNode)?.paint ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredNode, pinnedNodeId, hoverSuppressed, populationNodes, populationEdges, nodes, edges]);
  const pinnedChain = pinnedView?.paint ?? null;
  const chain = pinnedChain ?? hoverChain;
  const censusChain = pinnedView?.censusNodes ?? null;
  const subjectAgentIds = pinnedView?.subject ?? null;

  const pinNode = (nodeId: string): void => {
    setPinnedNodeId((current) => (current === nodeId ? null : nodeId));
    const node = nodes.find((item) => item.id === nodeId);
    if (node && onPersistStructureFilter) {
      onPersistStructureFilter(node);
    }
  };
  const previewNode = (nodeId: string): void => {
    if (!hoverSuppressed) setHoveredNodeId(nodeId);
  };
  const leaveNode = (): void => {
    setHoverSuppressed(false);
    setHoveredNodeId(null);
    setHoverTip(null);
  };

  const selectedEdge =
    edges.find((edge) => edge.id === selectedEdgeId) ??
    populationEdges.find((edge) => edge.id === selectedEdgeId) ??
    null;

  /**
   * 浮层定位：把鼠标的**视口坐标**换算成浮层所在容器（根节点，`position: relative`）内的坐标。
   *
   * 浮层是根节点的绝对定位子元素，所以基准是根节点而不是 SVG；图区横向滚动（§5.4）
   * 只影响图形内容、不移动浮层，浮层因此始终贴着鼠标。
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tipPosition = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0)
    };
  };

  /**
   * Esc 分两段（呈现修订 §5.5）：抽屉开着 → 只关抽屉；抽屉关着且有聚焦 → 清聚焦。
   * 筛选状态任何时候都不受 Esc 影响。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (selectedEdgeId) return;
      const highlightActive = Boolean(pinnedNodeId || (hoveredNodeId && !hoverSuppressed));
      if (highlightActive) {
        setPinnedNodeId(null);
        setHoveredNodeId(null);
        setHoverSuppressed(true);
        return;
      }
      onClearFocus?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedEdgeId, pinnedNodeId, hoveredNodeId, hoverSuppressed, onClearFocus]);

  return (
    <div
      className="relative flex flex-col justify-center gap-3"
      data-testid="access-map-canvas"
      data-layout-mode={layout.sparse ? "sparse-centered" : "dense"}
      ref={rootRef}
      style={{ minHeight: ACCESS_MAP_CANVAS_MIN_HEIGHT }}
    >
      <div
        className="flex items-center justify-between gap-3 text-xs text-fg-muted"
        data-testid="access-map-chain-hint"
      >
        {pinnedNode ? (
          <>
            <span className="notranslate" translate="no" data-testid="access-map-chain-caption">
              正在看 {pinnedNode.label} 的链路
            </span>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              data-testid="access-map-chain-clear"
              onClick={() => setPinnedNodeId(null)}
            >
              看全图
            </button>
          </>
        ) : (
          <span>点一个名字，整条链路会亮起来，上面的数字跟着变成这条链路。</span>
        )}
      </div>

      {/*
        列头 KPI 固定在视口里排成一行，不跟桑基图横滚。
        图比屏幕宽时，表这一列在右侧，卡如果跟柱子走，第一眼就看不到「表」。
      */}
      <div
        className="grid gap-3"
        data-testid="access-map-column-cards"
        style={{ gridTemplateColumns: `repeat(${Math.max(layout.columns.length, 1)}, minmax(0, 1fr))` }}
      >
        {layout.columns.map((column, index) => {
          const columnNodes = populationNodes.filter(
            (node) => node.kind !== "token" && node.depth === column.depth
          );
          const scoped = censusChain
            ? columnNodes.filter((node) => censusChain.has(node.id))
            : columnNodes;
          const summaryCard = summarizeAccessMapColumn(scoped, subjectAgentIds);
          const active = pinnedNode?.depth === column.depth;
          return (
            <div
              key={`column-card-${column.depth}`}
              data-testid={`access-map-column-card-${column.depth}`}
              data-column-label={column.label}
              data-active={active ? "true" : "false"}
              className={`rounded-lg border bg-bg-elevated px-3 py-2 shadow-card ${
                active ? "border-brand" : "border-border-default"
              } ${pinnedChain && summaryCard.nodeCount === 0 ? "opacity-40" : ""}`}
            >
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-fg-muted">
                  <span className="notranslate" translate="no">
                    {column.label}
                  </span>
                  <span aria-hidden="true">{COLUMN_CARD_INDEX[index] ?? String(index + 1)}</span>
                </div>
                <div
                  className="mt-1 text-2xl font-semibold leading-none text-fg-default"
                  data-testid={`access-map-column-card-value-${column.depth}`}
                >
                  {summaryCard.nodeCount}
                </div>
                <div className="mt-2 text-[11px] leading-snug text-fg-muted">
                  有授权 {summaryCard.granted} · 有问询 {summaryCard.queried}
                </div>
                <div className="text-[11px] leading-snug text-fg-muted">
                  闲置授权 {summaryCard.dormant}
                </div>
            </div>
          );
        })}
      </div>

      {/* 图区横向滚动：不缩小 SVG，也不做窄屏重排。 */}
      <div className="overflow-x-auto" data-testid="access-map-plot-scroll">
        <svg
          role="img"
          aria-label={summary}
          data-testid="access-map-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          className="block"
          onClick={() => setPinnedNodeId(null)}
        >
          {layout.links.map((link) => {
            const onChain = chain ? chain.edges.has(link.edge.id) : false;
            const faded = Boolean(chain) && !onChain;
            return (
              <g
                key={link.edge.id}
                data-testid={`access-map-link-${link.edge.id}`}
                data-chain={chain ? (onChain ? "on" : "off") : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedEdgeId(link.edge.id);
                }}
                onMouseEnter={(event) =>
                  setHoverTip({
                    kind: "edge",
                    edge: link.edge,
                    ...tipPosition(event.clientX, event.clientY)
                  })
                }
                onMouseLeave={() => setHoverTip(null)}
              >
                {/*
                  主视觉：**填充面积**（授权面积，或需复核的独立警示面积）。
                  不是「一条超粗描边」——描边无法表达厚度，也没法做虚线中线。
                */}
                {link.band ? (
                  <path
                    d={link.band.path}
                    className={`${bandFillClass(link.edge)} ${faded ? "opacity-10" : onChain ? "opacity-60" : "opacity-30"}`}
                    data-testid={`access-map-ribbon-${link.edge.id}`}
                    onClick={() => setSelectedEdgeId(link.edge.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{accessMapEdgeTitleText(link.edge, accessOk, labelOfNode)}</title>
                  </path>
                ) : null}
                {/* 需复核：虚线中线（状态不只靠颜色区分）。 */}
                {link.midlinePath ? (
                  <path
                    d={link.midlinePath}
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="stroke-warning-strong"
                    data-testid={`access-map-midline-${link.edge.id}`}
                  />
                ) : null}
                {/* 越权：danger 实线轮廓（不靠加粗表达）。 */}
                {link.outlinePath ? (
                  <path
                    d={link.outlinePath}
                    fill="none"
                    strokeWidth={1.5}
                    className="stroke-danger-strong"
                    data-testid={`access-map-outline-${link.edge.id}`}
                  />
                ) : null}
                {/*
                  透明命中层：厚度至少 `MIN_HIT_PX`，**不参与计量**。
                  让「很细但仍然可见」的流带（僵尸授权、无内核）也能悬停与点击。
                */}
                {link.hitPaths.map((d, index) => (
                  <path
                    key={`hit-${index}`}
                    d={d}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={0}
                    pointerEvents="all"
                    data-testid={`access-map-hit-${link.edge.id}-${index}`}
                    onClick={() => setSelectedEdgeId(link.edge.id)}
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </g>
            );
          })}
          {layout.idleStubs.map((stub) => {
            const sourceNode = nodes.find((node) => node.id === stub.nodeId);
            const grantSum = stub.idleEdges.reduce((sum, edge) => sum + edge.grantPaths, 0);
            return (
              <g
                key={`idle-stub-${stub.nodeId}`}
                data-testid={`access-map-idle-stub-${stub.nodeId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setIdleList({
                    nodeLabel: sourceNode?.label ?? stub.nodeId,
                    edges: stub.idleEdges
                  });
                }}
                onMouseEnter={(event) =>
                  setHoverTip({
                    kind: "idle-stub",
                    nodeLabel: sourceNode?.label ?? stub.nodeId,
                    idleCount: stub.idleEdges.length,
                    grantPaths: grantSum,
                    ...tipPosition(event.clientX, event.clientY)
                  })
                }
                onMouseLeave={() => setHoverTip(null)}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {`${sourceNode?.label ?? stub.nodeId} → 闲置授权 ${stub.idleEdges.length} 条`}
                </title>
                <rect
                  x={stub.x}
                  y={stub.y}
                  width={stub.width}
                  height={stub.height}
                  fill="none"
                  className="stroke-fg-muted"
                  strokeWidth={1}
                  data-testid={`access-map-idle-stub-shape-${stub.nodeId}`}
                  data-grant-sum={grantSum}
                />
              </g>
            );
          })}
          {layout.nodes.map((item) => {
            const { node } = item;
            const isPinned = pinnedNodeId === node.id;
            const isFocus = focusNodeId === node.id;
            const clickable = !node.meta.unresolved;
            const onChain = chain ? chain.nodes.has(node.id) : false;
            const dimmed = Boolean(chain) && !onChain;
            const block = item.labelBlock;
            const hitWidth = Math.max(PILLAR_WIDTH, MIN_HIT_PX);
            const hitHeight = Math.max(item.height, MIN_HIT_PX);
            return (
              <g
                key={node.id}
                data-testid={`access-map-node-${node.id}`}
                data-node-kind={node.kind}
                data-unresolved={node.meta.unresolved ? "true" : undefined}
                data-chain={chain ? (onChain ? "on" : "off") : undefined}
                data-pinned={isPinned ? "true" : undefined}
                className={dimmed ? "opacity-20" : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!clickable) return;
                  pinNode(node.id);
                }}
                onMouseEnter={(event) => {
                  if (clickable) previewNode(node.id);
                  setHoverTip({ kind: "node", node, ...tipPosition(event.clientX, event.clientY) });
                }}
                onMouseLeave={leaveNode}
                style={{ cursor: clickable ? "pointer" : "default" }}
              >
                {/* 全名留在 `<title>`：外标里的名称过长时会省略。 */}
                <title>
                  {`${node.label} · ${accessMapNodeSubtitle(node)}`}
                </title>
                <rect
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={3}
                  className={`${nodeFillClass(node)} ${isPinned || isFocus ? "opacity-100" : "opacity-80"} ${
                    isPinned || isFocus ? "stroke-brand" : ""
                  }`}
                  strokeWidth={isPinned || isFocus ? 2 : 0}
                />
                {/* 透明命中扩展：细柱也要好点。名字在柱外，点击落在整组上。 */}
                <rect
                  x={item.x - (hitWidth - item.width) / 2}
                  y={item.y}
                  width={hitWidth}
                  height={hitHeight}
                  fill="transparent"
                  pointerEvents="all"
                />
                {/* 外标只留名字。路径数和僵尸授权改到列头卡片，避免每根柱旁都是一句说明。 */}
                <g data-testid={`access-map-label-${node.id}`}>
                  <text
                    x={block.x}
                    y={block.y + 11}
                    className="fill-fg-body text-[12px] notranslate"
                    {...translateNo}
                  >
                    {block.name}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        悬停浮层（chart-first Spec §5.6）。
        `pointer-events-none`：浮层**不拦截指针**，点击仍然落到下面的节点/边上
        （点边开抽屉、点节点钉住链路都不受影响）。
        位置跟随鼠标偏移一小段，避免盖住被指的东西本身。
      */}
      {hoverTip ? (
        <div
          className="pointer-events-none absolute z-50 max-w-xs rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-xs leading-relaxed text-fg-default shadow-lg"
          data-testid="access-map-hover-tip"
          style={{ left: hoverTip.x + 12, top: hoverTip.y + 12 }}
        >
          {hoverTip.kind === "node" ? (
            <>
              <div className="font-medium notranslate" translate="no">
                {hoverTip.node.label}
              </div>
              <div className="text-fg-muted">{accessMapNodeSubtitle(hoverTip.node)}</div>
              <div className="text-fg-muted">类型：{accessMapNodeKindLabel(hoverTip.node.kind)}</div>
            </>
          ) : hoverTip.kind === "idle-stub" ? (
            <>
              <div className="font-medium notranslate" translate="no">
                {hoverTip.nodeLabel} → 闲置授权 {hoverTip.idleCount} 条
              </div>
              <div className="text-fg-muted">
                {accessOk ? "有授权，窗口内未调用" : ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CONCLUSION}
              </div>
              <div className="text-fg-muted">
                授权路径 {hoverTip.grantPaths} 条 ·{" "}
                {accessOk ? "调用 0 次" : ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CALLS}
              </div>
            </>
          ) : (
            <>
              <div className="font-medium notranslate" translate="no">
                {labelOfNode(hoverTip.edge.source)} → {labelOfNode(hoverTip.edge.target)}
              </div>
              <div className="text-fg-muted">
                {accessMapEdgeHoverConclusionText(hoverTip.edge, accessOk)}
              </div>
              <div className="text-fg-muted">
                授权路径 {hoverTip.edge.grantPaths} 条 · {accessMapEdgeHoverCallsText(hoverTip.edge, accessOk)}
              </div>
            </>
          )}
        </div>
      ) : null}

      {idleList ? (
        <div
          className="absolute right-3 top-3 z-40 w-72 rounded-md border border-border-default bg-bg-elevated p-3 shadow-lg"
          data-testid="access-map-idle-grant-list"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-fg-body notranslate" translate="no">
              {idleList.nodeLabel} · 闲置授权 {idleList.edges.length} 条
            </h3>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              onClick={() => setIdleList(null)}
            >
              关闭
            </button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1 overflow-auto text-xs">
            {idleList.edges.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-fg-muted hover:bg-bg-subtle notranslate"
                  translate="no"
                  data-testid={`access-map-idle-grant-row-${edge.id}`}
                  onClick={() => {
                    setSelectedEdgeId(edge.id);
                    setIdleList(null);
                  }}
                >
                  {labelOfNode(edge.target)} · 授权路径 {edge.grantPaths} 条
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        键盘可达的节点列表：SVG 本身对屏幕阅读器不友好（§7.5）。
        视觉上不占位（`sr-only`），但仍然留在无障碍树里、仍然可 Tab 聚焦。
        `focus-within:not-sr-only` 让键盘用户聚焦时整组显形，避免焦点落在看不见的按钮上。
      */}
      <ul
        className="sr-only focus-within:not-sr-only flex flex-wrap gap-2"
        data-testid="access-map-node-list"
      >
        {layout.nodes.map((item) => (
          <li key={item.node.id}>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs notranslate"
              translate="no"
              disabled={Boolean(item.node.meta.unresolved)}
              onClick={() => {
                if (item.node.meta.unresolved) return;
                pinNode(item.node.id);
              }}
              onMouseEnter={() => previewNode(item.node.id)}
              onMouseLeave={leaveNode}
              data-testid={`access-map-node-button-${item.node.id}`}
            >
              {item.node.label}
              <span className="ml-1 text-fg-muted">{accessMapNodeSubtitle(item.node)}</span>
            </button>
          </li>
        ))}
      </ul>

      {/*
        边明细面板的**键盘可达入口**（SC-09）。
        SVG `<path onClick>` 只能靠鼠标触发，所以这里给每条非 normal 边一个可聚焦的
        按钮：徽标列表本身就是逐边说明，把它变成按钮即可打开同一个明细面板，
        不需要第二套 UI。
      */}
      {(() => {
        const badgeEdges = [
          ...layout.links.filter((link) => link.edge.state !== "normal").map((link) => link.edge),
          ...layout.idleStubs.flatMap((stub) => stub.idleEdges)
        ];
        const seen = new Set<string>();
        const unique = badgeEdges.filter((edge) => {
          if (seen.has(edge.id)) return false;
          seen.add(edge.id);
          return true;
        });
        if (unique.length === 0) return null;
        return (
          <ul
            className="sr-only focus-within:not-sr-only flex flex-wrap gap-3 text-xs text-fg-muted"
            data-testid="access-map-edge-badges"
          >
            {unique.map((edge) => (
              <li key={`badge-${edge.id}`} data-testid={`access-map-edge-badge-${edge.id}`}>
                <button
                  type="button"
                  className="underline notranslate"
                  translate="no"
                  onClick={() => setSelectedEdgeId(edge.id)}
                  aria-expanded={selectedEdgeId === edge.id}
                  data-testid={`access-map-edge-badge-button-${edge.id}`}
                >
                  {edge.source} → {edge.target}：{accessMapEdgeStateLabel(edge.state)}
                  {edge.confirmedUnauthorized && accessOk
                    ? "（确凿越权：调用当时授权亦不覆盖）"
                    : ""}
                </button>
              </li>
            ))}
          </ul>
        );
      })()}

      {/*
        边明细进右侧抽屉（呈现修订 D6）：明细内容不变，只是不再占据图下方的文档流。
      */}
      <Dialog.Root
        open={Boolean(selectedEdge)}
        onOpenChange={(next) => {
          if (!next) setSelectedEdgeId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="pl-drawer-overlay" />
          <Dialog.Content
            className="pl-drawer-panel"
            data-testid="access-map-edge-drawer"
            aria-describedby="access-map-edge-drawer-description"
          >
            <header className="pl-drawer-header">
              <div>
                <Dialog.Title className="pl-panel-title">关系明细</Dialog.Title>
                <Dialog.Description
                  id="access-map-edge-drawer-description"
                  className="mt-1 text-sm text-fg-muted"
                >
                  一条授权路径在每一跳上各贡献 1；下面按边拆开写。
                </Dialog.Description>
              </div>
              <Dialog.Close className="pl-btn pl-btn--ghost pl-drawer-close pl-drawer-close--prominent">
                关闭
              </Dialog.Close>
            </header>
            <div className="pl-drawer-body min-h-0 flex-1 content-start overflow-auto">
              {selectedEdge ? (
                <section
                  className="rounded-md border border-border-default p-2 text-xs"
                  data-testid="access-map-edge-detail"
                >
                  <h3 className="mb-1 font-semibold text-fg-body notranslate" translate="no">
                    {selectedEdge.source} → {selectedEdge.target}
                  </h3>
                  <ul className="flex flex-col gap-1 text-fg-muted">
                    <li className="notranslate" translate="no">
                      授权路径 {selectedEdge.grantPaths} 条 · 去重 Agent {selectedEdge.grantUsers} 个
                    </li>
                    <li className="notranslate" translate="no">
                      {accessOk ? (
                        <>
                          访问路径 {selectedEdge.accessPaths} 条 · 去重 Agent {selectedEdge.accessUsers}{" "}
                          个 · 调用 {selectedEdge.accessCalls} 次
                        </>
                      ) : (
                        ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CALLS
                      )}
                    </li>
                    <li className="notranslate" translate="no">
                      状态：{accessMapEdgeStateLabel(selectedEdge.state)}
                      {accessOk && selectedEdge.confirmedUnauthorized
                        ? "（确凿越权：调用当时授权亦不覆盖）"
                        : ""}
                    </li>
                    {accessOk
                      ? selectedEdge.reviewEvaluations.map((evaluation) => (
                          <li
                            key={evaluation.pathKey}
                            className="notranslate"
                            translate="no"
                            data-testid={`access-map-edge-detail-path-${evaluation.pathKey}`}
                          >
                            {evaluation.agentId} / {evaluation.roleId} / {evaluation.schema}.
                            {evaluation.sourceName}：{evaluation.calls} 次调用 ·{" "}
                            {evaluation.result === "confirmed_unauthorized"
                              ? "确凿越权（调用当时授权亦不覆盖）"
                              : evaluation.result === "covered_at_call_time"
                                ? "调用当时授权已覆盖"
                                : `需复核（${evaluation.reason ?? "证据不足"}）`}
                          </li>
                        ))
                      : null}
                  </ul>
                </section>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
