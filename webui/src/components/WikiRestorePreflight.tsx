import * as Dialog from "@radix-ui/react-dialog";
import { DiffViewer } from "./DiffViewer";
import type { WikiVersionRestorePreview } from "../lib/types";

export type WikiRestorePreflightProps = {
  open: boolean;
  preview: WikiVersionRestorePreview | null;
  isLoading: boolean;
  isRestoring: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WikiRestorePreflight({
  open,
  preview,
  isLoading,
  isRestoring,
  error,
  onCancel,
  onConfirm
}: WikiRestorePreflightProps) {
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-restore-preflight-description"
          className="pl-wiki-preflight-content"
          data-testid="wiki-restore-preflight"
        >
          <Dialog.Title className="pl-wiki-preflight-title">恢复预检</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-restore-preflight-description"
          >
            确认目标文档、来源版本和 Diff 后，再恢复到指定 Markdown 历史版本。
          </Dialog.Description>

          {isLoading ? (
            <p className="pl-notice" data-testid="wiki-restore-preflight-loading">
              正在生成恢复预检...
            </p>
          ) : error ? (
            <p className="pl-error" data-testid="wiki-restore-preflight-error">
              恢复预检失败：{error}
            </p>
          ) : preview ? (
            <>
              <section className="pl-wiki-preflight-section">
                <h3 className="pl-wiki-preflight-section-title">目标</h3>
                <code className="pl-wiki-preflight-target notranslate" translate="no">
                  wiki/{preview.key}
                </code>
                <p>
                  标题：
                  <strong>{preview.targetTitle}</strong>
                </p>
                <p>
                  来源版本：
                  <code className="notranslate" translate="no">{preview.versionId}</code>
                </p>
              </section>

              <section className="pl-wiki-preflight-section" data-testid="wiki-restore-diff">
                <h3 className="pl-wiki-preflight-section-title">Diff</h3>
                <DiffViewer diff={preview.diff} />
              </section>
            </>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button className="pl-btn pl-btn--ghost" onClick={onCancel} type="button">
              取消
            </button>
            <button
              className="pl-btn pl-btn--primary"
              data-testid="wiki-restore-confirm"
              disabled={!preview || isLoading || isRestoring || Boolean(error)}
              onClick={onConfirm}
              type="button"
            >
              {isRestoring ? "恢复中..." : "确认恢复"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
