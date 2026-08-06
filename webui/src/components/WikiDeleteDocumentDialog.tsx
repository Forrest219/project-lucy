import * as Dialog from "@radix-ui/react-dialog";

export type WikiDeleteDocumentDialogProps = {
  /** Wiki key targeted for deletion. `null` keeps the dialog closed. */
  documentKey: string | null;
  error: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Spec 118 / UX-WIKI-045: destructive confirmation for Markdown document
 * deletion. Mirrors the empty-directory delete dialog: surfaces the full
 * target path and inline server errors without exposing filesystem details.
 */
export function WikiDeleteDocumentDialog({
  documentKey,
  error,
  isDeleting,
  onCancel,
  onConfirm
}: WikiDeleteDocumentDialogProps) {
  const open = Boolean(documentKey);
  const targetPreview = documentKey ? `wiki/${documentKey}` : "";
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-delete-document-description"
          className="pl-wiki-preflight-content pl-wiki-delete-directory-content"
          data-testid="wiki-delete-document-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">删除文档</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-delete-document-description"
          >
            删除后文档将从业务 Wiki 移除，且不可通过版本记录恢复。请确认目标路径无误。
          </Dialog.Description>

          <section className="pl-wiki-preflight-section">
            <h3 className="pl-wiki-preflight-section-title">目标文档</h3>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-delete-document-target"
              translate="no"
            >
              {targetPreview}
            </code>
          </section>

          {error ? (
            <p className="pl-error" data-testid="wiki-delete-document-error">
              {error}
            </p>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-delete-document-cancel"
              disabled={isDeleting}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="pl-btn pl-btn--danger"
              data-testid="wiki-delete-document-confirm"
              disabled={isDeleting}
              onClick={onConfirm}
              type="button"
            >
              {isDeleting ? "删除中..." : "删除文档"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
