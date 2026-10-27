import * as Dialog from "@radix-ui/react-dialog";
import { DiffViewer } from "./DiffViewer";
import { WikiAccessEditor } from "./WikiAccessEditor";
import type { WikiAccessSource } from "./WikiAccessEditor";
import {
  wikiAclDisplayText,
  wikiAclEquals,
  wikiAclIsEmpty,
  wikiAclRoleIds,
  wikiUploadAuthorizationChanged,
  wikiUploadCommitGuard,
  wikiUploadFinalAcl
} from "../lib/wikiAccess";
import type { WikiUploadAccessSelection, WikiUploadPreview } from "../lib/types";

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
  /* Spec 193 §5 — the explicit authorization selection of this upload. */
  selection: WikiUploadAccessSelection | null;
  onSelectionChange: (selection: WikiUploadAccessSelection) => void;
  emptyConfirmed: boolean;
  onEmptyConfirmedChange: (next: boolean) => void;
  allConfirmed: boolean;
  onAllConfirmedChange: (next: boolean) => void;
  /** The uploaded declaration is corrupt and has not been overridden yet. */
  corruptBlocked: boolean;
  onIgnoreCorrupt: () => void;
  /** The assignable Role list is ready. */
  roleReady: boolean;
  /** Reports the assignable Role query state so the commit can be blocked. */
  onRoleStateChange?: (ready: boolean) => void;
};

const SOURCE_LABELS: Record<WikiAccessSource, string> = {
  uploaded: "来自上传文件",
  current: "保留现有授权",
  reset: "重新设置"
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
  onTargetDirectoryChange,
  selection,
  onSelectionChange,
  emptyConfirmed,
  onEmptyConfirmedChange,
  allConfirmed,
  onAllConfirmedChange,
  corruptBlocked,
  onIgnoreCorrupt,
  roleReady,
  onRoleStateChange
}: WikiUploadPreflightProps) {
  const title = mode === "replace" ? "上传覆盖预检" : "上传 Markdown 预检";
  const directoryOptionsId = "wiki-upload-directory-options";
  const access = preview?.access ?? null;
  const currentAcl = access?.current_acl ?? null;
  const uploadedAcl = access?.uploaded_acl ?? null;
  const finalAcl = wikiUploadFinalAcl(selection, currentAcl, uploadedAcl);
  const authorizationChanged = wikiUploadAuthorizationChanged(selection, currentAcl, uploadedAcl);
  const source: WikiAccessSource =
    selection?.mode === "preserve_current"
      ? "current"
      : selection?.mode === "use_uploaded"
        ? "uploaded"
        : "reset";
  const editorValue =
    selection?.mode === "preserve_current"
      ? wikiAclRoleIds(currentAcl)
      : selection?.mode === "use_uploaded"
        ? wikiAclRoleIds(uploadedAcl)
        : (selection?.allowed_roles ?? []);
  const uploadedIsLegal = uploadedAcl !== null && uploadedAcl.state !== "corrupt";
  const adoptAvailable =
    mode === "replace" &&
    uploadedIsLegal &&
    selection?.mode !== "use_uploaded" &&
    !wikiAclEquals(uploadedAcl, currentAcl);

  const guard = wikiUploadCommitGuard({
    mode,
    selection,
    currentAcl,
    uploadedAcl,
    previewReady: Boolean(preview),
    previewLoading: isLoading,
    previewError: error,
    previewDigest: access?.preview_digest ?? null,
    roleReady,
    emptyConfirmed,
    allConfirmed,
    corruptBlocked,
    serverFinalAcl: access?.final_acl ?? null
  });

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
            确认目标目录、目标 Wiki 路径、标题、关联表、可访问角色和 Diff 后再写入业务 Wiki。
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
                <dl className="pl-wiki-preflight-summary-list pl-wiki-preflight-target-list">
                  <div
                    className="pl-wiki-preflight-summary-row pl-wiki-preflight-target-row"
                    data-testid="wiki-upload-target-path"
                  >
                    <dt className="pl-wiki-preflight-summary-label">目标 Wiki 路径</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      <code className="pl-wiki-upload-target-path notranslate" translate="no">
                        {preview.filePath}
                      </code>
                    </dd>
                  </div>
                </dl>
                <span
                  className={
                    preview.exists
                      ? "pl-wiki-preflight-target-status pl-wiki-preflight-target-status--replace"
                      : "pl-wiki-preflight-target-status pl-wiki-preflight-target-status--create"
                  }
                  data-testid="wiki-upload-target-status"
                >
                  {preview.exists ? "将覆盖现有 Markdown 文档" : "将新建 Markdown 文档"}
                </span>
              </section>

              <section className="pl-wiki-preflight-section" data-testid="wiki-upload-summary">
                <h3 className="pl-wiki-preflight-section-title">解析摘要</h3>
                <dl className="pl-wiki-preflight-summary-list">
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-source">
                    <dt className="pl-wiki-preflight-summary-label">本地文件名</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      <code className="notranslate" translate="no">
                        {preview.sourceFileName}
                      </code>
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-target">
                    <dt className="pl-wiki-preflight-summary-label">目标 Wiki 路径</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      <code className="notranslate" translate="no">
                        {preview.filePath}
                      </code>
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-existing">
                    <dt className="pl-wiki-preflight-summary-label">
                      {mode === "replace" ? "当前被覆盖文档" : "目标位置"}
                    </dt>
                    <dd className="pl-wiki-preflight-summary-value">
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
                    <dt className="pl-wiki-preflight-summary-label">上传后标题</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      <strong>{preview.targetTitle}</strong>
                    </dd>
                  </div>
                  <div className="pl-wiki-preflight-summary-row" data-testid="wiki-upload-summary-refs">
                    <dt className="pl-wiki-preflight-summary-label">关联表</dt>
                    <dd className="pl-wiki-preflight-summary-value pl-wiki-preflight-summary-value--refs">
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
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="pl-wiki-preflight-section" data-testid="wiki-upload-access">
                <h3 className="pl-wiki-preflight-section-title">可访问角色</h3>
                <dl className="pl-wiki-preflight-summary-list">
                  {mode === "replace" ? (
                    <div
                      className="pl-wiki-preflight-summary-row"
                      data-testid="wiki-upload-access-current"
                    >
                      <dt className="pl-wiki-preflight-summary-label">当前授权</dt>
                      <dd className="pl-wiki-preflight-summary-value">
                        {wikiAclDisplayText(currentAcl)}
                      </dd>
                    </div>
                  ) : null}
                  <div
                    className="pl-wiki-preflight-summary-row"
                    data-testid="wiki-upload-access-uploaded"
                  >
                    <dt className="pl-wiki-preflight-summary-label">文件内声明</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      {wikiAclDisplayText(uploadedAcl)}
                    </dd>
                  </div>
                  <div
                    className="pl-wiki-preflight-summary-row"
                    data-testid="wiki-upload-access-final"
                  >
                    <dt className="pl-wiki-preflight-summary-label">最终将采用</dt>
                    <dd className="pl-wiki-preflight-summary-value">
                      {wikiAclDisplayText(finalAcl)}（{SOURCE_LABELS[source]}）
                    </dd>
                  </div>
                </dl>
                {adoptAvailable ? (
                  <button
                    className="pl-btn pl-btn--secondary text-sm"
                    data-testid="wiki-upload-access-adopt"
                    onClick={() => onSelectionChange({ mode: "use_uploaded" })}
                    type="button"
                  >
                    采用文件内授权
                  </button>
                ) : null}
                {corruptBlocked ? (
                  <div className="pl-wiki-access-corrupt" data-testid="wiki-upload-access-corrupt">
                    <p className="pl-error">文件内可访问角色声明已损坏，不能直接采用。</p>
                    <button
                      className="pl-btn pl-btn--secondary text-sm"
                      data-testid="wiki-upload-access-ignore-corrupt"
                      onClick={onIgnoreCorrupt}
                      type="button"
                    >
                      忽略文件内损坏声明并重新设置
                    </button>
                  </div>
                ) : null}
                <WikiAccessEditor
                  allConfirmed={allConfirmed}
                  emptyConfirmed={emptyConfirmed}
                  effects={access?.role_effects ?? []}
                  effectsError={error}
                  effectsStatus={isLoading ? "loading" : error ? "error" : "ready"}
                  emptyConfirmationLabel={
                    <>
                      我确认上传后 <span className="notranslate" translate="no">Agent</span>{" "}
                      暂时无法访问
                    </>
                  }
                  onAllConfirmedChange={onAllConfirmedChange}
                  onChange={(next) => onSelectionChange({ mode: "set", allowed_roles: next })}
                  onEmptyConfirmedChange={onEmptyConfirmedChange}
                  onRoleStateChange={(state) => onRoleStateChange?.(state.roleStatus === "ready")}
                  requireEmptyConfirmation={selection !== null && wikiAclIsEmpty(finalAcl)}
                  source={source}
                  testId="wiki-upload-access-editor"
                  value={editorValue}
                />
              </section>

              <section
                className="pl-wiki-preflight-section"
                data-testid="wiki-upload-warnings-section"
              >
                <h3 className="pl-wiki-preflight-section-title">警告与阻断问题</h3>
                {preview.warnings.length > 0 ? (
                  <ul className="pl-wiki-upload-warnings" data-testid="wiki-upload-warnings">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="pl-notice" data-testid="wiki-upload-warnings-empty">
                    没有警告。
                  </p>
                )}
                {access && access.issues.length > 0 ? (
                  <ul className="pl-wiki-upload-warnings" data-testid="wiki-upload-access-issues">
                    {access.issues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>
                        {issue.blocking ? "阻断：" : "提示："}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {guard.reason ? (
                  <p
                    className="pl-notice notranslate"
                    data-testid="wiki-upload-commit-reason"
                    id="wiki-upload-commit-reason"
                    translate="no"
                  >
                    {guard.reason}
                  </p>
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
              aria-busy={isCommitting}
              aria-describedby={guard.reason ? "wiki-upload-commit-reason" : undefined}
              className="pl-btn pl-btn--primary"
              data-testid="wiki-upload-confirm"
              disabled={
                guard.blocked || !preview || isLoading || isCommitting || Boolean(error)
              }
              onClick={onConfirm}
              type="button"
            >
              {isCommitting ? "写入中..." : guard.label}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
