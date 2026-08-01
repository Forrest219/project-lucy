import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FrontmatterDrawer } from "../components/FrontmatterDrawer";
import { PageHeader } from "../components/PageHeader";
import { TemplatePicker } from "../components/TemplatePicker";
import { WikiReadView } from "../components/WikiReadView";
import { WikiEditView } from "../components/WikiEditView";
import { WikiSavePreflight } from "../components/WikiSavePreflight";
import { WikiTree } from "../components/WikiTree";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import {
  draftKeyForSlRef,
  findWikiBySlRef,
  nextNewNoteKey
} from "../lib/slRef";
import { buildSavePreflightState, wikiDraftVersion } from "../lib/wiki";
import type {
  SourcesResponse,
  WikiFrontmatter,
  WikiListResponse,
  WikiPage,
  WikiPreview,
  WikiSummary
} from "../lib/types";

type PageMode = "loaded" | "draft";
type WikiUiMode = "read" | "edit";

/**
 * Compute the effective key + mode for the editor. The URL is the
 * source of truth:
 *   - `?key=...`     -> loaded (or draft if no matching page)
 *   - `?sl_ref=...`  -> matched page (loaded) or new draft
 *   - neither        -> first page (loaded) or new draft
 */
function resolveKey(
  keyParam: string,
  slRef: string | null,
  pages: WikiSummary[]
): { key: string; mode: PageMode } {
  if (keyParam) {
    return { key: keyParam, mode: pages.some((p) => p.key === keyParam) ? "loaded" : "draft" };
  }
  if (slRef) {
    const matched = findWikiBySlRef(pages, slRef);
    if (matched) {
      return { key: matched.key, mode: "loaded" };
    }
    return { key: draftKeyForSlRef(slRef, pages.map((p) => p.key)), mode: "draft" };
  }
  if (pages.length > 0) {
    return { key: pages[0]?.key ?? "global/new-note.md", mode: "loaded" };
  }
  return { key: "global/new-note.md", mode: "draft" };
}

export function WikiEditor() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const slRefRaw = searchParams.get("sl_ref");
  const slRef = slRefRaw ? decodeURIComponent(slRefRaw) : null;
  const keyParamRaw = searchParams.get("key") ?? "";
  const keyParam = keyParamRaw ? decodeURIComponent(keyParamRaw) : "";
  const listQuery = useQuery({
    queryKey: queryKeys.wiki,
    queryFn: () => apiGet<WikiListResponse>("/api/wiki")
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const pages = listQuery.data?.pages ?? [];
  const tables = sourcesQuery.data?.tables ?? [];

  const knownSlRefs = useMemo(() => {
    const set = new Set<string>();
    for (const table of tables) {
      set.add(`${table.conn}/${table.schema}/${table.table}`);
    }
    return set;
  }, [tables]);

  // The effective key is derived from URL + page list on every render.
  // No useState for this — the URL is the single source of truth.
  const resolved = useMemo(
    () => resolveKey(keyParam, slRef, pages),
    [keyParam, pages, slRef]
  );
  const key = resolved.key;
  const mode = resolved.mode;

  // Local buffer for the frontmatter / body the user is editing.
  // The dirty flag tells us to skip applying loaded-page content
  // back over local edits on subsequent renders.
  const [frontmatter, setFrontmatter] = useState<WikiFrontmatter>({});
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<WikiPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<WikiUiMode>("read");
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [previewTab, setPreviewTab] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [showMetaDrawer, setShowMetaDrawer] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const sourceRef = useRef<string>(`${key}::${mode}::init`);
  const preserveBufferForKeyRef = useRef<string | null>(null);
  const lastResolvedKeyRef = useRef<string>(key);
  // Refs that always reflect the latest content / frontmatter. Updated
  // synchronously from the change handlers so the Save Preflight and
  // debounced dry-run see fresh values even before React commits the
  // batched state update. We intentionally do NOT mirror `content` /
  // `frontmatter` back into the ref during render, otherwise a render
  // triggered by an unrelated state change would clobber the latest
  // edit before downstream consumers have a chance to read it.
  const contentRef = useRef(content);
  const frontmatterRef = useRef(frontmatter);
  // Live draft version. Updated every time the editor buffer changes.
  // Stored in a ref so the async runDryRun closure can compare it
  // against the version it started with without going stale.
  const currentDraftVersionRef = useRef<string>(wikiDraftVersion({}, ""));
  const currentDraftVersion = useMemo(
    () => wikiDraftVersion(frontmatter, content),
    [content, frontmatter]
  );
  useEffect(() => {
    currentDraftVersionRef.current = currentDraftVersion;
  }, [currentDraftVersion]);

  useEffect(() => {
    if (lastResolvedKeyRef.current === key) {
      return;
    }
    lastResolvedKeyRef.current = key;
    setUiMode("read");
    setPreflightOpen(false);
  }, [key]);

  // When an object handoff comes in as only `?sl_ref=...`, resolve it
  // once the Wiki list is loaded and mirror the resolved key back into
  // the URL. This keeps the URL shareable and makes the selected page
  // explicit after auto-match or draft generation.
  useEffect(() => {
    if (!slRef || keyParam || !listQuery.data) {
      return;
    }
    const next: Record<string, string> = { key, sl_ref: slRef };
    setSearchParams(next, { replace: true });
  }, [key, keyParam, listQuery.data, setSearchParams, slRef]);

  // Seed the local buffer with `sl_ref` whenever a new draft key is
  // generated from the URL. We only do this on the transition into a
  // draft so existing pages are not overwritten.
  useEffect(() => {
    if (mode !== "draft") {
      return;
    }
    if (preserveBufferForKeyRef.current === key) {
      preserveBufferForKeyRef.current = null;
      sourceRef.current = `${key}::${mode}::preserved`;
      return;
    }
    const sourceKey = `${key}::${mode}::seeded`;
    if (sourceRef.current === sourceKey) {
      return;
    }
    if (slRef) {
      frontmatterRef.current = { sl_refs: [slRef] };
      setFrontmatter({ sl_refs: [slRef] });
    } else {
      frontmatterRef.current = {};
      setFrontmatter({});
    }
    contentRef.current = "";
    setContent("");
    setPreview(null);
    dirtyRef.current = false;
    sourceRef.current = sourceKey;
  }, [key, mode, slRef]);

  const pageQuery = useQuery({
    queryKey: queryKeys.wikiPage(key),
    queryFn: () => apiGet<WikiPage>(`/api/wiki/${encodeURIComponent(key)}`),
    enabled: Boolean(key) && mode === "loaded"
  });

  // Apply page detail to local state when the user has not edited
  // anything since the last reset. We never clobber unsaved edits.
  useEffect(() => {
    if (mode !== "loaded") {
      return;
    }
    if (!pageQuery.data) {
      return;
    }
    // The buffer was hydrated for a draft on this key — keep that
    // state unless the user explicitly starts editing. The dirty flag
    // is set by every change handler, so once the user types anything
    // we MUST NOT overwrite their input.
    if (dirtyRef.current) {
      return;
    }
    const sourceKey = `${key}::${mode}::loaded`;
    if (sourceRef.current === sourceKey) {
      return;
    }
    setFrontmatter(pageQuery.data.frontmatter);
    frontmatterRef.current = pageQuery.data.frontmatter;
    setContent(pageQuery.data.content);
    contentRef.current = pageQuery.data.content;
    setPreview(null);
    sourceRef.current = sourceKey;
  }, [key, mode, pageQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, {
        dryRun: false,
        frontmatter,
        content
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      dirtyRef.current = false;
      sourceRef.current = `${key}::${mode}::saved`;
      toast.success("Wiki 已保存");
      setPreflightOpen(false);
      setUiMode("read");
    },
    onError: (error) => {
      toast.error(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const previewBody = useMemo(
    () => ({ dryRun: true, frontmatter, content }),
    [content, frontmatter]
  );

  // Refs that always reflect the latest content / frontmatter. Updated
  // synchronously from the change handlers so the Save Preflight and
  // debounced dry-run see fresh values even before React commits the
  // batched state update. We intentionally do NOT mirror `content` /
  // `frontmatter` back into the ref during render, otherwise a render
  // triggered by an unrelated state change would clobber the latest
  // edit before downstream consumers have a chance to read it.
  // Debounced dry-run preview. Only PUTs with dryRun: true.
  useEffect(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const timeout = window.setTimeout(() => {
      runDryRunRef.current();
    }, 350);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewBody]);

  const runDryRunRef = useRef<() => void>(() => undefined);
  const runDryRun = useCallback(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const body = {
      dryRun: true,
      frontmatter: frontmatterRef.current,
      content: contentRef.current
    };
    const startedVersion = wikiDraftVersion(body.frontmatter, body.content);
    setPreviewLoading(true);
    apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, body)
      .then((data) => {
        // Drop the response if the user kept editing while the
        // request was in flight. A later runDryRun will pick up the
        // current draft and the Save Preflight must never show a diff
        // that does not match the editor buffer.
        if (currentDraftVersionRef.current !== startedVersion) {
          return;
        }
        setPreview(data);
        setPreviewVersion(startedVersion);
        setPreviewError(null);
      })
      .catch((caught: unknown) => {
        if (currentDraftVersionRef.current !== startedVersion) {
          return;
        }
        setPreview(null);
        setPreviewVersion(null);
        setPreviewError(caught instanceof Error ? caught.message : "预览失败");
      })
      .finally(() => {
        if (currentDraftVersionRef.current === startedVersion) {
          setPreviewLoading(false);
        }
      });
  }, [key]);
  runDryRunRef.current = runDryRun;

  function updateFrontmatter(next: WikiFrontmatter) {
    dirtyRef.current = true;
    frontmatterRef.current = next;
    setFrontmatter(next);
  }

  function updateContent(next: string) {
    dirtyRef.current = true;
    contentRef.current = next;
    setContent(next);
  }

  function applyTemplate(templateContent: string) {
    dirtyRef.current = true;
    contentRef.current = templateContent;
    setContent(templateContent);
    setUiMode("edit");
  }

  function navigateTo(nextKey: string) {
    const next: Record<string, string> = { key: nextKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    dirtyRef.current = false;
    sourceRef.current = `${nextKey}::navigated`;
    setSearchParams(next, { replace: true });
  }

  function startNewWiki() {
    const draftKey = nextNewNoteKey(pages.map((p) => p.key));
    const next: Record<string, string> = { key: draftKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    setSearchParams(next, { replace: true });
    dirtyRef.current = false;
    sourceRef.current = `${draftKey}::navigated`;
  }

  function openSavePreflight() {
    if (!key.endsWith(".md")) {
      toast.error("路径必须以 .md 结尾才能保存。");
      return;
    }
    // Always force a fresh dry-run when the modal opens. If the
    // current draft is still covered by a recent preview we still
    // re-issue the request so Diff / Raw can never lag behind the
    // editor buffer.
    setPreview(null);
    setPreviewVersion(null);
    setPreviewError(null);
    runDryRun();
    setPreflightOpen(true);
  }

  function switchToEdit() {
    if (uiMode === "edit") {
      return;
    }
    setUiMode("edit");
  }

  function requestBackToRead() {
    if (uiMode === "edit" && dirtyRef.current) {
      const confirmed = window.confirm(
        "当前编辑未保存。返回阅读态后，未保存的草稿仍会保留在 Markdown 编辑器中。"
      );
      if (!confirmed) {
        return;
      }
    }
    setUiMode("read");
  }

  // Cmd/Ctrl+S opens the Save Preflight. This is the single source of
  // truth for the shortcut and is wired on `window` so it works no
  // matter where focus currently lives.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      if (uiMode !== "edit") {
        setUiMode("edit");
      }
      openSavePreflight();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode, key, frontmatter, content]);

  const preflightState = useMemo(
    () =>
      buildSavePreflightState({
        key,
        preview,
        previewError,
        frontmatter,
        content,
        knownSlRefs,
        previewLoading,
        currentDraftVersion,
        previewVersion
      }),
    [content, currentDraftVersion, frontmatter, key, knownSlRefs, preview, previewError, previewLoading, previewVersion]
  );

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/wiki?key=${encodeURIComponent(key)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyHint("已复制链接");
      window.setTimeout(() => setCopyHint(null), 1600);
    } catch {
      setCopyHint("复制失败，请手动复制地址栏 URL");
      window.setTimeout(() => setCopyHint(null), 2400);
    }
  }, [key]);

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={
          uiMode === "read" ? (
            "业务 Wiki"
          ) : (
            <span className="pl-wiki-header-edit-title">
              业务 Wiki ·{" "}
              <code
                className="pl-wiki-header-edit-key notranslate"
                translate="no"
              >
                {key}
              </code>
            </span>
          )
        }
        breadcrumbs={["语义建模", "业务 Wiki", key]}
        description={
          uiMode === "read"
            ? "用 Markdown 沉淀表口径、指标说明与分析 Playbook。"
            : "直接撰写 Markdown；保存预检会显示 Diff 与校验结果。"
        }
        badges={
          uiMode === "read" ? null : (
            <span
              className="pl-wiki-header-status"
              data-testid="wiki-status-pill"
              data-status={mode}
            >
              {mode === "draft" ? "未保存草稿" : "已保存"}
            </span>
          )
        }
        actions={
          <div className="pl-wiki-header-actions" data-testid="wiki-header-actions">
            {uiMode === "read" ? (
              <>
                <button
                  aria-label="复制当前 Wiki 链接"
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-copy-link-button"
                  onClick={handleCopyLink}
                  type="button"
                >
                  复制链接
                </button>
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-new-button"
                  onClick={startNewWiki}
                  type="button"
                >
                  + 新建 Wiki
                </button>
                <button
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-edit-button"
                  onClick={switchToEdit}
                  type="button"
                >
                  编辑
                </button>
              </>
            ) : (
              <>
                <button
                  aria-pressed={focusMode}
                  className={clsx(
                    "pl-btn",
                    "pl-btn--ghost",
                    focusMode && "pl-wiki-header-focus--active"
                  )}
                  data-testid="wiki-focus-toggle"
                  onClick={() => setFocusMode((current) => !current)}
                  title="隐藏左侧导航，专注 Markdown 与 Preview"
                  type="button"
                >
                  专注编辑
                </button>
                <button
                  aria-label="文档信息"
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-meta-toggle"
                  onClick={() => setShowMetaDrawer((current) => !current)}
                  type="button"
                >
                  文档信息
                </button>
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-back-to-read"
                  onClick={requestBackToRead}
                  type="button"
                >
                  返回阅读
                </button>
                <button
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-save-preflight-button"
                  disabled={saveMutation.isPending}
                  onClick={openSavePreflight}
                  type="button"
                >
                  保存预检
                </button>
              </>
            )}
            {copyHint ? (
              <span
                aria-live="polite"
                className="pl-wiki-header-copy-hint"
                data-testid="wiki-copy-hint"
                role="status"
              >
                {copyHint}
              </span>
            ) : null}
          </div>
        }
      />

      <section
        aria-label="业务 Wiki 工作区"
        className={clsx(
          "pl-editor-layout",
          "pl-wiki-layout",
          `pl-wiki-layout--${uiMode}`,
          focusMode && uiMode === "edit" && "pl-wiki-layout--focus",
          previewTab && uiMode === "edit" && "pl-wiki-layout--preview-tab"
        )}
        data-focus={focusMode || undefined}
        data-key={key || undefined}
        data-mode={uiMode}
        data-preview-tab={previewTab || undefined}
        data-testid="wiki-layout"
      >
        <aside
          aria-label="业务 Wiki 目录"
          className={clsx(
            "grid content-start gap-3 pl-wiki-sidebar",
            focusMode && uiMode === "edit" && "pl-wiki-sidebar--collapsed"
          )}
          data-testid="wiki-sidebar"
          hidden={focusMode && uiMode === "edit"}
        >
          <Link className="pl-btn pl-btn--ghost justify-start" to="/">
            表目录
          </Link>
          <div className="pl-wiki-sidebar-header">
            <h2 className="pl-wiki-sidebar-title">业务 Wiki</h2>
          </div>
          {key && uiMode === "read" ? (
            <p
              className="pl-wiki-sidebar-key notranslate"
              data-testid="wiki-sidebar-key"
              title={key}
              translate="no"
            >
              {key}
            </p>
          ) : null}
          {slRef ? (
            <p
              className="pl-notice pl-wiki-context-hint"
              data-testid="wiki-context-hint"
              title={slRef}
            >
              当前上下文：<code className="notranslate" translate="no">{slRef}</code>
              {mode === "loaded" ? "（已匹配）" : "（新草稿）"}
            </p>
          ) : null}
          <WikiTree activeKey={key} onSelect={navigateTo} pages={pages} />
        </aside>

        <div className="grid gap-4 pl-wiki-main">
          <div className="pl-wiki-body" data-testid="wiki-body">
            {uiMode === "read" ? (
              <WikiReadView
                content={content}
                frontmatter={frontmatter}
                keyName={key}
                knownSources={knownSlRefs}
                knownTables={tables}
                onApplyTemplate={applyTemplate}
                onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
                onSwitchToEdit={switchToEdit}
              />
            ) : (
              <WikiEditView
                content={content}
                frontmatter={frontmatter}
                onContentChange={updateContent}
                onFrontmatterChange={updateFrontmatter}
                previewTab={previewTab}
                onPreviewTabChange={setPreviewTab}
              />
            )}
          </div>
        </div>
      </section>

      <TemplatePicker
        onClose={() => setTemplatePickerOpen(false)}
        onPick={(picked) => {
          applyTemplate(picked.content);
          setTemplatePickerOpen(false);
          toast.success("模板已填充，请补全高亮字段后保存预检。");
        }}
        open={templatePickerOpen}
      />

      <WikiSavePreflight
        isSaving={saveMutation.isPending}
        onCancel={() => setPreflightOpen(false)}
        onConfirmSave={() => saveMutation.mutate()}
        open={preflightOpen}
        state={preflightState}
      />

      <FrontmatterDrawer
        frontmatter={frontmatter}
        onClose={() => setShowMetaDrawer(false)}
        onChange={updateFrontmatter}
        open={showMetaDrawer}
      />
    </div>
  );
}
