import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";

export type WikiNewDirectoryDialogProps = {
  open: boolean;
  directories: string[];
  defaultParentDirectory: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { parent: string; name: string }) => void;
};

export function WikiNewDirectoryDialog({
  open,
  directories,
  defaultParentDirectory,
  error,
  onCancel,
  onConfirm
}: WikiNewDirectoryDialogProps) {
  const [parent, setParent] = useState(defaultParentDirectory);
  const [name, setName] = useState("");
  const [topLevel, setTopLevel] = useState(defaultParentDirectory === "");
  const directoryOptionsId = "wiki-new-directory-parent-options";
  const sortedDirectories = useMemo(
    () => Array.from(new Set(directories)).sort((a, b) => a.localeCompare(b)),
    [directories]
  );
  const effectiveParent = topLevel ? "" : parent;
  const targetPreview = useMemo(
    () => `wiki/${previewDirectoryPath(effectiveParent, name)}/`,
    [effectiveParent, name]
  );

  useEffect(() => {
    if (!open) return;
    setParent(defaultParentDirectory);
    setName("");
    setTopLevel(defaultParentDirectory === "");
  }, [defaultParentDirectory, open]);

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-new-directory-description"
          className="pl-wiki-new-document-content"
          data-testid="wiki-new-directory-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">新建目录</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-new-directory-description"
          >
            选择父级目录，并输入新的目录名称。
          </Dialog.Description>

          <div className="pl-wiki-new-document-form">
            <label className="pl-field-label pl-wiki-new-directory-toggle">
              <input
                checked={topLevel}
                className="pl-wiki-new-directory-checkbox notranslate"
                data-testid="wiki-new-directory-top-level-checkbox"
                onChange={(event) => setTopLevel(event.target.checked)}
                translate="no"
                type="checkbox"
              />
              <span>顶层目录（与 global 平级）</span>
            </label>
            <label className="pl-field-label">
              <span>父级目录</span>
              <input
                className="pl-input notranslate"
                data-testid="wiki-new-directory-parent-input"
                disabled={topLevel}
                list={directoryOptionsId}
                onChange={(event) => setParent(event.target.value)}
                placeholder={topLevel ? "顶层目录（与 global 平级）" : "global"}
                translate="no"
                value={topLevel ? "" : parent}
              />
            </label>
            <datalist id={directoryOptionsId}>
              {sortedDirectories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <label className="pl-field-label">
              <span>目录名称</span>
              <input
                className="pl-input notranslate"
                data-testid="wiki-new-directory-name-input"
                onChange={(event) =>
                  setName(event.target.value.replaceAll("/", "").replaceAll("\\", ""))
                }
                placeholder="playbooks"
                translate="no"
                value={name}
              />
            </label>
            <div
              className="pl-wiki-new-document-target"
              data-testid="wiki-new-directory-target-preview"
            >
              <span>目标路径</span>
              <code className="notranslate" translate="no">
                {targetPreview}
              </code>
            </div>
          </div>

          {error ? (
            <p className="pl-error" data-testid="wiki-new-directory-error">
              {error}
            </p>
          ) : null}

          <footer className="pl-wiki-preflight-actions">
            <button className="pl-btn pl-btn--ghost" onClick={onCancel} type="button">
              取消
            </button>
            <button
              className="pl-btn pl-btn--primary"
              data-testid="wiki-new-directory-confirm"
              onClick={() => onConfirm({ parent: effectiveParent, name })}
              type="button"
            >
              创建目录
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function previewDirectoryPath(parent: string, name: string): string {
  return [parent, name]
    .join("/")
    .trim()
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "") || "global";
}
