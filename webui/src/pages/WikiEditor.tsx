import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { TemplatePicker } from "../components/TemplatePicker";
import { WikiLibraryHome } from "../components/WikiLibraryHome";
import { WikiReadView } from "../components/WikiReadView";
import { WikiEditView } from "../components/WikiEditView";
import { WikiSavePreflight } from "../components/WikiSavePreflight";
import { WikiTree } from "../components/WikiTree";
import { WikiUploadPreflight } from "../components/WikiUploadPreflight";
import { apiGet, apiPost, apiPut } from "../lib/apiClient";
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
  WikiSummary,
  WikiUploadPreview
} from "../lib/types";

type PageMode = "library" | "loaded" | "draft";
type WikiUiMode = "read" | "edit";
type WikiUploadMode = "create" | "replace";

/**
 * Compute the effective key + mode for the editor. The URL is the
 * source of truth:
 *   - `?key=...`     -> loaded (or draft if no matching page)
 *   - `?sl_ref=...`  -> matched page (loaded) or new draft
 *   - neither        -> library home
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
  return { key: "", mode: "library" };
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
  const [previewTab, setPreviewTab] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<WikiUploadMode>("create");
  const [uploadTargetKey, setUploadTargetKey] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadMarkdown, setUploadMarkdown] = useState("");
  const [uploadPreview, setUploadPreview] = useState<WikiUploadPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
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

  const uploadCommitMutation = useMutation({
    mutationFn: () =>
      apiPost<WikiUploadPreview>("/api/wiki/upload/commit", {
        key: uploadTargetKey,
        markdown: uploadMarkdown,
        overwrite: uploadMode === "replace" || uploadPreview?.exists === true
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      dirtyRef.current = false;
      sourceRef.current = `${result.key}::uploaded`;
      setUiMode("read");
      setUploadOpen(false);
      setUploadPreview(null);
      setUploadError(null);
      setSearchParams({ key: result.key }, { replace: true });
      toast.success(uploadMode === "replace" ? "Markdown 已覆盖" : "Markdown 已上传");
    },
    onError: (error) => {
      toast.error(`上传失败：${error instanceof Error ? error.message : "未知错误"}`);
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

  function confirmDiscardUnsaved(message: string): boolean {
    if (!dirtyRef.current) {
      return true;
    }
    return window.confirm(message);
  }

  function navigateTo(nextKey: string) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。切换文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    const next: Record<string, string> = { key: nextKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    dirtyRef.current = false;
    sourceRef.current = `${nextKey}::navigated`;
    setSearchParams(next, { replace: true });
  }

  function startNewWiki() {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。新建文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    const draftKey = nextNewNoteKey(pages.map((p) => p.key));
    const next: Record<string, string> = { key: draftKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    setSearchParams(next, { replace: true });
    dirtyRef.current = false;
    sourceRef.current = `${draftKey}::navigated`;
    setUiMode("edit");
  }

  function openSavePreflight() {
    if (!key) {
      toast.error("请先选择或新建 Markdown 文档。");
      return;
    }
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
    if (!key) {
      toast.error("请先选择或新建 Markdown 文档。");
      return;
    }
    if (uiMode === "edit") {
      return;
    }
    setUiMode("edit");
  }

  function requestBackToRead() {
    if (
      uiMode === "edit" &&
      !confirmDiscardUnsaved("当前编辑未保存。取消编辑会放弃未保存内容，是否继续？")
    ) {
      return;
    }
    if (mode === "loaded" && pageQuery.data) {
      setFrontmatter(pageQuery.data.frontmatter);
      frontmatterRef.current = pageQuery.data.frontmatter;
      setContent(pageQuery.data.content);
      contentRef.current = pageQuery.data.content;
      sourceRef.current = `${key}::${mode}::cancelled`;
    }
    if (mode === "draft") {
      setContent("");
      contentRef.current = "";
      setFrontmatter(slRef ? { sl_refs: [slRef] } : {});
      frontmatterRef.current = slRef ? { sl_refs: [slRef] } : {};
    }
    dirtyRef.current = false;
    setUiMode("read");
  }

  const currentDirectory = useMemo(() => {
    if (!key || !key.includes("/")) {
      return "global";
    }
    return key.split("/").slice(0, -1).join("/") || "global";
  }, [key]);

  const uploadDirectories = useMemo(() => {
    const directories = new Set<string>(["global"]);
    for (const page of pages) {
      const segments = page.key.split("/").filter(Boolean);
      if (segments.length > 1) {
        directories.add(segments.slice(0, -1).join("/"));
      }
    }
    directories.add(currentDirectory);
    return Array.from(directories).sort((a, b) => a.localeCompare(b));
  }, [currentDirectory, pages]);

  function openUpload(modeToOpen: WikiUploadMode) {
    if (
      !confirmDiscardUnsaved(
        modeToOpen === "replace"
          ? "当前编辑未保存。上传覆盖会放弃未保存内容，是否继续？"
          : "当前编辑未保存。上传新文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    if (modeToOpen === "replace" && !key) {
      toast.error("请先选择要覆盖的 Markdown 文档。");
      return;
    }
    setUploadMode(modeToOpen);
    setUploadPreview(null);
    setUploadError(null);
    uploadInputRef.current?.click();
  }

  async function previewUpload(targetKey: string, markdown: string, modeToPreview: WikiUploadMode) {
    setUploadLoading(true);
    setUploadOpen(true);
    setUploadError(null);
    setUploadPreview(null);
    try {
      const result = await apiPost<WikiUploadPreview>("/api/wiki/upload/preview", {
        key: targetKey,
        markdown,
        overwrite: modeToPreview === "replace"
      });
      setUploadPreview(result);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "未知错误");
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleUploadFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.name.endsWith(".md")) {
      toast.error("请选择 .md Markdown 文件。");
      return;
    }
    const markdown = await file.text();
    const fileName = file.name.split(/[\\/]/).pop() ?? file.name;
    setUploadFileName(fileName);
    const targetKey =
      uploadMode === "replace"
        ? key
        : `${currentDirectory}/${fileName}`.replaceAll(/\/+/g, "/");
    setUploadTargetKey(targetKey);
    setUploadMarkdown(markdown);
    await previewUpload(targetKey, markdown, uploadMode);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  function handleUploadDirectoryChange(directory: string) {
    if (!uploadFileName || !uploadMarkdown) {
      return;
    }
    const targetKey = `${directory}/${uploadFileName}`.replaceAll(/\/+/g, "/");
    setUploadTargetKey(targetKey);
    void previewUpload(targetKey, uploadMarkdown, "create");
  }

  async function handleDownloadMarkdown() {
    if (!key) {
      toast.error("请先选择 Markdown 文档。");
      return;
    }
    if (
      uiMode === "edit" &&
      dirtyRef.current &&
      !window.confirm("当前有未保存编辑。下载的是已保存版本，是否继续？")
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/wiki/${encodeURIComponent(key)}/raw`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const markdown = await response.text();
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = key.split("/").pop() ?? "wiki.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(`下载失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
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
      if (!key) {
        toast.error("请先选择或新建 Markdown 文档。");
        return;
      }
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

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={
          uiMode === "edit" ? (
            <span className="pl-wiki-header-edit-title">
              编辑 Wiki 文档
            </span>
          ) : (
            "业务 Wiki"
          )
        }
        description={
          uiMode === "read"
            ? "管理业务口径、指标说明和分析 Playbook 的 Markdown 文档。"
            : "直接撰写 Markdown；保存并发布前会显示 Diff 与校验结果。"
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
              mode === "library" ? (
                <>
                  <button
                    className="pl-btn pl-btn--primary"
                    data-testid="wiki-upload-button"
                    onClick={() => openUpload("create")}
                    type="button"
                  >
                    上传 Markdown
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-new-button"
                    onClick={startNewWiki}
                    type="button"
                  >
                    新建文档
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-download-button"
                    onClick={handleDownloadMarkdown}
                    type="button"
                  >
                    下载 Markdown
                  </button>
                  <button
                    className="pl-btn pl-btn--primary"
                    data-testid="wiki-upload-replace-button"
                    onClick={() => openUpload("replace")}
                    type="button"
                  >
                    上传覆盖
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-edit-button"
                    onClick={switchToEdit}
                    type="button"
                  >
                    编辑
                  </button>
                </>
              )
            ) : (
              <>
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-back-to-read"
                  onClick={requestBackToRead}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-save-preflight-button"
                  disabled={saveMutation.isPending}
                  onClick={openSavePreflight}
                  type="button"
                >
                  保存并发布
                </button>
              </>
            )}
          </div>
        }
      />

      <section
        aria-label="业务 Wiki 工作区"
        className={clsx(
          "pl-editor-layout",
          "pl-wiki-layout",
          `pl-wiki-layout--${uiMode}`,
          previewTab && uiMode === "edit" && "pl-wiki-layout--preview-tab"
        )}
        data-key={key || undefined}
        data-mode={uiMode}
        data-preview-tab={previewTab || undefined}
        data-testid="wiki-layout"
      >
        <aside
          aria-label="业务 Wiki 目录"
          className="grid content-start gap-3 pl-wiki-sidebar"
          data-testid="wiki-sidebar"
        >
          <div className="pl-wiki-sidebar-header">
            <h2 className="pl-wiki-sidebar-title">目录</h2>
          </div>
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
            {mode === "library" ? (
              <WikiLibraryHome
                onNew={startNewWiki}
                onSelect={navigateTo}
                onUpload={() => openUpload("create")}
                pages={pages}
              />
            ) : uiMode === "read" ? (
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

      <input
        accept=".md,text/markdown,text/plain"
        aria-label="选择 Markdown 文件"
        className="sr-only"
        data-testid="wiki-upload-input"
        onChange={(event) => {
          void handleUploadFile(event.target.files?.[0]);
        }}
        ref={uploadInputRef}
        type="file"
      />

      <WikiUploadPreflight
        error={uploadError}
        directories={uploadDirectories}
        isCommitting={uploadCommitMutation.isPending}
        isLoading={uploadLoading}
        mode={uploadMode}
        onCancel={() => {
          setUploadOpen(false);
          setUploadPreview(null);
          setUploadError(null);
        }}
        onConfirm={() => uploadCommitMutation.mutate()}
        onTargetDirectoryChange={handleUploadDirectoryChange}
        open={uploadOpen}
        preview={uploadPreview}
        targetDirectory={
          uploadTargetKey.includes("/")
            ? uploadTargetKey.split("/").slice(0, -1).join("/")
            : currentDirectory
        }
      />
    </div>
  );
}
