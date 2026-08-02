import { Fragment, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../../lib/apiClient";
import type { EvalRun, EvalRunCompare, EvalRunWithResults } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

const STATUS_CLASS: Record<string, string> = {
  queued: "pl-status-partial",
  running: "pl-status-partial",
  succeeded: "pl-status-done",
  failed: "pl-status-validation_failed",
  cancelled: "pl-status-not_started"
};

type SseProgress = {
  current?: number;
  total?: number;
  caseId?: string;
};

type SseCaseDone = {
  caseId: string;
  status: "PASS" | "FAIL" | "SKIPPED" | "ERROR";
};

type SseFinished = {
  runId: number;
  passCount?: number;
  failCount?: number;
  totalCases?: number;
  status?: string;
};

type RunsResponse = { total: number; runs: EvalRun[] };

const DRIFT_LABELS: Record<string, string> = {
  pass: "pass",
  data_drift: "data_drift",
  schema_drift: "schema_drift",
  logic_regression: "logic_regression",
  tool_error: "tool_error"
};

const DELTA_LABELS: Record<string, string> = {
  regressed: "新增失败",
  fixed: "已修复",
  unchanged: "无变化",
  added: "新增 Case",
  removed: "移除 Case"
};

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [sseProgress, setSseProgress] = useState<{ current: number; total?: number; caseId: string } | null>(null);
  const [sseCaseDone, setSseCaseDone] = useState<Record<string, "PASS" | "FAIL" | "SKIPPED" | "ERROR">>({});
  const [sseFinished, setSseFinished] = useState(false);
  const [compareWith, setCompareWith] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: runData, isLoading, refetch } = useQuery({
    queryKey: ["eval", "run", runId],
    queryFn: () => apiGet<EvalRunWithResults>(`/api/eval/runs/${runId}`),
    refetchInterval: sseFinished ? false : undefined
  });

  const run = runData;

  const { data: runsData } = useQuery({
    queryKey: ["eval", "runs", run?.domain],
    queryFn: () => apiGet<RunsResponse>(`/api/eval/runs?domain=${run?.domain ?? ""}&limit=50`),
    enabled: Boolean(run?.domain)
  });

  const { data: compareData } = useQuery({
    queryKey: ["eval", "run", runId, "compare", compareWith],
    queryFn: () => apiGet<EvalRunCompare>(`/api/eval/runs/${runId}/compare?with=${compareWith}`),
    enabled: Boolean(runId && compareWith)
  });

  // SSE subscription for running runs
  useEffect(() => {
    if (!runId || !run) return;
    if (run.status !== "running" && run.status !== "queued") return;

    const es = new EventSource(`/api/eval/runs/${runId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data) as SseProgress;
      if (d.caseId) {
        setSseProgress({ current: d.current ?? 0, total: d.total, caseId: d.caseId });
      }
    });

    es.addEventListener("case_done", (e) => {
      const d = JSON.parse(e.data) as SseCaseDone;
      setSseCaseDone((prev) => ({ ...prev, [d.caseId]: d.status }));
    });

    es.addEventListener("finished", (e) => {
      setSseFinished(true);
      es.close();
      void refetch();
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId, run?.status]);

  if (isLoading || !run) {
    return <div className="pl-notice">{isLoading ? "加载中…" : "Run 不存在"}</div>;
  }

  const results = run.results ?? [];
  const passCount = run.passCount;
  const failCount = run.failCount;
  const totalCases = run.totalCases;
  const passRate = totalCases > 0 ? (passCount / totalCases) * 100 : 0;
  const comparableRuns = (runsData?.runs ?? []).filter((candidate) => candidate.id !== run.id);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Run #${run.id}`}
        backAction={
          <button
            type="button"
            className="pl-page-header-back"
            onClick={() => navigate("/eval/runs")}
          >
            ‹ 返回运行历史
          </button>
        }
        badges={
          <>
            <span className={`pl-status-badge ${STATUS_CLASS[run.status] ?? "pl-status-partial"}`}>{run.status}</span>
            <span>{run.domain}</span>
            <span>通过率 {passRate.toFixed(1)}%</span>
          </>
        }
        actions={
          <>
            <a className="pl-btn pl-btn--ghost text-sm" href={`/api/eval/runs/${run.id}/artifact?type=json`} download>
              下载 JSON
            </a>
            <a className="pl-btn pl-btn--ghost text-sm" href={`/api/eval/runs/${run.id}/artifact?type=md`} download>
              下载 MD
            </a>
          </>
        }
      />

      {/* Summary */}
      <div className="border border-border rounded p-4 grid gap-2 text-sm">
        <div className="flex flex-wrap gap-4">
          <span><span className="text-fg-muted">Domain：</span>{run.domain}</span>
          <span><span className="text-fg-muted">开始：</span>{new Date(run.startedAt).toLocaleString("zh-CN")}</span>
          {run.finishedAt && (
            <span><span className="text-fg-muted">结束：</span>{new Date(run.finishedAt).toLocaleString("zh-CN")}</span>
          )}
          <span><span className="text-fg-muted">触发人：</span>{run.triggeredBy}</span>
        </div>
        {run.triggerReason && (
          <div><span className="text-fg-muted">原因：</span>{run.triggerReason}</div>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="text-lg font-semibold">{Math.round(passRate)}%</span>
          <span className="text-fg-muted">{passCount} PASS / {failCount} FAIL / 共 {totalCases} 个</span>
        </div>
        {/* Progress bar */}
        {totalCases > 0 && (
          <div className="w-full bg-bg-muted rounded-full h-2 mt-1">
            <div
              className="bg-green-500 h-2 rounded-full"
              style={{ width: `${passRate}%` }}
            />
          </div>
        )}
      </div>

      {/* Live progress indicator */}
      {(run.status === "running" || run.status === "queued") && sseProgress && (
        <div className="border border-border rounded p-3 text-sm bg-bg-muted/30">
          <span className="text-fg-muted">正在运行：</span>
          <span className="font-mono">{sseProgress.caseId}</span>
          <span className="text-fg-muted ml-2">
            ({sseProgress.current}{sseProgress.total ? `/${sseProgress.total}` : ""} 个已处理)
          </span>
        </div>
      )}

      <div className="border border-border rounded p-4 grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-sm mb-0">Run 对比</p>
          <select
            className="pl-input w-48 text-sm"
            value={compareWith}
            onChange={(e) => setCompareWith(e.target.value)}
          >
            <option value="">选择对比 run</option>
            {comparableRuns.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                #{candidate.id} · {new Date(candidate.startedAt).toLocaleString("zh-CN")}
              </option>
            ))}
          </select>
        </div>
        {compareData ? (
          <div className="grid gap-3">
            <div className="flex gap-4 text-xs text-fg-muted">
              <span>新增失败 {compareData.summary.regressed}</span>
              <span>已修复 {compareData.summary.fixed}</span>
              <span>无变化 {compareData.summary.unchanged}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="px-3 py-2">Case ID</th>
                    <th className="px-3 py-2">对比 Run</th>
                    <th className="px-3 py-2">当前 Run</th>
                    <th className="px-3 py-2">变化</th>
                  </tr>
                </thead>
                <tbody>
                  {compareData.byCase.map((item) => (
                    <tr key={item.caseId} className="border-b border-border">
                      <td className="px-3 py-2 font-mono">{item.caseId}</td>
                      <td className="px-3 py-2">{item.left ?? "—"}</td>
                      <td className="px-3 py-2">{item.right ?? "—"}</td>
                      <td className="px-3 py-2">{DELTA_LABELS[item.delta] ?? item.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-xs text-fg-muted">选择一个历史 run 后查看 regressed / fixed / unchanged。</div>
        )}
      </div>

      {/* Case results */}
      {results.length > 0 && (
        <div>
          <p className="font-medium mb-3">Case 明细</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-3 py-2">Case ID</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">失败断言</th>
                <th className="px-3 py-2">耗时</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => {
                // Merge SSE real-time status
                const liveStatus = sseCaseDone[c.caseId] ?? c.status;
                const isPassed = liveStatus === "PASS";
                return (
                  <Fragment key={c.caseId}>
                    <tr
                      className="border-b border-border hover:bg-bg-muted/50 cursor-pointer"
                      onClick={() => setExpandedCase(expandedCase === c.caseId ? null : c.caseId)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{c.caseId}</td>
                      <td className="px-3 py-2">
                        <span className={`pl-status-badge ${isPassed ? "pl-status-done" : "pl-status-validation_failed"}`}>
                          {liveStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {c.failedAssertions?.length ? c.failedAssertions[0] : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                    </tr>
                    {expandedCase === c.caseId && (
                      <tr className="border-b border-border bg-bg-muted/20">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="grid gap-3 text-xs">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              <div>
                                <div className="text-fg-muted">Drift</div>
                                <div className="font-mono">{DRIFT_LABELS[c.drift ?? ""] ?? c.drift ?? (isPassed ? "pass" : "—")}</div>
                              </div>
                              <div>
                                <div className="text-fg-muted">Exit Code</div>
                                <div className="font-mono">{c.exitCode ?? "—"}</div>
                              </div>
                              <div>
                                <div className="text-fg-muted">SQL</div>
                                <div>{c.sql ? "已捕获" : "未捕获"}</div>
                              </div>
                              <div>
                                <div className="text-fg-muted">Final Text</div>
                                <div>{c.finalText ? "已捕获" : "未捕获"}</div>
                              </div>
                            </div>
                            {c.errorMessage && (
                              <div>
                                <span className="font-medium text-red-500">错误：</span>
                                <span className="text-fg-muted ml-1">{c.errorMessage}</span>
                              </div>
                            )}
                            {c.failedAssertions && c.failedAssertions.length > 0 && (
                              <div>
                                <span className="font-medium">失败断言：</span>
                                <ul className="ml-2 list-disc list-inside text-fg-muted">
                                  {c.failedAssertions.map((f, i) => <li key={i}>{f}</li>)}
                                </ul>
                              </div>
                            )}
                            <div className="grid md:grid-cols-2 gap-3">
                              <div>
                                <div className="font-medium mb-1">Expected</div>
                                <pre className="bg-bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{formatJson(c.expected)}</pre>
                              </div>
                              <div>
                                <div className="font-medium mb-1">Actual</div>
                                <pre className="bg-bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{formatJson(c.actual)}</pre>
                              </div>
                            </div>
                            <div>
                              <div className="font-medium mb-1">SQL</div>
                              <pre className="bg-bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{c.sql ?? "未捕获 SQL"}</pre>
                            </div>
                            {c.finalText && (
                              <div>
                                <div className="font-medium mb-1">Final Text</div>
                                <pre className="bg-bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{c.finalText}</pre>
                              </div>
                            )}
                            <div>
                              <button
                                type="button"
                                className="pl-btn pl-btn--ghost text-xs"
                                onClick={() => navigate(`/eval/cases/${run.domain}/${c.caseId}`)}
                              >
                                跳到 Case 编辑 →
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {results.length === 0 && (run.status === "running" || run.status === "queued") && (
        <div className="pl-notice">等待 case 结果…</div>
      )}
    </div>
  );
}
