import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet } from "../../lib/apiClient";
import { publishSemanticAssets } from "../../lib/semantic-assets";
import { queryKeys } from "../../lib/queryKeys";
import { PublishImpactReview } from "./PublishImpactReview";
import type { SemanticAssetReleaseRecord, SemanticBatchPlanResponse } from "../../lib/types";

/**
 * Lucy v0.25 / L25-11 §3.2 (D13) — the batch plan in the publish workbench.
 *
 * The workbench receives a BATCH ID (a validation id), never a client-provided
 * disk path. It shows the COMPLETE plan:
 *
 *   - the candidates staged by this import, and
 *   - the pending disk changes that already exist and would be indexed too.
 *
 * The index is batch-wide, so a Catalog selection may NOT be presented as a
 * partial activation. The confirmation is bound to the plan digest, and any
 * change to the plan invalidates it (the server re-derives it under the
 * publish lock).
 */

export type PublishBatchPlanPanelProps = {
  validationId: string;
  onPublished?: (release: SemanticAssetReleaseRecord) => void;
};

export function PublishBatchPlanPanel(props: PublishBatchPlanPanelProps) {
  const { validationId, onPublished } = props;
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The idempotency key is stable for the life of this panel: a retry after a
  // disconnect must be recognised as the SAME publish, not a second one.
  const idempotencyKeyRef = useRef(`idem_${validationId}_${Math.random().toString(36).slice(2, 10)}`);

  const planQuery = useQuery({
    queryKey: ["semantic-assets", "plan", validationId],
    queryFn: () =>
      apiGet<SemanticBatchPlanResponse>(
        `/api/semantic-assets/plans/${encodeURIComponent(validationId)}`
      ),
    enabled: Boolean(validationId),
    refetchInterval: (query) => (query.state.data ? 5000 : false)
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      publishSemanticAssets({
        validationId,
        planDigest: planQuery.data?.planDigest,
        overwriteTargets: planQuery.data?.overwriteSet ?? [],
        idempotencyKey: idempotencyKeyRef.current
      }),
    onSuccess: (data) => {
      setConfirmOpen(false);
      toast.success(
        `已受理发布 ${data.release.id}。文件已保存，索引同步中；生效状态以发布记录为准。`,
        { id: "workbench-batch-publish" }
      );
      onPublished?.(data.release);
      void queryClient.invalidateQueries({ queryKey: queryKeys.semanticAssetReleases });
    },
    onError: (err) => {
      const code = (err as { code?: string }).code;
      if (code === "SEMANTIC_PLAN_DIGEST_MISMATCH") {
        toast.error("计划已变化，本次确认已失效，请重新预览后再次确认。", {
          id: "workbench-batch-publish"
        });
        void planQuery.refetch();
        return;
      }
      if (code === "SEMANTIC_IDEMPOTENCY_CONFLICT") {
        toast.error("该幂等键已绑定另一个计划，发布已被拒绝。", { id: "workbench-batch-publish" });
        return;
      }
      toast.error(`发布失败：${err instanceof Error ? err.message : "未知错误"}`, {
        id: "workbench-batch-publish"
      });
    }
  });

  const plan = planQuery.data;
  const candidateRows = useMemo(() => plan?.candidates ?? [], [plan]);
  const unrelatedRows = useMemo(() => plan?.unrelatedDiskChanges ?? [], [plan]);

  if (!validationId) return null;

  return (
    <section
      className="pl-panel mt-4"
      data-testid="workbench-batch-plan"
      aria-label="本次导入批次计划"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="pl-panel-title mb-0">本次导入批次</p>
        {plan ? (
          <span className="text-xs text-fg-muted" data-testid="workbench-batch-plan-digest">
            计划摘要 <span className="notranslate" translate="no">{plan.planDigest.slice(0, 12)}</span>
          </span>
        ) : null}
      </div>

      {planQuery.isLoading ? (
        <p className="pl-notice text-xs" data-testid="workbench-batch-plan-loading">
          正在解析批次计划…
        </p>
      ) : null}

      {planQuery.error ? (
        <p className="pl-notice text-xs" role="alert" data-testid="workbench-batch-plan-error">
          {planQuery.error instanceof Error ? planQuery.error.message : "批次计划不可用"}
        </p>
      ) : null}

      {plan ? (
        <>
          <p className="pl-notice text-xs mt-2" data-testid="workbench-batch-plan-summary">
            本次导入候选 {candidateRows.length} 个目标；另有 {unrelatedRows.length} 个既有待同步磁盘变更会一并进入本次索引。
            索引为整批同步，不能按导入范围局部生效。
          </p>

          {candidateRows.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-medium text-fg-default">本次导入候选</p>
              <ul className="list-none p-0 text-xs text-fg-muted" data-testid="workbench-batch-candidates">
                {candidateRows.map((candidate) => (
                  <li key={candidate.targetPath} className="notranslate" translate="no">
                    {candidate.targetPath}
                    {candidate.overwrite ? "（覆盖已有文件）" : "（新建）"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unrelatedRows.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-medium text-fg-default">既有待同步磁盘变更</p>
              <ul className="list-none p-0 text-xs text-fg-muted" data-testid="workbench-batch-disk-changes">
                {unrelatedRows.map((change) => (
                  <li key={change.targetPath} className="notranslate" translate="no">
                    {change.targetPath}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.overwriteSet.length > 0 ? (
            <p className="pl-notice text-xs mt-2" data-testid="workbench-batch-overwrite">
              确认将覆盖 {plan.overwriteSet.length} 个已存在的目标文件。覆盖确认绑定本次计划摘要；计划一旦变化必须重新确认。
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={() => setConfirmOpen(true)}
              disabled={publishMutation.isPending || candidateRows.length === 0}
              data-testid="workbench-batch-confirm"
            >
              {publishMutation.isPending ? "发布中…" : "确认计划并发布"}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={() => void planQuery.refetch()}
              data-testid="workbench-batch-refresh"
            >
              重新预览
            </button>
          </div>
        </>
      ) : null}

      {confirmOpen && plan ? (
        <div
          className="pl-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="确认导入批次计划"
          data-testid="workbench-batch-confirm-drawer"
        >
          <div className="pl-drawer-panel">
            <header className="pl-drawer-header">
              <h2 className="pl-panel-title mb-0">确认导入批次计划</h2>
            </header>
            <section className="pl-drawer-body">
              <p className="text-sm" data-testid="workbench-batch-confirm-summary">
                本次将写入 {candidateRows.length} 个导入目标，并一并索引 {unrelatedRows.length}{" "}
                个既有待同步磁盘变更。
                {plan.overwriteSet.length > 0
                  ? `其中 ${plan.overwriteSet.length} 个已存在的目标会被覆盖。`
                  : ""}
              </p>
              <p className="text-xs text-fg-muted">
                确认绑定计划摘要{" "}
                <span className="notranslate" translate="no">{plan.planDigest.slice(0, 16)}</span>；
                预览后计划若发生变化，本次确认自动失效。
              </p>
              {/* Spec §4.5 — the staged batch explains its scope with the SAME
                  impact model the regular sync uses. The plan digest and the
                  overwrite confirmation stay as they are. */}
              {plan.impact ? (
                <div data-testid="workbench-batch-impact-review">
                  <PublishImpactReview impact={plan.impact} />
                </div>
              ) : null}
            </section>
            <footer className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button
                className="pl-btn pl-btn--primary"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                data-testid="workbench-batch-confirm-submit"
              >
                {publishMutation.isPending ? "发布中…" : "确认并发布"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
