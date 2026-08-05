import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { apiGet } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  SemanticAssetReleaseRecord,
  SemanticAssetReleaseStatus,
  SemanticAssetReleaseTrigger,
  SemanticAssetReleasesResponse,
  SemanticAssetValidationRow
} from "../../lib/types";
import { SemanticAssetExportButton } from "../../components/semantic-assets";

type TriggerLabel = "WebUI 发布" | "WebUI 强制重建索引" | "系统";
type ReindexLabel = "成功" | "失败" | "进行中" | "未执行";

const SCOPE_PREVIEW_LIMIT = 2;

/**
 * Coerce a record's `trigger` field into the trigger enum expected by the
 * history page. The backend backfills missing values, but legacy fixtures or
 * optimistic records may still arrive without one, so the helper is lenient.
 */
function coerceTrigger(
  raw: SemanticAssetReleaseTrigger | undefined
): SemanticAssetReleaseTrigger {
  if (raw === "webui_manual_reindex" || raw === "webui_publish") return raw;
  return "webui_publish";
}

function triggerLabelFor(record: SemanticAssetReleaseRecord): TriggerLabel {
  const trigger = coerceTrigger(record.trigger);
  if (trigger === "webui_manual_reindex") return "WebUI 强制重建索引";
  if (trigger === "webui_publish") return "WebUI 发布";
  return "系统";
}

function reindexLabelFor(record: SemanticAssetReleaseRecord): ReindexLabel {
  if (record.status === "reindexing") return "进行中";
  if (record.reindex) return record.reindex.ok ? "成功" : "失败";
  return "未执行";
}

function reindexStatusClass(label: ReindexLabel): string {
  switch (label) {
    case "成功":
      return "pl-publish-history-status pl-publish-history-status--success";
    case "失败":
      return "pl-publish-history-status pl-publish-history-status--danger";
    case "进行中":
      return "pl-publish-history-status pl-publish-history-status--warning";
    case "未执行":
    default:
      return "pl-publish-history-status pl-publish-history-status--muted";
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function statusLabelFor(record: SemanticAssetReleaseRecord): string {
  switch (record.status as SemanticAssetReleaseStatus) {
    case "blocked":
      return "已阻断";
    case "promote_failed":
      return "落盘失败";
    case "reindexing":
      return "Reindex 中";
    case "published":
      return "已发布";
    case "reindex_failed":
      return "Reindex 失败";
    default:
      return record.status;
  }
}

function uniqueConnectionIds(record: SemanticAssetReleaseRecord): string[] {
  const fromField = record.connectionIds ?? [];
  const fromSources = (record.changedSources ?? []).map((s) => s.connectionId);
  return Array.from(new Set([...fromField, ...fromSources].filter(Boolean)));
}

function hasAssetChanges(record: SemanticAssetReleaseRecord): boolean {
  return (
    uniqueConnectionIds(record).length > 0 ||
    (record.changedSources?.length ?? 0) > 0 ||
    (record.files?.length ?? 0) > 0
  );
}

function isEmptyManualReindex(record: SemanticAssetReleaseRecord): boolean {
  return coerceTrigger(record.trigger) === "webui_manual_reindex" && !hasAssetChanges(record);
}

function previewList(items: string[], limit = SCOPE_PREVIEW_LIMIT): { shown: string[]; more: number } {
  const unique = Array.from(new Set(items.filter(Boolean)));
  return {
    shown: unique.slice(0, limit),
    more: Math.max(0, unique.length - limit)
  };
}

type ErrorPanel = { title: string; body: string } | null;

/**
 * Build the body shown in the row's expanded error panel.
 *
 * The audit page must surface every reason a publish batch stopped short of
 * `published`: reindex exit code, validation gate issues, overwrite
 * conflicts, and promote-time exceptions. Reindex stderr is the primary
 * source for reindex failures; validation issues are the primary source
 * for blocked / promote_failed records.
 */
function buildErrorPanel(record: SemanticAssetReleaseRecord): ErrorPanel {
  const reindex = record.reindex;
  const validation = record.validation;
  const validationIssues = collectValidationIssues(validation?.results ?? []);

  // Reindex is the most actionable failure for the analyst — show stderr
  // verbatim so they can grep the original KTX error.
  if (reindex && !reindex.ok) {
    const lines = [
      reindex.stderr?.trim() ? reindex.stderr.trim() : "(stderr 为空)",
      "",
      `exit code: ${reindex.exitCode}`
    ];
    return {
      title: `Reindex 失败 · ${record.id} (exit ${reindex.exitCode})`,
      body: lines.join("\n")
    };
  }

  // Validation gate failure is the most common reason for `blocked`.
  if (record.status === "blocked") {
    const lines: string[] = [];
    if (validationIssues.length > 0) {
      for (const issue of validationIssues) {
        const loc = issue.filePath
          ? `${issue.filePath}${issue.line ? `:${issue.line}` : ""}${issue.column ? `:${issue.column}` : ""}`
          : "(无定位)";
        lines.push(`- [${loc}] ${issue.message}`);
      }
    } else if (reindex && reindex.ok === false) {
      // Some blocked records carry a reindex error envelope as well.
      lines.push(reindex.stderr?.trim() || "(stderr 为空)");
    } else {
      lines.push("(未提供具体错误信息)");
    }
    return {
      title: `发布被阻断 · ${record.id}`,
      body: lines.join("\n")
    };
  }

  // Promote failed: the file system rejected the atomic write. The current
  // release record doesn't capture the thrown error message, so we surface
  // any validation issues and explicitly call out the missing promote log
  // so the operator knows where to look (server stdout / stderr).
  if (record.status === "promote_failed") {
    const lines: string[] = [];
    if (validationIssues.length > 0) {
      lines.push("Promote 之前校验已失败：");
      for (const issue of validationIssues) {
        const loc = issue.filePath
          ? `${issue.filePath}${issue.line ? `:${issue.line}` : ""}`
          : "(无定位)";
        lines.push(`- [${loc}] ${issue.message}`);
      }
    } else {
      lines.push("Promote 阶段发生异常，请查看后端日志定位。");
    }
    return {
      title: `Promote 失败 · ${record.id}`,
      body: lines.join("\n")
    };
  }

  // Validation ran and reported issues even though status is not blocked
  // (e.g. legacy records that finished reindex despite partial failures).
  if (validation && !validation.ok && validationIssues.length > 0) {
    const lines = validationIssues.map(
      (issue) => `- [${issue.filePath ?? "(无定位)"}] ${issue.message}`
    );
    return {
      title: `校验失败 · ${record.id}`,
      body: lines.join("\n")
    };
  }

  return null;
}

function collectValidationIssues(
  rows: SemanticAssetValidationRow[]
): Array<{ message: string; filePath?: string; line?: number; column?: number }> {
  const issues: Array<{ message: string; filePath?: string; line?: number; column?: number }> = [];
  for (const row of rows) {
    for (const issue of row.issues) {
      issues.push(issue);
    }
  }
  return issues;
}

type ChangeScopeProps = {
  record: SemanticAssetReleaseRecord;
};

function ChangeScopeCell({ record }: ChangeScopeProps) {
  if (isEmptyManualReindex(record)) {
    return (
      <span className="pl-publish-history-scope-empty" data-testid="publish-history-scope">
        全库索引重建（无资产变更）
      </span>
    );
  }

  const connections = previewList(uniqueConnectionIds(record));
  const sources = previewList((record.changedSources ?? []).map((s) => s.sourceName));

  return (
    <div className="pl-publish-history-scope" data-testid="publish-history-scope">
      {connections.shown.length > 0 ? (
        <div className="pl-publish-history-scope-primary">
          {connections.shown.map((id, index) => (
            <span key={id}>
              {index > 0 ? "、" : null}
              <span className="notranslate" translate="no">
                {id}
              </span>
            </span>
          ))}
          {connections.more > 0 ? (
            <span className="pl-publish-history-scope-more"> +{connections.more}</span>
          ) : null}
        </div>
      ) : (
        <div className="pl-publish-history-scope-primary text-fg-muted">（无连接信息）</div>
      )}
      {sources.shown.length > 0 ? (
        <div className="pl-publish-history-scope-secondary">
          {sources.shown.map((name, index) => (
            <span key={name}>
              {index > 0 ? "、" : null}
              <span className="notranslate" translate="no">
                {name}
              </span>
            </span>
          ))}
          {sources.more > 0 ? (
            <span className="pl-publish-history-scope-more"> +{sources.more}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ScaleCellProps = {
  record: SemanticAssetReleaseRecord;
};

function ScaleCell({ record }: ScaleCellProps) {
  if (isEmptyManualReindex(record)) {
    return (
      <span className="pl-publish-history-table-num" data-testid="publish-history-scale">
        —
      </span>
    );
  }
  const fileCount = record.files?.length ?? 0;
  const sourceCount = record.changedSources?.length ?? 0;
  return (
    <span className="pl-publish-history-table-num" data-testid="publish-history-scale">
      文件 {fileCount} · 语义源 {sourceCount}
    </span>
  );
}

type RowActionsProps = {
  record: SemanticAssetReleaseRecord;
  expandedDiff: string | null;
  hasErrorPanel: boolean;
  isErrorOpen: boolean;
  onToggleDiff: () => void;
  onToggleError: () => void;
};

function RowActions({
  record,
  expandedDiff,
  hasErrorPanel,
  isErrorOpen,
  onToggleDiff,
  onToggleError
}: RowActionsProps) {
  const hasDiff = Boolean(record.diff && record.diff.trim().length > 0);
  if (!hasDiff && !hasErrorPanel) {
    return <span className="text-fg-muted">—</span>;
  }
  return (
    <div className="pl-publish-history-row-actions">
      {hasDiff ? (
        <button
          type="button"
          className="pl-row-action-link"
          onClick={onToggleDiff}
          aria-expanded={expandedDiff !== null}
          data-testid="publish-history-toggle-diff"
        >
          {expandedDiff !== null ? "收起 Diff" : "查看 Diff"}
        </button>
      ) : null}
      {hasErrorPanel ? (
        <button
          type="button"
          className="pl-row-action-link"
          onClick={onToggleError}
          aria-expanded={isErrorOpen}
          data-testid="publish-history-toggle-error"
        >
          {isErrorOpen ? "收起错误" : "查看错误"}
        </button>
      ) : null}
    </div>
  );
}

type ExpandedPanelProps = {
  title: string;
  body: string;
};

function ExpandedPanel({ title, body }: ExpandedPanelProps) {
  return (
    <div
      className="grid gap-2 border-t border-border-default bg-bg-subtle p-3 text-xs"
      data-testid="publish-history-expanded-panel"
    >
      <strong className="text-fg-default notranslate" translate="no">
        {title}
      </strong>
      <pre className="pl-yaml-preview m-0 max-h-80 whitespace-pre-wrap">{body}</pre>
    </div>
  );
}

export function PublishHistory() {
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  const releasesQuery = useQuery({
    queryKey: queryKeys.semanticAssetReleases,
    queryFn: () => apiGet<SemanticAssetReleasesResponse>("/api/semantic-assets/releases")
  });

  const records = useMemo(
    () => releasesQuery.data?.records ?? [],
    [releasesQuery.data?.records]
  );

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="发布历史与审计"
        description="查看历史发布批次的变更范围与结果，并导出当前工作区语义资产包。"
        badges={
          releasesQuery.data ? (
            <span data-testid="publish-history-count">共 {records.length} 条记录</span>
          ) : null
        }
        actions={
          <SemanticAssetExportButton
            label="导出当前语义资产包 (.zip)"
            variant="secondary"
            testId="publish-history-export-snapshot-header"
          />
        }
      />

      <section
        className="rounded-md border border-border-default bg-bg-surface p-4"
        data-testid="publish-history-section"
      >
        {releasesQuery.isLoading ? <p className="pl-notice">正在加载发布历史…</p> : null}
        {releasesQuery.error ? (
          <p className="pl-error">
            发布历史加载失败：
            {releasesQuery.error instanceof Error
              ? releasesQuery.error.message
              : "未知错误"}
          </p>
        ) : null}

        {records.length === 0 && !releasesQuery.isLoading ? (
          <p className="pl-notice" data-testid="publish-history-empty">
            暂无发布记录。在
            <a className="pl-row-action-link ml-1 mr-1" href="/publish/workbench">
              发布工作台
            </a>
            完成首次发布后，记录会显示在这里。
          </p>
        ) : null}

        {records.length > 0 ? (
          <div className="overflow-x-auto">
            <table
              className="pl-data-grid pl-data-table pl-publish-history-table"
              data-testid="publish-history-table"
            >
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">发布时间</th>
                  <th scope="col">触发方式</th>
                  <th scope="col">操作人</th>
                  <th scope="col">变更范围</th>
                  <th scope="col">规模</th>
                  <th scope="col">
                    <span className="notranslate" translate="no">
                      Reindex
                    </span>{" "}
                    状态
                  </th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => {
                  const trigger = triggerLabelFor(record);
                  const reindex = reindexLabelFor(record);
                  const isDiffOpen = expandedDiffId === record.id;
                  const isErrorOpen = expandedErrorId === record.id;
                  const errorPanel = buildErrorPanel(record);
                  const hasErrorPanel = errorPanel !== null;
                  const serial = index + 1;
                  return (
                    <tr
                      key={record.id}
                      data-testid="publish-history-row"
                      data-trigger={record.trigger ?? "unknown"}
                      data-status={record.status}
                      data-serial={serial}
                    >
                      <td className="pl-publish-history-table-num" data-testid="publish-history-serial">
                        {serial}
                      </td>
                      <td>
                        <div className="pl-publish-history-time">
                          <span className="font-mono notranslate" translate="no">
                            {formatTimestamp(record.createdAt)}
                          </span>
                          <span className="pl-publish-history-time-status">
                            {record.status === "reindexing" ||
                            record.status === "reindex_failed" ? (
                              <span className="notranslate" translate="no">
                                {statusLabelFor(record)}
                              </span>
                            ) : (
                              statusLabelFor(record)
                            )}
                          </span>
                        </div>
                      </td>
                      <td>{trigger}</td>
                      <td>
                        <span className="notranslate" translate="no">
                          {record.actor || "unknown"}
                        </span>
                      </td>
                      <td>
                        <ChangeScopeCell record={record} />
                      </td>
                      <td>
                        <ScaleCell record={record} />
                      </td>
                      <td>
                        <span
                          className={reindexStatusClass(reindex)}
                          data-testid="publish-history-reindex-status"
                          data-label={reindex}
                        >
                          {reindex}
                        </span>
                      </td>
                      <td>
                        <RowActions
                          record={record}
                          expandedDiff={isDiffOpen ? record.diff ?? "" : null}
                          hasErrorPanel={hasErrorPanel}
                          isErrorOpen={isErrorOpen}
                          onToggleDiff={() =>
                            setExpandedDiffId(isDiffOpen ? null : record.id)
                          }
                          onToggleError={() =>
                            setExpandedErrorId(isErrorOpen ? null : record.id)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {records.map((record) => {
          const isDiffOpen = expandedDiffId === record.id;
          const isErrorOpen = expandedErrorId === record.id;
          if (!isDiffOpen && !isErrorOpen) return null;
          const errorPanel = isErrorOpen ? buildErrorPanel(record) : null;
          return (
            <div key={`${record.id}-expanded`} className="mt-3 grid gap-2">
              {isDiffOpen && record.diff ? (
                <ExpandedPanel title={`Diff · ${record.id}`} body={record.diff} />
              ) : null}
              {errorPanel ? <ExpandedPanel title={errorPanel.title} body={errorPanel.body} /> : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}
