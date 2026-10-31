import { useEffect, useRef } from "react";
import { PublishImpactReview } from "./PublishImpactReview";
import type { PublishBaselineState, PublishImpact } from "../../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.5 — the wide
 * confirmation panel 「确认同步索引并生效」.
 *
 * The panel is PAGE-SCOPED: its width comes from an inline style on this
 * component only, so no shared drawer (and no other page) changes. The header
 * and the footer stay fixed; the body is the ONLY vertical scroll area — the
 * operator must never have to scroll the submit button out of view.
 *
 * A failed submission keeps the drawer open with the reviewed content
 * preserved: the operator still has to decide what to do next.
 */

export type PublishSyncConfirmDrawerProps = {
  open: boolean;
  impact: PublishImpact | null;
  /** The content version this confirmation is bound to. */
  pendingDigest: string | null;
  /** The baseline state — `needs_verification` disables the submission. */
  baselineState?: PublishBaselineState;
  /** True when the submission must be blocked. */
  submitDisabled: boolean;
  submitDisabledReason?: string;
  isSubmitting: boolean;
  /** A failure from the last submission. The drawer STAYS OPEN on failure. */
  error?: string | null;
  onCancel: () => void;
  onSubmit: () => void;
};

const DIGEST_PREVIEW_LENGTH = 16;

export function PublishSyncConfirmDrawer(props: PublishSyncConfirmDrawerProps) {
  const {
    open,
    impact,
    pendingDigest,
    baselineState,
    submitDisabled,
    submitDisabledReason,
    isSubmitting,
    error,
    onCancel,
    onSubmit
  } = props;

  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes the panel — the same path as the close button and the
  // backdrop, so there is exactly ONE way to leave it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  // Focus moves to the panel title when it opens and goes back to the element
  // that opened it when it closes.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const needsVerification = baselineState === "needs_verification";
  const blocked = submitDisabled || needsVerification;
  const disableReason =
    submitDisabledReason ??
    (needsVerification
      ? "生效基线需要核对，恢复前不能提交。"
      : submitDisabled
        ? "当前状态不允许提交。"
        : undefined);

  const handleSubmit = () => {
    // Duplicate submits are impossible: the button is disabled while the
    // request is in flight and the handler refuses a second call.
    if (blocked || isSubmitting) return;
    onSubmit();
  };

  const digestPreview =
    pendingDigest && pendingDigest.length > DIGEST_PREVIEW_LENGTH
      ? `${pendingDigest.slice(0, DIGEST_PREVIEW_LENGTH)}…`
      : (pendingDigest ?? "");

  return (
    <div
      className="pl-drawer-backdrop"
      role="presentation"
      onClick={onCancel}
      data-testid="publish-sync-confirm-backdrop"
    >
      <div
        className="pl-drawer-panel publish-sync-confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-label="确认同步索引并生效"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(880px, calc(100vw - 48px))",
          maxWidth: "960px",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 48px)"
        }}
        data-testid="publish-sync-confirm-panel"
      >
        <header className="pl-drawer-header">
          <div>
            <h2
              className="pl-panel-title mb-0"
              ref={titleRef}
              tabIndex={-1}
              data-testid="publish-sync-confirm-title"
            >
              确认同步索引并生效
            </h2>
            <p className="pl-notice text-xs mt-1">本批内容将一并同步，不能按表单独选择。</p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onCancel}
            aria-label="关闭"
            data-testid="publish-sync-confirm-close"
          >
            关闭
          </button>
        </header>

        {/* The body is the only vertical scroll area of this panel. */}
        <div
          className="pl-drawer-body"
          style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
          data-testid="publish-sync-confirm-body"
        >
          {error ? (
            <div
              className="pl-error"
              role="alert"
              data-testid="publish-sync-confirm-error"
            >
              {error}
            </div>
          ) : null}

          {pendingDigest ? (
            <p className="text-xs text-fg-muted" data-testid="publish-sync-confirm-digest">
              确认绑定内容版本{" "}
              <span className="notranslate" translate="no" title={pendingDigest}>
                {digestPreview}
              </span>
            </p>
          ) : null}

          {impact ? (
            <PublishImpactReview impact={impact} />
          ) : (
            <p className="pl-notice text-xs" data-testid="publish-sync-confirm-pending">
              正在解析影响范围…
            </p>
          )}
        </div>

        <footer className="pl-drawer-footer">
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={onCancel}
            data-testid="publish-sync-confirm-cancel"
          >
            取消
          </button>
          {disableReason ? (
            <span className="text-xs text-fg-muted" data-testid="publish-sync-confirm-blocked-reason">
              {disableReason}
            </span>
          ) : null}
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={blocked || isSubmitting}
            onClick={handleSubmit}
            data-testid="publish-sync-confirm-submit"
          >
            {isSubmitting ? "处理中…" : "同步索引并生效"}
          </button>
        </footer>
      </div>
    </div>
  );
}
