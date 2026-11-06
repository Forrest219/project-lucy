/**
 * 访问关系图「数据表」—— 同投影小时级调用明细。
 *
 * Authority: `docs/specs/lucy-20261104-access-map-hourly-detail-spec.md` §5.4／D10
 *   列：小时 · Agent · 角色 · 连接 · Schema · 表 · 问询种类 · 访问等级 · 允许调用 · 拒绝调用
 *   标识列 notranslate；inquiryKind === null →「无关联」；分页读 detailLimit／detailOffset。
 *
 * Spec 187 §7.5 全边等价主表义务已按 D11 能力收缩：本表不再列 dormant／边状态。
 */
import {
  accessMapDetailAccessGradeLabel,
  accessMapDetailInquiryKindLabel,
  type AccessMapHourlyDetail,
  type AccessMapHourlyDetailRow,
  type AccessMapNode
} from "./AccessMapTypes";

export type AccessMapTableProps = {
  detail: AccessMapHourlyDetail;
  /** 可选：用图节点 label 补 Agent 展示名。 */
  nodes?: AccessMapNode[];
  onPageChange: (nextOffset: number) => void;
};

function agentLabel(row: AccessMapHourlyDetailRow, nodes: AccessMapNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return row.agentId;
  const hit = nodes.find(
    (node) =>
      node.kind === "agent" &&
      (node.id === `agent:${row.agentId}` || node.id === row.agentId || node.label === row.agentId)
  );
  if (!hit) return row.agentId;
  return hit.label === row.agentId ? row.agentId : `${hit.label}（${row.agentId}）`;
}

export function AccessMapTable({ detail, nodes, onPageChange }: AccessMapTableProps) {
  const { rows, hasMore, totalRowCount, limit, offset } = detail;
  const pageEnd = Math.min(offset + rows.length, totalRowCount);
  const canPrev = offset > 0;
  const canNext = hasMore;

  return (
    <div className="flex flex-col gap-3" data-testid="access-map-table">
      <section className="pl-data-grid-frame">
        <div className="pl-data-grid-scroll pl-audit-grid-scroll">
          <table className="pl-data-grid pl-data-table" data-testid="access-map-hourly-detail">
            <caption className="sr-only">访问关系图小时调用明细</caption>
            <thead>
              <tr>
                <th scope="col">小时</th>
                <th scope="col" className="notranslate" translate="no">
                  Agent
                </th>
                <th scope="col" className="notranslate" translate="no">
                  角色
                </th>
                <th scope="col" className="notranslate" translate="no">
                  连接
                </th>
                <th scope="col" className="notranslate" translate="no">
                  Schema
                </th>
                <th scope="col" className="notranslate" translate="no">
                  表
                </th>
                <th scope="col">问询种类</th>
                <th scope="col">访问等级</th>
                <th scope="col" className="text-right">
                  允许调用
                </th>
                <th scope="col" className="text-right">
                  拒绝调用
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rowKey = [
                  row.hour,
                  row.agentId,
                  row.roleId,
                  row.connectionId,
                  row.schema,
                  row.table,
                  row.inquiryKind ?? "null",
                  row.accessGrade,
                  String(index)
                ].join("|");
                return (
                  <tr key={rowKey} data-testid={`access-map-detail-row-${index}`}>
                    <td className="notranslate tabular-nums" translate="no">
                      {row.hour}
                    </td>
                    <td className="notranslate" translate="no">
                      {agentLabel(row, nodes)}
                    </td>
                    <td className="notranslate" translate="no">
                      {row.roleId}
                    </td>
                    <td className="notranslate" translate="no">
                      {row.connectionId}
                    </td>
                    <td className="notranslate" translate="no">
                      {row.schema}
                    </td>
                    <td className="notranslate" translate="no">
                      {row.table}
                    </td>
                    <td data-testid={`access-map-detail-inquiry-${index}`}>
                      {accessMapDetailInquiryKindLabel(row.inquiryKind)}
                    </td>
                    <td>{accessMapDetailAccessGradeLabel(row.accessGrade)}</td>
                    <td className="text-right tabular-nums">{row.allowCalls}</td>
                    <td className="text-right tabular-nums">{row.denyCalls}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div
        className="flex flex-wrap items-center gap-3 text-xs text-fg-muted"
        data-testid="access-map-detail-pagination"
      >
        <span data-testid="access-map-detail-page-summary">
          {totalRowCount === 0
            ? "共 0 行"
            : `第 ${offset + 1}–${pageEnd} 行 · 共 ${totalRowCount} 行`}
          {hasMore ? " · 还有更多" : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-detail-prev"
            disabled={!canPrev}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            上一页
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-detail-next"
            disabled={!canNext}
            onClick={() => onPageChange(offset + limit)}
          >
            下一页
          </button>
        </div>
        {hasMore ? (
          <span className="text-warning-strong" data-testid="access-map-detail-has-more">
            当前为分页结果，不是完整明细。
          </span>
        ) : null}
      </div>
    </div>
  );
}
