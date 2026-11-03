import { useMemo, useState } from "react";
import { isWikiBatchRetryable } from "../lib/wikiAccess";
import type { WikiBatchAccessResult, WikiBatchItemStatus } from "../lib/types";

export type WikiBatchResultFilter = "all" | "unfinished" | WikiBatchItemStatus;

const STATUS_LABELS: Record<WikiBatchItemStatus, string> = {
  pending: "待执行",
  applied: "已生效",
  noop: "无变化",
  conflict: "冲突",
  failed: "失败",
  not_run: "未执行",
  needs_review: "待核对"
};

const FILTER_LABELS: Record<WikiBatchResultFilter, string> = {
  all: "全部",
  unfinished: "未完成",
  pending: "待执行",
  applied: "已生效",
  noop: "无变化",
  conflict: "冲突",
  failed: "失败",
  not_run: "未执行",
  needs_review: "待核对"
};

const FILTERS: readonly WikiBatchResultFilter[] = [
  "all",
  "unfinished",
  "applied",
  "noop",
  "conflict",
  "failed",
  "not_run",
  "needs_review"
];

export type WikiBatchAccessResultProps = {
  result: WikiBatchAccessResult;
  /** Retry creates a NEW preview / operation containing only the unfinished keys. */
  onRetryIncomplete?: (keys: string[]) => void;
  retrying?: boolean;
  testId?: string;
};

/**
 * Spec 193 §7.4 — the durable result of a bulk authorization run.
 *
 * The result stays in the Drawer: a partial success is never reduced to a
 * Toast. `needs_review` is visible but explicitly NOT retryable.
 */
export function WikiBatchAccessResult({
  result,
  onRetryIncomplete,
  retrying = false,
  testId = "wiki-batch-result"
}: WikiBatchAccessResultProps) {
  const [filter, setFilter] = useState<WikiBatchResultFilter>("all");

  const retryableKeys = useMemo(
    () => result.items.filter((item) => isWikiBatchRetryable(item.status)).map((item) => item.key),
    [result.items]
  );
  const needsReviewCount = useMemo(
    () => result.items.filter((item) => item.status === "needs_review").length,
    [result.items]
  );

  const visibleItems = useMemo(() => {
    if (filter === "all") return result.items;
    if (filter === "unfinished") {
      return result.items.filter((item) => !["applied", "noop"].includes(item.status));
    }
    return result.items.filter((item) => item.status === filter);
  }, [filter, result.items]);

  return (
    <div className="pl-wiki-batch-result" data-testid={testId}>
      <div className="pl-wiki-batch-result-head">
        <p className="pl-wiki-batch-result-total" data-testid={`${testId}-total`}>
          共 {result.items.length} 篇文档
        </p>
        <p className="pl-wiki-batch-result-note">
          批量授权不是跨文件事务：已完成的文档不会因其他文档失败而回滚。
        </p>
      </div>

      <div
        aria-label="批量结果筛选"
        className="pl-segmented-control pl-segmented-control--auto"
        data-testid={`${testId}-filters`}
        role="group"
      >
        {FILTERS.map((item) => (
          <button
            aria-pressed={filter === item}
            className={
              filter === item
                ? "pl-segmented-control-item pl-segmented-control-item--active"
                : "pl-segmented-control-item"
            }
            data-testid={`${testId}-filter-${item}`}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {FILTER_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="pl-data-grid-scroll">
        <table className="pl-data-grid pl-wiki-batch-result-table" data-testid={`${testId}-table`}>
          <thead>
            <tr>
              <th scope="col">文档</th>
              <th scope="col">状态</th>
              <th scope="col">授权变化</th>
              <th scope="col">错误</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={4}>当前筛选没有匹配的文档。</td>
              </tr>
            ) : (
              visibleItems.map((item) => (
                <tr data-testid={`${testId}-item-${item.key}`} key={item.key}>
                  <td>
                    <code className="notranslate" translate="no">
                      wiki/{item.key}
                    </code>
                    {item.title ? (
                      <span className="pl-wiki-batch-result-title">{item.title}</span>
                    ) : null}
                  </td>
                  <td data-testid={`${testId}-status-${item.key}`}>
                    {STATUS_LABELS[item.status]}
                    {item.status === "needs_review" ? (
                      <span className="pl-wiki-batch-result-note">
                        需运维核对，不可重试
                      </span>
                    ) : null}
                  </td>
                  <td>{item.direction ? item.direction : "—"}</td>
                  <td>
                    {item.error_code ? (
                      <span className="notranslate" translate="no">
                        {item.error_code}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pl-wiki-batch-result-actions">
        <button
          className="pl-btn pl-btn--secondary"
          data-testid={`${testId}-retry`}
          disabled={!onRetryIncomplete || retryableKeys.length === 0 || retrying}
          onClick={() => onRetryIncomplete?.(retryableKeys)}
          type="button"
        >
          仅重试未完成项
        </button>
        {needsReviewCount > 0 ? (
          <p className="pl-wiki-batch-result-note" data-testid={`${testId}-needs-review`}>
            {needsReviewCount} 篇文档待运维核对，不进入重试范围。
          </p>
        ) : null}
      </div>
    </div>
  );
}
