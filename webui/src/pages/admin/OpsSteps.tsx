import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, userFacingApiErrorMessage } from "../../lib/apiClient";
import { AsyncRegion, asyncStatus } from "../../components/AsyncRegion";
import { PageHeader } from "../../components/PageHeader";

export type OpsStepRow = {
  key: string;
  op: string;
  opId: string;
  step: string;
  phase: "enter" | "leave" | "fail";
  ts: string;
  elapsedMs: number;
  result: "running" | "ok" | "error";
  reasonCode: string;
  state: "running" | "ended" | "previous_incomplete" | "start_truncated";
  enteredAt: string | null;
  durationMs: number | null;
};

export type OpsStepsResponse = {
  history: OpsStepRow[];
  inFlight: OpsStepRow[];
  historyTruncated: boolean;
  truncationReasons: Array<"row_limit" | "age_limit">;
  stdoutWriteFailed: boolean;
  stdoutDroppedCount: number;
  fileWritable: "ok" | "error" | "unknown";
  fileDroppedCount: number;
  formatDroppedCount: number;
  fileWriteReason: "io_error" | "queue_full" | "";
  historyResidual: boolean;
};

type StepFilter = "all" | "running" | "ended" | "previous_incomplete";
type RowBucket = Exclude<StepFilter, "all">;

function rowBucket(row: OpsStepRow, inFlight: boolean): RowBucket {
  if (inFlight) return "running";
  if (row.state === "previous_incomplete") return "previous_incomplete";
  return "ended";
}

function formatEnteredAt(value: string | null): string {
  if (!value) return "未知";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value: number | null): string {
  if (value == null) return "未知";
  if (value < 1000) return `${value} 毫秒`;
  if (value < 60_000) return `${Number((value / 1000).toFixed(1))} 秒`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function resultLabel(row: OpsStepRow, previousIncomplete: boolean): string {
  if (previousIncomplete) return "未记录终态";
  if (row.result === "running") return "进行中";
  if (row.result === "ok") return "成功";
  if (row.result === "error") return "失败";
  return "未知";
}

function resultClass(row: OpsStepRow, previousIncomplete: boolean): string {
  if (previousIncomplete) return "pl-status-neutral";
  if (row.result === "ok") return "pl-status-done";
  if (row.result === "error") return "pl-status-error";
  if (row.result === "running") return "pl-status-pending";
  return "pl-status-neutral";
}

function bucketLabel(bucket: RowBucket): string {
  if (bucket === "running") return "进行中";
  if (bucket === "previous_incomplete") return "上次进程未完成";
  return "已结束";
}

function StepRows({ rows, inFlight }: { rows: OpsStepRow[]; inFlight: boolean }) {
  return (
    <>
      {rows.map((row) => {
        const bucket = rowBucket(row, inFlight);
        const previousIncomplete = bucket === "previous_incomplete";
        const startTruncated = !previousIncomplete && row.enteredAt == null;
        const duration = previousIncomplete
          ? "未知（上次进程未完成）"
          : startTruncated
            ? "未知（起始记录已截断）"
            : formatDuration(row.durationMs);
        return (
          <tr key={row.key} data-testid={`ops-steps-row-${row.key}`}>
            <td>
              <code className="notranslate break-all" translate="no">{row.opId}</code>
            </td>
            <td>
              <code className="notranslate" translate="no">{row.op}</code>
            </td>
            <td>
              <code className="notranslate font-medium" translate="no">{row.step}</code>
            </td>
            <td>
              <span className="notranslate" translate="no" title={row.enteredAt ?? undefined}>
                {formatEnteredAt(row.enteredAt)}
              </span>
              {startTruncated ? <span className="block text-xs text-fg-muted">起始记录已截断</span> : null}
            </td>
            <td className="tabular-nums">{duration}</td>
            <td>
              <span className={`pl-status-badge ${bucket === "running" ? "pl-status-pending" : "pl-status-neutral"}`}>
                {bucketLabel(bucket)}
              </span>
            </td>
            <td>
              <span className={`pl-status-badge ${resultClass(row, previousIncomplete)}`}>
                {resultLabel(row, previousIncomplete)}
              </span>
            </td>
            <td>
              {row.reasonCode ? (
                <code className="notranslate" translate="no">{row.reasonCode}</code>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function StepSection({
  title,
  rows,
  emptyText,
  testId,
  busy,
  inFlight
}: {
  title: string;
  rows: OpsStepRow[];
  emptyText: string;
  testId: string;
  busy: boolean;
  inFlight: boolean;
}) {
  return (
    <section className="pl-panel" data-testid={testId} aria-busy={busy}>
      <div className="pl-section-heading">
        <div>
          <h2 className="pl-panel-title">{title}</h2>
          <p className="pl-notice">共 {rows.length} 个步骤实例</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="pl-empty-state">{emptyText}</div>
      ) : (
        <div className="pl-data-grid-frame min-w-0 max-w-full">
          <div
            className="pl-data-grid-scroll min-w-0 max-w-full w-full"
            role="region"
            aria-label={`${title}表格，可横向滚动`}
            tabIndex={0}
          >
            <table className="pl-data-grid pl-data-table w-full" data-testid={`${testId}-table`}>
              <thead>
                <tr>
                  <th>操作号</th>
                  <th>操作名</th>
                  <th>步骤名</th>
                  <th>进入时间</th>
                  <th>步骤时长</th>
                  <th>状态</th>
                  <th>结果</th>
                  <th>原因码</th>
                </tr>
              </thead>
              <tbody><StepRows rows={rows} inFlight={inFlight} /></tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function WriteHealth({ data }: { data: OpsStepsResponse }) {
  const fileState = data.fileWritable === "ok" ? "可写" : data.fileWritable === "error" ? "写入失败" : "状态未知";
  return (
    <section className="pl-panel" data-testid="ops-steps-write-health">
      <div className="pl-section-heading">
        <div>
          <h2 className="pl-panel-title">记录写入状态</h2>
          <p className="pl-notice">丢行计数只统计当前进程；历史截断与残行隔离不计入丢行。</p>
        </div>
      </div>
      <ul className="grid gap-2 text-sm">
        <li data-testid="ops-steps-stdout-health">
          标准输出：{data.stdoutWriteFailed ? "写入失败" : "未报告写入失败"}；丢行 {data.stdoutDroppedCount} 行。
        </li>
        <li data-testid="ops-steps-file-health">
          文件副本：{fileState}；丢行 {data.fileDroppedCount} 行。
          {data.fileWriteReason ? (
            <> 原因码：<code className="notranslate" translate="no">{data.fileWriteReason}</code>。</>
          ) : null}
        </li>
        <li data-testid="ops-steps-format-health">格式化：丢行 {data.formatDroppedCount} 行。</li>
      </ul>
    </section>
  );
}

export function OpsSteps() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StepFilter>("all");
  const query = useQuery({
    queryKey: ["admin", "ops-steps"],
    queryFn: () => apiGet<OpsStepsResponse>("/api/admin/ops-steps"),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
  const data = query.data;

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const matches = (row: OpsStepRow, inFlight: boolean) => {
      const bucket = rowBucket(row, inFlight);
      const statusMatches = status === "all" || bucket === status;
      const searchMatches = !normalized || [row.opId, row.op, row.step, row.reasonCode]
        .some((value) => value.toLowerCase().includes(normalized));
      return statusMatches && searchMatches;
    };
    return {
      inFlight: (data?.inFlight ?? []).filter((row) => matches(row, true)),
      history: (data?.history ?? []).filter((row) => matches(row, false))
    };
  }, [data, search, status]);

  const totalCount = (data?.inFlight.length ?? 0) + (data?.history.length ?? 0);
  const filteredCount = filtered.inFlight.length + filtered.history.length;
  const hasFilters = Boolean(search.trim()) || status !== "all";
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
  };
  const errorMessage = userFacingApiErrorMessage(query.error);

  return (
    <div className="pl-page-stack" data-testid="ops-steps-page">
      <PageHeader
        title={<span className="notranslate" translate="no">运维步骤</span>}
        breadcrumbs={["运行状态", "运维步骤"]}
        description="按操作号查看进行中、已结束的运维步骤及写入降级。"
        actions={
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-loading={query.isFetching ? "true" : undefined}
            aria-busy={query.isFetching}
            data-testid="ops-steps-refresh"
          >
            {query.isFetching ? "刷新中…" : "刷新"}
          </button>
        }
      />

      {!data ? (
        <AsyncRegion
          status={asyncStatus(query)}
          label="运维步骤列表"
          error={query.error ? new Error(errorMessage) : undefined}
          onRetry={() => void query.refetch()}
          minHeight={320}
        />
      ) : (
        <>
          {query.isFetching ? (
            <p className="pl-notice" role="status" data-testid="ops-steps-refreshing">
              正在刷新运维步骤，已显示的步骤保持不变。
            </p>
          ) : null}
          {query.isError ? (
            <div className="pl-notice" role="alert" data-testid="ops-steps-refresh-error">
              <span>运维步骤刷新失败：{errorMessage}；当前保留上次成功读取的数据。</span>
              <button
                type="button"
                className="pl-btn pl-btn--secondary pl-btn--xs"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
                data-testid="ops-steps-refresh-retry"
              >
                重试
              </button>
            </div>
          ) : null}

          <WriteHealth data={data} />

          {data.historyTruncated ? (
            <p className="pl-notice" role="status" data-testid="ops-steps-truncated">
              历史记录已截断：
              {data.truncationReasons.includes("row_limit") ? "达到 2000 行上限。" : ""}
              {data.truncationReasons.includes("age_limit") ? "达到 1 小时上限。" : ""}
              进行中的步骤不受历史截断影响。
            </p>
          ) : null}
          {data.historyResidual ? (
            <p className="pl-notice" role="status" data-testid="ops-steps-residual">
              启动时已隔离上次进程的历史残行；该残行不计入当前进程文件丢行。
            </p>
          ) : null}

          <section className="pl-card grid gap-4" data-testid="ops-steps-filters" aria-label="运维步骤筛选">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="pl-input max-w-md text-sm notranslate"
                translate="no"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索操作号、操作名、步骤名或原因码"
                aria-label="搜索运维步骤"
              />
              <select
                className="pl-input max-w-[220px] text-sm"
                value={status}
                onChange={(event) => setStatus(event.target.value as StepFilter)}
                aria-label="按步骤状态筛选"
              >
                <option value="all">全部状态</option>
                <option value="running">进行中</option>
                <option value="ended">已结束</option>
                <option value="previous_incomplete">上次进程未完成</option>
              </select>
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={clearFilters}
                disabled={!hasFilters}
                data-testid="ops-steps-clear-filters"
              >
                清除筛选
              </button>
              <span className="text-xs text-fg-muted">
                显示 {filteredCount} / {totalCount} 个步骤实例
              </span>
            </div>
          </section>

          {totalCount === 0 ? (
            <div className="pl-empty-state" data-testid="ops-steps-empty">
              当前没有已记录的运维步骤；执行受支持的运维操作后，步骤实例会显示在这里。
            </div>
          ) : filteredCount === 0 ? (
            <div className="pl-empty-state" data-testid="ops-steps-filter-empty">
              当前筛选条件下没有匹配的步骤实例。请调整条件或使用“清除筛选”。
            </div>
          ) : (
            <>
              <StepSection
                title="进行中"
                rows={filtered.inFlight}
                emptyText="当前筛选条件下没有进行中的步骤。"
                testId="ops-steps-inflight"
                busy={query.isFetching}
                inFlight={true}
              />
              <StepSection
                title="已结束"
                rows={filtered.history}
                emptyText="当前筛选条件下没有已结束的步骤；上次进程未完成的步骤也在此区展示。"
                testId="ops-steps-history"
                busy={query.isFetching}
                inFlight={false}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
