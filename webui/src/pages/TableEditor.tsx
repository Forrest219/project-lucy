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
import type { SourceDetail, SourcePreview, SourceSaveResponse, SourceSummary, SourcesResponse, TablePatch } from "../lib/types";

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
type EditorSection = "overview" | "columns" | "measures" | "segments" | "joins";
type InspectorTab = "diff" | "yaml" | "validate";

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

const SECTION_LABELS: Record<EditorSection, string> = {
  overview: "基础语义",
  columns: "字段",
  measures: "Measures",
  segments: "Segments",
  joins: "Joins"
};

function countLabel(count: number, unit: string) {
  return `${count} ${unit}`;
}

function SourceObjectTree({
  activeSection,
  currentTable,
  onSectionChange,
  schema,
  siblingTables,
  source
}: {
  activeSection: EditorSection;
  currentTable: string;
  onSectionChange: (section: EditorSection) => void;
  schema: string;
  siblingTables: SourceSummary[];
  source: SourceDetail | undefined;
}) {
  const sectionCounts: Array<{ section: EditorSection; count?: number; unit?: string }> = [
    { section: "overview" },
    { section: "columns", count: source?.model.columns.length ?? 0, unit: "字段" },
    { section: "measures", count: source?.model.measures?.length ?? 0, unit: "指标" },
    { section: "segments", count: source?.model.segments?.length ?? 0, unit: "分群" },
    { section: "joins", count: source?.model.joins?.length ?? 0, unit: "关联" }
  ];

  return (
    <aside className="pl-object-tree">
      <Link className="pl-btn pl-btn--ghost justify-start" to="/">表目录</Link>
      <div className="pl-object-tree-group">
        <h2 className="pl-object-tree-title">{schema || "schema"}</h2>
        <nav className="grid gap-1" aria-label="同 schema 表">
          {siblingTables.map((item) => (
            <Link
              aria-current={item.table === currentTable ? "page" : undefined}
              className={`pl-nav-link ${item.table === currentTable ? "pl-nav-link--active" : ""}`}
              key={item.table}
              to={`/sources/${encodeURIComponent(item.conn)}/${encodeURIComponent(item.schema)}/${encodeURIComponent(item.table)}`}
            >
              <span className="truncate">{item.table}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="pl-object-tree-group">
        <h2 className="pl-object-tree-title">当前表</h2>
        <div className="grid gap-1" role="list" aria-label="表编辑区域">
          {sectionCounts.map((item) => (
            <button
              aria-current={item.section === activeSection ? "true" : undefined}
              className={`pl-object-tree-item ${item.section === activeSection ? "pl-object-tree-item--active" : ""}`}
              key={item.section}
              onClick={() => onSectionChange(item.section)}
              type="button"
            >
              <span>{SECTION_LABELS[item.section]}</span>
              {typeof item.count === "number" && item.unit ? <small>{countLabel(item.count, item.unit)}</small> : null}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Inspector({
  activeTab,
  preview,
  previewError,
  saveError,
  source,
  onTabChange
}: {
  activeTab: InspectorTab;
  preview: SourcePreview | null;
  previewError: string | null;
  saveError: string | null;
  source: SourceDetail;
  onTabChange: (tab: InspectorTab) => void;
}) {
  return (
    <aside className="pl-inspector" aria-label="变更检查器">
      <div className="pl-segmented-control" role="tablist" aria-label="检查器视图">
        {(["diff", "yaml", "validate"] as InspectorTab[]).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
            key={tab}
            onClick={() => onTabChange(tab)}
            role="tab"
            type="button"
          >
            {tab === "diff" ? "Diff" : tab === "yaml" ? "YAML" : "Validate"}
          </button>
        ))}
      </div>

      {previewError ? <p className="pl-error">{previewError}</p> : null}
      {saveError ? <p className="pl-error">{saveError}</p> : null}

      {activeTab === "diff" ? (
        <section className="pl-inspector-section">
          <h2 className="pl-panel-title">变更预览</h2>
          <DiffViewer diff={preview?.diff ?? ""} />
        </section>
      ) : null}
      {activeTab === "yaml" ? (
        <section className="pl-inspector-section">
          <h2 className="pl-panel-title">拟写入 YAML</h2>
          <YamlPreview yaml={preview?.proposedYaml ?? source.rawYaml} />
        </section>
      ) : null}
      {activeTab === "validate" ? (
        <section className="pl-inspector-section">
          <h2 className="pl-panel-title">保存与校验</h2>
          <div className="pl-validation-summary">
            <div>
              <span>当前完成度</span>
              <StatusBadge status={source.completion} />
            </div>
            <div>
              <span>Dry-run 文件</span>
              <strong>{preview?.files.length ?? 0}</strong>
            </div>
            <div>
              <span>未知 YAML Key</span>
              <strong>{source.model.unknownKeys?.length ?? 0}</strong>
            </div>
          </div>
          <p className="pl-notice">保存会调用现有语义层写入接口；成功后进入审阅页查看 changed files 与 validate 结果。</p>
        </section>
      ) : null}
    </aside>
  );
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
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [activeSection, setActiveSection] = useState<EditorSection>("overview");
  const [fieldSearch, setFieldSearch] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("diff");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (patch: TablePatch) =>
      apiPut<SourceSaveResponse>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: false,
        patch
      }),
    onMutate: () => {
      setSaveError(null);
    },
    onSuccess: () => {
      toast.success("已保存到语义层");
      navigate("/review");
    },
    onError: (error) => {
      const message = `保存失败：${error instanceof Error ? error.message : "未知错误"}`;
      setSaveError(message);
      setInspectorTab("validate");
      toast.error(message);
    }
  });

  const parsedValues = useMemo(() => editorSchema.safeParse(form), [form]);
  const filteredColumns = useMemo(() => {
    const keyword = fieldSearch.trim().toLowerCase();
    if (!keyword) {
      return form.columns;
    }
    return form.columns.filter((column) => `${column.name} ${column.description}`.toLowerCase().includes(keyword));
  }, [fieldSearch, form.columns]);

  useEffect(() => {
    if (source) {
      setForm(formFromSource(source));
      setActiveSection("overview");
      setFieldSearch("");
      setInspectorTab("diff");
      setPreview(null);
      setPreviewError(null);
      setSaveError(null);
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
    <section className="pl-table-workbench">
      <SourceObjectTree
        activeSection={activeSection}
        currentTable={table}
        onSectionChange={setActiveSection}
        schema={schema}
        siblingTables={siblingTables}
        source={source}
      />

      <div className="pl-table-editor-main">
        {sourceQuery.isLoading ? <p className="pl-notice">正在加载表信息...</p> : null}
        {sourceQuery.error ? (
          <p className="pl-error">表信息加载失败：{sourceQuery.error instanceof Error ? sourceQuery.error.message : "未知错误"}</p>
        ) : null}
        {source ? (
          <>
            <div className="pl-table-editor-header">
              <div>
                <p className="pl-eyebrow">语义层维护 / {source.model.conn} / {source.model.schema}</p>
                <h1 className="text-xl font-semibold">维护表语义：{source.model.table}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                <button className="pl-btn pl-btn--primary" disabled={saveMutation.isPending} form="table-editor-form" type="submit">
                  {saveMutation.isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </div>

            <form
              className="pl-table-editor-form"
              id="table-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate(patchFromForm(form));
              }}
            >
              {activeSection === "overview" ? (
                <section className="pl-panel">
                  <h2 className="pl-panel-title">基础语义</h2>
                  <p className="pl-page-intro">维护会写入 semantic-layer 的结构化语义，包括表描述、行粒度、字段描述、指标和分群。</p>
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
                  <label className="pl-field-label">
                    <span>表描述</span>
                    <textarea rows={4} className="pl-textarea" value={form.tableDescription} onChange={(event) => setForm({ ...form, tableDescription: event.target.value })} />
                  </label>
                  <label className="pl-field-label">
                    <span>行粒度</span>
                    <input className="pl-input" placeholder="customer_id, signup_date" value={form.grain} onChange={(event) => setForm({ ...form, grain: event.target.value })} />
                  </label>
                </section>
              ) : null}

              {activeSection === "measures" ? (
                <MeasureForm
                  measures={form.measures}
                  onChange={(measures) => setForm({ ...form, measures })}
                />
              ) : null}

              {activeSection === "segments" ? (
                <SegmentForm
                  segments={form.segments}
                  onChange={(segments) => setForm({ ...form, segments })}
                />
              ) : null}

              {activeSection === "columns" ? (
                <section className="pl-panel">
                  <div className="pl-section-heading">
                    <div>
                      <h2 className="pl-panel-title">字段语义</h2>
                      <p className="pl-notice">字段描述仍由页面级保存按钮统一提交。</p>
                    </div>
                    <label className="pl-field-search">
                      <span>搜索字段</span>
                      <input className="pl-input" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="字段名或描述" />
                    </label>
                  </div>
                  <div className="pl-field-editor-list">
                    {filteredColumns.map((column) => {
                      const index = form.columns.findIndex((item) => item.name === column.name);
                      return (
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
                      );
                    })}
                    {filteredColumns.length === 0 ? <p className="pl-notice">没有匹配字段。</p> : null}
                  </div>
                </section>
              ) : null}

              {activeSection === "joins" ? (
                <section className="pl-panel">
                  <div className="pl-section-heading">
                    <div>
                      <h2 className="pl-panel-title">Joins</h2>
                      <p className="pl-notice">正式关联关系仍在关联关系页面维护，这里只展示当前表上下文。</p>
                    </div>
                    <Link
                      className="pl-btn pl-btn--secondary"
                      to={`/joins/${encodeURIComponent(source.model.conn)}/${encodeURIComponent(source.model.schema)}/${encodeURIComponent(source.model.table)}`}
                    >
                      打开关联关系
                    </Link>
                  </div>
                  <div className="pl-relation-list">
                    {(source.model.joins ?? []).map((join) => (
                      <div className="pl-relation-row" key={`${join.to}-${join.on}`}>
                        <strong>{join.to}</strong>
                        <span>{join.relationship}</span>
                        <code>{join.on}</code>
                      </div>
                    ))}
                    {(source.model.joins ?? []).length === 0 ? <p className="pl-notice">当前表还没有正式关联关系。</p> : null}
                  </div>
                </section>
              ) : null}
            </form>
          </>
        ) : null}
      </div>

      {source ? (
        <Inspector
          activeTab={inspectorTab}
          onTabChange={setInspectorTab}
          preview={preview}
          previewError={previewError}
          saveError={saveError}
          source={source}
        />
      ) : null}
    </section>
  );
}
