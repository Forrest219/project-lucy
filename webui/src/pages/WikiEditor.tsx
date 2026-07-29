import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FrontmatterForm } from "../components/FrontmatterForm";
import { PageHeader } from "../components/PageHeader";
import {
  WikiInspector,
  type WikiInspectorTab
} from "../components/WikiInspector";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import {
  draftKeyForSlRef,
  findWikiBySlRef,
  nextNewNoteKey,
  normalizeSlRef
} from "../lib/slRef";
import { toast } from "sonner";
import type {
  WikiFrontmatter,
  WikiListResponse,
  WikiPage,
  WikiPreview,
  WikiSummary
} from "../lib/types";

type PageMode = "loaded" | "draft";

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
  const slRef = normalizeSlRef(searchParams.get("sl_ref"));
  const keyParam = searchParams.get("key") ?? "";
  const listQuery = useQuery({
    queryKey: queryKeys.wiki,
    queryFn: () => apiGet<WikiListResponse>("/api/wiki")
  });

  const pages = listQuery.data?.pages ?? [];

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
  const [activeTab, setActiveTab] = useState<WikiInspectorTab>("preview");
  const [searchFilter, setSearchFilter] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const dirtyRef = useRef(false);
  const sourceRef = useRef<string>(`${key}::${mode}::init`);
  const preserveBufferForKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setPathDraft(key);
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
      apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, previewBody)
        .then((data) => {
          setPreview(data);
          setPreviewError(null);
        })
        .catch((caught: unknown) => {
          setPreview(null);
          setPreviewError(caught instanceof Error ? caught.message : "预览失败");
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [key, previewBody]);

  const runPreviewNow = useCallback(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, previewBody)
      .then((data) => {
        setPreview(data);
        setPreviewError(null);
      })
      .catch((caught: unknown) => {
        setPreview(null);
        setPreviewError(caught instanceof Error ? caught.message : "预览失败");
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

  // Cmd/Ctrl+S: refresh the dry-run preview and switch the inspector
  // to the Diff tab. This is explicitly a no-write shortcut. We
  // listen on `window` so the shortcut works regardless of where
  // focus currently lives inside the editor.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "s") {
        return;
      }
      // Don't hijack the browser's save-page shortcut when the user
      // is editing inside a regular text input other than our own
      // (e.g. the page path field). The wiki editor owns the shortcut
      // and we always want a dry-run refresh.
      event.preventDefault();
      runPreviewNow();
      setActiveTab("diff");
      toast.success("已更新 Dry-run 预览");
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [runPreviewNow]);

  const filteredPages = useMemo(() => {
    const needle = searchFilter.trim().toLowerCase();
    if (!needle) {
      return pages;
    }
    return pages.filter((page) =>
      `${page.key} ${page.summary ?? ""} ${page.tags.join(" ")} ${page.slRefs.join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  }, [pages, searchFilter]);

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={`业务文档：${key}`}
        breadcrumbs={["业务文档", "Wiki 文档", key]}
        description={
          <>
            Wiki 用于维护人可阅读的业务口径、使用场景和注意事项，不替代表字段描述。
            {mode === "draft" ? " 当前为未保存草稿，点保存才会落盘。" : ""}
          </>
        }
        badges={
          mode === "draft" ? <span>未保存草稿</span> : null
        }
        actions={
          <button
            className="pl-btn pl-btn--primary"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            type="button"
          >
            {saveMutation.isPending ? "保存中..." : "保存"}
          </button>
        }
      />

      <section
        className="pl-editor-layout pl-wiki-layout"
      >
        <aside className="grid content-start gap-3 pl-wiki-sidebar">
        <Link className="pl-btn pl-btn--ghost justify-start" to="/">
          表目录
        </Link>
        <div className="pl-wiki-sidebar-header">
          <h2 className="pl-wiki-sidebar-title">业务 Wiki</h2>
          <button
            className="pl-btn pl-btn--primary pl-wiki-new-button"
            onClick={startNewWiki}
            type="button"
          >
            + 新建 Wiki
          </button>
        </div>
        <label className="pl-field-label">
          <span>页面路径</span>
          <input
            className="pl-input"
            onBlur={commitPathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPathDraft();
              }
            }}
            value={pathDraft}
          />
        </label>
        <input
          aria-label="按路径或标签筛选 Wiki"
          className="pl-input pl-wiki-filter"
          onChange={(event) => setSearchFilter(event.target.value)}
          placeholder="筛选路径 / 标签 / sl_ref…"
          value={searchFilter}
        />
        {slRef ? (
          <p className="pl-notice pl-wiki-context-hint" title={slRef}>
            当前上下文：<code>{slRef}</code>
            {mode === "loaded" ? "（已匹配）" : "（新草稿）"}
          </p>
        ) : null}
        <nav aria-label="Wiki 页面列表" className="grid gap-1">
          {filteredPages.map((page: WikiSummary) => {
            const active = page.key === key && mode === "loaded";
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={clsx("pl-file-button", active && "pl-file-button--active")}
                key={page.key}
                onClick={() => navigateTo(page.key)}
                type="button"
              >
                <span>md</span>
                <span className="truncate">{page.key}</span>
              </button>
            );
          })}
          {filteredPages.length === 0 ? (
            <p className="pl-notice">没有匹配的 Wiki 页面。</p>
          ) : null}
        </nav>
        </aside>

        <div className="grid gap-4 pl-wiki-main">
          <div className="pl-wiki-body">
          <div className="grid gap-4 pl-wiki-left">
            <FrontmatterForm onChange={updateFrontmatter} value={frontmatter} />
            <section className="pl-panel pl-wiki-editor-panel">
              <header className="pl-wiki-editor-header">
                <p className="pl-panel-title mb-0">正文 Markdown</p>
                <span aria-hidden className="pl-wiki-shortcut-hint">
                  ⌘/Ctrl + S 刷新 Dry-run
                </span>
              </header>
              <textarea
                className="pl-textarea pl-wiki-markdown-input"
                onChange={(event) => updateContent(event.target.value)}
                rows={18}
                value={content}
              />
            </section>
          </div>
          <WikiInspector
            activeTab={activeTab}
            content={content}
            onTabChange={setActiveTab}
            preview={preview}
            previewError={previewError}
          />
          </div>
        </div>
      </section>
    </div>
  );
}
