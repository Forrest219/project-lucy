import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { useState } from "react";
import { DiffViewer } from "./DiffViewer";
import type { SavePreflightState } from "../lib/wiki";

export type WikiSavePreflightProps = {
  open: boolean;
  state: SavePreflightState;
  /** `true` when the parent is mid-save. The confirm button shows a spinner. */
  isSaving: boolean;
  onCancel: () => void;
  onConfirmSave: () => void;
};

/**
 * Save Preflight modal.
 *
 * Surfaces the target file path, client-side validation findings and
 * the dry-run diff. The `Raw` body lives behind a collapsed disclosure
 * to keep the main flow uncluttered. The user must confirm here before
 * `dryRun:false` is sent to the Wiki API.
 */
export function WikiSavePreflight({
  open,
  state,
  isSaving,
  onCancel,
  onConfirmSave
}: WikiSavePreflightProps) {
  const [showRaw, setShowRaw] = useState(false);
  const hasError = state.findings.some((finding) => finding.level === "error");
  const previewInFlight = state.previewLoading || state.previewError !== null || !state.previewFresh;
  const confirmBlockedReason = !state.previewFresh
    ? state.previewLoading
      ? "正在生成 Dry-run 预览"
      : state.previewError
        ? `Dry-run 失败：${state.previewError}`
        : "Diff 与当前草稿不一致，需要重新生成预览"
    : null;
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-save-preflight-description"
          className="pl-wiki-preflight-content"
          data-testid="wiki-save-preflight"
        >
          <Dialog.Title className="pl-wiki-preflight-title">保存预检</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-save-preflight-description"
          >
            确认目标路径、Diff 与校验结果后再写入业务 Wiki。
          </Dialog.Description>

          <section
            aria-label="目标文件"
            className="pl-wiki-preflight-section"
            data-testid="wiki-save-preflight-target"
          >
            <h3 className="pl-wiki-preflight-section-title">目标</h3>
            <code className="pl-wiki-preflight-target notranslate" translate="no">
              {state.target}
            </code>
            {state.filePath && state.filePath !== state.target ? (
              <p className="pl-notice">
                后端写入路径：<code className="notranslate" translate="no">{state.filePath}</code>
              </p>
            ) : null}
          </section>

          <section
            aria-label="校验结果"
            className="pl-wiki-preflight-section"
            data-testid="wiki-save-preflight-findings"
          >
            <h3 className="pl-wiki-preflight-section-title">校验</h3>
            {state.findings.length === 0 ? (
              <p className="pl-notice">没有发现校验问题，可以安全保存。</p>
            ) : (
              <ul className="pl-wiki-preflight-findings">
                {state.findings.map((finding, index) => (
                  <li
                    className={clsx(
                      "pl-wiki-preflight-finding",
                      `pl-wiki-preflight-finding--${finding.level}`
                    )}
                    data-level={finding.level}
                    key={`${finding.level}-${index}-${finding.message}`}
                  >
                    <strong className="pl-wiki-preflight-finding-level notranslate" translate="no">
                      {finding.level === "error" ? "阻塞" : finding.level === "warning" ? "警告" : "提示"}
                    </strong>
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="Dry-run Diff"
            className="pl-wiki-preflight-section"
            data-testid="wiki-save-preflight-diff"
          >
            <h3 className="pl-wiki-preflight-section-title">Diff</h3>
            {state.previewLoading ? (
              <p className="pl-notice" data-testid="wiki-save-preflight-loading">
                正在生成 Dry-run 预览…
              </p>
            ) : state.previewError ? (
              <p
                className="pl-error"
                data-testid="wiki-save-preflight-preview-error"
              >
                Dry-run 失败：{state.previewError}
              </p>
            ) : !state.previewFresh ? (
              <p
                className="pl-notice"
                data-testid="wiki-save-preflight-stale"
              >
                Diff 与当前草稿不一致，正在刷新预览…
              </p>
            ) : (
              <DiffViewer diff={state.diff} />
            )}
          </section>

          <section
            aria-label="原始 Markdown"
            className="pl-wiki-preflight-section"
            data-testid="wiki-save-preflight-raw"
          >
            <button
              aria-expanded={showRaw}
              className="pl-wiki-preflight-raw-toggle"
              onClick={() => setShowRaw((current) => !current)}
              type="button"
            >
              {showRaw ? "收起 Raw" : "展开 Raw"}
            </button>
            {showRaw ? (
              <pre className="pl-wiki-preflight-raw notranslate" translate="no">
                {state.proposedMarkdown || "（无原始 Markdown 预览）"}
              </pre>
            ) : null}
          </section>

          <footer className="pl-wiki-preflight-actions">
            <button
              className="pl-btn pl-btn--ghost"
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="pl-btn pl-btn--secondary"
              onClick={onCancel}
              type="button"
            >
              继续编辑
            </button>
            <button
              aria-disabled={previewInFlight || hasError}
              className="pl-btn pl-btn--primary"
              data-testid="wiki-save-preflight-confirm"
              disabled={isSaving || hasError || previewInFlight}
              onClick={onConfirmSave}
              title={confirmBlockedReason ?? undefined}
              type="button"
            >
              {isSaving ? "保存中..." : "保存"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
