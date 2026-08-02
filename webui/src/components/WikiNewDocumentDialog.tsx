import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";

export type WikiNewDocumentDialogProps = {
  open: boolean;
  directories: string[];
  defaultDirectory: string;
  defaultFileName: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { directory: string; fileName: string }) => void;
};

export function WikiNewDocumentDialog({
  open,
  directories,
  defaultDirectory,
  defaultFileName,
  error,
  onCancel,
  onConfirm
}: WikiNewDocumentDialogProps) {
  const [directory, setDirectory] = useState(defaultDirectory);
  const [fileName, setFileName] = useState(defaultFileName);
  const directoryOptionsId = "wiki-new-document-directory-options";
  const sortedDirectories = useMemo(
    () => Array.from(new Set(directories)).sort((a, b) => a.localeCompare(b)),
    [directories]
  );
  const targetPreview = useMemo(
    () => `wiki/${previewDirectory(directory)}/${previewFileName(fileName)}`,
    [directory, fileName]
  );

  useEffect(() => {
    if (!open) return;
    setDirectory(defaultDirectory);
    setFileName(defaultFileName);
  }, [defaultDirectory, defaultFileName, open]);

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-new-document-description"
          className="pl-wiki-new-document-content"
          data-testid="wiki-new-document-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">新建文档</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-new-document-description"
          >
            选择已有目录，或输入新的子目录路径。
          </Dialog.Description>

          <div className="pl-wiki-new-document-form">
            <label className="pl-field-label">
              <span>目标目录</span>
              <input
                className="pl-input notranslate"
                data-testid="wiki-new-directory-input"
                list={directoryOptionsId}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder="global"
                translate="no"
                value={directory}
              />
            </label>
            <datalist id={directoryOptionsId}>
              {sortedDirectories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <label className="pl-field-label">
              <span>文件名</span>
              <input
                className="pl-input notranslate"
                data-testid="wiki-new-file-input"
                onChange={(event) => setFileName(event.target.value)}
                placeholder="new-note.md"
                translate="no"
                value={fileName}
              />
            </label>
            <div
              className="pl-wiki-new-document-target"
              data-testid="wiki-new-target-preview"
            >
              <span>目标路径</span>
              <code className="notranslate" translate="no">
                {targetPreview}
              </code>
            </div>
          </div>

          {error ? (
            <p className="pl-error" data-testid="wiki-new-document-error">
              {error}
            </p>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button className="pl-btn pl-btn--ghost" onClick={onCancel} type="button">
              取消
            </button>
            <button
              className="pl-btn pl-btn--primary"
              data-testid="wiki-new-confirm"
              onClick={() => onConfirm({ directory, fileName })}
              type="button"
            >
              创建草稿
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function previewDirectory(value: string): string {
  return (
    value
      .trim()
      .replaceAll("\\", "/")
      .replaceAll(/\/+/g, "/")
      .replace(/^\/+|\/+$/g, "") || "global"
  );
}

function previewFileName(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
  if (!trimmed) {
    return "new-note.md";
  }
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
}
