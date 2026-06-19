import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../../lib/apiClient";
import type { EvalRunWithResults } from "../../lib/types";

const STATUS_CLASS: Record<string, string> = {
  queued: "pl-status-partial",
  running: "pl-status-partial",
  succeeded: "pl-status-done",
  failed: "pl-status-validation_failed",
  cancelled: "pl-status-not_started"
};

type SseProgress = {
  current?: number;
  caseId?: string;
};

type SseCaseDone = {
  caseId: string;
  status: "PASS" | "FAIL";
};

type SseFinished = {
  runId: number;
  passCount?: number;
  failCount?: number;
  totalCases?: number;
  status?: string;
};

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [sseProgress, setSseProgress] = useState<{ current: number; caseId: string } | null>(null);
  const [sseCaseDone, setSseCaseDone] = useState<Record<string, "PASS" | "FAIL">>({});
  const [sseFinished, setSseFinished] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: runData, isLoading, refetch } = useQuery({
    queryKey: ["eval", "run", runId],
    queryFn: () => apiGet<EvalRunWithResults>(`/api/eval/runs/${runId}`),
    refetchInterval: sseFinished ? false : undefined
  });

  const run = runData;

  // SSE subscription for running runs
  useEffect(() => {
    if (!runId || !run) return;
    if (run.status !== "running" && run.status !== "queued") return;

    const es = new EventSource(`/api/eval/runs/${runId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data) as SseProgress;
      if (d.caseId) {
        setSseProgress({ current: d.current ?? 0, caseId: d.caseId });
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

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-2">
        <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => navigate("/eval/runs")}>
          ‹ 返回
        </button>
        <h1 className="text-xl font-semibold">Run #{run.id}</h1>
        <span className={`pl-status-badge ${STATUS_CLASS[run.status] ?? "pl-status-partial"}`}>{run.status}</span>
      </div>

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
          <span className="text-fg-muted ml-2">({sseProgress.current} 个已处理)</span>
        </div>
      )}

      {/* Case results */}
      {results.length > 0 && (
        <div>
          <h2 className="font-medium mb-3">Case 明细</h2>
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
                  <>
                    <tr
                      key={c.caseId}
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
                    {expandedCase === c.caseId && !isPassed && (
                      <tr key={`${c.caseId}-expand`} className="border-b border-border bg-bg-muted/20">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="grid gap-2 text-xs">
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
                  </>
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
