import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import clsx from "clsx";
import { DiffViewer } from "../components/DiffViewer";
import { MeasureForm } from "../components/MeasureForm";
import { SegmentForm } from "../components/SegmentForm";
import { StatusBadge } from "../components/StatusBadge";
import { YamlPreview } from "../components/YamlPreview";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type {
  Join,
  JoinCandidate,
  JoinCandidatesResponse,
  SourceDetail,
  SourcePreview,
  SourceSaveResponse,
  SourceSummary,
  SourcesResponse,
  TablePatch
} from "../lib/types";
import {
  RELATIONSHIP_LABELS,
  tableJoinCandidates
} from "./semantic/join-utils";

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

/**
 * Initialise the editable form from the source detail.
 *
 * Important: the column human description is loaded from
 * `column.descriptions.human` only. AI suggestions are surfaced read-only in
 * the field card and explicitly copied to Human only when the user clicks
 * the "采纳 AI 描述" button. M9 must not prefill Human from AI.
 */
function formFromSource(source: SourceDetail): EditorForm {
  return {
    tableDescription: source.model.descriptions.human ?? "",
    grain: source.model.grain?.join(", ") ?? "",
    measures: source.model.measures ?? [],
    segments: source.model.segments ?? [],
    columns: source.model.columns.map((column) => ({
      name: column.name,
      description: column.descriptions.human ?? ""
    }))
  };
}

function patchFromForm(form: EditorForm, source?: SourceDetail): TablePatch {
  const patch: TablePatch = {
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
      }))
  };

  if (!source || form.tableDescription !== (source.model.descriptions.human ?? "")) {
    patch.tableDescription = form.tableDescription;
  }

  const sourceColumns = new Map(source?.model.columns.map((column) => [column.name, column]));
  const changedColumns = form.columns
    .filter((column) => column.description !== (sourceColumns.get(column.name)?.descriptions.human ?? ""))
    .map((column) => ({
      name: column.name,
      description: column.description
    }));
  if (changedColumns.length > 0) {
    patch.columns = changedColumns;
  }

  return patch;
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

function overlayPathFor(source: SourceDetail): string {
  return `semantic-layer/${source.model.conn}/${source.model.table}.yaml`;
}

function OverlayBadge({ source }: { source: SourceDetail }) {
  const path = overlayPathFor(source);
  return (
    <span
      className="pl-overlay-badge"
      title={`修改将写入独立 overlay 文件：${path}`}
    >
      Overlay
    </span>
  );
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // Fallback for older browsers / non-secure contexts: synthesise a textarea
  // and select+copy through the deprecated execCommand path.
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function FieldMetaBadge({
  tone = "muted",
  children
}: {
  tone?: "muted" | "pk" | "success" | "warning";
  children: React.ReactNode;
}) {
  return <span className={clsx("pl-meta-badge", `pl-meta-badge--${tone}`)}>{children}</span>;
}

function FieldCard({
  sourceColumn,
  description,
  onDescriptionChange,
  onAdoptAi
}: {
  sourceColumn: SourceDetail["model"]["columns"][number];
  description: string;
  onDescriptionChange: (next: string) => void;
  onAdoptAi: () => void;
}) {
  const ai = sourceColumn.descriptions.ai ?? "";
  const human = description;
  const hasHuman = human.trim().length > 0;
  const hasAi = ai.length > 0;

  return (
    <article className="pl-field-card" data-column={sourceColumn.name}>
      <div className="pl-field-card-header">
        <div className="pl-field-card-name">
          <strong>{sourceColumn.name}</strong>
        </div>
        <div className="pl-field-badges">
          {sourceColumn.pk ? <FieldMetaBadge tone="pk">PK</FieldMetaBadge> : null}
          <FieldMetaBadge tone="muted">{sourceColumn.type}</FieldMetaBadge>
          {sourceColumn.nullable === false ? (
            <FieldMetaBadge tone="success">Not Null</FieldMetaBadge>
          ) : null}
          {sourceColumn.nullable === true ? (
            <FieldMetaBadge tone="warning">nullable</FieldMetaBadge>
          ) : null}
        </div>
      </div>

      <div className="pl-description-buckets">
        <div className="pl-description-bucket">
          <span className="pl-description-label">物理注释 (DB)</span>
          <p className="pl-description-muted">暂无物理注释</p>
        </div>

        <div className="pl-description-bucket">
          <div className="pl-description-bucket-header">
            <span className="pl-description-label">AI 建议描述</span>
            {hasAi ? (
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={onAdoptAi}
              >
                {hasHuman ? "覆盖为 AI 描述" : "采纳 AI 描述"}
              </button>
            ) : (
              <FieldMetaBadge tone="muted">无 AI 建议</FieldMetaBadge>
            )}
          </div>
          {hasAi ? (
            <p className="pl-description-text" title={ai}>
              {ai}
            </p>
          ) : null}
        </div>

        <div className="pl-description-bucket">
          <span className="pl-description-label">人工描述 (Human)</span>
          <textarea
            rows={3}
            className="pl-textarea"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="人工编辑的描述，仅在用户主动保存后写入 descriptions.human"
          />
        </div>
      </div>
    </article>
  );
}

function CandidateJoinBanner({
  candidates,
  onKeep,
  onReject,
  onConfirm
}: {
  candidates: JoinCandidate[];
  onKeep: (candidate: JoinCandidate) => void;
  onReject: (candidate: JoinCandidate) => void;
  onConfirm: (candidate: JoinCandidate) => void;
}) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <section className="pl-candidate-joins-banner" aria-label="候选关联关系">
      <header className="pl-candidate-joins-banner-header">
        <strong>发现 {candidates.length} 个智能推断的候选关联关系</strong>
        <span className="pl-notice">这些关系来自 *_id 启发式推断。确认后写入正式 YAML；保留/拒绝仅修改 .ktx-ui sidecar。</span>
      </header>
      <div className="pl-candidate-joins-list">
        {candidates.map((candidate) => (
          <div
            className="pl-candidate-join-row"
            key={`${candidate.join.to}-${candidate.join.on}-${candidate.confidence}`}
          >
            <div className="pl-candidate-join-body">
              <div className="pl-candidate-join-line">
                <strong>{candidate.join.to}</strong>
                <span className="pl-candidate-join-rel">
                  [{RELATIONSHIP_LABELS[candidate.join.relationship]}]
                </span>
              </div>
              <code className="pl-candidate-join-on">{candidate.join.on}</code>
              <div className="pl-candidate-join-note">{`推断依据: ${candidate.note ?? "字段名匹配"}`}</div>
            </div>
            <div className="pl-candidate-join-actions">
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => onConfirm(candidate)}
              >
                确认写入语义层
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={() => onKeep(candidate)}
              >
                保留为候选
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => onReject(candidate)}
              >
                标记不采用
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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

type InspectorBadges = {
  completion: SourceDetail["completion"];
  preview: SourcePreview | null;
  unknownKeys: number;
  previewError: string | null;
  saveError: string | null;
};

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
  const unknownKeys = source.model.unknownKeys?.length ?? 0;
  const fileCount = preview?.files.length ?? 0;

  return (
    <aside className="pl-inspector" aria-label="变更检查器">
      <div className="pl-inspector-header">
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
        <InspectorBadges
          completion={source.completion}
          preview={preview}
          previewError={previewError}
          saveError={saveError}
          unknownKeys={unknownKeys}
        />
      </div>

      {previewError ? <p className="pl-error">{previewError}</p> : null}
      {saveError ? <p className="pl-error">{saveError}</p> : null}

      {activeTab === "diff" ? (
        <section className="pl-inspector-section">
          <p className="pl-panel-title">变更预览</p>
          <DiffViewer diff={preview?.diff ?? ""} />
        </section>
      ) : null}
      {activeTab === "yaml" ? (
        <section className="pl-inspector-section">
          <p className="pl-panel-title">拟写入 YAML</p>
          <YamlPreview yaml={preview?.proposedYaml ?? source.rawYaml} />
        </section>
      ) : null}
      {activeTab === "validate" ? (
        <section className="pl-inspector-section">
          <p className="pl-panel-title">保存与校验</p>
          <p className="pl-notice">
            保存会调用现有语义层写入接口（dryRun:false）；成功后进入审阅页查看 changed files 与 validate 结果。
            Cmd+S / Ctrl+S 不会落盘，只会刷新 DryRun 预览并切到 Diff 面板。
          </p>
          {previewError ? null : (
            <p className="pl-notice">
              Dry-run 包含 {fileCount} 个文件，未知 YAML Key {unknownKeys} 个。
            </p>
          )}
        </section>
      ) : null}
    </aside>
  );
}

function InspectorBadges({
  completion,
  preview,
  unknownKeys,
  previewError,
  saveError
}: InspectorBadges) {
  return (
    <div className="pl-inspector-badges" aria-label="检查器状态">
      <StatusBadge status={completion} />
      <span className="pl-inspector-badge pl-inspector-badge--muted">
        Dry-run {preview?.files.length ?? 0}
      </span>
      <span
        className={clsx(
          "pl-inspector-badge",
          unknownKeys > 0 ? "pl-inspector-badge--warning" : "pl-inspector-badge--muted"
        )}
      >
        Unknown {unknownKeys}
      </span>
      {previewError ? (
        <span className="pl-inspector-badge pl-inspector-badge--danger">Preview error</span>
      ) : null}
      {saveError ? (
        <span className="pl-inspector-badge pl-inspector-badge--danger">Save error</span>
      ) : null}
    </div>
  );
}

export function TableEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const candidatesQuery = useQuery({
    queryKey: queryKeys.joinCandidates,
    queryFn: () => apiGet<JoinCandidatesResponse>("/api/joins/candidates")
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

  const sidecarCandidates = candidatesQuery.data?.candidates ?? [];
  const visibleCandidates = useMemo(
    () =>
      tableJoinCandidates({
        source,
        sidecarCandidates
      }),
    [source, sidecarCandidates]
  );

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

  const writeCandidatesMutation = useMutation({
    mutationFn: (next: JoinCandidate[]) =>
      apiPut<JoinCandidatesResponse>("/api/joins/candidates", { candidates: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.joinCandidates });
      toast.success("候选已保存");
    },
    onError: (error) => {
      toast.error(`保存候选失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const confirmJoinMutation = useMutation({
    mutationFn: (candidate: JoinCandidate) =>
      apiPut(
        `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        {
          dryRun: false,
          patch: {
            joins: [
              ...(source?.model.joins ?? []),
              { ...candidate.join, source: "formal" as const }
            ]
          }
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.source(conn, schema, table) });
      queryClient.invalidateQueries({ queryKey: queryKeys.joinCandidates });
      toast.success("已写入语义层");
      navigate("/review");
    },
    onError: (error) => {
      toast.error(`确认失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const runPreview = useCallback(
    async (nextForm: EditorForm): Promise<boolean> => {
      const parsed = editorSchema.safeParse(nextForm);
      if (!source || !parsed.success) {
        return false;
      }
      try {
        const data = await apiPut<SourcePreview>(
          `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
          {
            dryRun: true,
            patch: patchFromForm(parsed.data, source)
          }
        );
        setPreview(data);
        setPreviewError(null);
        return true;
      } catch (caught: unknown) {
        setPreview(null);
        setPreviewError(caught instanceof Error ? caught.message : "预览失败");
        return false;
      }
    },
    [conn, schema, source, table]
  );

  const parsedValues = useMemo(() => editorSchema.safeParse(form), [form]);

  const columnsByName = useMemo(() => {
    const map = new Map<string, SourceDetail["model"]["columns"][number]>();
    if (source) {
      for (const column of source.model.columns) {
        map.set(column.name, column);
      }
    }
    return map;
  }, [source]);

  const filteredColumns = useMemo(() => {
    const keyword = fieldSearch.trim().toLowerCase();
    if (!keyword) {
      return form.columns;
    }
    return form.columns.filter((column) => {
      const sourceColumn = columnsByName.get(column.name);
      const haystack = [
        column.name,
        sourceColumn?.type ?? "",
        sourceColumn?.descriptions.ai ?? "",
        column.description
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [columnsByName, fieldSearch, form.columns]);

  // Track which source we have already initialised the form from. We use the
  // SourceDetail reference (not just the route key) because the same route
  // can be re-mounted with a fresh data identity after the first query
  // resolves — and we only want to wipe the user's edits once, on that
  // first resolution. Using the route key alone would race with a click
  // that happened before the query resolved and clobber the user's choice.
  const lastInitialisedSource = useRef<SourceDetail | null>(null);
  const isFirstInit = useRef(true);

  useEffect(() => {
    if (!source) {
      return;
    }
    if (lastInitialisedSource.current === source) {
      return;
    }
    lastInitialisedSource.current = source;
    setForm(formFromSource(source));
    if (isFirstInit.current) {
      // First source for this mount — keep the user's current active
      // section (which may already reflect a click that happened before
      // the source resolved). Only reset the form-derived state.
      isFirstInit.current = false;
    } else {
      // A different source identity appeared (route change). Reset
      // everything so the user starts on the overview tab.
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
      void runPreview(form);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [form, parsedValues.success, runPreview, source]);

  function adoptAiDescription(columnName: string) {
    const sourceColumn = source?.model.columns.find((column) => column.name === columnName);
    const ai = sourceColumn?.descriptions.ai;
    if (!ai) {
      return;
    }
    setForm((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.name === columnName ? { ...column, description: ai } : column
      )
    }));
  }

  function updateColumnDescription(columnName: string, next: string) {
    setForm((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.name === columnName ? { ...column, description: next } : column
      )
    }));
  }

  async function handleCopyQualifiedName() {
    if (!source) {
      return;
    }
    const value = source.model.qualifiedName ?? `${source.model.schema}.${source.model.table}`;
    try {
      await copyTextToClipboard(value);
      toast.success("已复制完整表名");
    } catch (caught: unknown) {
      const message = `复制失败：${caught instanceof Error ? caught.message : "未知错误"}`;
      toast.error(message);
    }
  }

  function handleSaveShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    if (event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    void runPreview(form).then((ok) => {
      setInspectorTab("diff");
      if (ok) {
        toast.success("已更新 Dry-run 预览");
      } else {
        toast.error("Dry-run 预览失败");
      }
    });
  }

  function upsertCandidateInSidecar(candidate: JoinCandidate) {
    const remaining = sidecarCandidates.filter(
      (item) =>
        !(
          item.conn === candidate.conn &&
          item.schema === candidate.schema &&
          item.fromTable === candidate.fromTable &&
          item.join.to === candidate.join.to &&
          item.join.on === candidate.join.on
        )
    );
    writeCandidatesMutation.mutate([...remaining, candidate]);
  }

  function handleKeepCandidate(candidate: JoinCandidate) {
    upsertCandidateInSidecar({
      ...candidate,
      confidence: "candidate",
      join: { ...candidate.join, source: "candidate" }
    });
  }

  function handleRejectCandidate(candidate: JoinCandidate) {
    upsertCandidateInSidecar({
      ...candidate,
      confidence: "rejected",
      join: { ...candidate.join, source: "candidate" }
    });
  }

  function handleConfirmCandidate(candidate: JoinCandidate) {
    confirmJoinMutation.mutate(candidate);
  }

  const qualifiedName = source?.model.qualifiedName ?? (source ? `${source.model.schema}.${source.model.table}` : "");
  const grainLabel = source?.model.grain?.join(", ") || "无";

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={source ? `维护表语义：${source.model.table}` : "维护表语义"}
        breadcrumbs={[
          "语义层维护",
          source?.model.conn ?? conn,
          source?.model.schema ?? schema,
          source?.model.table ?? table
        ]}
        description="维护 semantic-layer 的结构化语义，包括表描述、行粒度、字段描述、指标和分群。"
        badges={
          source ? (
            <>
              <span data-testid="table-editor-conn">{source.model.conn}</span>
              <span>{source.model.schema}</span>
              <span>完成度 {source.completion}</span>
            </>
          ) : null
        }
        actions={
          source ? (
            <>
              <Link
                aria-label={`打开或创建 ${source.model.table} 的业务 Wiki`}
                className="pl-btn pl-btn--ghost"
                title={`打开或创建 ${source.model.conn}/${source.model.schema}/${source.model.table} 的业务 Wiki`}
                to={`/wiki?sl_ref=${encodeURIComponent(`${source.model.conn}/${source.model.schema}/${source.model.table}`)}`}
              >
                业务 Wiki
              </Link>
              <Link
                className="pl-btn pl-btn--ghost"
                to={`/joins/${encodeURIComponent(source.model.conn)}/${encodeURIComponent(source.model.schema)}/${encodeURIComponent(source.model.table)}`}
              >
                关联关系
              </Link>
              <Link className="pl-btn pl-btn--ghost" to="/review">审阅</Link>
              <button className="pl-btn pl-btn--primary" disabled={saveMutation.isPending} form="table-editor-form" type="submit">
                {saveMutation.isPending ? "保存中..." : "保存"}
              </button>
            </>
          ) : null
        }
      />

      <section
        className="pl-table-workbench"
        onKeyDown={source ? handleSaveShortcut : undefined}
      >
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

            <form
              className="pl-table-editor-form"
              id="table-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate(patchFromForm(form, source));
              }}
            >
              <CandidateJoinBanner
                candidates={visibleCandidates}
                onConfirm={handleConfirmCandidate}
                onKeep={handleKeepCandidate}
                onReject={handleRejectCandidate}
              />

              {activeSection === "overview" ? (
                <section className="pl-panel">
                  <div className="pl-source-metadata-grid">
                    <div className="pl-source-metadata-cell pl-source-metadata-cell--wide">
                      <span className="pl-source-metadata-label">完整表名</span>
                      <div className="pl-copy-line">
                        <strong className="truncate" title={qualifiedName}>{qualifiedName || "无"}</strong>
                        <button
                          type="button"
                          aria-label="复制完整表名"
                          className="pl-btn pl-btn--ghost"
                          onClick={handleCopyQualifiedName}
                        >
                          复制
                        </button>
                      </div>
                    </div>
                    <div className="pl-source-metadata-cell">
                      <span className="pl-source-metadata-label">字段数</span>
                      <strong>{source.model.columns.length}</strong>
                    </div>
                    <div className="pl-source-metadata-cell">
                      <span className="pl-source-metadata-label">关联数</span>
                      <strong>{source.model.joins?.length ?? 0}</strong>
                    </div>
                    <div className="pl-source-metadata-cell">
                      <span className="pl-source-metadata-label">
                        行粒度
                        <OverlayBadge source={source} />
                      </span>
                      <strong className="truncate" title={grainLabel}>{grainLabel}</strong>
                    </div>
                  </div>
                  <label className="pl-field-label">
                    <span>表描述</span>
                    <textarea rows={4} className="pl-textarea" value={form.tableDescription} onChange={(event) => setForm({ ...form, tableDescription: event.target.value })} />
                  </label>
                  <label className="pl-field-label">
                    <span className="pl-field-label-with-overlay">
                      行粒度
                      <OverlayBadge source={source} />
                    </span>
                    <input className="pl-input" placeholder="customer_id, signup_date" value={form.grain} onChange={(event) => setForm({ ...form, grain: event.target.value })} />
                  </label>
                </section>
              ) : null}

              {activeSection === "measures" ? (
                <section className="pl-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="pl-panel-title mb-0">Measures</p>
                    <OverlayBadge source={source} />
                  </div>
                  <p className="pl-notice mb-3">修改将写入 semantic-layer/&lt;conn&gt;/&lt;table&gt;.yaml 的指标段，与基础表定义分离。</p>
                  <MeasureForm
                    measures={form.measures}
                    onChange={(measures) => setForm({ ...form, measures })}
                  />
                </section>
              ) : null}

              {activeSection === "segments" ? (
                <section className="pl-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="pl-panel-title mb-0">Segments</p>
                    <OverlayBadge source={source} />
                  </div>
                  <p className="pl-notice mb-3">修改将写入 semantic-layer/&lt;conn&gt;/&lt;table&gt;.yaml 的分群段，与基础表定义分离。</p>
                  <SegmentForm
                    segments={form.segments}
                    onChange={(segments) => setForm({ ...form, segments })}
                  />
                </section>
              ) : null}

              {activeSection === "columns" ? (
                <section className="pl-panel">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="pl-notice mb-0">每张卡片展示 PK/类型/可空性与 AI 建议。Human 文本框初始仅载入 descriptions.human，点击「采纳 AI 描述」才会把 AI 文本写进 Human。</p>
                    <label className="pl-field-search shrink-0">
                      <span className="sr-only">搜索字段</span>
                      <input className="pl-input" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="搜索字段" />
                    </label>
                  </div>
                  <div className="pl-field-editor-list">
                    {filteredColumns.map((column) => {
                      const sourceColumn = columnsByName.get(column.name);
                      if (!sourceColumn) {
                        return null;
                      }
                      return (
                        <FieldCard
                          key={column.name}
                          sourceColumn={sourceColumn}
                          description={column.description}
                          onDescriptionChange={(next) => updateColumnDescription(column.name, next)}
                          onAdoptAi={() => adoptAiDescription(column.name)}
                        />
                      );
                    })}
                    {filteredColumns.length === 0 ? <p className="pl-notice">没有匹配字段。</p> : null}
                  </div>
                </section>
              ) : null}

              {activeSection === "joins" ? (
                <section className="pl-panel">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="pl-notice mb-0">正式关联关系仍在关联关系页面维护，这里只展示当前表上下文。</p>
                    <Link
                      className="pl-btn pl-btn--secondary shrink-0"
                      to={`/joins/${encodeURIComponent(source.model.conn)}/${encodeURIComponent(source.model.schema)}/${encodeURIComponent(source.model.table)}`}
                    >
                      打开关联关系
                    </Link>
                  </div>
                  <div className="pl-relation-list">
                    {(source.model.joins ?? []).map((join) => (
                      <div className="pl-relation-row" key={`${join.to}-${join.on}`}>
                        <strong>{join.to}</strong>
                        <span>{RELATIONSHIP_LABELS[join.relationship]}</span>
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
    </div>
  );
}

// Re-export the Join type for callers that need to type candidate join
// objects (kept here so the types stay close to the table editor that
// composes them).
export type { Join };
