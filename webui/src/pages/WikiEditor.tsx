import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiffViewer } from "../components/DiffViewer";
import { FrontmatterForm } from "../components/FrontmatterForm";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
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
      toast.success("Wiki 已保存");
    },
    onError: (error) => {
      toast.error(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
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
    <section className="pl-editor-layout">
      <aside className="grid gap-3 content-start">
        <Link className="pl-btn pl-btn--ghost justify-start" to="/">表目录</Link>
        <h2 className="text-base font-semibold">业务 Wiki</h2>
        <label className="pl-field-label">
          <span>页面路径</span>
          <input
            className="pl-input"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setSearchParams({ key: event.target.value });
            }}
          />
        </label>
        <nav className="grid gap-1">
          {pages.map((page) => (
            <button
              className={clsx("pl-file-button", page.key === key && "pl-file-button--active")}
              key={page.key}
              type="button"
              onClick={() => {
                setKey(page.key);
                setSearchParams({ key: page.key });
              }}
            >
              <span>md</span>
              <span className="truncate">{page.key}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="grid gap-4">
        <div className="pl-section-heading">
          <div>
            <p className="pl-eyebrow">业务文档</p>
            <h1 className="text-xl font-semibold">业务文档：{key}</h1>
          </div>
          <button type="button" className="pl-btn pl-btn--primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            保存
          </button>
        </div>
        <p className="pl-page-intro">Wiki 用于维护人可阅读的业务口径、使用场景和注意事项，不替代表字段描述。</p>
        {previewError ? <p className="pl-error">{previewError}</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-4">
            <FrontmatterForm value={frontmatter} onChange={setFrontmatter} />
            <section className="pl-panel">
              <h2 className="pl-panel-title">正文 Markdown</h2>
              <textarea className="pl-textarea" rows={18} value={content} onChange={(event) => setContent(event.target.value)} />
            </section>
          </div>
          <div className="grid gap-4">
            <section className="pl-panel">
              <h2 className="pl-panel-title">变更预览</h2>
              <DiffViewer diff={preview?.diff ?? ""} />
            </section>
            <section className="pl-panel">
              <h2 className="pl-panel-title">拟写入 Markdown</h2>
              <pre className="pl-yaml-preview">{preview?.proposedMarkdown ?? ""}</pre>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}