import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { DiffViewer } from "../components/DiffViewer";
import { MeasureForm } from "../components/MeasureForm";
import { SegmentForm } from "../components/SegmentForm";
import { StatusBadge } from "../components/StatusBadge";
import { YamlPreview } from "../components/YamlPreview";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
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
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (patch: TablePatch) =>
      apiPut<SourceSaveResponse>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: false,
        patch
      }),
    onSuccess: () => {
      navigate("/review");
    }
  });
  const form = useForm<EditorForm>({
    defaultValues: {
      tableDescription: "",
      grain: "",
      measures: [],
      segments: [],
      columns: []
    }
  });
  const values = useWatch({ control: form.control });
  const parsedValues = useMemo(() => editorSchema.safeParse(values), [values]);

  useEffect(() => {
    if (source) {
      form.reset(formFromSource(source));
      setPreview(null);
      setPreviewError(null);
    }
  }, [form, source]);

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
    <section className="editor-layout">
      <aside className="left-nav">
        <Link className="back-link" to="/">表目录</Link>
        <h2>{schema}</h2>
        <nav>
          {siblingTables.map((item) => (
            <Link
              key={item.table}
              className={item.table === table ? "nav-item active" : "nav-item"}
              to={`/sources/${encodeURIComponent(item.conn)}/${encodeURIComponent(item.schema)}/${encodeURIComponent(item.table)}`}
            >
              {item.table}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="detail-panel editor-three-panel">
        {sourceQuery.isLoading ? <p className="notice">正在加载表信息...</p> : null}
        {sourceQuery.error ? (
          <p className="error">表信息加载失败：{sourceQuery.error instanceof Error ? sourceQuery.error.message : "未知错误"}</p>
        ) : null}
        {source ? (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">语义层维护 / {source.model.conn} / {source.model.schema}</p>
                <h1>维护表语义：{source.model.table}</h1>
              </div>
              <div className="heading-actions">
                <Link
                  className="back-link"
                  to={`/wiki?sl_ref=${encodeURIComponent(`${source.model.conn}/${source.model.schema}/${source.model.table}`)}`}
                >
                  创建 Wiki
                </Link>
                <Link
                  className="back-link"
                  to={`/joins/${encodeURIComponent(source.model.conn)}/${encodeURIComponent(source.model.schema)}/${encodeURIComponent(source.model.table)}`}
                >
                  关联关系
                </Link>
                <Link className="back-link" to="/review">审阅</Link>
                <StatusBadge status={source.completion} />
              </div>
            </div>
            <p className="page-intro">这里维护会写入 semantic-layer 的结构化语义，包括表描述、字段描述、行粒度、指标、分群和正式关联关系。</p>

            <div className="metadata-grid">
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

            <div className="editor-columns">
              <form
                className="edit-form"
                onSubmit={form.handleSubmit((data) => {
                  saveMutation.mutate(patchFromForm(data));
                })}
              >
                <section className="read-panel">
                  <div className="review-actions">
                    <h2>基础语义</h2>
                    <button type="submit" disabled={saveMutation.isPending}>
                      保存
                    </button>
                  </div>
                  {saveMutation.error ? (
                    <p className="error">{saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}</p>
                  ) : null}
                  <label>
                    表描述
                    <textarea rows={4} {...form.register("tableDescription")} />
                  </label>
                  <label>
                    行粒度
                    <input placeholder="customer_id, signup_date" {...form.register("grain")} />
                  </label>
                </section>

                <MeasureForm
                  measures={form.watch("measures")}
                  onChange={(measures) => form.setValue("measures", measures, { shouldDirty: true })}
                />

                <SegmentForm
                  segments={form.watch("segments")}
                  onChange={(segments) => form.setValue("segments", segments, { shouldDirty: true })}
                />

                <section className="read-panel">
                  <h2>字段语义</h2>
                  <div className="field-editor-list">
                    {form.getValues("columns").map((column, index) => (
                      <label key={`${column.name}-${index}`}>
                        <span>{column.name}</span>
                        <textarea rows={3} {...form.register(`columns.${index}.description`)} />
                      </label>
                    ))}
                  </div>
                </section>
              </form>

              <aside className="preview-panel">
                {previewError ? <p className="error">{previewError}</p> : null}
                <section className="read-panel">
                  <h2>变更预览</h2>
                  <DiffViewer diff={preview?.diff ?? ""} />
                </section>
                <section className="read-panel">
                  <h2>拟写入 YAML</h2>
                  <YamlPreview yaml={preview?.proposedYaml ?? source.rawYaml} />
                </section>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
