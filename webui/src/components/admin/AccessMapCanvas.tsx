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
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`
 *   §5.3  流带着色（僵尸授权流带回到中性；需复核 warning 虚线；确凿越权 danger 实线）
 *   §5.4  定宽卡片、列标题、流带只画在列与列之间、图区横向滚动
 *   §5.5  边明细进右侧抽屉；Esc 先关抽屉
 *   §5.7  图下清单视觉隐藏但仍可聚焦
 *
 * 布局是**自研**的轻量分层布局，不是 d3-sankey：
 * Spec §8.1 建议引入 `d3-sankey`，但本轮实施计划的硬约束是「不新增运行时依赖」，
 * 两条约束冲突时以实施计划为准。因此这里用纯计算实现同样的语义：
 * 分层 → 层内稳定排序 → 节点高度按流量 → 流带按流量 → 内核按访问路径数起点对齐。
 *
 * 颜色只用语义层 token：授权流带 `brand`、访问内核 `accent`；
 * 需复核用 `warning`、确凿越权用 `danger`；且**状态不只靠颜色区分**
 * （需复核为虚线、确凿越权为实线，并带文字徽标）。
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState, type SVGProps } from "react";
import {
  accessMapEdgeStateLabel,
  accessMapNodeKindLabel,
  accessMapNodeSubtitle,
  type AccessMapEdge,
  type AccessMapEdgeState,
  type AccessMapNode,
  type AccessMapNodeKind
} from "./AccessMapTypes";

/** 节点卡片定宽：约 18 个拉丁字符的宽度。 */
const NODE_WIDTH = 168;
const CARD_PADDING_X = 10;
const CARD_MIN_HEIGHT = 54;
const NODE_GAP = 12;
/** 列间距必须大于卡片宽度，否则流带通道会压到下一列的卡片上。 */
const COLUMN_GAP = 240;
const CANVAS_HEIGHT = 560;
const PADDING = 28;
/** 列标题占的那一行。 */
const COLUMN_HEADER_HEIGHT = 34;
const LABEL_FONT_SIZE = 12;
const SUBTITLE_FONT_SIZE = 10;
const MARKER_FONT_SIZE = 9;
const MARKER_GAP = 8;

/**
 * React 的 `SVGAttributes` 没有声明 `translate`，但它是 HTML 全局属性、
 * SVG 元素同样支持。受保护 DOM 要求所有 connection / schema / table /
 * role / token 标识加 `translate="no"`，这里用一个窄断言补上，运行时行为不变。
 */
const translateNo = { translate: "no" } as SVGProps<SVGTextElement>;

type Point = { x: number; y: number };

export type AccessMapLayoutColumn = {
  depth: number;
  kind: AccessMapNodeKind;
  /** 列标题（中文层名）。 */
  label: string;
  x: number;
};

export type AccessMapLayoutMarker = {
  state: AccessMapEdgeState;
  label: string;
  x: number;
};

export type AccessMapLayoutNode = {
  node: AccessMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 卡片内可见的名称（超长时尾部省略）。 */
  label: string;
  /** 名称文字的绘制盒，用于「文字盒不与流带通道相交」的自检。 */
  labelBox: { x: number; y: number; width: number; height: number };
  /** 卡片上的状态文字标记（§5.3「卡片标记」）。 */
  markers: AccessMapLayoutMarker[];
};

export type AccessMapLayoutLink = {
  edge: AccessMapEdge;
  path: string;
  kernelPath: string | null;
  width: number;
  kernelWidth: number;
  /** 内核比例（相对流带长度）。 */
  kernelRatio: number;
  /** 流带的三次贝塞尔控制点，供「文字盒 vs 流带通道」自检采样。 */
  points: [Point, Point, Point, Point];
};

export type AccessMapLayout = {
  nodes: AccessMapLayoutNode[];
  links: AccessMapLayoutLink[];
  columns: AccessMapLayoutColumn[];
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

/** 估算文字宽度：拉丁字符约 0.55em，中日韩字符约 1em。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += /[⺀-鿿豈-﫿＀-｠]/.test(char) ? 1 : 0.55;
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

/** 卡片标记的顺序（§5.3 的状态表顺序）。 */
const MARKER_STATE_ORDER: AccessMapEdgeState[] = ["dormant", "needs_review", "overflow"];

/**
 * 分层布局。
 *
 * 节点高度与流带宽度都按同一把全局刻度算，所以「带宽 = 授权路径数」在图上是可比的。
 *
 * 节点是**定宽卡片**：名称落在卡片里（超长省略），流带只画在列与列之间，
 * 不再从卡片上压过去。
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

  const contentTop = PADDING + COLUMN_HEADER_HEIGHT;
  const columnFlow = columns.map((column) => column.reduce((sum, node) => sum + flowOf(node), 0));
  const units = columnFlow.map((flow, index) => {
    if (flow <= 0) return Number.POSITIVE_INFINITY;
    const gaps = Math.max(0, columns[index].length - 1) * NODE_GAP;
    return Math.max(0, CANVAS_HEIGHT - COLUMN_HEADER_HEIGHT - gaps) / flow;
  });
  const unit = units.length > 0 ? Math.min(...units) : 1;

  // 卡片上的状态标记：取该节点相邻边上出现过的非正常状态。
  const markerStates = new Map<string, Set<AccessMapEdgeState>>();
  for (const edge of edges) {
    if (edge.state === "normal") continue;
    for (const nodeId of [edge.source, edge.target]) {
      const states = markerStates.get(nodeId) ?? new Set<AccessMapEdgeState>();
      states.add(edge.state);
      markerStates.set(nodeId, states);
    }
  }

  const placed: AccessMapLayoutNode[] = [];
  let maxHeight = 0;
  columns.forEach((column, columnIndex) => {
    const x = PADDING + columnIndex * COLUMN_GAP;
    let y = contentTop;
    for (const node of column) {
      const height = Math.max(CARD_MIN_HEIGHT, flowOf(node) * unit);
      const label = truncateLabel(node.label, NODE_WIDTH - CARD_PADDING_X * 2, LABEL_FONT_SIZE);
      const states = markerStates.get(node.id);
      const markers: AccessMapLayoutMarker[] = [];
      let markerX = x + CARD_PADDING_X;
      for (const state of MARKER_STATE_ORDER) {
        if (!states?.has(state)) continue;
        const markerLabel = accessMapEdgeStateLabel(state);
        markers.push({ state, label: markerLabel, x: markerX });
        markerX += estimateTextWidth(markerLabel, MARKER_FONT_SIZE) + MARKER_GAP;
      }
      placed.push({
        node,
        x,
        y,
        width: NODE_WIDTH,
        height,
        label,
        labelBox: {
          x: x + CARD_PADDING_X,
          y: y + 5,
          width: estimateTextWidth(label, LABEL_FONT_SIZE),
          height: LABEL_FONT_SIZE + 4
        },
        markers
      });
      y += height + NODE_GAP;
    }
    maxHeight = Math.max(maxHeight, y - contentTop - NODE_GAP);
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
    // 流带从源卡片右缘连到目标卡片左缘，不穿过卡片文字盒。
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
      kernelRatio: ratio,
      points: curve
    });
  }

  return {
    nodes: placed,
    links,
    columns: columns.map((column, index) => ({
      depth: depths[index],
      kind: column[0]?.kind ?? "table",
      label: accessMapNodeKindLabel(column[0]?.kind ?? "table"),
      x: PADDING + index * COLUMN_GAP
    })),
    width: PADDING * 2 + Math.max(0, columns.length - 1) * COLUMN_GAP + NODE_WIDTH,
    height: Math.max(CANVAS_HEIGHT, contentTop + maxHeight + PADDING)
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

/**
 * 流带本体着色（呈现修订 §5.3）。
 *
 * 僵尸授权与正常授权**同色**（`series/grant` default）：警告色只留给需复核与确凿越权，
 * 否则「全部为僵尸授权」的图会被涂成一片警告色，读者读不出别的信息。
 * 僵尸授权的状态由卡片上的「僵尸授权」文字承担。
 */
function ribbonStrokeClass(edge: AccessMapEdge): string {
  if (edge.state === "needs_review") return "stroke-warning-strong";
  if (edge.state === "overflow") return "stroke-danger-strong";
  return "stroke-brand";
}

/** 流带线型：需复核为虚线（状态不只靠颜色区分）。 */
function ribbonDashClass(edge: AccessMapEdge): string | undefined {
  if (edge.state === "needs_review") return "6 4";
  return undefined;
}

function kernelStrokeClass(edge: AccessMapEdge): string {
  if (edge.confirmedUnauthorized) return "stroke-danger-strong";
  if (edge.state === "needs_review") return "stroke-warning-strong";
  if (edge.state === "overflow") return "stroke-danger-strong";
  return "stroke-accent";
}

/** 状态不得只靠颜色区分：需复核为虚线，确凿越权为实线。 */
function kernelDashClass(edge: AccessMapEdge): string | undefined {
  if (edge.confirmedUnauthorized) return undefined;
  if (edge.state === "needs_review") return "4 3";
  return undefined;
}

/**
 * 卡片标记的着色。
 *
 * 僵尸授权走中性色：警告色留给需复核与确凿越权，僵尸授权的数量放在指标卡上。
 */
function markerFillClass(state: AccessMapEdgeState): string {
  if (state === "overflow") return "fill-danger-strong";
  if (state === "needs_review") return "fill-warning-strong";
  return "fill-fg-muted";
}

export type AccessMapCanvasProps = {
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  focusNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  /**
   * Esc 且抽屉关闭时清除聚焦（呈现修订 §5.5）。
   * 抽屉开着时 Esc 只关抽屉，由 Radix Dialog 自己处理。
   */
  onClearFocus?: () => void;
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
  onClearFocus,
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

  /**
   * Esc 分两段（呈现修订 §5.5）：抽屉开着 → 只关抽屉；抽屉关着且有聚焦 → 清聚焦。
   * 筛选状态任何时候都不受 Esc 影响。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (selectedEdgeId) return;
      onClearFocus?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedEdgeId, onClearFocus]);

  return (
    <div className="flex flex-col gap-3" data-testid="access-map-canvas">
      {/* 图区横向滚动：不缩小 SVG，也不做窄屏重排。 */}
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={summary}
          data-testid="access-map-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
        >
          {layout.columns.map((column) => (
            <text
              key={`column-${column.depth}`}
              x={column.x}
              y={PADDING + 18}
              className="fill-fg-strong text-[12px] font-medium notranslate"
              data-column-label={column.label}
              {...translateNo}
            >
              {column.label}
            </text>
          ))}
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
                  strokeDasharray={ribbonDashClass(link.edge)}
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
                {/* 全名留在 `<title>`：卡片里的名称过长时会省略。 */}
                <title>
                  {`${node.label} · ${accessMapNodeSubtitle(node)}`}
                </title>
                <rect
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={4}
                  className={`${nodeFillClass(node)} ${isFocus ? "opacity-100" : "opacity-80"}`}
                  onClick={clickable ? () => onSelectNode?.(node.id) : undefined}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                />
                <text
                  x={item.x + CARD_PADDING_X}
                  y={item.y + 17}
                  className="fill-fg-body text-[12px] notranslate"
                  {...translateNo}
                >
                  {item.label}
                </text>
                <text
                  x={item.x + CARD_PADDING_X}
                  y={item.y + 32}
                  className="fill-fg-muted text-[10px] notranslate"
                  {...translateNo}
                >
                  {accessMapNodeSubtitle(node)}
                </text>
                {item.markers.map((marker) => (
                  <text
                    key={marker.state}
                    x={marker.x}
                    y={item.y + 46}
                    className={`text-[9px] notranslate ${markerFillClass(marker.state)}`}
                    {...translateNo}
                  >
                    {marker.label}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

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
        <ul
          className="sr-only focus-within:not-sr-only flex flex-wrap gap-3 text-xs text-fg-muted"
          data-testid="access-map-edge-badges"
        >
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
