import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
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
  SourceSummary,
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
  const [pathDraft, setPathDraft] = useState("");
  const dirtyRef = useRef(false);
  const sourceRef = useRef<string>(`${key}::${mode}::init`);
  const preserveBufferForKeyRef = useRef<string | null>(null);
  const lastResolvedKeyRef = useRef<string>(key);
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
    setPathDraft(key);
  }, [key]);

  // When the resolved key changes, default back to Read Mode so the
  // user always lands on a clean document surface unless they were
  // actively editing the same key.
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
      setFrontmatter({ sl_refs: [slRef] });
    } else {
      setFrontmatter({});
    }
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
    const sourceKey = `${key}::${mode}::loaded`;
    if (sourceRef.current === sourceKey) {
      return;
    }
    if (sourceRef.current.startsWith(`${key}::loaded::`) && dirtyRef.current) {
      // User edited; only apply once.
      return;
    }
    setFrontmatter(pageQuery.data.frontmatter);
    setContent(pageQuery.data.content);
    setPreview(null);
    dirtyRef.current = false;
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

  // Debounced dry-run preview. Only PUTs with dryRun: true.
  useEffect(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const timeout = window.setTimeout(() => {
      runDryRun();
    }, 350);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewBody]);

  const runDryRun = useCallback(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const startedVersion = wikiDraftVersion(previewBody.frontmatter, previewBody.content);
    setPreviewLoading(true);
    apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, previewBody)
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
  }, [key, previewBody]);

  function updateFrontmatter(next: WikiFrontmatter) {
    dirtyRef.current = true;
    setFrontmatter(next);
  }

  function updateContent(next: string) {
    dirtyRef.current = true;
    setContent(next);
  }

  function applyTemplate(templateContent: string) {
    dirtyRef.current = true;
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

  function commitPathDraft() {
    const nextKey = pathDraft.trim();
    if (!nextKey || nextKey === key) {
      setPathDraft(key);
      return;
    }
    const next: Record<string, string> = {};
    if (nextKey) {
      next.key = nextKey;
    }
    if (slRef) {
      next.sl_ref = slRef;
    }
    preserveBufferForKeyRef.current = nextKey;
    setSearchParams(next, { replace: true });
    dirtyRef.current = true;
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

  const tabs = useMemo(
    () => [
      { key: "read", label: "阅读态", active: uiMode === "read" },
      { key: "edit", label: "编辑态", active: uiMode === "edit" }
    ],
    [uiMode]
  );

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={uiMode === "read" ? "业务 Wiki" : `业务 Wiki · ${key}`}
        breadcrumbs={["语义建模", "业务 Wiki", key]}
        description={
          uiMode === "read"
            ? "阅读态：先看清业务 Wiki，再决定是否进入编辑态。"
            : "编辑态：直接撰写 Markdown，Diff 与原始 Markdown 通过保存预检查看。"
        }
        badges={
          <>
            <span data-testid="wiki-mode-badge" data-mode={uiMode}>
              {uiMode === "read" ? "阅读态" : "编辑态"}
            </span>
            <span data-testid="wiki-status-badge" data-status={mode}>
              {mode === "draft" ? "未保存草稿" : "已保存"}
            </span>
          </>
        }
        actions={
          <div className="pl-wiki-header-actions" data-testid="wiki-header-actions">
            <div className="pl-wiki-header-modes" data-testid="wiki-header-modes" role="tablist">
              {tabs.map((tab) => (
                <button
                  aria-selected={tab.active}
                  className={clsx(
                    "pl-btn",
                    "pl-btn--ghost",
                    tab.active && "pl-wiki-header-mode--active"
                  )}
                  data-mode={tab.key}
                  data-testid={`wiki-mode-${tab.key}`}
                  key={tab.key}
                  onClick={() => {
                    if (tab.key === "read") {
                      requestBackToRead();
                    } else {
                      switchToEdit();
                    }
                  }}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-new-button"
              onClick={startNewWiki}
              type="button"
            >
              + 新建 Wiki
            </button>
            {uiMode === "read" ? (
              <button
                className="pl-btn pl-btn--primary"
                data-testid="wiki-edit-button"
                onClick={switchToEdit}
                type="button"
              >
                编辑
              </button>
            ) : (
              <>
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
          </div>
        }
      />

      <section
        aria-label="业务 Wiki 工作区"
        className={clsx("pl-editor-layout", "pl-wiki-layout", `pl-wiki-layout--${uiMode}`)}
        data-testid="wiki-layout"
      >
        <aside
          aria-label="业务 Wiki 目录"
          className="grid content-start gap-3 pl-wiki-sidebar"
          data-testid="wiki-sidebar"
        >
          <Link className="pl-btn pl-btn--ghost justify-start" to="/">
            表目录
          </Link>
          <div className="pl-wiki-sidebar-header">
            <h2 className="pl-wiki-sidebar-title">业务 Wiki</h2>
          </div>
          <label className="pl-field-label">
            <span>页面路径</span>
            <input
              className="pl-input notranslate"
              data-testid="wiki-path-input"
              onBlur={commitPathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPathDraft();
                }
              }}
              translate="no"
              value={pathDraft}
            />
          </label>
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
                onSwitchToEdit={switchToEdit}
              />
            ) : (
              <WikiEditView
                content={content}
                frontmatter={frontmatter}
                onContentChange={updateContent}
                onFrontmatterChange={updateFrontmatter}
              />
            )}
          </div>
        </div>
      </section>

      <WikiSavePreflight
        isSaving={saveMutation.isPending}
        onCancel={() => setPreflightOpen(false)}
        onConfirmSave={() => saveMutation.mutate()}
        open={preflightOpen}
        state={preflightState}
      />
    </div>
  );
}
