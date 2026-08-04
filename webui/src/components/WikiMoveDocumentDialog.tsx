import * as Dialog from "@radix-ui/react-dialog";
import { useMemo } from "react";
import type { WikiMovePreview } from "../lib/types";

export type WikiMoveDocumentDialogProps = {
  open: boolean;
  keyName: string;
  /** Free-text target directory input. */
  targetDirectory: string;
  preview: WikiMovePreview | null;
  error: string | null;
  isLoading: boolean;
  isMoving: boolean;
  /** Suggestions for the combobox; `targetDirectory` is the live value. */
  directories: string[];
  onTargetDirectoryChange: (directory: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * M56 UX-WIKI-011: opt-in directory mover.
 *
 * Renders a combobox-style directory input and a live target preview
 * (re-fetched through `onTargetDirectoryChange`). Moving a document
 * only changes its path, not its content, so this dialog intentionally
 * does not render a Diff (UX-WIKI-024). The server never auto-confirms:
 * the user must click `确认移动` themselves.
 */
export function WikiMoveDocumentDialog({
  open,
  keyName,
  targetDirectory,
  preview,
  error,
  isLoading,
  isMoving,
  directories,
  onTargetDirectoryChange,
  onCancel,
  onConfirm
}: WikiMoveDocumentDialogProps) {
  const directoryOptionsId = "wiki-move-target-directory-options";
  const sortedDirectories = useMemo(
    () => Array.from(new Set(directories)).sort((a, b) => a.localeCompare(b)),
    [directories]
  );
  const sourcePreview = keyName ? `wiki/${keyName}` : "";
  const targetPreview = preview?.filePath ?? "";
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-move-document-description"
          className="pl-wiki-preflight-content pl-wiki-move-document-content"
          data-testid="wiki-move-document-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">移动到目录</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-move-document-description"
          >
            选择目标目录后，文档路径会更新，历史版本记录会随文档一起迁移到新 key。原路径不再可访问。
          </Dialog.Description>

          <section className="pl-wiki-preflight-section" data-testid="wiki-move-source">
            <h3 className="pl-wiki-preflight-section-title">当前路径</h3>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-move-source-key"
              translate="no"
            >
              {sourcePreview}
            </code>
          </section>

          <section className="pl-wiki-preflight-section" data-testid="wiki-move-target">
            <h3 className="pl-wiki-preflight-section-title">目标目录</h3>
            <input
              aria-label="目标目录"
              className="pl-input notranslate"
              data-testid="wiki-move-target-directory-input"
              disabled={isMoving}
              list={directoryOptionsId}
              onChange={(event) => onTargetDirectoryChange(event.target.value)}
              placeholder="global"
              translate="no"
              value={targetDirectory}
            />
            <datalist id={directoryOptionsId}>
              {sortedDirectories.map((directory) => (
                <option key={directory} value={directory}>
                  {directory}
                </option>
              ))}
            </datalist>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-move-target-key-preview"
              translate="no"
            >
              {targetPreview || "—"}
            </code>
            {preview?.exists ? (
              <p className="pl-wiki-preflight-warn notranslate" data-testid="wiki-move-target-exists">
                目标 Wiki 路径已存在，无法移动。请先移动或重命名现有文档。
              </p>
            ) : null}
          </section>

          {error ? (
            <p className="pl-error" data-testid="wiki-move-error">
              {error}
            </p>
          ) : null}

          {preview?.warnings?.length ? (
            <ul className="pl-wiki-upload-warnings" data-testid="wiki-move-warnings">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-move-cancel"
              disabled={isMoving}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="pl-btn pl-btn--primary"
              data-testid="wiki-move-confirm"
              disabled={!preview || preview.exists || isLoading || isMoving || Boolean(error)}
              onClick={onConfirm}
              type="button"
            >
              {isMoving ? "移动中..." : "确认移动"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
