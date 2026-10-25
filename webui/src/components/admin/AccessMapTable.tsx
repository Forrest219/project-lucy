/**
 * Lucy v0.25 P1-3 — 表格等价视图（无障碍等价物）。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §5.4  折叠只影响渲染，表格视图仍展示全量
 *   §7.5  数据表视图：每行一条边；起点、终点、授权路径数、去重 Agent 数、
 *         访问路径数、调用次数、状态
 *   §10   SC-09 键盘可达、屏幕阅读器可读出全部节点与边
 *
 * 表格读的是**全量** `edges`（不是 `render.edges`），所以图面被折叠时
 * 表格依然是完整的 —— 这是「折叠不影响计数」在 UI 上的落点。
 */
import {
  accessMapEdgeStateLabel,
  type AccessMapEdge,
  type AccessMapNode
} from "./AccessMapTypes";

export type AccessMapTableProps = {
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
};

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
        <div className="pl-data-grid-scroll">
          <table className="pl-data-grid pl-data-table">
            <caption className="sr-only">访问关系图节点清单</caption>
            <thead>
              <tr>
                <th scope="col">节点</th>
                <th scope="col">类型</th>
                <th scope="col" className="notranslate" translate="no">
                  去重 Agent 数
                </th>
                <th scope="col">授权路径数</th>
                <th scope="col">访问路径数</th>
              </tr>
            </thead>
            <tbody>
              {flowNodes.map((node) => (
                <tr key={node.id} data-testid={`access-map-table-node-${node.id}`}>
                  <td className="notranslate" translate="no">
                    {node.label}
                  </td>
                  <td className="notranslate" translate="no">
                    {node.kind}
                  </td>
                  <td>{node.meta.grantUsers ?? 0}</td>
                  <td>{node.meta.grantPaths ?? 0}</td>
                  <td>{node.meta.accessPaths ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="pl-data-grid-frame">
        <div className="pl-data-grid-scroll">
          <table className="pl-data-grid pl-data-table" data-testid="access-map-table-edges">
            <caption className="sr-only">访问关系图表格等价视图：每行一条关系边</caption>
            <thead>
              <tr>
                <th scope="col">起点</th>
                <th scope="col">终点</th>
                <th scope="col">授权路径数</th>
                <th scope="col" className="notranslate" translate="no">
                  去重 Agent 数
                </th>
                <th scope="col">访问路径数</th>
                <th scope="col">调用次数</th>
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
                  <td>{edge.grantPaths}</td>
                  <td>{edge.grantUsers}</td>
                  <td>{edge.accessPaths}</td>
                  <td>{edge.accessCalls}</td>
                  <td>
                    <span
                      className={
                        edge.confirmedUnauthorized
                          ? "text-danger-strong"
                          : edge.state === "normal"
                            ? "text-fg-muted"
                            : "text-warning-strong"
                      }
                    >
                      {accessMapEdgeStateLabel(edge.state)}
                      {edge.confirmedUnauthorized ? "（确凿越权：调用当时授权亦不覆盖）" : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
