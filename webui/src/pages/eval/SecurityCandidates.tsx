import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";

type SecurityCandidate = {
  id: string;
  normalizedEvent: string;
  decisionReason: string;
  tool: string | null;
  userId: string | null;
  roleIds: string[];
  tableRefs: string[];
  riskTier: "P0" | "P1";
  status: "candidate" | "accepted" | "rejected" | "promoted";
  redactionStatus: string;
  sourceTraceId: string | null;
};

type ExtractResponse = {
  scanned: number;
  inserted: number;
  rejected: number;
  duplicate: number;
};

type PreviewResponse = {
  candidateId: string;
  relPath: string;
  diff: string;
};

function statusLabel(status: SecurityCandidate["status"]): string {
  if (status === "candidate") return "待审定";
  if (status === "accepted") return "已接受";
  if (status === "promoted") return "已入库";
  return "已拒绝";
}

function statusClass(status: SecurityCandidate["status"]): string {
  if (status === "candidate") return "pl-status-partial";
  if (status === "accepted") return "pl-status-done";
  if (status === "promoted") return "pl-status-done";
  return "pl-status-validation_failed";
}

export function SecurityCandidates() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<SecurityCandidate | null>(null);
  const [reviewer, setReviewer] = useState("local-admin");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["eval", "security-candidates"],
    queryFn: () => apiGet<{ candidates: SecurityCandidate[] }>("/api/eval/security-candidates")
  });
  const candidates = data?.candidates ?? [];

  const extractMutation = useMutation({
    mutationFn: () => apiPost<ExtractResponse>("/api/eval/security-candidates/extract", { limit: 200 }),
    onSuccess: (result) => {
      toast.success(`已抽取 ${result.inserted} 个候选，拒绝 ${result.rejected} 个高风险日志`);
      void qc.invalidateQueries({ queryKey: ["eval", "security-candidates"] });
    },
    onError: (err) => toast.error(`抽取失败：${(err as Error).message}`)
  });

  const reviewMutation = useMutation({
    mutationFn: (candidate: SecurityCandidate) => apiPost<{ status: string }>(
      `/api/eval/security-candidates/${encodeURIComponent(candidate.id)}/review`,
      {
        decision: "accept",
        reviewer: { actorKind: "admin", actorId: reviewer, identityProvider: "local-admin" },
        permissionBoundaryConfirmed: true,
        expectedDenialConfirmed: true,
        businessContextConfirmed: true,
        note: "Reviewed from Admin Security Candidate page"
      }
    ),
    onSuccess: () => {
      toast.success("候选已审定");
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["eval", "security-candidates"] });
    },
    onError: (err) => toast.error(`审定失败：${(err as Error).message}`)
  });

  const previewMutation = useMutation({
    mutationFn: (candidate: SecurityCandidate) => apiPost<PreviewResponse>(
      `/api/eval/security-candidates/${encodeURIComponent(candidate.id)}/promote/preview`,
      {}
    ),
    onSuccess: (result) => setPreview(result),
    onError: (err) => toast.error(`生成 Diff 失败：${(err as Error).message}`)
  });

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="安全候选"
        description="从访问拒绝日志中沉淀权限与隔离类 Eval 候选，必须人工审定后才能入库。"
        actions={
          <button
            className="pl-btn pl-btn--primary text-sm"
            type="button"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
          >
            抽取候选
          </button>
        }
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-md border border-border-default bg-bg-surface">
          <div className="border-b border-border-default px-4 py-3 text-sm text-fg-muted">
            {isLoading ? "加载中" : `${candidates.length} 个候选`}
          </div>
          <div className="divide-y divide-border-default">
            {candidates.map((candidate) => (
              <button
                className="block w-full px-4 py-3 text-left hover:bg-bg-muted"
                key={candidate.id}
                type="button"
                onClick={() => {
                  setSelected(candidate);
                  setPreview(null);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="pl-status-badge pl-status-validation_failed">{candidate.riskTier}</span>
                    <span className={`pl-status-badge ${statusClass(candidate.status)}`}>{statusLabel(candidate.status)}</span>
                  </div>
                  <span className="text-xs text-fg-muted notranslate" translate="no">{candidate.tool ?? "unknown_tool"}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-sm text-fg-body">{candidate.normalizedEvent}</div>
                <div className="mt-1 text-xs text-fg-muted notranslate" translate="no">{candidate.decisionReason}</div>
              </button>
            ))}
            {candidates.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-fg-muted">暂无安全候选</div>
            ) : null}
          </div>
        </section>

        <aside className="rounded-md border border-border-default bg-bg-surface p-4">
          {selected ? (
            <div className="grid gap-4">
              <div>
                <div className="text-xs text-fg-muted">Candidate ID</div>
                <div className="mt-1 break-all font-mono text-xs notranslate" translate="no">{selected.id}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">证据摘要</div>
                <div className="mt-1 text-sm">{selected.normalizedEvent}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-fg-muted notranslate" translate="no">Agent</div>
                  <div className="notranslate" translate="no">{selected.userId ?? "unknown"}</div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Trace</div>
                  <div className="truncate notranslate" translate="no">{selected.sourceTraceId ?? "none"}</div>
                </div>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-fg-muted">Reviewer</span>
                <input
                  className="rounded-md border border-border-default bg-bg-surface px-3 py-2"
                  value={reviewer}
                  onChange={(event) => setReviewer(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-border-default px-3 py-2 text-sm"
                  type="button"
                  onClick={() => reviewMutation.mutate(selected)}
                  disabled={reviewMutation.isPending || selected.status === "promoted"}
                >
                  审定接受
                </button>
                <button
                  className="rounded-md border border-border-default px-3 py-2 text-sm"
                  type="button"
                  onClick={() => previewMutation.mutate(selected)}
                  disabled={previewMutation.isPending}
                >
                  生成 Diff
                </button>
              </div>
              {preview ? (
                <div>
                  <div className="mb-2 text-xs text-fg-muted notranslate" translate="no">{preview.relPath}</div>
                  <pre className="max-h-80 overflow-auto rounded-md bg-bg-muted p-3 text-xs notranslate" translate="no">{preview.diff}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-fg-muted">选择候选后审定或生成 Diff</div>
          )}
        </aside>
      </div>
    </div>
  );
}
