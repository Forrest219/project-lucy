import type { Segment } from "../lib/types";

type Props = {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
  /** Source table name used in the reference example, e.g. superstore_orders */
  tableName?: string;
};

function updateSegment(segments: Segment[], index: number, patch: Partial<Segment>): Segment[] {
  return segments.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

export function SegmentForm({ segments, onChange, tableName }: Props) {
  const exampleKey = tableName ? `${tableName}.active_rows` : "table.active_rows";

  return (
    <div className="pl-segment-editor" data-testid="segment-editor">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="pl-notice mb-0">
          又名：命名筛选 / 可复用过滤器。问答与查询时可按技术名直接引用，例如{" "}
          <code className="notranslate" translate="no">
            segments: [&quot;{exampleKey}&quot;]
          </code>
          。
        </p>
        <button
          type="button"
          className="pl-btn pl-btn--secondary shrink-0"
          data-testid="segment-add"
          onClick={() => onChange([...segments, { name: "", expr: "", description: "" }])}
        >
          新增
        </button>
      </div>

      {segments.length === 0 ? (
        <p className="pl-notice mb-0" data-testid="segment-empty">
          暂无分群。点击「新增」添加一条命名筛选，例如排除已删除行或亏损明细。
        </p>
      ) : (
        <div className="pl-segment-card-list">
          {segments.map((segment, index) => {
            const heading =
              segment.description?.trim() ||
              (segment.name.trim() ? segment.name.trim() : `分群 ${index + 1}`);
            return (
              <article
                className="pl-segment-card"
                data-testid={`segment-card-${index}`}
                key={index}
              >
                <div className="pl-segment-card-header">
                  <label className="pl-field-label min-w-0 flex-1 mb-0">
                    <span>业务含义</span>
                    <input
                      className="pl-input"
                      data-testid={`segment-description-${index}`}
                      onChange={(event) =>
                        onChange(updateSegment(segments, index, { description: event.target.value }))
                      }
                      placeholder="例如：排除逻辑删除行；所有分析查询的基础过滤"
                      value={segment.description ?? ""}
                    />
                  </label>
                  <button
                    aria-label={`删除分群 ${heading}`}
                    className="pl-btn pl-btn--ghost pl-btn--sm shrink-0 self-end"
                    data-testid={`segment-remove-${index}`}
                    onClick={() => onChange(segments.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                  >
                    删除
                  </button>
                </div>

                <div className="pl-segment-card-fields">
                  <label className="pl-field-label">
                    <span>技术名</span>
                    <input
                      className="pl-input notranslate"
                      data-testid={`segment-name-${index}`}
                      onChange={(event) =>
                        onChange(updateSegment(segments, index, { name: event.target.value }))
                      }
                      placeholder="例如：active_rows"
                      translate="no"
                      value={segment.name}
                    />
                  </label>
                  <label className="pl-field-label">
                    <span>筛选条件</span>
                    <input
                      className="pl-input notranslate"
                      data-testid={`segment-expr-${index}`}
                      onChange={(event) =>
                        onChange(updateSegment(segments, index, { expr: event.target.value }))
                      }
                      placeholder="例如：is_deleted = 0"
                      translate="no"
                      value={segment.expr}
                    />
                  </label>
                </div>

                {segment.expr.trim() ? (
                  <p className="pl-segment-card-preview mb-0">
                    等价于 WHERE{" "}
                    <code className="notranslate" translate="no">
                      {segment.expr.trim()}
                    </code>
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
