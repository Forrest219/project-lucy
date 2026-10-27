import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { WikiAccessEditor } from "./WikiAccessEditor";
import { queryKeys } from "../lib/queryKeys";
import {
  fetchWikiAccessSummary,
  isWikiAccessConflict,
  previewWikiAccess,
  saveWikiAccess,
  wikiAccessErrorText,
  wikiAclDisplayText,
  wikiAclRoleIds,
  wikiDirectionLabel
} from "../lib/wikiAccess";
import type { WikiAccessPreview, WikiAccessSaveResult } from "../lib/types";

export type WikiAccessDrawerProps = {
  open: boolean;
  wikiKey: string;
  /** Document title shown in the drawer header. */
  title: string;
  onClose: () => void;
  onSaved?: (result: WikiAccessSaveResult) => void;
};

/**
 * Spec 193 §6.2 — the independent "管理访问权限" drawer.
 *
 * The drawer only changes `allowed_roles`. The Markdown body is never
 * submitted here, so an unsaved body draft can never be overwritten by an
 * authorization save.
 */
export function WikiAccessDrawer({
  open,
  wikiKey,
  title,
  onClose,
  onSaved
}: WikiAccessDrawerProps) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [allConfirmed, setAllConfirmed] = useState(false);
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [preview, setPreview] = useState<WikiAccessPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [needsReconfirm, setNeedsReconfirm] = useState(false);
  const [result, setResult] = useState<WikiAccessSaveResult | null>(null);
  const previewSeqRef = useRef(0);

  const summaryQuery = useQuery({
    queryKey: queryKeys.wikiAccess(wikiKey),
    queryFn: () => fetchWikiAccessSummary(wikiKey),
    enabled: open && Boolean(wikiKey)
  });
  const summary = summaryQuery.data ?? null;

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      setPreview(null);
      setPreviewError(null);
      setSaveError(null);
      setNeedsReconfirm(false);
      setResult(null);
      return;
    }
    if (!summary || initialized) {
      return;
    }
    setSelection(wikiAclRoleIds(summary.acl));
    setInitialized(true);
  }, [initialized, open, summary]);

  // Preview requests are sequenced: a stale response never replaces the
  // digest that belongs to the current selection.
  async function runPreview() {
    if (!summary) {
      return;
    }
    const seq = previewSeqRef.current + 1;
    previewSeqRef.current = seq;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const next = await previewWikiAccess(wikiKey, {
        allowed_roles: selection,
        expected_version: summary.file_version
      });
      if (previewSeqRef.current !== seq) return;
      setPreview(next);
    } catch (error: unknown) {
      if (previewSeqRef.current !== seq) return;
      setPreview(null);
      setPreviewError(wikiAccessErrorText(error));
    } finally {
      if (previewSeqRef.current === seq) setPreviewLoading(false);
    }
  }

  const runPreviewRef = useRef(runPreview);
  runPreviewRef.current = runPreview;

  useEffect(() => {
    if (!open || !summary || !initialized) {
      return;
    }
    void runPreviewRef.current();
  }, [initialized, open, selection, summary, wikiKey]);

  const isEmptySelection = !selection.some((role) => role !== "*");
  const isAllSelection = selection.includes("*");
  const commitBlocked =
    !preview ||
    previewLoading ||
    Boolean(previewError) ||
    !roleReady ||
    needsReconfirm ||
    saving ||
    (isEmptySelection && !emptyConfirmed) ||
    (isAllSelection && !allConfirmed);

  async function commit() {
    if (!preview || !summary) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveWikiAccess(wikiKey, {
        allowed_roles: selection,
        expected_version: summary.file_version,
        preview_digest: preview.preview_digest
      });
      setResult(saved);
      setNeedsReconfirm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(wikiKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(wikiKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiAccess(wikiKey) });
      // The Agent list carries the effective context permission digest, which
      // the authorization change can move.
      queryClient.invalidateQueries({ queryKey: queryKeys.adminAgents });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      toast.success("访问权限已保存");
      onSaved?.(saved);
    } catch (error: unknown) {
      setSaveError(wikiAccessErrorText(error));
      if (isWikiAccessConflict(error)) {
        // Keep the administrator's selection, refresh the persisted facts
        // and require a new confirmation before the next commit.
        setNeedsReconfirm(true);
        setAllConfirmed(false);
        setEmptyConfirmed(false);
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiAccess(wikiKey) });
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(wikiKey) });
      }
    } finally {
      setSaving(false);
    }
  }

  const currentLabel = summary ? wikiAclDisplayText(summary.acl) : "加载中…";
  const nextLabel = preview ? wikiAclDisplayText(preview.next_acl) : "—";

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-drawer-overlay" />
        <Dialog.Content
          aria-describedby="wiki-access-drawer-description"
          className="pl-drawer-panel"
          data-testid="wiki-access-drawer"
        >
          <header className="pl-drawer-header">
            <div className="grid gap-1 min-w-0">
              <Dialog.Title className="pl-wiki-access-drawer-title">管理访问权限</Dialog.Title>
              <Dialog.Description
                className="pl-wiki-access-drawer-description"
                id="wiki-access-drawer-description"
              >
                只修改可访问角色，不提交正文草稿。
              </Dialog.Description>
            </div>
            <button
              aria-label="关闭管理访问权限"
              className="pl-drawer-close"
              data-testid="wiki-access-drawer-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="pl-drawer-body">
            <section className="pl-wiki-access-drawer-section">
              <h3 className="pl-wiki-preflight-section-title">文档</h3>
              <dl className="pl-wiki-preflight-summary-list">
                <div className="pl-wiki-preflight-summary-row">
                  <dt className="pl-wiki-preflight-summary-label">标题</dt>
                  <dd className="pl-wiki-preflight-summary-value">{title}</dd>
                </div>
                <div className="pl-wiki-preflight-summary-row">
                  <dt className="pl-wiki-preflight-summary-label">Wiki 路径</dt>
                  <dd className="pl-wiki-preflight-summary-value">
                    <code className="notranslate" translate="no">
                      wiki/{wikiKey}
                    </code>
                  </dd>
                </div>
                <div className="pl-wiki-preflight-summary-row">
                  <dt className="pl-wiki-preflight-summary-label">当前文件版本</dt>
                  <dd className="pl-wiki-preflight-summary-value">
                    <code className="notranslate" translate="no">
                      {summary?.file_version ?? "—"}
                    </code>
                  </dd>
                </div>
              </dl>
            </section>

            {summaryQuery.isError ? (
              <p className="pl-error" data-testid="wiki-access-drawer-error">
                访问权限加载失败：{wikiAccessErrorText(summaryQuery.error)}
              </p>
            ) : null}

            {summaryQuery.isLoading ? (
              <p className="pl-notice" data-testid="wiki-access-drawer-loading">
                正在加载访问权限…
              </p>
            ) : null}

            {summary ? (
              <>
                <section className="pl-wiki-access-drawer-section">
                  <h3 className="pl-wiki-preflight-section-title">可访问角色</h3>
                  <WikiAccessEditor
                    allConfirmed={allConfirmed}
                    emptyConfirmed={emptyConfirmed}
                    effects={preview?.role_effects ?? []}
                    effectsError={previewError}
                    effectsStatus={
                      previewLoading ? "loading" : previewError ? "error" : "ready"
                    }
                    onAllConfirmedChange={setAllConfirmed}
                    onChange={(next) => setSelection(next)}
                    onEmptyConfirmedChange={setEmptyConfirmed}
                    onRoleStateChange={(state) => setRoleReady(state.roleStatus === "ready")}
                    requireEmptyConfirmation={isEmptySelection}
                    source="reset"
                    testId="wiki-access-drawer-editor"
                    value={selection}
                  />
                </section>

                <section className="pl-wiki-access-drawer-section">
                  <h3 className="pl-wiki-preflight-section-title">授权变化</h3>
                  <dl className="pl-wiki-preflight-summary-list">
                    <div className="pl-wiki-preflight-summary-row">
                      <dt className="pl-wiki-preflight-summary-label">当前授权</dt>
                      <dd className="pl-wiki-preflight-summary-value" data-testid="wiki-access-current">
                        {currentLabel}
                      </dd>
                    </div>
                    <div className="pl-wiki-preflight-summary-row">
                      <dt className="pl-wiki-preflight-summary-label">最终授权</dt>
                      <dd className="pl-wiki-preflight-summary-value" data-testid="wiki-access-next">
                        {nextLabel}
                      </dd>
                    </div>
                    <div className="pl-wiki-preflight-summary-row">
                      <dt className="pl-wiki-preflight-summary-label">变化方向</dt>
                      <dd className="pl-wiki-preflight-summary-value" data-testid="wiki-access-direction">
                        {preview ? wikiDirectionLabel(preview.direction) : "—"}
                      </dd>
                    </div>
                  </dl>
                  {preview && preview.declared_without_read > 0 ? (
                    <p className="pl-notice" data-testid="wiki-access-warning-read">
                      {preview.declared_without_read} 个角色缺少读取通道
                    </p>
                  ) : null}
                  {preview && preview.declared_without_discover > 0 ? (
                    <p className="pl-notice" data-testid="wiki-access-warning-discover">
                      {preview.declared_without_discover} 个角色缺少搜索通道
                    </p>
                  ) : null}
                  {previewError ? (
                    <p className="pl-error" data-testid="wiki-access-preview-error">
                      权限预检失败：{previewError}
                    </p>
                  ) : null}
                </section>

                {needsReconfirm ? (
                  <div className="pl-wiki-access-confirm" data-testid="wiki-access-conflict">
                    <p className="pl-notice">
                      文档已被其他人更新，已保留你的角色选择。请重新确认后保存。
                    </p>
                    <button
                      className="pl-btn pl-btn--secondary text-sm"
                      data-testid="wiki-access-reconfirm"
                      onClick={() => {
                        setNeedsReconfirm(false);
                        setPreview(null);
                        setPreviewError(null);
                        void runPreview();
                      }}
                      type="button"
                    >
                      重新预检并确认
                    </button>
                  </div>
                ) : null}
                {saveError ? (
                  <p className="pl-error" data-testid="wiki-access-save-error">
                    保存失败：{saveError}
                  </p>
                ) : null}
                {result ? (
                  <p className="pl-notice" data-testid="wiki-access-result">
                    {result.status === "noop"
                      ? "授权未变化，未写入文件。"
                      : "访问权限已保存。"}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <footer className="pl-drawer-footer">
            <button className="pl-btn pl-btn--ghost" onClick={onClose} type="button">
              关闭
            </button>
            <button
              aria-busy={saving}
              className="pl-btn pl-btn--primary"
              data-testid="wiki-access-save"
              disabled={commitBlocked}
              onClick={() => void commit()}
              type="button"
            >
              {saving ? "保存中…" : "保存访问权限"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
