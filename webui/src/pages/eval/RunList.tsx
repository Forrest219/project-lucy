import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { EvalRun, EvalDomainInfo } from "../../lib/types";

type DomainsResponse = { domains: EvalDomainInfo[] };
type RunsResponse = { total: number; runs: EvalRun[] };

const STATUS_LABELS: Record<string, string> = {
  queued: "等待中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消"
};

const STATUS_CLASS: Record<string, string> = {
  queued: "pl-status-partial",
  running: "pl-status-partial",
  succeeded: "pl-status-done",
  failed: "pl-status-validation_failed",
  cancelled: "pl-status-not_started"
};

export function RunList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [domain, setDomain] = useState("");
  const [showTrigger, setShowTrigger] = useState(false);
  const [triggerForm, setTriggerForm] = useState({
    domain: "",
    caseSelectionMode: "all",
    ktxMcpUrl: "http://localhost:7878/mcp",
    triggerReason: ""
  });

  const { data: domainsData } = useQuery({
    queryKey: ["eval", "domains"],
    queryFn: () => apiGet<DomainsResponse>("/api/eval/domains")
  });
  const domains = domainsData?.domains ?? [];

  const { data: runsData, isLoading } = useQuery({
    queryKey: ["eval", "runs", domain],
    queryFn: () => apiGet<RunsResponse>(`/api/eval/runs${domain ? `?domain=${domain}` : ""}`)
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiPost<{ runId: number; status: string }>("/api/eval/runs", {
      domain: triggerForm.domain,
      caseSelection: { mode: triggerForm.caseSelectionMode },
      ktxMcpUrl: triggerForm.ktxMcpUrl,
      triggerReason: triggerForm.triggerReason || undefined
    }),
    onSuccess: (data) => {
      toast.success(`Run #${data.runId} 已启动`);
      setShowTrigger(false);
      void qc.invalidateQueries({ queryKey: ["eval", "runs"] });
      navigate(`/eval/runs/${data.runId}`);
    },
    onError: (err) => {
      const code = (err as { code?: string }).code;
      if (code === "RUNNER_BUSY") {
        toast.error("当前已有 run 正在执行，请等待完成后再触发");
      } else {
        toast.error(`触发失败：${(err as Error).message}`);
      }
    }
  });

  const runs = runsData?.runs ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">运行历史</h1>
          <p className="text-sm text-fg-muted mt-1">查看 eval run 历史，触发新 run，查看结果详情。</p>
        </div>
        <button
          type="button"
          className="pl-btn pl-btn--primary text-sm"
          onClick={() => {
            setTriggerForm((p) => ({ ...p, domain: domains[0]?.domain ?? "" }));
            setShowTrigger(true);
          }}
        >
          触发新 Run
        </button>
      </div>

      {/* Trigger dialog */}
      {showTrigger && (
        <div className="border border-border rounded p-5 grid gap-4 max-w-lg bg-bg-muted/30">
          <h2 className="font-medium">触发一次 Eval Run</h2>
          <div className="grid gap-1">
            <label className="text-sm font-medium">Domain <span className="text-red-500">*</span></label>
            <select
              className="pl-input"
              value={triggerForm.domain}
              onChange={(e) => setTriggerForm((p) => ({ ...p, domain: e.target.value }))}
            >
              <option value="">— 选择 domain —</option>
              {domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium">Case 选择</label>
            <select
              className="pl-input"
              value={triggerForm.caseSelectionMode}
              onChange={(e) => setTriggerForm((p) => ({ ...p, caseSelectionMode: e.target.value }))}
            >
              <option value="all">全部</option>
              <option value="failed_in_last">上次失败回归</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium">KTX MCP URL</label>
            <input
              className="pl-input"
              value={triggerForm.ktxMcpUrl}
              onChange={(e) => setTriggerForm((p) => ({ ...p, ktxMcpUrl: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium">触发原因（备注）</label>
            <input
              className="pl-input"
              placeholder="例如：语义层 measure 公式更新后验证"
              value={triggerForm.triggerReason}
              onChange={(e) => setTriggerForm((p) => ({ ...p, triggerReason: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => setShowTrigger(false)}>
              取消
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--primary text-sm"
              onClick={() => triggerMutation.mutate()}
              disabled={!triggerForm.domain || triggerMutation.isPending}
            >
              {triggerMutation.isPending ? "启动中…" : "开始"}
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-3">
        <select className="pl-input w-40" value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">全部 domain</option>
          {domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
        </select>
      </div>

      {/* Runs table */}
      {isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : runs.length === 0 ? (
        <div className="pl-notice">暂无 run 记录</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-3 py-2">Run ID</th>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">通过率</th>
                <th className="px-3 py-2">开始时间</th>
                <th className="px-3 py-2">触发原因</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-border hover:bg-bg-muted/50 cursor-pointer"
                  onClick={() => navigate(`/eval/runs/${run.id}`)}
                >
                  <td className="px-3 py-2 font-mono text-xs">#{run.id}</td>
                  <td className="px-3 py-2">{run.domain}</td>
                  <td className="px-3 py-2">
                    <span className={`pl-status-badge ${STATUS_CLASS[run.status] ?? "pl-status-partial"}`}>
                      {STATUS_LABELS[run.status] ?? run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {run.totalCases > 0
                      ? `${run.passCount}/${run.totalCases} (${Math.round((run.passRate ?? 0) * 100)}%)`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted whitespace-nowrap">
                    {new Date(run.startedAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted max-w-xs truncate">
                    {run.triggerReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
