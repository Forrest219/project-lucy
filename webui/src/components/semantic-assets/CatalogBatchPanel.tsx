import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cancelSemanticBatchOperation,
  createSemanticScope,
  exportSemanticMaintenancePackage,
  fetchSemanticBatchOperation,
  startSemanticBatchCheck
} from "../../lib/semantic-assets";
import type {
  SemanticBatchOperation,
  SemanticMaintenanceExportResponse,
  SemanticScopeResponse,
  SemanticTableIdentity
} from "../../lib/types";

/**
 * Lucy v0.25 / L25-11 §3.1 — the Catalog batch action panel.
 *
 * Two jobs:
 *
 *   - 批量下载 (download): resolve the selection into a scope, build a
 *     `semantic-maintenance-package/v1` from it and hand the operator the
 *     download. The server owns every target path.
 *   - 批量校验 (check): resolve the selection into a scope, run the independent
 *     batch validation and show the per-table verdicts.
 *
 * Both actions go through the SAME scope, so the selection the operator sees
 * is the selection the server resolved.
 */

export type CatalogBatchMode = "download" | "check";

export type CatalogBatchPanelProps = {
  open: boolean;
  mode: CatalogBatchMode;
  selection: SemanticTableIdentity[];
  onClose: () => void;
};

const POLL_INTERVAL_MS = 1500;

function identityLabel(identity: SemanticTableIdentity): string {
  return `${identity.connectionId}/${identity.schema}/${identity.table}`;
}

function verdictLabel(verdict: string): string {
  switch (verdict) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "not_run":
      return "未执行";
    case "stale":
      return "已过期";
    default:
      return verdict;
  }
}

export function CatalogBatchPanel(props: CatalogBatchPanelProps) {
  const { open, mode, selection, onClose } = props;
  const [scope, setScope] = useState<SemanticScopeResponse | null>(null);
  const [exportResult, setExportResult] = useState<SemanticMaintenanceExportResponse | null>(null);
  const [operation, setOperation] = useState<SemanticBatchOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    setScope(null);
    setExportResult(null);
    setOperation(null);
    setError(null);
    setBusy(false);
    cancelledRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    cancelledRef.current = false;
    let disposed = false;

    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        // ★ The scope is resolved SERVER-SIDE: the client sends the full
        // identities and the server computes the targets, the dependency
        // closure and the baseline digests (L25-11 §4.1 / §4.2).
        const created = await createSemanticScope({ refs: selection });
        if (disposed || cancelledRef.current) return;
        setScope(created);

        if (mode === "download") {
          const result = await exportSemanticMaintenancePackage({ scopeId: created.scopeId });
          if (disposed || cancelledRef.current) return;
          setExportResult(result);
        } else {
          const accepted = await startSemanticBatchCheck({ scopeId: created.scopeId });
          if (disposed || cancelledRef.current) return;
          setOperation({
            operationId: accepted.operationId,
            taskId: accepted.taskId,
            scopeId: accepted.scopeId,
            status: "queued",
            cancelled: false,
            createdAt: new Date().toISOString(),
            baselineDigest: created.baselineDigest,
            summary: { selected: 0, passed: 0, failed: 0, notRun: 0, stale: 0, dependencies: 0 },
            results: []
          });
        }
      } catch (err) {
        if (!disposed && !cancelledRef.current) {
          setError(err instanceof Error ? err.message : "操作失败");
        }
      } finally {
        if (!disposed) setBusy(false);
      }
    };

    void run();
    return () => {
      disposed = true;
      cancelledRef.current = true;
    };
  }, [open, mode, selection, reset]);

  // Poll the operation while it is still running. The task result is
  // persisted server-side, so leaving the page does not lose it.
  useEffect(() => {
    if (!open || mode !== "check") return;
    const current = operation;
    if (!current) return;
    if (current.status !== "queued" && current.status !== "running") return;

    let disposed = false;
    const timer = window.setInterval(() => {
      void fetchSemanticBatchOperation(current.taskId)
        .then((next) => {
          if (!disposed) setOperation(next);
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [open, mode, operation]);

  const summary = operation?.summary;
  const canCancel = operation?.status === "queued" || operation?.status === "running";

  const previewRows = useMemo(
    () => selection.map((identity) => identityLabel(identity)),
    [selection]
  );

  if (!open) return null;

  return (
    <div
      className="pl-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "download" ? "批量下载语义资产" : "批量校验语义资产"}
      data-testid="catalog-batch-panel"
    >
      <div className="pl-drawer-panel" data-testid="catalog-batch-panel-body">
        <header className="pl-drawer-header">
          <div>
            <p className="pl-eyebrow">语义资产</p>
            <h2 className="pl-panel-title">
              {mode === "download" ? "批量下载语义资产" : "批量校验语义资产"}
            </h2>
            <p className="pl-notice">
              已选择 {selection.length} 张表。目标路径由服务端按表身份解析，客户端不提供落盘路径。
            </p>
          </div>
          <button
            className="pl-btn pl-btn--ghost"
            onClick={onClose}
            data-testid="catalog-batch-close"
          >
            关闭
          </button>
        </header>

        <section className="pl-drawer-body" aria-label="批量对象预览">
          {error ? (
            <div className="pl-drawer-error" role="alert" data-testid="catalog-batch-error">
              <strong>操作被阻断</strong>
              <p className="text-xs">{error}</p>
            </div>
          ) : null}

          <details className="text-xs" open>
            <summary className="cursor-pointer text-fg-default">操作前预览（{selection.length} 张表）</summary>
            <ul
              className="list-none p-0 text-xs text-fg-muted"
              data-testid="catalog-batch-preview"
            >
              {previewRows.map((label) => (
                <li key={label} className="notranslate" translate="no">
                  {label}
                </li>
              ))}
            </ul>
          </details>

          {scope ? (
            <p className="text-xs text-fg-muted" data-testid="catalog-batch-scope">
              范围快照 <span className="notranslate" translate="no">{scope.scopeId}</span> ·{" "}
              {scope.refs.length} 张所选表 · {scope.dependencies.length} 个只读依赖 ·{" "}
              基线 <span className="notranslate" translate="no">{scope.baselineDigest.slice(0, 12)}</span>
            </p>
          ) : null}

          {mode === "download" && exportResult ? (
            <div className="grid gap-2 text-sm" data-testid="catalog-batch-export">
              <p className="text-xs text-fg-muted">
                语义维护包已生成，包含 {exportResult.entryCount} 个条目（可编辑覆盖层 + 只读上下文）。
                导出基线有效期至 <span className="notranslate" translate="no">{exportResult.expiresAt}</span>。
              </p>
              <a
                className="pl-btn pl-btn--primary"
                href={exportResult.downloadUrl}
                data-testid="catalog-batch-download"
              >
                下载语义维护包
              </a>
            </div>
          ) : null}

          {mode === "check" && operation ? (
            <div className="grid gap-2" data-testid="catalog-batch-check">
              <p className="text-xs text-fg-muted">
                任务状态：{operation.status}
                {summary && summary.selected > 0
                  ? ` · 通过 ${summary.passed} / 失败 ${summary.failed} / 未执行 ${summary.notRun} / 已过期 ${summary.stale}`
                  : ""}
              </p>
              {canCancel ? (
                <button
                  className="pl-btn pl-btn--ghost"
                  onClick={() => {
                    void cancelSemanticBatchOperation(operation.taskId)
                      .then((next) => setOperation(next))
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "取消失败")
                      );
                  }}
                  data-testid="catalog-batch-cancel"
                >
                  取消校验
                </button>
              ) : null}
              {operation.reportCsvUrl ? (
                <a
                  className="pl-btn pl-btn--ghost"
                  href={`/api/semantic-assets/operations/${encodeURIComponent(operation.taskId)}/report.csv`}
                  data-testid="catalog-batch-report-csv"
                >
                  下载 CSV 报告
                </a>
              ) : null}
              <ul className="list-none p-0 text-xs" data-testid="catalog-batch-results">
                {operation.results.map((result) => (
                  <li key={`${result.identity.connectionId}/${result.identity.schema}/${result.identity.table}`}>
                    <span className="notranslate" translate="no">
                      {identityLabel(result.identity)}
                    </span>{" "}
                    — {verdictLabel(result.verdict)}
                    {result.reasons.length > 0 ? `：${result.reasons[0]?.message ?? ""}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {busy ? (
            <p className="pl-notice" data-testid="catalog-batch-progress">
              正在解析范围并提交任务…
            </p>
          ) : null}
        </section>

        <footer className="pl-drawer-footer">
          <button className="pl-btn pl-btn--ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
