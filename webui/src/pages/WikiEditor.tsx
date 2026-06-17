import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiffViewer } from "../components/DiffViewer";
import { FrontmatterForm } from "../components/FrontmatterForm";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { WikiFrontmatter, WikiListResponse, WikiPage, WikiPreview } from "../lib/types";

function defaultKey(ref: string | null) {
  if (!ref) {
    return "global/new-note.md";
  }
  const parts = ref.split("/").filter(Boolean);
  return `global/${parts[parts.length - 1] ?? "new-note"}.md`;
}

export function WikiEditor() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const slRef = searchParams.get("sl_ref");
  const [key, setKey] = useState(searchParams.get("key") ?? defaultKey(slRef));
  const [frontmatter, setFrontmatter] = useState<WikiFrontmatter>({ sl_refs: slRef ? [slRef] : [] });
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<WikiPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.wiki,
    queryFn: () => apiGet<WikiListResponse>("/api/wiki")
  });
  const pageQuery = useQuery({
    queryKey: queryKeys.wikiPage(key),
    queryFn: () => apiGet<WikiPage>(`/api/wiki/${encodeURIComponent(key)}`),
    enabled: Boolean(key)
  });
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
    }
  });

  const pages = listQuery.data?.pages ?? [];
  const previewBody = useMemo(() => ({ dryRun: true, frontmatter, content }), [content, frontmatter]);

  useEffect(() => {
    if (pageQuery.data?.rawMarkdown) {
      setFrontmatter(pageQuery.data.frontmatter);
      setContent(pageQuery.data.content);
      setPreview(null);
    } else if (slRef) {
      setFrontmatter((current) => ({ ...current, sl_refs: current.sl_refs?.length ? current.sl_refs : [slRef] }));
    }
  }, [pageQuery.data, slRef]);

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

  return (
    <section className="editor-layout">
      <aside className="left-nav">
        <Link className="back-link" to="/">表目录</Link>
        <h2>业务 Wiki</h2>
        <label>
          页面路径
          <input
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setSearchParams({ key: event.target.value });
            }}
          />
        </label>
        <nav>
          {pages.map((page) => (
            <button
              className={page.key === key ? "file-button active" : "file-button"}
              key={page.key}
              type="button"
              onClick={() => {
                setKey(page.key);
                setSearchParams({ key: page.key });
              }}
            >
              <span>md</span>
              {page.key}
            </button>
          ))}
        </nav>
      </aside>

      <div className="detail-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">业务文档</p>
            <h1>业务文档：{key}</h1>
          </div>
          <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            保存
          </button>
        </div>
        <p className="page-intro">Wiki 用于维护人可阅读的业务口径、使用场景和注意事项，不替代表字段描述。</p>
        {previewError ? <p className="error">{previewError}</p> : null}
        {saveMutation.error ? <p className="error">{saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}</p> : null}

        <div className="editor-columns">
          <div>
            <FrontmatterForm value={frontmatter} onChange={setFrontmatter} />
            <section className="read-panel">
              <h2>正文 Markdown</h2>
              <textarea rows={18} value={content} onChange={(event) => setContent(event.target.value)} />
            </section>
          </div>
          <aside className="preview-panel">
            <section className="read-panel">
              <h2>变更预览</h2>
              <DiffViewer diff={preview?.diff ?? ""} />
            </section>
            <section className="read-panel">
              <h2>拟写入 Markdown</h2>
              <pre className="yaml-preview">{preview?.proposedMarkdown ?? ""}</pre>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
