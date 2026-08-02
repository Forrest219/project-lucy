import * as Dialog from "@radix-ui/react-dialog";
import { DiffViewer } from "./DiffViewer";
import type { WikiUploadPreview } from "../lib/types";

export type WikiUploadPreflightProps = {
  open: boolean;
  mode: "create" | "replace";
  preview: WikiUploadPreview | null;
  directories: string[];
  targetDirectory: string;
  error: string | null;
  isLoading: boolean;
  isCommitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onTargetDirectoryChange: (directory: string) => void;
};

export function WikiUploadPreflight({
  open,
  mode,
  preview,
  directories,
  targetDirectory,
  error,
  isLoading,
  isCommitting,
  onCancel,
  onConfirm,
  onTargetDirectoryChange
}: WikiUploadPreflightProps) {
  const title = mode === "replace" ? "上传覆盖预检" : "上传 Markdown 预检";
  const directoryOptionsId = "wiki-upload-directory-options";
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onCancel() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-upload-preflight-description"
          className="pl-wiki-preflight-content"
          data-testid="wiki-upload-preflight"
        >
          <Dialog.Title className="pl-wiki-preflight-title">{title}</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-upload-preflight-description"
          >
            确认目标路径、标题、关联表和 Diff 后再写入业务 Wiki。
          </Dialog.Description>

          {isLoading ? (
            <p className="pl-notice" data-testid="wiki-upload-preflight-loading">
              正在解析 Markdown…
            </p>
          ) : error ? (
            <p className="pl-error" data-testid="wiki-upload-preflight-error">
              上传预检失败：{error}
            </p>
          ) : preview ? (
            <>
              <section className="pl-wiki-preflight-section" data-testid="wiki-upload-target">
                <h3 className="pl-wiki-preflight-section-title">目标</h3>
                {mode === "create" ? (
                  <label className="pl-wiki-upload-directory">
                    <span>目标目录</span>
                    <input
                      className="pl-input notranslate"
                      data-testid="wiki-upload-directory-input"
                      list={directoryOptionsId}
                      onChange={(event) => onTargetDirectoryChange(event.target.value)}
                      placeholder="global"
                      translate="no"
                      value={targetDirectory}
                    />
                    <datalist id={directoryOptionsId}>
                      {directories.map((directory) => (
                        <option key={directory} value={directory}>
                          {directory}
                        </option>
                      ))}
                    </datalist>
                  </label>
                ) : null}
                <code className="pl-wiki-preflight-target notranslate" translate="no">
                  {preview.filePath}
                </code>
                <p className="pl-notice">
                  {preview.exists ? "将覆盖现有 Markdown 文档。" : "将新建 Markdown 文档。"}
                </p>
              </section>

              <section className="pl-wiki-preflight-section" data-testid="wiki-upload-summary">
                <h3 className="pl-wiki-preflight-section-title">解析摘要</h3>
                <dl className="pl-wiki-preflight-summary-list">
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-source">
                    <dt>本地文件名</dt>
                    <dd>
                      <code className="notranslate" translate="no">
                        {preview.sourceFileName}
                      </code>
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-target">
                    <dt>目标 Wiki 路径</dt>
                    <dd>
                      <code className="notranslate" translate="no">
                        {preview.filePath}
                      </code>
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-existing">
                    <dt>{mode === "replace" ? "当前被覆盖文档" : "目标位置"}</dt>
                    <dd>
                      {preview.exists ? (
                        preview.existingTitle ? (
                          <strong>{preview.existingTitle}</strong>
                        ) : (
                          <span className="pl-notice-inline">未命名文档</span>
                        )
                      ) : (
                        <span className="pl-notice-inline">新建文档</span>
                      )}
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-title">
                    <dt>上传后标题</dt>
                    <dd>
                      <strong>{preview.targetTitle}</strong>
                    </dd>
                  </div>
                </dl>
                <p>
                  关联表：
                  {preview.slRefs.length > 0 ? (
                    preview.slRefs.map((ref) => (
                      <code
                        className="pl-wiki-upload-ref notranslate"
                        key={ref}
                        translate="no"
                      >
                        {ref}
                      </code>
                    ))
                  ) : (
                    <span className="pl-notice-inline">未声明关联表</span>
                  )}
                </p>
                {preview.warnings.length > 0 ? (
                  <ul className="pl-wiki-upload-warnings" data-testid="wiki-upload-warnings">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="pl-wiki-preflight-section" data-testid="wiki-upload-diff">
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
              data-testid="wiki-upload-confirm"
              disabled={!preview || isLoading || isCommitting || Boolean(error)}
              onClick={onConfirm}
              type="button"
            >
              {isCommitting ? "写入中..." : mode === "replace" ? "确认覆盖" : "确认上传"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
