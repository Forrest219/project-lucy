import { useState } from "react";
import { apiPost } from "../../lib/apiClient";

export type RestoreTargetPlan = {
  targetPath: string;
  assetKind: "overlay" | "manifest";
  identity?: { connectionId: string; schema: string; table: string };
  action: "restore_bytes" | "delete" | "unchanged";
  currentDigest: string | null;
  expectedCurrentDigest: string | null;
  restoredDigest: string | null;
  siblingCurrentDigest: string | null;
};

export type RestoreReadbackExpectation = {
  kind: "table_gone" | "extension_invisible";
  table: { connectionId: string; schema: string; table: string };
  targetPath?: string;
};

export type MirrorDriftEntry = {
  contentRelPath: string;
  siblingRelPath: string;
  contentDigest: string | null;
  siblingDigest: string | null;
};

export type RestorePreviewData = {
  previewId: string;
  sourceReleaseId: string;
  snapshotId: string;
  planDigest: string;
  expiresAt: string;
  verdict: "ready" | "conflict" | "unavailable";
  conflicts: string[];
  targets: RestoreTargetPlan[];
  reindexMode: "incremental" | "force";
  semanticDeletionSet: Array<{ connectionId: string; schema: string; table: string }>;
  readbackExpectations: RestoreReadbackExpectation[];
  mirrorSyncWriteSet: MirrorDriftEntry[];
  fullIndexScope: string[];
  knownPending: string[];
  unknownCoverage: number;
  noChange: boolean;
};

type Props = {
  releaseId: string;
  createdAt: string;
  actor: string;
  onClose: () => void;
};

const ACTION_LABEL: Record<RestoreTargetPlan["action"], string> = {
  restore_bytes: "恢复内容",
  delete: "恢复为不存在",
  unchanged: "保持不变"
};

function digestText(digest: string | null): string {
  return digest === null ? "不存在" : digest.slice(0, 12);
}

function tableLabel(table: { connectionId: string; schema: string; table: string }): string {
  return `${table.connectionId}/${table.schema}/${table.table}`;
}

/**
 * The restore drawer of the publish history.
 *
 * It shows three separate areas, because they mean different things and have
 * different consequences (Spec v0.11 §2.3):
 *
 *   - **本次恢复目标** — what this restore writes.
 *   - **全局索引范围与既有待同步变更** — what the index will pick up, and
 *     how much of it cannot be decided file by file.
 *   - **镜像同步写集** — files the next full mirror upsert copies. They are
 *     NOT written by this restore; their direction is "the ktx view aligns to
 *     the content root".
 */
export function RestoreReleaseDrawer({ releaseId, createdAt, actor, onClose }: Props) {
  const [preview, setPreview] = useState<RestorePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<RestorePreviewData>(
        `/api/semantic-assets/releases/${encodeURIComponent(releaseId)}/restore/preview`,
        {}
      );
      setPreview(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复预检失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!preview || preview.verdict !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<{ release: { id: string } }>(
        `/api/semantic-assets/releases/${encodeURIComponent(releaseId)}/restore`,
        {
          previewId: preview.previewId,
          planDigest: preview.planDigest,
          // A fresh preview is a fresh plan, so it carries a fresh key. The
          // old key is never reused for a new plan.
          idempotencyKey: preview.previewId
        }
      );
      setSubmittedId(data.release.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "整批恢复没有提交");
    } finally {
      setBusy(false);
    }
  }

  const unknownPercent = Math.round((preview?.unknownCoverage ?? 0) * 100);

  return (
    <div
      className="pl-drawer"
      role="dialog"
      aria-labelledby="restore-release-title"
      data-testid="restore-release-drawer"
    >
      <h2 id="restore-release-title">恢复发布批次</h2>
      <p>恢复到本批次发布前。这会生成一条新的发布记录，原来的记录保持不变。</p>
      <p>
        来源{" "}
        <span className="notranslate" translate="no">
          {releaseId}
        </span>
        ，时间{" "}
        <span className="notranslate" translate="no">
          {createdAt}
        </span>
        ，操作者{" "}
        <span className="notranslate" translate="no">
          {actor}
        </span>
      </p>
      <p>
        <a
          className="pl-row-action-link"
          href={`/api/semantic-assets/releases/${encodeURIComponent(releaseId)}/restore-package`}
          data-testid="restore-package-export"
        >
          导出恢复包
        </a>
      </p>
      <button type="button" className="pl-btn pl-btn--ghost" onClick={() => void runPreview()} disabled={busy}>
        恢复预检
      </button>
      {preview ? (
        <div data-testid="restore-preview-targets">
          <p>
            本次恢复目标{" "}
            <span className="notranslate" translate="no">
              {preview.targets.length}
            </span>{" "}
            个。计划摘要{" "}
            <span className="notranslate" translate="no">
              {preview.planDigest}
            </span>
          </p>
          <ul>
            {preview.targets.map((target) => (
              <li key={target.targetPath}>
                <span className="notranslate" translate="no">
                  {target.targetPath}
                </span>
                {" — "}
                {ACTION_LABEL[target.action]}
                {"（当前 "}
                <span className="notranslate" translate="no">
                  {digestText(target.currentDigest)}
                </span>
                {"，恢复后 "}
                <span className="notranslate" translate="no">
                  {digestText(target.restoredDigest)}
                </span>
                {"）"}
              </li>
            ))}
          </ul>

          <section data-testid="restore-preview-index-scope">
            <h3>全局索引范围与既有待同步变更</h3>
            <p>
              本次索引会扫描{" "}
              <span className="notranslate" translate="no">
                {preview.fullIndexScope.length}
              </span>{" "}
              个文件。其中已知待同步变更{" "}
              <span className="notranslate" translate="no">
                {preview.knownPending.length}
              </span>{" "}
              个；无法逐文件确认的内容约占{" "}
              <span className="notranslate" translate="no">
                {unknownPercent}%
              </span>
              。无法逐文件确认的内容也可能被本次索引纳入。
            </p>
            {preview.knownPending.length > 0 ? (
              <ul>
                {preview.knownPending.map((item) => (
                  <li key={item} className="notranslate" translate="no">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p>当前没有已知待同步变更。</p>
            )}
            <p>
              索引模式：
              {preview.reindexMode === "force" ? "强制重建（存在语义删除）" : "增量重建"}
            </p>
          </section>

          <section data-testid="restore-preview-mirror-sync-write-set">
            <h3>镜像同步写集</h3>
            <p>
              这些文件不由本次恢复写入。它们是内容根与 ktx 视图之间已有的差异，变化方向是镜像向内容根对齐。
            </p>
            {preview.mirrorSyncWriteSet.length === 0 ? (
              <p>当前没有镜像同步写集。</p>
            ) : (
              <ul>
                {preview.mirrorSyncWriteSet.map((item) => (
                  <li key={item.contentRelPath}>
                    <span className="notranslate" translate="no">
                      {item.contentRelPath}
                    </span>
                    {"（内容根 "}
                    <span className="notranslate" translate="no">
                      {digestText(item.contentDigest)}
                    </span>
                    {"，ktx 视图 "}
                    <span className="notranslate" translate="no">
                      {digestText(item.siblingDigest)}
                    </span>
                    {"）"}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {preview.semanticDeletionSet.length > 0 ? (
            <section data-testid="restore-preview-semantic-deletion">
              <h3>恢复后会从模型中消失的表</h3>
              <ul>
                {preview.semanticDeletionSet.map((table) => (
                  <li key={tableLabel(table)} className="notranslate" translate="no">
                    {tableLabel(table)}
                  </li>
                ))}
              </ul>
              <p>这些表在恢复后不可检索、不可读取。</p>
            </section>
          ) : null}

          {preview.readbackExpectations.length > 0 ? (
            <section data-testid="restore-preview-readback">
              <h3>删除方向的读回预期</h3>
              <ul>
                {preview.readbackExpectations.map((item) => (
                  <li key={`${item.kind}:${tableLabel(item.table)}`}>
                    <span className="notranslate" translate="no">
                      {tableLabel(item.table)}
                    </span>
                    {" — "}
                    {item.kind === "table_gone"
                      ? "整表不可检索、不可读取"
                      : "业务扩展不可见，表结构仍然可见"}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview.verdict === "conflict" ? <p>当前内容与所选批次不一致，请重新预检。</p> : null}
          {preview.noChange ? <p>所选批次的发布前内容已经就位，没有需要恢复的差异。</p> : null}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {submittedId ? (
        <p>
          已提交恢复批次{" "}
          <span className="notranslate" translate="no">
            {submittedId}
          </span>
          。生效以前不会显示为已发布。
        </p>
      ) : (
        <button
          type="button"
          className="pl-btn pl-btn--primary"
          disabled={busy || preview?.verdict !== "ready" || preview?.noChange}
          onClick={() => void confirmRestore()}
          data-testid="restore-release-confirm"
        >
          确认恢复
        </button>
      )}
      <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}
