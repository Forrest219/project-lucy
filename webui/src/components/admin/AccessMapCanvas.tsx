/**
 * Lucy v0.25 P1-3 — 访问关系图 SVG 画布。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.1  双层对照（流带宽度 = 授权路径数；内核 = 访问路径数，起点对齐）
 *   §4.4  边状态与视觉表现
 *   §7.1  布局（分层从左到右；层内按出流权重降序、id 字典序）
 *   §7.2  节点与边交互（悬停高亮、点击下钻、悬停浮层、点击边看明细）
 *   §7.5  无障碍等价视图（aria 摘要 + 节点列表可聚焦跳转）
 *   §9    Design System（只用语义层 token，禁止裸 hex）
 *
 * 布局是**自研**的轻量分层布局，不是 d3-sankey：
 * Spec §8.1 建议引入 `d3-sankey`，但本轮实施计划的硬约束是「不新增运行时依赖」，
 * 两条约束冲突时以实施计划为准。因此这里用纯计算实现同样的语义：
 * 分层 → 层内稳定排序 → 节点高度按流量 → 流带按流量 → 内核按访问路径数起点对齐。
 *
 * 颜色只用语义层 token：授权流带 `brand`、访问内核 `accent`；
 * 僵尸授权 / 需复核用 `warning`、确凿越权用 `danger`；且**状态不只靠颜色区分**
 * （需复核为虚线、确凿越权为实线，并带文字徽标）。
 */
import { useMemo, useState, type SVGProps } from "react";
import {
  accessMapEdgeStateLabel,
  accessMapNodeSubtitle,
  type AccessMapEdge,
  type AccessMapEdgeState,
  type AccessMapNode
} from "./AccessMapTypes";

const NODE_WIDTH = 14;
const NODE_MIN_HEIGHT = 10;
const NODE_GAP = 10;
const COLUMN_GAP = 190;
const CANVAS_HEIGHT = 560;
const PADDING = 28;

/**
 * React 的 `SVGAttributes` 没有声明 `translate`，但它是 HTML 全局属性、
 * SVG 元素同样支持。受保护 DOM 要求所有 connection / schema / table /
 * role / token 标识加 `translate="no"`，这里用一个窄断言补上，运行时行为不变。
 */
const translateNo = { translate: "no" } as SVGProps<SVGTextElement>;

type Point = { x: number; y: number };

export type AccessMapLayoutNode = {
  node: AccessMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AccessMapLayoutLink = {
  edge: AccessMapEdge;
  path: string;
  kernelPath: string | null;
  width: number;
  kernelWidth: number;
  /** 内核比例（相对流带长度）。 */
  kernelRatio: number;
};

export type AccessMapLayout = {
  nodes: AccessMapLayoutNode[];
  links: AccessMapLayoutLink[];
  width: number;
  height: number;
};

function flowOf(node: AccessMapNode): number {
  return Math.max(node.meta.grantPaths ?? 0, node.meta.accessPaths ?? 0);
}

function edgeWeight(edge: AccessMapEdge): number {
  return edge.grantPaths > 0 ? edge.grantPaths : edge.accessPaths;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 三次贝塞尔按参数 t 截断（De Casteljau）。
 *
 * 访问内核必须**起点对齐**地画在流带里，所以不能用「另一条更短的连线」近似，
 * 得真的把同一条曲线截断 —— 否则内核会飘在流带外侧，读者会以为它是另一条边。
 */
function truncateCubic(points: [Point, Point, Point, Point], t: number): [Point, Point, Point, Point] {
  const a = lerpPoint(points[0], points[1], t);
  const b = lerpPoint(points[1], points[2], t);
  const c = lerpPoint(points[2], points[3], t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  const f = lerpPoint(d, e, t);
  return [points[0], a, d, f];
}

function cubicPath(points: [Point, Point, Point, Point]): string {
  const r = (value: number): number => Math.round(value * 10) / 10;
  const [p0, p1, p2, p3] = points;
  return `M${r(p0.x)},${r(p0.y)} C${r(p1.x)},${r(p1.y)} ${r(p2.x)},${r(p2.y)} ${r(p3.x)},${r(p3.y)}`;
}

/**
 * 分层布局。
 *
 * 节点高度与流带宽度都按同一把全局刻度算，所以「带宽 = 授权路径数」在图上是可比的。
 */
export function layoutAccessMap(
  nodes: AccessMapNode[],
  edges: AccessMapEdge[]
): AccessMapLayout {
  const flowNodes = nodes.filter((node) => node.kind !== "token");
  const depths = [...new Set(flowNodes.map((node) => node.depth))].sort((a, b) => a - b);

  const columns = depths.map((depth) =>
    flowNodes
      .filter((node) => node.depth === depth)
      .sort((a, b) => flowOf(b) - flowOf(a) || a.id.localeCompare(b.id))
  );

  const columnFlow = columns.map((column) => column.reduce((sum, node) => sum + flowOf(node), 0));
  const units = columnFlow.map((flow, index) => {
    if (flow <= 0) return Number.POSITIVE_INFINITY;
    const gaps = Math.max(0, columns[index].length - 1) * NODE_GAP;
    return Math.max(0, CANVAS_HEIGHT - gaps) / flow;
  });
  const unit = units.length > 0 ? Math.min(...units) : 1;

  const placed: AccessMapLayoutNode[] = [];
  let maxHeight = 0;
  columns.forEach((column, columnIndex) => {
    const x = PADDING + columnIndex * COLUMN_GAP;
    let y = PADDING;
    for (const node of column) {
      const height = Math.max(NODE_MIN_HEIGHT, flowOf(node) * unit);
      placed.push({ node, x, y, width: NODE_WIDTH, height });
      y += height + NODE_GAP;
    }
    maxHeight = Math.max(maxHeight, y - PADDING - NODE_GAP);
  });

  const placedById = new Map(placed.map((item) => [item.node.id, item]));

  // 边在节点内的进出偏移：按权重分配，顺序稳定（按对端 id 字典序）。
  const outgoing = new Map<string, AccessMapEdge[]>();
  const incoming = new Map<string, AccessMapEdge[]>();
  for (const edge of edges) {
    if (!placedById.has(edge.source) || !placedById.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.target.localeCompare(b.target));
  for (const list of incoming.values()) list.sort((a, b) => a.source.localeCompare(b.source));

  const outgoingOffset = new Map<string, number>();
  for (const list of outgoing.values()) {
    let cursor = 0;
    for (const edge of list) {
      outgoingOffset.set(edge.id, cursor);
      cursor += Math.max(2, edgeWeight(edge) * unit);
    }
  }
  const incomingOffset = new Map<string, number>();
  for (const list of incoming.values()) {
    let cursor = 0;
    for (const edge of list) {
      incomingOffset.set(edge.id, cursor);
      cursor += Math.max(2, edgeWeight(edge) * unit);
    }
  }

  const links: AccessMapLayoutLink[] = [];
  for (const edge of edges) {
    const source = placedById.get(edge.source);
    const target = placedById.get(edge.target);
    if (!source || !target) continue;
    const width = Math.max(2, edgeWeight(edge) * unit);
    const x0 = source.x + source.width;
    const x1 = target.x;
    const y0 = source.y + (outgoingOffset.get(edge.id) ?? 0) + width / 2;
    const y1 = target.y + (incomingOffset.get(edge.id) ?? 0) + width / 2;
    const midX = (x0 + x1) / 2;
    const curve: [Point, Point, Point, Point] = [
      { x: x0, y: y0 },
      { x: midX, y: y0 },
      { x: midX, y: y1 },
      { x: x1, y: y1 }
    ];

    // 内核比例：访问路径数 / 授权路径数（同量纲），上限 1。
    // 授权路径数为 0（需复核）时没有流带，内核独立成一条警示描边。
    const ratio = edge.grantPaths > 0 ? Math.min(1, edge.accessPaths / edge.grantPaths) : 1;
    const kernelPoints = ratio >= 1 ? curve : truncateCubic(curve, ratio);
    links.push({
      edge,
      path: cubicPath(curve),
      kernelPath: edge.accessPaths > 0 ? cubicPath(kernelPoints) : null,
      width,
      kernelWidth: Math.max(2, edge.accessPaths * unit),
      kernelRatio: ratio
    });
  }

  return {
    nodes: placed,
    links,
    width: PADDING * 2 + Math.max(0, columns.length - 1) * COLUMN_GAP + NODE_WIDTH,
    height: Math.max(CANVAS_HEIGHT, maxHeight + PADDING * 2)
  };
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

function ribbonStrokeClass(edge: AccessMapEdge): string {
  if (edge.state === "needs_review" || edge.state === "overflow") return "stroke-warning-strong";
  if (edge.state === "dormant") return "stroke-warning";
  return "stroke-brand";
}

function kernelStrokeClass(edge: AccessMapEdge): string {
  if (edge.confirmedUnauthorized) return "stroke-danger-strong";
  if (edge.state === "needs_review" || edge.state === "overflow") return "stroke-warning-strong";
  return "stroke-accent";
}

/** 状态不得只靠颜色区分：需复核为虚线，确凿越权为实线。 */
function kernelDashClass(edge: AccessMapEdge): string | undefined {
  if (edge.confirmedUnauthorized) return undefined;
  if (edge.state === "needs_review") return "4 3";
  return undefined;
}

export type AccessMapCanvasProps = {
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  focusNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  /** 无障碍摘要：节点数、边数、信号计数。 */
  summary: string;
  /**
   * 信号筛选：只影响**高亮**，不改变数据本身（§7.2）。
   * null 表示不筛选。
   */
  highlightStates?: AccessMapEdgeState[] | null;
};

export function AccessMapCanvas({
  nodes,
  edges,
  focusNodeId,
  onSelectNode,
  summary,
  highlightStates
}: AccessMapCanvasProps) {
  const layout = useMemo(() => layoutAccessMap(nodes, edges), [nodes, edges]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const highlight =
    highlightStates && highlightStates.length > 0 ? new Set(highlightStates) : null;

  const incident = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const edge of edges) {
      if (edge.source === hoveredNodeId) ids.add(edge.target);
      if (edge.target === hoveredNodeId) ids.add(edge.source);
    }
    return ids;
  }, [hoveredNodeId, edges]);

  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="access-map-canvas">
      <svg
        role="img"
        aria-label={summary}
        data-testid="access-map-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="max-w-full"
      >
        {layout.links.map((link) => {
          const dimmed = highlight ? !highlight.has(link.edge.state) : false;
          const unrelated = incident
            ? !incident.has(link.edge.source) && !incident.has(link.edge.target)
            : false;
          const faded = dimmed || unrelated;
          return (
            <g key={link.edge.id} data-testid={`access-map-link-${link.edge.id}`}>
              <path
                d={link.path}
                fill="none"
                strokeWidth={link.width}
                className={`${ribbonStrokeClass(link.edge)} ${faded ? "opacity-10" : "opacity-30"}`}
              >
                <title>
                  {`${link.edge.source} → ${link.edge.target}：授权路径 ${link.edge.grantPaths} 条 · 访问路径 ${link.edge.accessPaths} 条 · ${accessMapEdgeStateLabel(link.edge.state)}`}
                </title>
              </path>
              {link.kernelPath ? (
                <path
                  d={link.kernelPath}
                  fill="none"
                  strokeWidth={link.kernelWidth}
                  strokeDasharray={kernelDashClass(link.edge)}
                  className={`${kernelStrokeClass(link.edge)} ${faded ? "opacity-15" : "opacity-90"}`}
                  onClick={() => setSelectedEdgeId(link.edge.id)}
                  style={{ cursor: "pointer" }}
                  data-testid={`access-map-kernel-${link.edge.id}`}
                >
                  <title>
                    {`访问路径 ${link.edge.accessPaths} 条 · 调用 ${link.edge.accessCalls} 次 · ${accessMapEdgeStateLabel(link.edge.state)}`}
                  </title>
                </path>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((item) => {
          const { node } = item;
          const isFocus = focusNodeId === node.id;
          const clickable = Boolean(onSelectNode) && !node.meta.unresolved;
          return (
            <g
              key={node.id}
              data-testid={`access-map-node-${node.id}`}
              data-node-kind={node.kind}
              data-unresolved={node.meta.unresolved ? "true" : undefined}
            >
              <rect
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                rx={2}
                className={`${nodeFillClass(node)} ${isFocus ? "opacity-100" : "opacity-80"}`}
                onClick={clickable ? () => onSelectNode?.(node.id) : undefined}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                style={{ cursor: clickable ? "pointer" : "default" }}
              >
                <title>
                  {`${node.label} · ${accessMapNodeSubtitle(node)}`}
                </title>
              </rect>
              <text
                x={item.x + item.width + 6}
                y={item.y + Math.min(12, item.height / 2)}
                className="fill-fg-body text-[11px] notranslate"
                {...translateNo}
              >
                {node.label}
              </text>
              <text
                x={item.x + item.width + 6}
                y={item.y + Math.min(12, item.height / 2) + 13}
                className="fill-fg-muted text-[10px] notranslate"
                {...translateNo}
              >
                {accessMapNodeSubtitle(node)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 键盘可达的节点列表：SVG 本身对屏幕阅读器不友好（§7.5）。 */}
      <ul className="flex flex-wrap gap-2" data-testid="access-map-node-list">
        {layout.nodes.map((item) => (
          <li key={item.node.id}>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs notranslate"
              translate="no"
              disabled={Boolean(item.node.meta.unresolved)}
              onClick={() => onSelectNode?.(item.node.id)}
              onMouseEnter={() => setHoveredNodeId(item.node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
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
      {layout.links.some((link) => link.edge.state !== "normal") ? (
        <ul className="flex flex-wrap gap-3 text-xs text-fg-muted" data-testid="access-map-edge-badges">
          {layout.links
            .filter((link) => link.edge.state !== "normal")
            .map((link) => (
              <li key={`badge-${link.edge.id}`} data-testid={`access-map-edge-badge-${link.edge.id}`}>
                <button
                  type="button"
                  className="underline notranslate"
                  translate="no"
                  onClick={() => setSelectedEdgeId(link.edge.id)}
                  aria-expanded={selectedEdgeId === link.edge.id}
                  data-testid={`access-map-edge-badge-button-${link.edge.id}`}
                >
                  {link.edge.source} → {link.edge.target}：{accessMapEdgeStateLabel(link.edge.state)}
                  {link.edge.confirmedUnauthorized ? "（确凿越权：调用当时授权亦不覆盖）" : ""}
                </button>
              </li>
            ))}
        </ul>
      ) : null}

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
              访问路径 {selectedEdge.accessPaths} 条 · 去重 Agent {selectedEdge.accessUsers} 个 · 调用{" "}
              {selectedEdge.accessCalls} 次
            </li>
            <li className="notranslate" translate="no">
              状态：{accessMapEdgeStateLabel(selectedEdge.state)}
              {selectedEdge.confirmedUnauthorized ? "（确凿越权：调用当时授权亦不覆盖）" : ""}
            </li>
            {selectedEdge.reviewEvaluations.map((evaluation) => (
              <li
                key={evaluation.pathKey}
                className="notranslate"
                translate="no"
                data-testid={`access-map-edge-detail-path-${evaluation.pathKey}`}
              >
                {evaluation.agentId} / {evaluation.roleId} / {evaluation.schema}.{evaluation.sourceName}
                ：{evaluation.calls} 次调用 ·{" "}
                {evaluation.result === "confirmed_unauthorized"
                  ? "确凿越权（调用当时授权亦不覆盖）"
                  : evaluation.result === "covered_at_call_time"
                    ? "调用当时授权已覆盖"
                    : `需复核（${evaluation.reason ?? "证据不足"}）`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
