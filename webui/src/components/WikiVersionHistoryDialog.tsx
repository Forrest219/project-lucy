import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { DiffViewer } from "./DiffViewer";
import { MarkdownPreview } from "./MarkdownPreview";
import type { WikiVersionDetail, WikiVersionSummary } from "../lib/types";

export type WikiVersionHistoryDialogProps = {
  open: boolean;
  keyName: string;
  retentionLimit: number;
  versions: WikiVersionSummary[];
  selectedVersion: WikiVersionDetail | null;
  selectedVersionId: string | null;
  isLoading: boolean;
  isDetailLoading: boolean;
  error: string | null;
  restoreLoading: boolean;
  onClose: () => void;
  onSelectVersion: (versionId: string) => void;
  onRestore: (versionId: string) => void;
};

const OPERATION_LABELS: Record<WikiVersionSummary["operation"], string> = {
  create: "创建",
  edit_save: "编辑保存",
  upload_create: "上传新文档",
  upload_replace: "上传覆盖",
  restore: "恢复",
  move: "移动",
  rename: "重命名",
  delete: "删除"
};

function formatVersionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function WikiVersionHistoryDialog({
  open,
  keyName,
  retentionLimit,
  versions,
  selectedVersion,
  selectedVersionId,
  isLoading,
  isDetailLoading,
  error,
  restoreLoading,
  onClose,
  onSelectVersion,
  onRestore
}: WikiVersionHistoryDialogProps) {
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-version-history-description"
          className="pl-wiki-preflight-content pl-wiki-version-content"
          data-testid="wiki-version-history-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">版本记录</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-version-history-description"
          >
            保留最近 {retentionLimit} 版 Markdown 快照。当前文档：
            <code className="notranslate" translate="no">{keyName}</code>
          </Dialog.Description>

          {error ? (
            <p className="pl-error" data-testid="wiki-version-history-error">
              版本记录加载失败：{error}
            </p>
          ) : null}

          <div className="pl-wiki-version-layout">
            <section
              aria-label="版本列表"
              className="pl-wiki-preflight-section pl-wiki-version-list"
              data-testid="wiki-version-list"
            >
              <h3 className="pl-wiki-preflight-section-title">历史版本</h3>
              {isLoading ? (
                <p className="pl-notice">正在加载版本记录...</p>
              ) : versions.length === 0 ? (
                <p className="pl-notice">暂无历史版本。首次保存、上传或恢复后会生成记录。</p>
              ) : (
                versions.map((version) => (
                  <article
                    className={clsx(
                      "pl-wiki-version-item",
                      selectedVersionId === version.versionId && "pl-wiki-version-item--active"
                    )}
                    data-testid={`wiki-version-item-${version.versionId}`}
                    key={version.versionId}
                  >
                    <div className="pl-wiki-version-item-main">
                      <strong>{OPERATION_LABELS[version.operation]}</strong>
                      <time dateTime={version.createdAt}>{formatVersionTime(version.createdAt)}</time>
                      <code className="notranslate" translate="no">{version.versionId}</code>
                      {version.sourceFileName ? (
                        <span>
                          来源文件：
                          <code className="notranslate" translate="no">{version.sourceFileName}</code>
                        </span>
                      ) : null}
                      {version.restoredFromVersionId ? (
                        <span>
                          恢复来源：
                          <code className="notranslate" translate="no">
                            {version.restoredFromVersionId}
                          </code>
                        </span>
                      ) : null}
                    </div>
                    <div className="pl-wiki-version-item-actions">
                      <button
                        className="pl-btn pl-btn--ghost"
                        data-testid={`wiki-version-view-${version.versionId}`}
                        onClick={() => onSelectVersion(version.versionId)}
                        type="button"
                      >
                        查看
                      </button>
                      <button
                        className="pl-btn pl-btn--secondary"
                        data-testid={`wiki-version-restore-${version.versionId}`}
                        disabled={restoreLoading}
                        onClick={() => onRestore(version.versionId)}
                        type="button"
                      >
                        恢复此版本
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>

            <section
              aria-label="历史版本详情"
              className="pl-wiki-preflight-section pl-wiki-version-detail"
              data-testid="wiki-version-detail"
            >
              <h3 className="pl-wiki-preflight-section-title">历史预览</h3>
              {isDetailLoading ? (
                <p className="pl-notice">正在加载历史版本...</p>
              ) : selectedVersion ? (
                <>
                  <div
                    className="pl-wiki-version-meta"
                    data-testid="wiki-version-detail-meta"
                  >
                    <span>{OPERATION_LABELS[selectedVersion.operation]}</span>
                    <code className="notranslate" translate="no">
                      {selectedVersion.contentHash}
                    </code>
                  </div>
                  <div data-testid="wiki-version-markdown-preview">
                    <MarkdownPreview markdown={selectedVersion.rawMarkdown} />
                  </div>
                  <div data-testid="wiki-version-diff">
                    <h4 className="pl-wiki-version-subtitle">与当前版本 Diff</h4>
                    <DiffViewer diff={selectedVersion.diffFromCurrent} />
                  </div>
                </>
              ) : (
                <p className="pl-notice">选择一个历史版本查看 Markdown 预览和 Diff。</p>
              )}
            </section>
          </div>

          <footer className="pl-wiki-preflight-actions">
            <button className="pl-btn pl-btn--ghost" onClick={onClose} type="button">
              关闭
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
