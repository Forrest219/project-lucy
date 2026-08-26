import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { apiGet } from "../../lib/apiClient";
import {
  PUBLISH_HISTORY_PAGE_SIZE,
  coerceTrigger,
  formatPublishHistoryTs,
  isEmptyManualReindex,
  reindexLabelFor,
  statusLabelFor,
  triggerLabelFor,
  uniqueConnectionIds,
  type ReindexLabel
} from "../../lib/publishHistoryLabels";
import { queryKeys } from "../../lib/queryKeys";
import type {
  SemanticAssetReleaseRecord,
  SemanticAssetReleasesResponse,
  SemanticAssetValidationRow
} from "../../lib/types";

const SCOPE_PREVIEW_LIMIT = 2;
const DEFAULT_TIME_WINDOW = "24h";

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

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") q.set(key, String(value));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

function toDatetimeLocalValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function floorToHourIso(date: Date): string {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function sinceHoursAgoRounded(hours: number): string {
  return floorToHourIso(new Date(Date.now() - hours * 60 * 60 * 1000));
}

function sinceDaysAgo(days: number): string {
  return floorToHourIso(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function sinceForWindowPreset(preset: string): string {
  if (preset === "24h") return sinceHoursAgoRounded(24);
  if (preset === "7d") return sinceDaysAgo(7);
  if (preset === "30d") return sinceDaysAgo(30);
  return "";
}

function previewList(items: string[], limit = SCOPE_PREVIEW_LIMIT): { shown: string[]; more: number } {
  const unique = Array.from(new Set(items.filter(Boolean)));
  return {
    shown: unique.slice(0, limit),
    more: Math.max(0, unique.length - limit)
  };
}

type ErrorPanel = { title: string; body: string } | null;

function buildErrorPanel(record: SemanticAssetReleaseRecord): ErrorPanel {
  const reindex = record.reindex;
  const validation = record.validation;
  const validationIssues = collectValidationIssues(validation?.results ?? []);

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
      lines.push(reindex.stderr?.trim() || "(stderr 为空)");
    } else {
      lines.push("(未提供具体错误信息)");
    }
    return {
      title: `发布被阻断 · ${record.id}`,
      body: lines.join("\n")
    };
  }

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const didInitDefaultWindow = useRef(false);

  const windowPreset = searchParams.get("window") ?? "";
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";
  const trigger = searchParams.get("trigger") ?? "";
  const reindexStatus = searchParams.get("reindexStatus") ?? "";
  const actor = searchParams.get("actor") ?? "";

  useEffect(() => {
    if (didInitDefaultWindow.current) return;
    didInitDefaultWindow.current = true;
    if (searchParams.has("window") || searchParams.has("since") || searchParams.has("until")) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("window", DEFAULT_TIME_WINDOW);
    next.set("since", sinceForWindowPreset(DEFAULT_TIME_WINDOW));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
    setPage(0);
  }

  function applyWindowPreset(preset: string) {
    const next = new URLSearchParams(searchParams);
    if (!preset) {
      next.delete("window");
      next.delete("since");
      next.delete("until");
    } else {
      next.set("window", preset);
      next.set("since", sinceForWindowPreset(preset));
      next.delete("until");
    }
    setSearchParams(next);
    setPage(0);
  }

  function updateSinceLocal(local: string) {
    const next = new URLSearchParams(searchParams);
    const iso = fromDatetimeLocalValue(local);
    if (iso) next.set("since", iso);
    else next.delete("since");
    next.delete("window");
    setSearchParams(next);
    setPage(0);
  }

  function updateUntilLocal(local: string) {
    const next = new URLSearchParams(searchParams);
    const iso = fromDatetimeLocalValue(local);
    if (iso) next.set("until", iso);
    else next.delete("until");
    next.delete("window");
    setSearchParams(next);
    setPage(0);
  }

  const filterParams = useMemo(
    () => ({
      since: since || undefined,
      until: until || undefined,
      trigger: trigger || undefined,
      reindexStatus: reindexStatus || undefined,
      actor: actor || undefined
    }),
    [since, until, trigger, reindexStatus, actor]
  );

  const queryStr = buildQuery({
    ...filterParams,
    limit: PUBLISH_HISTORY_PAGE_SIZE,
    offset: page * PUBLISH_HISTORY_PAGE_SIZE
  });
  const exportUrl = `/api/semantic-assets/releases/export.csv${buildQuery(filterParams)}`;

  const releasesQuery = useQuery({
    queryKey: [...queryKeys.semanticAssetReleases, queryStr],
    queryFn: () => apiGet<SemanticAssetReleasesResponse>(`/api/semantic-assets/releases${queryStr}`)
  });

  const records = releasesQuery.data?.records ?? [];
  const total = releasesQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PUBLISH_HISTORY_PAGE_SIZE) || 1;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="发布记录"
        description="查看历次语义发布的变更范围、执行结果与操作记录。"
        actions={
          <a href={exportUrl} className="pl-btn pl-btn--secondary text-sm" data-testid="publish-history-export-csv">
            导出 CSV
          </a>
        }
      />

      <div className="pl-admin-filterbar" data-testid="publish-history-filterbar">
        <span
          className="text-sm text-fg-muted self-center whitespace-nowrap"
          data-testid="publish-history-time-label"
        >
          时间
        </span>
        <select
          className="pl-input w-32"
          value={windowPreset}
          onChange={(e) => applyWindowPreset(e.target.value)}
          aria-label="时间窗口"
          data-testid="publish-history-window"
        >
          <option value="">全部时间</option>
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </select>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={toDatetimeLocalValue(since)}
          onChange={(e) => updateSinceLocal(e.target.value)}
          aria-label="开始时间"
          data-testid="publish-history-since"
        />
        <span className="text-fg-muted self-center">—</span>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={toDatetimeLocalValue(until)}
          onChange={(e) => updateUntilLocal(e.target.value)}
          aria-label="结束时间"
          data-testid="publish-history-until"
        />
        <select
          className="pl-input w-44"
          value={trigger}
          onChange={(e) => updateParam("trigger", e.target.value)}
          aria-label="触发方式"
          data-testid="publish-history-trigger"
        >
          <option value="">全部触发方式</option>
          <option value="webui_publish">WebUI 发布</option>
          <option value="webui_manual_reindex">WebUI 强制重建索引</option>
        </select>
        <select
          className="pl-input w-36"
          value={reindexStatus}
          onChange={(e) => updateParam("reindexStatus", e.target.value)}
          aria-label="Reindex 状态"
          data-testid="publish-history-reindex-filter"
        >
          <option value="">全部 Reindex 状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="running">进行中</option>
          <option value="not_run">未执行</option>
        </select>
        <input
          className="pl-input w-40 notranslate"
          translate="no"
          placeholder="操作人"
          value={actor}
          onChange={(e) => updateParam("actor", e.target.value)}
          aria-label="操作人"
          data-testid="publish-history-actor"
        />
      </div>

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

        {!releasesQuery.isLoading && !releasesQuery.error ? (
          <>
            <div className="mb-3 text-sm text-fg-muted" data-testid="publish-history-page-range">
              {total === 0
                ? "共 0 条"
                : `${page * PUBLISH_HISTORY_PAGE_SIZE + 1}–${Math.min(
                    (page + 1) * PUBLISH_HISTORY_PAGE_SIZE,
                    total
                  )} / 共 ${total} 条`}
            </div>

            {total === 0 ? (
              <p className="pl-notice" data-testid="publish-history-empty">
                {since || until || trigger || reindexStatus || actor
                  ? "当前筛选下暂无发布记录。"
                  : (
                    <>
                      暂无发布记录。在
                      <a className="pl-row-action-link ml-1 mr-1" href="/publish/workbench">
                        发布工作台
                      </a>
                      完成首次发布后，记录会显示在这里。
                    </>
                  )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="pl-data-grid pl-data-table pl-publish-history-table"
                  data-testid="publish-history-table"
                >
                  <thead>
                    <tr>
                      <th scope="col" className="w-14 whitespace-nowrap">
                        序号
                      </th>
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
                      const triggerLabel = triggerLabelFor(record);
                      const reindex = reindexLabelFor(record);
                      const isDiffOpen = expandedDiffId === record.id;
                      const isErrorOpen = expandedErrorId === record.id;
                      const errorPanel = buildErrorPanel(record);
                      const hasErrorPanel = errorPanel !== null;
                      const serial = page * PUBLISH_HISTORY_PAGE_SIZE + index + 1;
                      return (
                        <tr
                          key={record.id}
                          data-testid="publish-history-row"
                          data-trigger={coerceTrigger(record.trigger)}
                          data-status={record.status}
                          data-serial={serial}
                        >
                          <td
                            className="pl-publish-history-table-num whitespace-nowrap"
                            data-testid="publish-history-serial"
                          >
                            {serial}
                          </td>
                          <td>
                            <div className="pl-publish-history-time">
                              <span className="font-mono notranslate" translate="no">
                                {formatPublishHistoryTs(record.createdAt)}
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
                          <td>{triggerLabel}</td>
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
            )}

            {total > 0 ? (
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost text-sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  data-testid="publish-history-prev"
                >
                  ‹ 上一页
                </button>
                <span className="text-sm text-fg-muted" data-testid="publish-history-page-index">
                  {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost text-sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  data-testid="publish-history-next"
                >
                  下一页 ›
                </button>
              </div>
            ) : null}
          </>
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
