import { Link } from "react-router-dom";
import {
  changeScopeTextFor,
  formatPublishHistoryTs,
  reindexLabelFor,
  statusLabelFor,
  triggerLabelFor
} from "../../lib/publishHistoryLabels";
import type { SemanticAssetReleaseRecord } from "../../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.3 — the right
 * column of the publish workbench.
 *
 * The column shows RECENT ATTEMPTS, not "what is live". A failed or still
 * running attempt must stay visible, and an activation that was never proven
 * must never be dressed up as 已生效. The complete history (filters, export,
 * restore) stays on `/publish/history`; this column only links there.
 */

export type PublishRecentReleasesProps = {
  /** The server already applied `businessChangesOnly=true` and the limit. */
  records: SemanticAssetReleaseRecord[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
};

type ActivationState = {
  text: string;
  tone: "success" | "warning";
};

const ACTIVATION_TONE_CLASS: Record<ActivationState["tone"], string> = {
  success: "border-success-strong bg-success-soft text-success-strong",
  warning: "border-warning-strong bg-warning-soft text-warning-strong"
};

/**
 * The pipeline status and the activation evidence are TWO dimensions: `status`
 * says what the attempt did, `activationStatus` says whether the content is
 * proven live. A legacy `published` record carries no activation proof, so it
 * stays 待确认 — it is never upgraded to 已生效 by this column.
 */
function activationStateFor(record: SemanticAssetReleaseRecord): ActivationState {
  if (record.activationStatus === "confirmed" && record.status === "published") {
    return { text: "已生效", tone: "success" };
  }
  return { text: "生效状态待确认", tone: "warning" };
}

function errorTextOf(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "最近发布记录读取失败。";
}

export function PublishRecentReleases(props: PublishRecentReleasesProps) {
  const { records, isLoading, error, onRetry } = props;
  const errorMessage = errorTextOf(error);

  return (
    <section
      className="pl-panel"
      data-testid="publish-recent-releases"
      aria-label="最近发布"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="pl-panel-title mb-0">最近发布</h2>
        <Link to="/publish/history" className="pl-inline-link text-xs">
          查看发布记录
        </Link>
      </div>

      {/* Loading is a text placeholder — never an empty-state announcement: an
          unknown history must not look like "nothing was ever published". */}
      {isLoading ? (
        <p className="pl-notice text-xs mt-2" data-testid="publish-recent-releases-loading">
          正在加载最近发布…
        </p>
      ) : null}

      {/* A history failure is contained here: it never blocks the left column
          or the activation panel. */}
      {errorMessage ? (
        <div
          className="pl-error mt-2"
          role="alert"
          data-testid="publish-recent-releases-error"
        >
          <p>最近发布加载失败：{errorMessage}</p>
          {onRetry ? (
            <button
              type="button"
              className="pl-btn pl-btn--ghost pl-btn--xs mt-1"
              onClick={onRetry}
              data-testid="publish-recent-releases-retry"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {!isLoading && !errorMessage && records.length === 0 ? (
        <p className="pl-notice text-xs mt-2" data-testid="publish-recent-releases-empty">
          暂无发布记录
        </p>
      ) : null}

      {records.length > 0 ? (
        <ul className="list-none p-0 mt-2" data-testid="publish-recent-releases-list">
          {records.map((record) => {
            const activation = activationStateFor(record);
            return (
              <li
                key={record.id}
                className="border-b border-border-default/40 py-2 last:border-b-0"
                data-testid="publish-recent-release"
                data-activation={activation.tone}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-fg-default">
                    {formatPublishHistoryTs(record.createdAt)}
                  </span>
                  <span className="rounded-pill border border-border-default px-2 py-0.5 text-xs text-fg-default">
                    {statusLabelFor(record)}
                  </span>
                  <span
                    className={`rounded-pill border px-2 py-0.5 text-xs ${ACTIVATION_TONE_CLASS[activation.tone]}`}
                    data-testid="publish-recent-release-activation"
                  >
                    {activation.text}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-default">{changeScopeTextFor(record)}</p>
                <p className="mt-1 text-xs text-fg-muted">
                  重建索引：{reindexLabelFor(record)} · 触发方式：{triggerLabelFor(record)}
                </p>
                {/* The technical id is SECONDARY information — it never leads. */}
                <p className="mt-1 text-xs text-fg-muted notranslate" translate="no">
                  发布 ID {record.id}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
