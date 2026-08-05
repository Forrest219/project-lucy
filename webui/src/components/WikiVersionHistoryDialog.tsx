import * as Dialog from "@radix-ui/react-dialog";
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
  onSelectVersion: (versionId: string | null) => void;
  onRestore: (versionId: string) => void;
};

const OPERATION_LABELS: Record<WikiVersionSummary["operation"], string> = {
  create: "新建文档",
  edit_save: "在线编辑",
  upload_create: "上传新建",
  upload_replace: "上传覆盖",
  restore: "恢复历史版本",
  move: "移动到目录",
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

function formatRevisionLabel(index: number, total: number, isCurrent: boolean): string {
  const revision = total - index;
  return isCurrent ? `修订 ${revision}（当前）` : `修订 ${revision}`;
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
  const showingDetail = Boolean(selectedVersionId);

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-preflight-overlay" />
        <Dialog.Content
          aria-describedby="wiki-version-history-description"
          className="pl-wiki-preflight-content pl-wiki-version-content"
          data-testid="wiki-version-history-dialog"
        >
          <Dialog.Title className="pl-wiki-preflight-title">
            {showingDetail ? "版本详情" : "版本记录"}
          </Dialog.Title>
          <Dialog.Description
            className="pl-wiki-preflight-description"
            id="wiki-version-history-description"
          >
            {showingDetail ? (
              <>
                查看历史 Markdown 与当前版本 Diff。当前文档：
                <code className="notranslate" translate="no">
                  {keyName}
                </code>
              </>
            ) : (
              <>
                保留最近 {retentionLimit} 版 Markdown 快照。当前文档：
                <code className="notranslate" translate="no">
                  {keyName}
                </code>
              </>
            )}
          </Dialog.Description>

          {error ? (
            <p className="pl-error" data-testid="wiki-version-history-error">
              版本记录加载失败：{error}
            </p>
          ) : null}

          {showingDetail ? (
            <section
              aria-label="版本详情"
              className="pl-wiki-preflight-section pl-wiki-version-detail"
              data-testid="wiki-version-detail"
            >
              <div className="pl-wiki-version-detail-toolbar">
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-version-back-to-list"
                  onClick={() => onSelectVersion(null)}
                  type="button"
                >
                  返回版本列表
                </button>
              </div>
              {isDetailLoading ? (
                <p className="pl-notice">正在加载历史版本...</p>
              ) : selectedVersion ? (
                <>
                  <div
                    className="pl-wiki-version-meta"
                    data-testid="wiki-version-detail-meta"
                  >
                    <span>{OPERATION_LABELS[selectedVersion.operation]}</span>
                    <time dateTime={selectedVersion.createdAt}>
                      {formatVersionTime(selectedVersion.createdAt)}
                    </time>
                    <code className="notranslate" translate="no">
                      {selectedVersion.versionId}
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
              ) : error ? null : (
                <p className="pl-notice">未找到该历史版本。</p>
              )}
            </section>
          ) : (
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
                <table className="pl-wiki-version-table" data-testid="wiki-version-table">
                  <thead>
                    <tr>
                      <th scope="col">版本</th>
                      <th scope="col">变更说明</th>
                      <th scope="col">时间</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version, index) => {
                      const isCurrent = index === 0;
                      return (
                        <tr
                          className="pl-wiki-version-row"
                          data-testid={`wiki-version-item-${version.versionId}`}
                          key={version.versionId}
                        >
                          <td>
                            <span
                              className={
                                isCurrent
                                  ? "pl-wiki-version-revision pl-wiki-version-revision--current"
                                  : "pl-wiki-version-revision"
                              }
                            >
                              {formatRevisionLabel(index, versions.length, isCurrent)}
                            </span>
                          </td>
                          <td>
                            {OPERATION_LABELS[version.operation]}
                            {version.sourceFileName ? (
                              <span className="pl-wiki-version-row-note">
                                来源文件：
                                <code className="notranslate" translate="no">
                                  {version.sourceFileName}
                                </code>
                              </span>
                            ) : null}
                            {version.restoredFromVersionId ? (
                              <span className="pl-wiki-version-row-note">
                                恢复来源：
                                <code className="notranslate" translate="no">
                                  {version.restoredFromVersionId}
                                </code>
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <time dateTime={version.createdAt}>
                              {formatVersionTime(version.createdAt)}
                            </time>
                          </td>
                          <td className="pl-wiki-version-row-actions">
                            {isCurrent ? (
                              <span className="pl-wiki-version-current-hint">当前</span>
                            ) : (
                              <>
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
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}

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
