/**
 * Lucy v0.25 P1-3 — 表格等价视图（无障碍等价物）。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §5.4  折叠只影响渲染，表格视图仍展示全量
 *   §7.5  数据表视图：每行一条边；起点、终点、授权路径数、去重 Agent 数、
 *         访问路径数、调用次数、状态
 *   §10   SC-09 键盘可达、屏幕阅读器可读出全部节点与边
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` §5.6
 *   可见标题「节点」「关系」；类型列用中文层名；状态用徽章；数字右对齐；表头吸顶。
 *
 * 表格读的是**全量** `edges`（不是 `render.edges`），所以图面被折叠时
 * 表格依然是完整的 —— 这是「折叠不影响计数」在 UI 上的落点。
 */
import {
  accessMapEdgeStateLabel,
  accessMapNodeKindLabel,
  type AccessMapEdge,
  type AccessMapNode
} from "./AccessMapTypes";

export type AccessMapTableProps = {
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
};

/**
 * 状态徽章。
 *
 * 僵尸授权用 warning 徽章、确凿越权用 danger 徽章、正常态用中性徽章。
 * 状态同时有文字，不只靠颜色。
 */
function statusBadgeClass(edge: AccessMapEdge): string {
  if (edge.confirmedUnauthorized || edge.state === "overflow") {
    return "pl-status-badge border-danger-strong bg-danger-soft text-danger-strong";
  }
  if (edge.state === "needs_review" || edge.state === "dormant") {
    return "pl-status-badge pl-status-badge--pending";
  }
  return "pl-status-badge pl-status-badge--disabled";
}

export function AccessMapTable({ nodes, edges }: AccessMapTableProps) {
  const labelById = new Map(nodes.map((node) => [node.id, node.label]));
  const flowNodes = nodes.filter((node) => node.kind !== "token");

  if (edges.length === 0 && flowNodes.length === 0) {
    return (
      <div className="text-sm text-fg-muted" data-testid="access-map-table-empty">
        当前范围内没有可展示的关系。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="access-map-table">
      {/*
        节点也要能被屏幕阅读器读出（SC-09：「读出全部节点与边」）。
        表格只列边是不够的 —— 只有边的表会让读者知道「有这条关系」，
        却不知道这条关系两端各是什么节点、各带多少计数。
      */}
      <section className="pl-data-grid-frame" data-testid="access-map-table-nodes">
        <h3 className="mb-2 text-sm font-semibold text-fg-body">节点</h3>
        <div className="pl-data-grid-scroll pl-audit-grid-scroll">
          <table className="pl-data-grid pl-data-table">
            <caption className="sr-only">访问关系图节点清单</caption>
            <thead>
              <tr>
                <th scope="col">节点</th>
                <th scope="col">类型</th>
                <th scope="col" className="text-right notranslate" translate="no">
                  去重 Agent 数
                </th>
                <th scope="col" className="text-right">
                  授权路径数
                </th>
                <th scope="col" className="text-right">
                  访问路径数
                </th>
              </tr>
            </thead>
            <tbody>
              {flowNodes.map((node) => (
                <tr key={node.id} data-testid={`access-map-table-node-${node.id}`}>
                  <td className="notranslate" translate="no">
                    {node.label}
                  </td>
                  <td>{accessMapNodeKindLabel(node.kind)}</td>
                  <td className="text-right tabular-nums">{node.meta.grantUsers ?? 0}</td>
                  <td className="text-right tabular-nums">{node.meta.grantPaths ?? 0}</td>
                  <td className="text-right tabular-nums">{node.meta.accessPaths ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pl-data-grid-frame">
        <h3 className="mb-2 text-sm font-semibold text-fg-body">关系</h3>
        <div className="pl-data-grid-scroll pl-audit-grid-scroll">
          <table className="pl-data-grid pl-data-table" data-testid="access-map-table-edges">
            <caption className="sr-only">访问关系图表格等价视图：每行一条关系边</caption>
            <thead>
              <tr>
                <th scope="col">起点</th>
                <th scope="col">终点</th>
                <th scope="col" className="text-right">
                  授权路径数
                </th>
                <th scope="col" className="text-right notranslate" translate="no">
                  去重 Agent 数
                </th>
                <th scope="col" className="text-right">
                  访问路径数
                </th>
                <th scope="col" className="text-right">
                  调用次数
                </th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <tr key={edge.id} data-testid={`access-map-table-row-${edge.id}`}>
                  <td className="notranslate" translate="no">
                    {labelById.get(edge.source) ?? edge.source}
                  </td>
                  <td className="notranslate" translate="no">
                    {labelById.get(edge.target) ?? edge.target}
                  </td>
                  <td className="text-right tabular-nums">{edge.grantPaths}</td>
                  <td className="text-right tabular-nums">{edge.grantUsers}</td>
                  <td className="text-right tabular-nums">{edge.accessPaths}</td>
                  <td className="text-right tabular-nums">{edge.accessCalls}</td>
                  <td>
                    <span className={statusBadgeClass(edge)}>
                      {accessMapEdgeStateLabel(edge.state)}
                      {edge.confirmedUnauthorized ? "（确凿越权：调用当时授权亦不覆盖）" : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
