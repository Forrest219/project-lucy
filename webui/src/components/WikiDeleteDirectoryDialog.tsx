import * as Dialog from "@radix-ui/react-dialog";

export type WikiDeleteDirectoryDialogProps = {
  /** Directory path targeted for deletion. `null` keeps the dialog closed. */
  directoryPath: string | null;
  error: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * M56 UX-WIKI-010: opt-in destructive confirmation for directory
 * deletion. The dialog surfaces the full target path so the user can
 * sanity-check before approving, and surfaces server-side errors
 * (e.g. `WIKI_DIRECTORY_NOT_EMPTY`) inline without leaking the
 * filesystem layer.
 */
export function WikiDeleteDirectoryDialog({
  directoryPath,
  error,
  isDeleting,
  onCancel,
  onConfirm
}: WikiDeleteDirectoryDialogProps) {
  const open = Boolean(directoryPath);
  const targetPreview = directoryPath ? `wiki/${directoryPath}/` : "";
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-delete-directory-description"
          className="pl-wiki-preflight-content pl-wiki-delete-directory-content"
          data-testid="wiki-delete-directory-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">删除目录</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-delete-directory-description"
          >
            删除目录会同时移除该目录在 wiki 文档列表中的条目。请确认目标目录是空的（没有 Markdown 文档或子目录）。
          </Dialog.Description>

          <section className="pl-wiki-preflight-section">
            <h3 className="pl-wiki-preflight-section-title">目标目录</h3>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-delete-directory-target"
              translate="no"
            >
              {targetPreview}
            </code>
          </section>

          {error ? (
            <p className="pl-error" data-testid="wiki-delete-directory-error">
              {error}
            </p>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-delete-directory-cancel"
              disabled={isDeleting}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="pl-btn pl-btn--danger"
              data-testid="wiki-delete-directory-confirm"
              disabled={isDeleting}
              onClick={onConfirm}
              type="button"
            >
              {isDeleting ? "删除中..." : "删除目录"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}