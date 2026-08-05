import * as Dialog from "@radix-ui/react-dialog";
import type { WikiDirectoryRenamePreview } from "../lib/types";

export type WikiRenameDirectoryDialogProps = {
  /** Source directory path; `null` keeps the dialog closed. */
  sourcePath: string | null;
  newName: string;
  preview: WikiDirectoryRenamePreview | null;
  error: string | null;
  isLoading: boolean;
  isRenaming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onNewNameChange: (value: string) => void;
};

/**
 * Spec 109 / UX-WIKI-044: same-parent Wiki directory rename preflight.
 */
export function WikiRenameDirectoryDialog({
  sourcePath,
  newName,
  preview,
  error,
  isLoading,
  isRenaming,
  onCancel,
  onConfirm,
  onNewNameChange
}: WikiRenameDirectoryDialogProps) {
  const open = Boolean(sourcePath);
  const sourcePreview = sourcePath ? `wiki/${sourcePath}/` : "";
  const targetPreview = preview
    ? `wiki/${preview.targetPath}/`
    : sourcePath
      ? `wiki/${parentPreview(sourcePath, newName)}/`
      : "";
  const hasConflicts = Boolean(preview?.conflicts.length);
  const canConfirm =
    Boolean(sourcePath) &&
    Boolean(newName.trim()) &&
    Boolean(preview) &&
    !hasConflicts &&
    !isLoading &&
    !isRenaming &&
    !error;

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-rename-directory-description"
          className="pl-wiki-preflight-content pl-wiki-rename-directory-content"
          data-testid="wiki-rename-directory-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">重命名目录</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-rename-directory-description"
          >
            修改目录名称会同步改写该目录下的 Markdown 文档路径与空目录资源。仅支持同父级改名。
          </Dialog.Description>

          <section className="pl-wiki-preflight-section">
            <h3 className="pl-wiki-preflight-section-title">当前目录路径</h3>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-rename-directory-source"
              translate="no"
            >
              {sourcePreview}
            </code>
          </section>

          <label className="pl-wiki-preflight-field">
            <span>新目录名称</span>
            <input
              autoFocus
              className="pl-input notranslate"
              data-testid="wiki-rename-directory-name-input"
              onChange={(event) => onNewNameChange(event.target.value)}
              placeholder="playbooks"
              translate="no"
              value={newName}
            />
          </label>

          <section className="pl-wiki-preflight-section">
            <h3 className="pl-wiki-preflight-section-title">目标目录路径</h3>
            <code
              className="pl-wiki-preflight-target notranslate"
              data-testid="wiki-rename-directory-target"
              translate="no"
            >
              {targetPreview}
            </code>
          </section>

          {preview ? (
            <p
              className="pl-wiki-preflight-description"
              data-testid="wiki-rename-directory-impact"
            >
              将改写{" "}
              <strong>{preview.documentCount}</strong> 篇 Markdown 文档、{" "}
              <strong>{preview.directoryCount}</strong> 个目录（含自身）。
            </p>
          ) : null}

          {preview?.conflicts.length ? (
            <ul
              className="pl-error"
              data-testid="wiki-rename-directory-conflicts"
            >
              {preview.conflicts.map((conflict) => (
                <li key={conflict}>{conflict}</li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <p className="pl-error" data-testid="wiki-rename-directory-error">
              {error}
            </p>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-rename-directory-cancel"
              disabled={isRenaming}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="pl-btn pl-btn--primary"
              data-testid="wiki-rename-directory-confirm"
              disabled={!canConfirm}
              onClick={onConfirm}
              type="button"
            >
              {isRenaming ? "重命名中..." : isLoading ? "预检中..." : "确认重命名"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function parentPreview(sourcePath: string, newName: string): string {
  const segments = sourcePath.split("/").filter(Boolean);
  const parent = segments.slice(0, -1).join("/");
  const name = newName.trim() || segments.at(-1) || "";
  return parent ? `${parent}/${name}` : name;
}
