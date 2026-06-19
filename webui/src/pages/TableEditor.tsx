import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DiffViewer } from "../components/DiffViewer";
import { MeasureForm } from "../components/MeasureForm";
import { SegmentForm } from "../components/SegmentForm";
import { StatusBadge } from "../components/StatusBadge";
import { YamlPreview } from "../components/YamlPreview";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type { SourceDetail, SourcePreview, SourceSaveResponse, SourcesResponse, TablePatch } from "../lib/types";

function authoredText(text: { human?: string; ai?: string }) {
  return text.human || text.ai || "";
}

const editorSchema = z.object({
  tableDescription: z.string(),
  grain: z.string(),
  measures: z.array(
    z.object({
      name: z.string(),
      expr: z.string(),
      filter: z.string().optional(),
      description: z.string().optional()
    })
  ),
  segments: z.array(
    z.object({
      name: z.string(),
      expr: z.string(),
      description: z.string().optional()
    })
  ),
  columns: z.array(
    z.object({
      name: z.string(),
      description: z.string()
    })
  )
});

type EditorForm = z.infer<typeof editorSchema>;

function formFromSource(source: SourceDetail): EditorForm {
  return {
    tableDescription: authoredText(source.model.descriptions),
    grain: source.model.grain?.join(", ") ?? "",
    measures: source.model.measures ?? [],
    segments: source.model.segments ?? [],
    columns: source.model.columns.map((column) => ({
      name: column.name,
      description: authoredText(column.descriptions)
    }))
  };
}

function patchFromForm(form: EditorForm): TablePatch {
  return {
    tableDescription: form.tableDescription,
    grain: form.grain
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    measures: form.measures
      .filter((measure) => measure.name.trim() && measure.expr.trim())
      .map((measure) => ({
        name: measure.name.trim(),
        expr: measure.expr.trim(),
        filter: measure.filter?.trim() || undefined,
        description: measure.description?.trim() || undefined
      })),
    segments: form.segments
      .filter((segment) => segment.name.trim() && segment.expr.trim())
      .map((segment) => ({
        name: segment.name.trim(),
        expr: segment.expr.trim(),
        description: segment.description?.trim() || undefined
      })),
    columns: form.columns.map((column) => ({
      name: column.name,
      description: column.description
    }))
  };
}

const EMPTY_FORM: EditorForm = {
  tableDescription: "",
  grain: "",
  measures: [],
  segments: [],
  columns: []
};

export function TableEditor() {
  const navigate = useNavigate();
  const params = useParams();
  const conn = params.conn ?? "";
  const schema = params.schema ?? "";
  const table = params.table ?? "";
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const sourceQuery = useQuery({
    queryKey: queryKeys.source(conn, schema, table),
    queryFn: () => apiGet<SourceDetail>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`),
    enabled: Boolean(conn && schema && table)
  });

  const source = sourceQuery.data;
  const siblingTables = sourcesQuery.data?.tables.filter((item) => item.conn === conn && item.schema === schema) ?? [];
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (patch: TablePatch) =>
      apiPut<SourceSaveResponse>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: false,
        patch
      }),
    onSuccess: () => {
      toast.success("已保存到语义层");
      navigate("/review");
    },
    onError: (error) => {
      toast.error(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const parsedValues = useMemo(() => editorSchema.safeParse(form), [form]);

  useEffect(() => {
    if (source) {
      setForm(formFromSource(source));
      setPreview(null);
      setPreviewError(null);
    }
  }, [source]);

  useEffect(() => {
    if (!source || !parsedValues.success) {
      return;
    }

    const timeout = window.setTimeout(() => {
      apiPut<SourcePreview>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: true,
        patch: patchFromForm(parsedValues.data)
      })
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
  }, [conn, parsedValues, schema, source, table]);

  return (
    <section className="pl-editor-layout">
      <aside className="grid gap-2 content-start">
        <Link className="pl-btn pl-btn--ghost justify-start" to="/">表目录</Link>
        <h2 className="text-base font-semibold mt-2">{schema}</h2>
        <nav className="grid gap-1">
          {siblingTables.map((item) => (
            <Link
              key={item.table}
              className={`pl-nav-link ${item.table === table ? "pl-nav-link--active" : ""}`}
              to={`/sources/${encodeURIComponent(item.conn)}/${encodeURIComponent(item.schema)}/${encodeURIComponent(item.table)}`}
            >
              {item.table}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="grid gap-4">
        {sourceQuery.isLoading ? <p className="pl-notice">正在加载表信息...</p> : null}
        {sourceQuery.error ? (
          <p className="pl-error">表信息加载失败：{sourceQuery.error instanceof Error ? sourceQuery.error.message : "未知错误"}</p>
        ) : null}
        {source ? (
          <>
            <div className="pl-section-heading">
              <div>
                <p className="pl-eyebrow">语义层维护 / {source.model.conn} / {source.model.schema}</p>
                <h1 className="text-xl font-semibold">维护表语义：{source.model.table}</h1>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  className="pl-btn pl-btn--ghost"
                  to={`/wiki?sl_ref=${encodeURIComponent(`${source.model.conn}/${source.model.schema}/${source.model.table}`)}`}
                >
                  创建 Wiki
                </Link>
                <Link
                  className="pl-btn pl-btn--ghost"
                  to={`/joins/${encodeURIComponent(source.model.conn)}/${encodeURIComponent(source.model.schema)}/${encodeURIComponent(source.model.table)}`}
                >
                  关联关系
                </Link>
                <Link className="pl-btn pl-btn--ghost" to="/review">审阅</Link>
                <StatusBadge status={source.completion} />
              </div>
            </div>
            <p className="pl-page-intro">这里维护会写入 semantic-layer 的结构化语义，包括表描述、字段描述、行粒度、指标、分群和正式关联关系。</p>

            <div className="pl-metadata-grid">
              <div>
                <span>完整表名</span>
                <strong>{source.model.qualifiedName ?? "无"}</strong>
              </div>
              <div>
                <span>字段数</span>
                <strong>{source.model.columns.length}</strong>
              </div>
              <div>
                <span>关联数</span>
                <strong>{source.model.joins?.length ?? 0}</strong>
              </div>
              <div>
                <span>行粒度</span>
                <strong>{source.model.grain?.join(", ") || "无"}</strong>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMutation.mutate(patchFromForm(form));
                }}
              >
                <section className="pl-panel">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="pl-panel-title">基础语义</h2>
                    <button type="submit" className="pl-btn pl-btn--primary" disabled={saveMutation.isPending}>
                      保存
                    </button>
                  </div>
                  <label className="pl-field-label">
                    <span>表描述</span>
                    <textarea rows={4} className="pl-textarea" value={form.tableDescription} onChange={(event) => setForm({ ...form, tableDescription: event.target.value })} />
                  </label>
                  <label className="pl-field-label">
                    <span>行粒度</span>
                    <input className="pl-input" placeholder="customer_id, signup_date" value={form.grain} onChange={(event) => setForm({ ...form, grain: event.target.value })} />
                  </label>
                </section>

                <MeasureForm
                  measures={form.measures}
                  onChange={(measures) => setForm({ ...form, measures })}
                />

                <SegmentForm
                  segments={form.segments}
                  onChange={(segments) => setForm({ ...form, segments })}
                />

                <section className="pl-panel">
                  <h2 className="pl-panel-title">字段语义</h2>
                  <div className="pl-field-editor-list">
                    {form.columns.map((column, index) => (
                      <label className="pl-field-label" key={`${column.name}-${index}`}>
                        <span>{column.name}</span>
                        <textarea
                          rows={3}
                          className="pl-textarea"
                          value={column.description}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              columns: form.columns.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, description: event.target.value } : item
                              )
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
              </form>

              <div className="grid gap-4">
                {previewError ? <p className="pl-error">{previewError}</p> : null}
                <section className="pl-panel">
                  <h2 className="pl-panel-title">变更预览</h2>
                  <DiffViewer diff={preview?.diff ?? ""} />
                </section>
                <section className="pl-panel">
                  <h2 className="pl-panel-title">拟写入 YAML</h2>
                  <YamlPreview yaml={preview?.proposedYaml ?? source.rawYaml} />
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}