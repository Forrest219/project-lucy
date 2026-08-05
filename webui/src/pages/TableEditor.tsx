import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import clsx from "clsx";
import { DiffViewer } from "../components/DiffViewer";
import { MeasureForm } from "../components/MeasureForm";
import { SegmentForm } from "../components/SegmentForm";
import { YamlPreview } from "../components/YamlPreview";
import { PageHeader } from "../components/PageHeader";
import { RowMoreMenu } from "../components/RowMoreMenu";
import { apiGet, apiPost, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type {
  Join,
  JoinCandidate,
  JoinCandidatesResponse,
  SourceDetail,
  SourcePreview,
  SourceSaveResponse,
  TablePatch,
  TableYamlVersionDetail,
  TableYamlVersionListResponse,
  TableYamlVersionRestoreResult,
  TableYamlVersionSummary,
  ValidationResult
} from "../lib/types";
import { RELATIONSHIP_LABELS, tableJoinCandidates } from "./semantic/join-utils";
import {
  formatValidationFailureToast,
  isNoiseValidationLine,
  listValidationIssueMessages
} from "./semantic/validation-utils";

const VALIDATE_BUTTON_TITLE =
  "校验已保存到磁盘的语义层文件结构与规则，不写入；未保存草稿不纳入本次校验。保存前可先发现问题。";

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
type FieldFilterMode = "all" | "missingHuman" | "hasAi" | "pkOrRequired";
type InspectorTab = "diff" | "yaml" | "validate";

const SECTION_FROM_TAB: Record<string, EditorSection> = {
  overview: "overview",
  columns: "columns",
  measures: "measures",
  segments: "segments",
  joins: "joins"
};
type ChangeSummaryRow = {
  section: string;
  added: number;
  modified: number;
  removed: number;
  details?: string[];
};
type SaveInput =
  | { kind: "patch"; patch: TablePatch }
  | { kind: "import"; yaml: string; sourceFileName?: string; restoredFromVersionId?: string };

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
  const knownColumns = new Set(source?.model.columns.map((column) => column.name) ?? []);
  const grainValues = form.grain
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((name) => knownColumns.size === 0 || knownColumns.has(name));
  const patch: TablePatch = {
    grain: grainValues,
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
  measures: "指标",
  segments: "分群",
  joins: "关联"
};

const FIELD_FILTER_LABELS: Record<FieldFilterMode, string> = {
  all: "全部字段",
  missingHuman: "缺少人工描述",
  hasAi: "有 AI 建议",
  pkOrRequired: "PK / Not Null"
};

function countLabel(count: number, unit: string) {
  return `${count} ${unit}`;
}

const VERSION_OPERATION_LABELS: Record<TableYamlVersionSummary["operation"], string> = {
  save: "保存",
  import: "导入",
  restore: "恢复"
};

function shortHash(contentHash: string) {
  return contentHash.replace(/^sha256:/, "").slice(0, 8);
}

function formatVersionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function compareNamedItems(
  current: Array<{ name: string }> | undefined,
  next: Array<{ name: string }> | undefined
): Pick<ChangeSummaryRow, "added" | "modified" | "removed"> {
  const currentByName = new Map((current ?? []).map((item) => [item.name, stableJson(item)]));
  const nextByName = new Map((next ?? []).map((item) => [item.name, stableJson(item)]));
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const [name, value] of nextByName) {
    if (!currentByName.has(name)) added += 1;
    else if (currentByName.get(name) !== value) modified += 1;
  }
  for (const name of currentByName.keys()) {
    if (!nextByName.has(name)) removed += 1;
  }
  return { added, modified, removed };
}

function namedItemChangeDetails(
  label: string,
  current: Array<{ name: string }> | undefined,
  next: Array<{ name: string }> | undefined
): string[] {
  const currentByName = new Map((current ?? []).map((item) => [item.name, stableJson(item)]));
  const nextByName = new Map((next ?? []).map((item) => [item.name, stableJson(item)]));
  const details: string[] = [];

  for (const [name, value] of nextByName) {
    if (!currentByName.has(name)) {
      details.push(`新增${label} ${name}`);
    } else if (currentByName.get(name) !== value) {
      details.push(`修改${label} ${name}`);
    }
  }
  for (const name of currentByName.keys()) {
    if (!nextByName.has(name)) {
      details.push(`删除${label} ${name}`);
    }
  }

  return details;
}

function displaySemanticValue(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || "空";
}

function buildChangeSummary({
  form,
  importedYamlName,
  source
}: {
  form: EditorForm;
  importedYamlName: string | null;
  source: SourceDetail;
}): ChangeSummaryRow[] {
  if (importedYamlName) {
    return [
      {
        section: "导入 YAML",
        added: 0,
        modified: 1,
        removed: 0,
        details: [`导入来源：${importedYamlName}`]
      }
    ];
  }

  const rows: ChangeSummaryRow[] = [];
  if (form.tableDescription !== (source.model.descriptions.human ?? "")) {
    rows.push({
      section: "表描述",
      added: source.model.descriptions.human ? 0 : 1,
      modified: source.model.descriptions.human ? 1 : 0,
      removed: 0,
      details: [
        `表描述：${displaySemanticValue(source.model.descriptions.human)} -> ${displaySemanticValue(form.tableDescription)}`
      ]
    });
  }
  const knownColumns = new Set(source.model.columns.map((column) => column.name));
  const nextGrain = form.grain
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((name) => knownColumns.has(name));
  const currentGrain = (source.model.grain ?? []).filter((name) => knownColumns.has(name));
  const nextGrainLabel = nextGrain.join(", ");
  const currentGrainLabel = currentGrain.join(", ");
  if (nextGrainLabel !== currentGrainLabel) {
    rows.push({
      section: "行粒度",
      added: currentGrain.length ? 0 : 1,
      modified: currentGrain.length ? 1 : 0,
      removed: nextGrain.length ? 0 : 1,
      details: [
        `行粒度：${displaySemanticValue(currentGrainLabel)} -> ${displaySemanticValue(nextGrainLabel)}`
      ]
    });
  }
  const sourceColumns = new Map(source.model.columns.map((column) => [column.name, column.descriptions.human ?? ""]));
  const modifiedColumnDetails = form.columns
    .filter((column) => column.description !== (sourceColumns.get(column.name) ?? ""))
    .map((column) => (
      `字段 ${column.name} · 人工描述：${displaySemanticValue(sourceColumns.get(column.name))} -> ${displaySemanticValue(column.description)}`
    ));
  const modifiedColumns = modifiedColumnDetails.length;
  if (modifiedColumns > 0) {
    rows.push({ section: "字段描述", added: 0, modified: modifiedColumns, removed: 0, details: modifiedColumnDetails });
  }
  const measures = compareNamedItems(source.model.measures, form.measures);
  if (measures.added || measures.modified || measures.removed) {
    rows.push({
      section: "指标",
      ...measures,
      details: namedItemChangeDetails("指标", source.model.measures, form.measures)
    });
  }
  const segments = compareNamedItems(source.model.segments, form.segments);
  if (segments.added || segments.modified || segments.removed) {
    rows.push({
      section: "分群",
      ...segments,
      details: namedItemChangeDetails("分群", source.model.segments, form.segments)
    });
  }
  return rows;
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

function FieldMetaBadge({
  tone = "muted",
  children
}: {
  tone?: "muted" | "pk" | "success" | "warning";
  children: React.ReactNode;
}) {
  return <span className={clsx("pl-meta-badge", `pl-meta-badge--${tone}`)}>{children}</span>;
}

function WorkbenchDisclosure({
  id,
  title,
  summary,
  children,
  className = "pl-workbench-disclosure",
  buttonClassName = "pl-workbench-disclosure-summary",
  panelClassName,
  defaultOpen = false,
  testId
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${id}-panel`;

  return (
    <div
      className={clsx(className, open && `${className}--open`)}
      data-open={open ? "true" : "false"}
      data-testid={testId}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={buttonClassName}
        id={id}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="pl-disclosure-title">
          <span aria-hidden="true" className="pl-disclosure-chevron">
            {open ? "▾" : "▸"}
          </span>
          <span>{title}</span>
        </span>
        {summary ? <small>{summary}</small> : null}
      </button>
      <div
        className={panelClassName}
        hidden={!open}
        id={panelId}
        role="region"
        aria-labelledby={id}
      >
        {children}
      </div>
    </div>
  );
}

function parseGrainValues(grain: string): string[] {
  return grain
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function GrainPicker({
  columns,
  value,
  onChange
}: {
  columns: SourceDetail["model"]["columns"];
  value: string;
  onChange: (next: string) => void;
}) {
  const selected = parseGrainValues(value);
  const columnNames = useMemo(() => {
    const sorted = [...columns].sort((left, right) => {
      if (Boolean(left.pk) !== Boolean(right.pk)) {
        return left.pk ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return sorted.map((column) => column.name);
  }, [columns]);
  const known = new Set(columnNames);
  const missing = selected.filter((name) => !known.has(name));

  function toggle(name: string) {
    const next = selected.includes(name)
      ? selected.filter((item) => item !== name)
      : [...selected, name];
    onChange(next.join(", "));
  }

  function remove(name: string) {
    onChange(selected.filter((item) => item !== name).join(", "));
  }

  return (
    <div className="pl-grain-picker" data-testid="grain-picker">
      <div className="pl-grain-chips" aria-label="已选行粒度字段">
        {selected.length === 0 ? (
          <span className="pl-description-muted">尚未选择字段</span>
        ) : (
          selected.map((name) => {
            const orphan = !known.has(name);
            return (
              <button
                className={clsx("pl-grain-chip", orphan && "pl-grain-chip--missing")}
                key={name}
                onClick={() => remove(name)}
                title={orphan ? "字段已不存在，点击移除" : `移除 ${name}`}
                type="button"
              >
                <span className="notranslate" translate="no">
                  {name}
                </span>
                {orphan ? <small>字段已不存在</small> : null}
                <span aria-hidden="true">×</span>
              </button>
            );
          })
        )}
      </div>
      <div className="pl-grain-options" role="group" aria-label="从当前表字段选择行粒度">
        {columnNames.map((name) => (
          <label className="pl-grain-option" key={name}>
            <input
              checked={selected.includes(name)}
              onChange={() => toggle(name)}
              type="checkbox"
            />
            <span className="notranslate" translate="no">
              {name}
            </span>
            {columns.find((column) => column.name === name)?.pk ? (
              <FieldMetaBadge tone="pk">PK</FieldMetaBadge>
            ) : null}
          </label>
        ))}
      </div>
      {missing.length > 0 ? (
        <p className="pl-notice mb-0">有 {missing.length} 个历史行粒度字段已不在当前表中，保存前请移除。</p>
      ) : null}
    </div>
  );
}

function TableDescriptionEditor({
  source,
  description,
  onDescriptionChange,
  onAdoptAi
}: {
  source: SourceDetail;
  description: string;
  onDescriptionChange: (next: string) => void;
  onAdoptAi: () => void;
}) {
  const ai = source.model.descriptions.ai ?? "";
  const db = source.model.descriptions.db ?? "";
  const hasHuman = description.trim().length > 0;
  const hasAi = ai.length > 0;
  const hasDb = db.trim().length > 0;

  return (
    <div className="pl-description-buckets" data-testid="table-description-buckets">
      <div className="pl-description-bucket">
        <span className="pl-description-label">物理注释 (DB)</span>
        {hasDb ? (
          <p className="pl-description-text" title={db}>
            {db}
          </p>
        ) : (
          <p className="pl-description-muted">暂无物理注释</p>
        )}
      </div>
      <div className="pl-description-bucket">
        <div className="pl-description-bucket-header">
          <span className="pl-description-label">AI 建议描述</span>
          {hasAi ? (
            <button
              type="button"
              className="pl-btn pl-btn--ghost pl-btn--sm"
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
          aria-label="表人工描述"
          rows={4}
          className="pl-textarea"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="人工编辑的表描述，仅在用户主动保存后写入 descriptions.human"
        />
      </div>
    </div>
  );
}

function FieldRow({
  sourceColumn,
  description,
  selected,
  onDescriptionChange,
  onAdoptAi,
  onSelectedChange
}: {
  sourceColumn: SourceDetail["model"]["columns"][number];
  description: string;
  selected: boolean;
  onDescriptionChange: (next: string) => void;
  onAdoptAi: () => void;
  onSelectedChange: (checked: boolean) => void;
}) {
  const ai = sourceColumn.descriptions.ai ?? "";
  const db = sourceColumn.descriptions.db ?? "";
  const human = description;
  const hasHuman = human.trim().length > 0;
  const hasAi = ai.length > 0;
  const hasDb = db.trim().length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <tr className="pl-field-row" data-column={sourceColumn.name}>
      <td className="pl-field-col-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          aria-label={`选择字段 ${sourceColumn.name}（用于批量采纳 AI 描述）`}
          title="勾选后可批量采纳 AI 描述"
        />
      </td>
      <td className="pl-field-col-name">
        <div className="pl-field-name-cell">
          <strong className="notranslate" translate="no">
            {sourceColumn.name}
          </strong>
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
      </td>
      <td className="pl-field-col-db">
        {hasDb ? (
          <p className="pl-description-text" title={db}>
            {db}
          </p>
        ) : (
          <span className="pl-description-muted">—</span>
        )}
      </td>
      <td className="pl-field-col-ai">
        {hasAi ? (
          <div className="pl-field-ai-cell">
            <p className="pl-description-text" title={ai}>
              {ai}
            </p>
            <button
              type="button"
              className="pl-btn pl-btn--ghost pl-btn--sm"
              aria-label={`${hasHuman ? "覆盖为 AI 描述" : "采纳 AI 描述"}：${sourceColumn.name}`}
              onClick={onAdoptAi}
            >
              {hasHuman ? "覆盖为 AI 描述" : "采纳 AI 描述"}
            </button>
          </div>
        ) : (
          <span className="pl-description-muted">无 AI 建议</span>
        )}
      </td>
      <td className="pl-field-col-human">
        {expanded ? (
          <textarea
            aria-label={`${sourceColumn.name} 人工描述`}
            rows={3}
            className="pl-textarea"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="人工编辑的描述，仅在用户主动保存后写入 descriptions.human"
          />
        ) : (
          <div className="pl-field-human-compact">
            <input
              aria-label={`${sourceColumn.name} 人工描述`}
              className="pl-input"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="人工描述"
            />
            <button
              className="pl-btn pl-btn--ghost pl-btn--sm"
              onClick={() => setExpanded(true)}
              type="button"
            >
              展开
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

type SaveStatusBadges = {
  hasDraftChanges: boolean;
  preview: SourcePreview | null;
  unknownKeys: number;
  previewError: string | null;
  saveError: string | null;
  isSaving: boolean;
  validation: ValidationResult | null;
  validationError: string | null;
};

function ValidationResultPanel({ validation }: { validation: ValidationResult }) {
  const issueMessages = listValidationIssueMessages(validation);
  const visibleIssues = issueMessages.filter((message) => !isNoiseValidationLine(message));
  const issuesToShow = visibleIssues.length > 0 ? visibleIssues : issueMessages;
  const hasTechnicalOutput = Boolean(validation.stderr.trim() || validation.stdout.trim());

  return (
    <div className="grid gap-2" data-testid="table-editor-validation-result">
      <div className="pl-validation-summary">
        <div>
          <span>校验状态</span>
          <strong>{validation.ok ? "通过" : "未通过"}</strong>
        </div>
      </div>
      {!validation.ok && issuesToShow.length > 0 ? (
        <div className="pl-validation-issues" data-testid="table-editor-validation-issues">
          <p className="pl-panel-title mb-2">校验问题</p>
          <ul>
            {issuesToShow.map((message) => (
              <li key={message} className="notranslate" translate="no">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!validation.ok ? (
        <details className="pl-validation-tech-details">
          <summary>技术详情</summary>
          <div className="pl-validation-summary mt-2">
            <div>
              <span>退出码</span>
              <strong>{validation.exitCode}</strong>
            </div>
          </div>
          {hasTechnicalOutput ? (
            <pre className="pl-yaml-preview mt-2 notranslate" translate="no">
              {[validation.stderr.trim(), validation.stdout.trim()].filter(Boolean).join("\n")}
            </pre>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function ChangeReview({
  activeTab,
  changeSummary,
  hasDraftChanges,
  importedYamlName,
  isSaving,
  preview,
  previewError,
  saveError,
  source,
  unknownKeys,
  validation,
  validationError,
  onTabChange
}: {
  activeTab: InspectorTab;
  changeSummary: ChangeSummaryRow[];
  hasDraftChanges: boolean;
  importedYamlName: string | null;
  isSaving: boolean;
  preview: SourcePreview | null;
  previewError: string | null;
  saveError: string | null;
  source: SourceDetail;
  unknownKeys: number;
  validation: ValidationResult | null;
  validationError: string | null;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const fileCount = preview?.files.length ?? 0;

  return (
    <aside className="pl-inspector pl-change-review" aria-label="变更审阅" data-testid="table-editor-change-review">
      <div className="pl-inspector-header">
        <div className="pl-inspector-title-row">
          <div>
            <p className="pl-panel-title mb-0">变更审阅</p>
          </div>
        </div>
        <SaveStatusBadges
          hasDraftChanges={hasDraftChanges}
          preview={preview}
          previewError={previewError}
          saveError={saveError}
          isSaving={isSaving}
          validation={validation}
          validationError={validationError}
          unknownKeys={unknownKeys}
        />
        <dl className="pl-review-facts">
          <div>
            <dt>导入来源</dt>
            <dd
              className="notranslate"
              data-testid="table-editor-imported-yaml-name"
              translate="no"
            >
              {importedYamlName ?? "未导入"}
            </dd>
          </div>
          <div>
            <dt>影响文件</dt>
            <dd>{fileCount}</dd>
          </div>
        </dl>
      </div>

      {previewError ? <p className="pl-error">{previewError}</p> : null}
      {saveError ? <p className="pl-error">{saveError}</p> : null}
      {validationError ? <p className="pl-error">{validationError}</p> : null}

      <section className="pl-inspector-section">
        <ChangeSummary rows={changeSummary} files={preview?.files ?? []} />
      </section>

      <div className="pl-change-review-tabs">
        <div className="pl-segmented-control" role="tablist" aria-label="变更详情视图">
          {(["diff", "yaml", "validate"] as InspectorTab[]).map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
              key={tab}
              onClick={() => onTabChange(tab)}
              role="tab"
              type="button"
            >
              {tab === "diff" ? "YAML Diff" : tab === "yaml" ? "YAML" : "校验"}
            </button>
          ))}
        </div>
      </div>
      {activeTab === "diff" ? (
        <section className="pl-inspector-section" role="tabpanel">
          <p className="pl-panel-title">YAML Diff</p>
          {preview?.diff ? (
            <DiffViewer diff={preview.diff} />
          ) : (
            <p className="pl-notice">暂无 Diff。</p>
          )}
        </section>
      ) : null}
      {activeTab === "yaml" ? (
        <section className="pl-inspector-section" role="tabpanel">
          <p className="pl-panel-title">拟写入 YAML</p>
          <YamlPreview yaml={preview?.proposedYaml ?? source.rawYaml} />
        </section>
      ) : null}
      {activeTab === "validate" ? (
        <section className="pl-inspector-section" role="tabpanel">
          <p className="pl-panel-title">保存与校验</p>
          <p className="pl-notice">
            校验针对已保存到磁盘的语义层文件，不写入；未保存草稿不纳入本次校验。
          </p>
          {previewError ? null : (
            <p className="pl-notice">
              预览包含 {fileCount} 个文件，未知 YAML Key {unknownKeys} 个。
            </p>
          )}
          {validation ? (
            <ValidationResultPanel validation={validation} />
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

function ImportYamlDrawer({
  onClose,
  onOpenFile,
  onPastePreview,
  onPastedYamlChange,
  pastedYaml
}: {
  onClose: () => void;
  onOpenFile: () => void;
  onPastePreview: () => void;
  onPastedYamlChange: (value: string) => void;
  pastedYaml: string;
}) {
  return (
    <div className="pl-drawer-backdrop" role="presentation" data-testid="table-editor-import-drawer-backdrop">
      <aside
        aria-label="导入 YAML"
        aria-modal="true"
        className="pl-drawer-panel"
        data-testid="table-editor-import-drawer"
        role="dialog"
      >
        <header className="pl-drawer-header">
          <div>
            <p className="pl-panel-title mb-0">导入 YAML</p>
          </div>
          <button className="pl-drawer-close pl-drawer-close--prominent" onClick={onClose} type="button">
            关闭
          </button>
        </header>
        <section className="pl-drawer-body" aria-label="导入 YAML 内容">
          <button className="pl-btn pl-btn--secondary" onClick={onOpenFile} type="button">
            选择 YAML 文件
          </button>
          <label className="pl-field-label">
            <span>粘贴 YAML</span>
            <textarea
              className="pl-textarea notranslate"
              data-testid="paste-yaml-textarea"
              onChange={(event) => onPastedYamlChange(event.target.value)}
              placeholder="粘贴完善后的当前表 YAML"
              rows={12}
              translate="no"
              value={pastedYaml}
            />
          </label>
        </section>
        <footer className="pl-drawer-footer pl-drawer-footer-border-t">
          <button className="pl-btn pl-btn--secondary" onClick={onPastePreview} type="button">
            生成导入预览
          </button>
        </footer>
      </aside>
    </div>
  );
}

function SemanticTabs({
  activeSection,
  onSectionChange,
  source
}: {
  activeSection: EditorSection;
  onSectionChange: (section: EditorSection) => void;
  source: SourceDetail;
}) {
  const sectionCounts: Array<{ section: EditorSection; count?: number; unit?: string }> = [
    { section: "overview" },
    { section: "columns", count: source.model.columns.length, unit: "字段" },
    { section: "measures", count: source.model.measures?.length ?? 0, unit: "指标" },
    { section: "segments", count: source.model.segments?.length ?? 0, unit: "分群" },
    { section: "joins", count: source.model.joins?.length ?? 0, unit: "关联" }
  ];

  return (
    <div className="pl-semantic-tabs" role="tablist" aria-label="在线编辑">
      {sectionCounts.map((item) => (
        <button
          aria-selected={item.section === activeSection}
          className={clsx(
            "pl-semantic-tab",
            item.section === activeSection && "pl-semantic-tab--active"
          )}
          key={item.section}
          onClick={() => onSectionChange(item.section)}
          role="tab"
          type="button"
        >
          <span>{SECTION_LABELS[item.section]}</span>
          {typeof item.count === "number" && item.unit ? <small>{countLabel(item.count, item.unit)}</small> : null}
        </button>
      ))}
    </div>
  );
}

function ChangeSummary({
  rows,
  files
}: {
  rows: ChangeSummaryRow[];
  files: SourcePreview["files"];
}) {
  return (
    <section className="pl-change-summary" data-testid="change-summary">
      <div className="pl-change-summary-header">
        <strong>本次变更</strong>
        <span>{files.length} 个影响文件</span>
      </div>
      {rows.length > 0 ? (
        <ul className="pl-change-summary-list">
          {rows.map((row) => (
            <li key={row.section}>
              <div className="pl-change-summary-row-head">
                <span>{row.section}</span>
                <strong>{`新增 ${row.added} / 修改 ${row.modified} / 删除 ${row.removed}`}</strong>
              </div>
              {row.details?.length ? (
                <ul className="pl-change-summary-detail-list">
                  {row.details.map((detail) => (
                    <li className="notranslate" key={detail} translate="no">
                      {detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pl-notice">暂无业务语义变更。</p>
      )}
      {files.length > 0 ? (
        <div className="pl-change-summary-files">
          <span>影响文件</span>
          <ul>
            {files.map((file) => (
              <li key={file.filePath} className="notranslate" translate="no">{file.filePath}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SaveStatusBadges({
  hasDraftChanges,
  preview,
  unknownKeys,
  previewError,
  saveError,
  isSaving,
  validation,
  validationError
}: SaveStatusBadges) {
  const primaryStatus = saveError
    ? "保存失败"
    : validationError
      ? "校验失败"
      : isSaving
        ? "保存中"
        : validation
          ? validation.ok ? "校验通过" : "校验未通过"
          : hasDraftChanges
            ? "有未保存修改"
            : "已保存";

  return (
    <div className="pl-inspector-badges" aria-label="保存状态摘要">
      <span
        className={clsx(
          "pl-inspector-badge",
          saveError || validationError || (validation && !validation.ok)
            ? "pl-inspector-badge--danger"
            : validation?.ok
              ? "pl-inspector-badge--success"
              : hasDraftChanges
                ? "pl-inspector-badge--warning"
                : "pl-inspector-badge--muted"
        )}
      >
        {primaryStatus}
      </span>
      <span className="pl-inspector-badge pl-inspector-badge--muted">
        影响文件 {preview?.files.length ?? 0}
      </span>
      <span
        className={clsx(
          "pl-inspector-badge",
          unknownKeys > 0 ? "pl-inspector-badge--warning" : "pl-inspector-badge--muted"
        )}
      >
        未知 YAML Key {unknownKeys}
      </span>
      {previewError ? (
        <span className="pl-inspector-badge pl-inspector-badge--danger">预览失败</span>
      ) : null}
      {saveError ? (
        <span className="pl-inspector-badge pl-inspector-badge--danger">保存失败</span>
      ) : null}
      {isSaving ? (
        <span className="pl-inspector-badge pl-inspector-badge--muted">保存中</span>
      ) : null}
      {validation ? (
        <span className={clsx("pl-inspector-badge", validation.ok ? "pl-inspector-badge--success" : "pl-inspector-badge--danger")}>
          {validation.ok ? "校验通过" : "校验未通过"}
        </span>
      ) : null}
      {validationError ? (
        <span className="pl-inspector-badge pl-inspector-badge--danger">校验失败</span>
      ) : null}
    </div>
  );
}

function VersionHistoryPanel({
  detail,
  detailLoading,
  onClose,
  onRestore,
  onSelectVersion,
  restorePending,
  selectedVersionId,
  versions,
  versionsLoading
}: {
  detail: TableYamlVersionDetail | undefined;
  detailLoading: boolean;
  onClose: () => void;
  onRestore: (versionId: string) => void;
  onSelectVersion: (versionId: string) => void;
  restorePending: boolean;
  selectedVersionId: string | null;
  versions: TableYamlVersionSummary[];
  versionsLoading: boolean;
}) {
  return (
    <div className="pl-version-panel-backdrop" role="presentation">
      <aside
        aria-label="版本记录"
        aria-modal="true"
        className="pl-version-panel"
        data-testid="table-editor-version-panel"
        role="dialog"
      >
        <div className="pl-version-panel-header">
          <div>
            <p className="pl-panel-title mb-0">版本记录</p>
            <span>保留最近 5 版 YAML，可预览并恢复为未保存草稿。</span>
          </div>
          <button className="pl-drawer-close pl-drawer-close--prominent" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="pl-version-panel-body">
          <div className="pl-version-list" aria-label="YAML 历史版本">
            {versionsLoading ? <p className="pl-notice">正在加载版本记录...</p> : null}
            {!versionsLoading && versions.length === 0 ? (
              <p className="pl-notice">暂无版本记录。保存或导入 YAML 后会生成记录。</p>
            ) : null}
            {versions.map((version) => (
              <button
                aria-pressed={selectedVersionId === version.versionId}
                className={clsx(
                  "pl-version-list-item",
                  selectedVersionId === version.versionId && "pl-version-list-item--active"
                )}
                key={version.versionId}
                onClick={() => onSelectVersion(version.versionId)}
                type="button"
              >
                <span>
                  <strong>{VERSION_OPERATION_LABELS[version.operation]}</strong>
                  <small>{formatVersionTime(version.createdAt)}</small>
                </span>
                <code className="notranslate" translate="no">{shortHash(version.contentHash)}</code>
              </button>
            ))}
          </div>

          <div className="pl-version-detail">
            {detailLoading ? <p className="pl-notice">正在加载版本详情...</p> : null}
            {detail ? (
              <>
                <div className="pl-version-detail-summary">
                  <div>
                    <span>操作</span>
                    <strong>{VERSION_OPERATION_LABELS[detail.operation]}</strong>
                  </div>
                  <div>
                    <span>时间</span>
                    <strong>{formatVersionTime(detail.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Hash</span>
                    <code className="notranslate" translate="no">{shortHash(detail.contentHash)}</code>
                  </div>
                </div>
                <div className="pl-version-detail-actions">
                  <button
                    className="pl-btn pl-btn--primary"
                    disabled={restorePending}
                    onClick={() => onRestore(detail.versionId)}
                    type="button"
                  >
                    {restorePending ? "恢复中..." : "恢复此版本"}
                  </button>
                </div>
                <WorkbenchDisclosure
                  defaultOpen
                  id="version-diff-disclosure-trigger"
                  title="Diff"
                  summary="当前 YAML 与历史版本的差异"
                  testId="version-diff-disclosure"
                >
                  <DiffViewer diff={detail.diffFromCurrent} />
                </WorkbenchDisclosure>
                <WorkbenchDisclosure
                  id="version-yaml-disclosure-trigger"
                  title="YAML"
                  summary="历史版本快照"
                  testId="version-yaml-disclosure"
                >
                  <YamlPreview yaml={detail.rawYaml} />
                </WorkbenchDisclosure>
              </>
            ) : !detailLoading ? (
              <p className="pl-notice">选择一个历史版本查看详情。</p>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function TableEditor() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const conn = params.conn ?? "";
  const schema = params.schema ?? "";
  const table = params.table ?? "";
  const sourceUrl = `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  const initialTab = SECTION_FROM_TAB[searchParams.get("tab") ?? ""] ?? "overview";
  const sourceQuery = useQuery({
    queryKey: queryKeys.source(conn, schema, table),
    queryFn: () => apiGet<SourceDetail>(sourceUrl),
    enabled: Boolean(conn && schema && table)
  });

  const source = sourceQuery.data;
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [activeSection, setActiveSection] = useState<EditorSection>(initialTab);
  const [fieldSearch, setFieldSearch] = useState("");
  const [fieldFilterMode, setFieldFilterMode] = useState<FieldFilterMode>("all");
  const [selectedFieldNames, setSelectedFieldNames] = useState<Set<string>>(() => new Set());
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("diff");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [importedYaml, setImportedYaml] = useState<string | null>(null);
  const [importedYamlName, setImportedYamlName] = useState<string | null>(null);
  const [restoredFromVersionId, setRestoredFromVersionId] = useState<string | null>(null);
  const [pastedYaml, setPastedYaml] = useState("");
  const [isImportDrawerOpen, setIsImportDrawerOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const versionsQuery = useQuery({
    queryKey: queryKeys.sourceVersions(conn, schema, table),
    queryFn: () => apiGet<TableYamlVersionListResponse>(`${sourceUrl}/versions`),
    enabled: Boolean(source && isVersionPanelOpen)
  });
  const selectedVersionQuery = useQuery({
    queryKey: queryKeys.sourceVersion(conn, schema, table, selectedVersionId ?? ""),
    queryFn: () => apiGet<TableYamlVersionDetail>(`${sourceUrl}/versions/${encodeURIComponent(selectedVersionId ?? "")}`),
    enabled: Boolean(source && isVersionPanelOpen && selectedVersionId)
  });
  const candidatesQuery = useQuery({
    queryKey: queryKeys.joinCandidates,
    queryFn: () => apiGet<JoinCandidatesResponse>("/api/joins/candidates"),
    enabled: Boolean(source && activeSection === "joins")
  });
  const writeCandidates = useMutation({
    mutationFn: (next: JoinCandidate[]) => apiPut<JoinCandidatesResponse>("/api/joins/candidates", { candidates: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.joinCandidates });
      toast.success("候选已保存");
    },
    onError: (error) => {
      toast.error(`保存候选失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });
  const confirmJoin = useMutation({
    mutationFn: (join: Join) =>
      apiPut(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: false,
        patch: {
          joins: [...(source?.model.joins ?? []), { ...join, source: "formal" }]
        }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.source(conn, schema, table) });
      toast.success("已写入语义层");
      navigate("/review");
    },
    onError: (error) => {
      toast.error(`确认失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const saveMutation = useMutation({
    mutationFn: (input: SaveInput) => {
      const url = `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
      if (input.kind === "import") {
        return apiPost<SourceSaveResponse>(`${url}/import`, {
          dryRun: false,
          yaml: input.yaml,
          sourceFileName: input.sourceFileName,
          restoredFromVersionId: input.restoredFromVersionId
        });
      }
      return apiPut<SourceSaveResponse>(url, {
        dryRun: false,
        patch: input.patch
      });
    },
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

  useEffect(() => {
    const tab = searchParams.get("tab");
    const nextSection = tab ? SECTION_FROM_TAB[tab] : "overview";
    if (nextSection && nextSection !== activeSection) {
      setActiveSection(nextSection);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- sync URL tab into local section; ignore activeSection to avoid loops

  useEffect(() => {
    if (!isVersionPanelOpen || selectedVersionId) {
      return;
    }
    const firstVersion = versionsQuery.data?.versions[0];
    if (firstVersion) {
      setSelectedVersionId(firstVersion.versionId);
    }
  }, [isVersionPanelOpen, selectedVersionId, versionsQuery.data?.versions]);

  const runPreview = useCallback(
    async (nextForm: EditorForm): Promise<boolean> => {
      const parsed = editorSchema.safeParse(nextForm);
      if (!source || !parsed.success) {
        return false;
      }
      setValidation(null);
      setValidationError(null);
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
        setValidation(null);
        setValidationError(null);
        return false;
      }
    },
    [conn, schema, source, table]
  );

  const runImportPreview = useCallback(
    async (yaml: string): Promise<SourcePreview | null> => {
      if (!source) {
        return null;
      }
      setValidation(null);
      setValidationError(null);
      try {
        const data = await apiPost<SourcePreview>(
          `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/import`,
          {
            dryRun: true,
            yaml
          }
        );
        setPreview(data);
        setPreviewError(null);
        setInspectorTab("diff");
        return data;
      } catch (caught: unknown) {
        setPreview(null);
        setPreviewError(caught instanceof Error ? caught.message : "导入预览失败");
        setValidation(null);
        setValidationError(null);
        setInspectorTab("validate");
        return null;
      }
    },
    [conn, schema, source, table]
  );

  const runValidate = useCallback(async (): Promise<ValidationResult | null> => {
    if (!source) {
      return null;
    }
    try {
      const data = await apiPost<ValidationResult>(
        `/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/validate`,
        {}
      );
      setValidation(data);
      setValidationError(null);
      return data;
    } catch (caught: unknown) {
      setValidation(null);
      setValidationError(caught instanceof Error ? caught.message : "校验失败");
      return null;
    }
  }, [conn, schema, source, table]);

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
    return form.columns.filter((column) => {
      const sourceColumn = columnsByName.get(column.name);
      if (fieldFilterMode === "missingHuman" && column.description.trim()) {
        return false;
      }
      if (fieldFilterMode === "hasAi" && !sourceColumn?.descriptions.ai) {
        return false;
      }
      if (
        fieldFilterMode === "pkOrRequired" &&
        !sourceColumn?.pk &&
        sourceColumn?.nullable !== false
      ) {
        return false;
      }
      if (!keyword) {
        return true;
      }
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
  }, [columnsByName, fieldFilterMode, fieldSearch, form.columns]);

  const filteredColumnNames = useMemo(
    () => filteredColumns.map((column) => column.name),
    [filteredColumns]
  );
  const selectedVisibleFieldCount = filteredColumnNames.filter((name) => selectedFieldNames.has(name)).length;

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
    setSelectedFieldNames(new Set());
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
      setFieldFilterMode("all");
      setInspectorTab("diff");
      setPreview(null);
      setPreviewError(null);
      setSaveError(null);
      setValidation(null);
      setValidationError(null);
      setImportedYaml(null);
      setImportedYamlName(null);
      setRestoredFromVersionId(null);
      setPastedYaml("");
      setIsImportDrawerOpen(false);
      setIsVersionPanelOpen(false);
      setSelectedVersionId(null);
    }
  }, [source]);

  useEffect(() => {
    if (!source || !parsedValues.success || importedYaml) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void runPreview(form);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [form, importedYaml, parsedValues.success, runPreview, source]);

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

  function adoptTableAiDescription() {
    const ai = source?.model.descriptions.ai;
    if (!ai) {
      return;
    }
    setForm((current) => ({ ...current, tableDescription: ai }));
  }

  function changeSection(section: EditorSection) {
    setActiveSection(section);
    const next = new URLSearchParams(searchParams);
    if (section === "overview") {
      next.delete("tab");
    } else {
      next.set("tab", section);
    }
    setSearchParams(next, { replace: true });
  }

  function upsertCandidate(candidate: JoinCandidate) {
    if (!candidatesQuery.isSuccess) {
      toast.error("候选列表尚未加载完成，请稍后再试");
      return;
    }
    const allCandidates = candidatesQuery.data?.candidates ?? [];
    const remaining = allCandidates.filter(
      (item) =>
        !(
          item.conn === candidate.conn &&
          item.schema === candidate.schema &&
          item.fromTable === candidate.fromTable &&
          item.join.to === candidate.join.to &&
          item.join.on === candidate.join.on
        )
    );
    writeCandidates.mutate([...remaining, candidate]);
  }

  function updateColumnDescription(columnName: string, next: string) {
    setForm((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.name === columnName ? { ...column, description: next } : column
      )
    }));
  }

  function setFieldSelected(columnName: string, selected: boolean) {
    setSelectedFieldNames((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(columnName);
      } else {
        next.delete(columnName);
      }
      return next;
    });
  }

  function selectVisibleFields() {
    setSelectedFieldNames((current) => {
      const next = new Set(current);
      for (const name of filteredColumnNames) {
        next.add(name);
      }
      return next;
    });
  }

  function clearFieldSelection() {
    setSelectedFieldNames(new Set());
  }

  function batchAdoptAiForSelectedFields() {
    const selectedNames = new Set(filteredColumnNames.filter((name) => selectedFieldNames.has(name)));
    if (selectedNames.size === 0) {
      toast.error("请先选择字段");
      return;
    }
    let adopted = 0;
    const nextColumns = form.columns.map((column) => {
      if (!selectedNames.has(column.name) || column.description.trim()) {
        return column;
      }
      const ai = columnsByName.get(column.name)?.descriptions.ai;
      if (!ai) {
        return column;
      }
      adopted += 1;
      return { ...column, description: ai };
    });
    if (adopted > 0) {
      setForm((current) => ({
        ...current,
        columns: nextColumns
      }));
      toast.success(`已批量采纳 ${adopted} 个字段的 AI 描述`);
    } else {
      toast.error("所选字段没有可填充的空白 AI 描述");
    }
  }

  function handleExportYaml() {
    if (!source) {
      return;
    }
    const blob = new Blob([source.rawYaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${source.model.conn}-${source.model.schema}-${source.model.table}.yaml`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleOpenImportPicker() {
    importInputRef.current?.click();
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const yaml = await file.text();
      setImportedYaml(yaml);
      setImportedYamlName(file.name);
      setRestoredFromVersionId(null);
      const previewResult = await runImportPreview(yaml);
      if (previewResult) {
        setIsImportDrawerOpen(false);
        toast.success("已导入 YAML 并生成变更预览");
      } else {
        setImportedYaml(null);
        setImportedYamlName(null);
        toast.error("导入预览失败");
      }
    } catch (caught: unknown) {
      const message = `导入失败：${caught instanceof Error ? caught.message : "未知错误"}`;
      setImportedYaml(null);
      setImportedYamlName(null);
      setPreviewError(message);
      setInspectorTab("validate");
      toast.error(message);
    }
  }

  async function handlePasteYamlPreview() {
    const yaml = pastedYaml.trim();
    if (!yaml) {
      toast.error("请先粘贴 YAML 内容");
      return;
    }
    setImportedYaml(yaml);
    setImportedYamlName("粘贴 YAML");
    setRestoredFromVersionId(null);
    const previewResult = await runImportPreview(yaml);
    if (previewResult) {
      setIsImportDrawerOpen(false);
      toast.success("已生成导入预览");
    } else {
      setImportedYaml(null);
      setImportedYamlName(null);
      toast.error("导入预览失败");
    }
  }

  function handleValidateCurrent() {
    const action = importedYaml
      ? runImportPreview(importedYaml)
      : runPreview(form);
    void Promise.resolve(action).then(async (previewOk) => {
      const validationResult = await runValidate();
      setInspectorTab("validate");
      if (previewOk && validationResult?.ok) {
        toast.success("校验通过");
        return;
      }
      if (validationResult && !validationResult.ok) {
        toast.error(formatValidationFailureToast(validationResult));
        return;
      }
      toast.error("校验未通过");
    });
  }

  function handleSubmit() {
    if (importedYaml) {
      saveMutation.mutate({
        kind: "import",
        yaml: importedYaml,
        sourceFileName: restoredFromVersionId ? undefined : importedYamlName ?? undefined,
        restoredFromVersionId: restoredFromVersionId ?? undefined
      });
      return;
    }
    if (source) {
      saveMutation.mutate({ kind: "patch", patch: patchFromForm(form, source) });
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
    const action = importedYaml
      ? runImportPreview(importedYaml)
      : runPreview(form);
    void Promise.resolve(action).then((ok) => {
      setInspectorTab("diff");
      if (ok) {
        toast.success("已更新预览");
      } else {
        toast.error("预览失败");
      }
    });
  }

  async function handleRestoreVersion(versionId: string) {
    setIsRestoringVersion(true);
    setSaveError(null);
    try {
      const data = await apiPost<TableYamlVersionRestoreResult>(
        `${sourceUrl}/versions/${encodeURIComponent(versionId)}/restore`,
        {}
      );
      setImportedYaml(data.rawYaml);
      setImportedYamlName(`恢复版本 ${shortHash(data.restoredFromVersionId)}`);
      setRestoredFromVersionId(data.restoredFromVersionId);
      setPastedYaml("");
      const previewResult = await runImportPreview(data.rawYaml);
      if (previewResult) {
        setInspectorTab("diff");
        toast.success("已恢复为未保存草稿");
      } else {
        setImportedYaml(null);
        setImportedYamlName(null);
        setRestoredFromVersionId(null);
        toast.error("恢复预览失败");
      }
    } catch (caught: unknown) {
      const message = `恢复失败：${caught instanceof Error ? caught.message : "未知错误"}`;
      setSaveError(message);
      setInspectorTab("validate");
      toast.error(message);
    } finally {
      setIsRestoringVersion(false);
    }
  }

  const changeSummary = source
    ? buildChangeSummary({ form, importedYamlName, source })
    : [];
  const unknownKeys = source?.model.unknownKeys?.length ?? 0;
  const hasDraftChanges = Boolean(preview?.diff || importedYaml);
  const joinCandidates = useMemo(
    () =>
      tableJoinCandidates({
        source,
        sidecarCandidates: candidatesQuery.data?.candidates ?? []
      }),
    [candidatesQuery.data?.candidates, source]
  );

  return (
    <div className="pl-page-stack">
      <PageHeader
title={source ? <span className="notranslate" translate="no">{source.model.table}</span> : "语义维护"}
        description={
          source ? (
            <span className="pl-table-editor-context" data-testid="table-editor-header-context">
              <span>
                连接：
                <span className="notranslate" translate="no">{source.model.conn}</span>
              </span>
              <span>
                Schema：
                <span className="notranslate" translate="no">{source.model.schema}</span>
              </span>
            </span>
          ) : (
            null
          )
        }
        actions={
          source ? (
            <div className="pl-table-header-actions">
              <button className="pl-btn pl-btn--secondary" type="button" onClick={() => setIsImportDrawerOpen(true)}>
                导入 YAML
              </button>
              <button className="pl-btn pl-btn--secondary" type="button" onClick={handleExportYaml}>
                导出 YAML
              </button>
              <button
                className="pl-btn pl-btn--secondary"
                type="button"
                onClick={handleValidateCurrent}
                title={VALIDATE_BUTTON_TITLE}
              >
                校验
              </button>
              <button className="pl-btn pl-btn--primary" disabled={saveMutation.isPending} form="table-editor-form" type="submit">
                {saveMutation.isPending ? "保存中..." : "保存"}
              </button>
              <RowMoreMenu
                ariaLabel={`更多操作：${source.model.conn}/${source.model.schema}/${source.model.table}`}
                items={[
                  {
                    kind: "action",
                    label: "版本记录",
                    onSelect: () => setIsVersionPanelOpen(true),
                    testId: "table-editor-more-versions"
                  },
                  {
                    kind: "link",
                    label: "查看关联的业务 Wiki",
                    href: `/wiki?sl_ref=${encodeURIComponent(`${source.model.conn}/${source.model.schema}/${source.model.table}`)}`,
                    testId: "table-editor-more-wiki"
                  },
                  {
                    kind: "link",
                    label: "审阅",
                    href: "/review",
                    testId: "table-editor-more-review"
                  },
                  {
                    kind: "action",
                    label: "关联关系",
                    onSelect: () => changeSection("joins"),
                    testId: "table-editor-more-joins"
                  }
                ]}
              />
            </div>
          ) : null
        }
      />

      <section
        className="pl-table-workbench"
        onKeyDown={source ? handleSaveShortcut : undefined}
      >
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
                handleSubmit();
              }}
            >
              <section className="pl-semantic-content" data-testid="semantic-content">
                <div className="pl-semantic-content-header">
                  <p className="pl-panel-title mb-0">在线编辑</p>
                  <SemanticTabs
                    activeSection={activeSection}
                    onSectionChange={changeSection}
                    source={source}
                  />
                </div>
                <div className="pl-manual-semantic-workspace">
                  <div className="pl-manual-semantic-panel">
                    {activeSection === "overview" ? (
                      <section className="pl-panel">
                        <div className="pl-field-label">
                          <span>表描述</span>
                          <TableDescriptionEditor
                            source={source}
                            description={form.tableDescription}
                            onDescriptionChange={(next) => setForm({ ...form, tableDescription: next })}
                            onAdoptAi={adoptTableAiDescription}
                          />
                        </div>
                        <div className="pl-field-label">
                          <span className="pl-field-label-with-overlay">
                            行粒度
                            <OverlayBadge source={source} />
                          </span>
                          <GrainPicker
                            columns={source.model.columns}
                            value={form.grain}
                            onChange={(next) => setForm({ ...form, grain: next })}
                          />
                        </div>
                      </section>
                    ) : null}

                    {activeSection === "measures" ? (
                      <section className="pl-panel">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="pl-panel-title mb-0">指标</p>
                          <OverlayBadge source={source} />
                        </div>
                        <p className="pl-notice mb-3">
                          指标是可复用的聚合口径，定义后可供数据问答与报表复用，避免每次分析重复手写。修改将写入{" "}
                          <span className="notranslate" translate="no">
                            semantic-layer/&lt;conn&gt;/&lt;table&gt;.yaml
                          </span>{" "}
                          的指标段，与基础表定义分离。
                        </p>
                        <MeasureForm
                          measures={form.measures}
                          onChange={(measures) => setForm({ ...form, measures })}
                        />
                      </section>
                    ) : null}

                    {activeSection === "segments" ? (
                      <section className="pl-panel">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="pl-panel-title mb-0">分群</p>
                          <OverlayBadge source={source} />
                        </div>
                        <p className="pl-notice mb-3">
                          分群是可复用的筛选条件，定义后可保证跨场景口径一致。修改将写入{" "}
                          <span className="notranslate" translate="no">
                            semantic-layer/&lt;conn&gt;/&lt;table&gt;.yaml
                          </span>{" "}
                          的分群段，与基础表定义分离。
                        </p>
                        <SegmentForm
                          segments={form.segments}
                          onChange={(segments) => setForm({ ...form, segments })}
                        />
                      </section>
                    ) : null}

                    {activeSection === "columns" ? (
                      <section className="pl-panel">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="pl-notice mb-0">
                            表格展示 PK/类型/可空性与 AI 建议。Human 初始仅载入 descriptions.human，点击「采纳 AI 描述」才会把 AI 文本写进 Human。勾选字段后可批量采纳 AI 描述。
                          </p>
                          <label className="pl-field-search shrink-0">
                            <span className="sr-only">搜索字段</span>
                            <input className="pl-input" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="搜索字段" />
                          </label>
                        </div>
                        <div className="pl-field-batch-toolbar" data-testid="field-batch-toolbar">
                          <div className="pl-field-filter-modes" aria-label="字段筛选模式">
                            {(Object.entries(FIELD_FILTER_LABELS) as [FieldFilterMode, string][]).map(([mode, label]) => (
                              <button
                                aria-pressed={fieldFilterMode === mode}
                                className={clsx(
                                  "pl-field-filter-mode",
                                  fieldFilterMode === mode && "pl-field-filter-mode--active"
                                )}
                                key={mode}
                                onClick={() => setFieldFilterMode(mode)}
                                type="button"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="pl-field-batch-actions">
                            <span data-testid="field-batch-selection-count">
                              已选 {selectedVisibleFieldCount} / 可见 {filteredColumns.length}
                            </span>
                            <span className="pl-field-batch-hint">勾选后可批量采纳 AI 描述</span>
                            <button className="pl-btn pl-btn--ghost pl-btn--sm" onClick={selectVisibleFields} type="button">
                              全选筛选结果
                            </button>
                            <button className="pl-btn pl-btn--ghost pl-btn--sm" onClick={clearFieldSelection} type="button">
                              清空选择
                            </button>
                            <button className="pl-btn pl-btn--secondary pl-btn--sm" onClick={batchAdoptAiForSelectedFields} type="button">
                              批量采纳 AI 描述
                            </button>
                          </div>
                        </div>
                        <div className="pl-field-table-wrap">
                          <table className="pl-data-grid pl-field-table" data-testid="field-editor-table">
                            <thead>
                              <tr>
                                <th scope="col" className="pl-field-col-select">
                                  <span className="sr-only">选择（批量采纳）</span>
                                </th>
                                <th scope="col">字段名</th>
                                <th scope="col">物理注释 (DB)</th>
                                <th scope="col">AI 建议描述</th>
                                <th scope="col">人工描述 (Human)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredColumns.map((column) => {
                                const sourceColumn = columnsByName.get(column.name);
                                if (!sourceColumn) {
                                  return null;
                                }
                                return (
                                  <FieldRow
                                    key={column.name}
                                    sourceColumn={sourceColumn}
                                    description={column.description}
                                    selected={selectedFieldNames.has(column.name)}
                                    onDescriptionChange={(next) => updateColumnDescription(column.name, next)}
                                    onAdoptAi={() => adoptAiDescription(column.name)}
                                    onSelectedChange={(checked) => setFieldSelected(column.name, checked)}
                                  />
                                );
                              })}
                            </tbody>
                          </table>
                          {filteredColumns.length === 0 ? <p className="pl-notice">没有匹配字段。</p> : null}
                        </div>
                      </section>
                    ) : null}

                    {activeSection === "joins" ? (
                      <section className="pl-panel" data-testid="joins-inline-panel">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="pl-panel-title mb-0">关联</p>
                          <OverlayBadge source={source} />
                        </div>
                        <p className="pl-notice mb-3">
                          关联声明表间连接方式，支撑跨表问答与分析。正式关系写入 overlay；候选关系先保存在 sidecar。候选来自字段名启发式，不是强语义推断。
                        </p>

                        <div className="grid gap-4">
                          <section>
                            <p className="pl-panel-title">已确认关系</p>
                            <div className="pl-relation-list">
                              {(source.model.joins ?? []).map((join) => (
                                <div className="pl-relation-row" key={`${join.to}-${join.on}`}>
                                  <strong className="notranslate" translate="no">
                                    {join.to}
                                  </strong>
                                  <span>{RELATIONSHIP_LABELS[join.relationship]}</span>
                                  <code className="notranslate" translate="no">
                                    {join.on}
                                  </code>
                                </div>
                              ))}
                              {(source.model.joins ?? []).length === 0 ? (
                                <p className="pl-notice">当前表还没有正式关联关系。</p>
                              ) : null}
                            </div>
                          </section>

                          <section>
                            <p className="pl-panel-title">候选关系</p>
                            <p className="pl-notice mb-2">
                              以下候选由字段名启发式生成或来自 sidecar，仅供人工确认，不代表已验证的业务关联。
                            </p>
                            <div className="grid gap-2">
                              {joinCandidates.map((candidate) => (
                                <div
                                  className="pl-join-row"
                                  key={`${candidate.join.to}-${candidate.join.on}-${candidate.note ?? ""}`}
                                >
                                  <strong className="notranslate" translate="no">
                                    {candidate.join.to}
                                  </strong>
                                  <span className="notranslate" translate="no">
                                    {candidate.join.on}
                                  </span>
                                  <span>{RELATIONSHIP_LABELS[candidate.join.relationship]}</span>
                                  <div className="flex items-center gap-2 justify-end flex-wrap">
                                    <button
                                      type="button"
                                      className="pl-btn pl-btn--ghost pl-btn--sm"
                                      disabled={!candidatesQuery.isSuccess || writeCandidates.isPending}
                                      onClick={() =>
                                        upsertCandidate({
                                          ...candidate,
                                          confidence: "candidate",
                                          join: { ...candidate.join, source: "candidate" }
                                        })
                                      }
                                    >
                                      保留为候选
                                    </button>
                                    <button
                                      type="button"
                                      className="pl-btn pl-btn--ghost pl-btn--sm"
                                      disabled={!candidatesQuery.isSuccess || writeCandidates.isPending}
                                      onClick={() =>
                                        upsertCandidate({
                                          ...candidate,
                                          confidence: "rejected",
                                          join: { ...candidate.join, source: "candidate" }
                                        })
                                      }
                                    >
                                      标记为不采用
                                    </button>
                                    <button
                                      type="button"
                                      className="pl-btn pl-btn--primary pl-btn--sm"
                                      onClick={() => confirmJoin.mutate(candidate.join)}
                                      disabled={confirmJoin.isPending}
                                    >
                                      确认写入语义层
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {joinCandidates.length === 0 ? (
                                <p className="pl-notice">暂无候选关联关系。</p>
                              ) : null}
                            </div>
                          </section>
                        </div>
                      </section>
                    ) : null}
                  </div>
                </div>
              </section>
              <input
                ref={importInputRef}
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                accept=".yaml,.yml,text/yaml,text/plain"
                onChange={handleImportFile}
                data-testid="table-editor-import-input"
              />
            </form>
          </>
        ) : null}
      </div>

      {source ? (
        <ChangeReview
          activeTab={inspectorTab}
          changeSummary={changeSummary}
          hasDraftChanges={hasDraftChanges}
          importedYamlName={importedYamlName}
          isSaving={saveMutation.isPending}
          onTabChange={setInspectorTab}
          preview={preview}
          previewError={previewError}
          saveError={saveError}
          source={source}
          unknownKeys={unknownKeys}
          validation={validation}
          validationError={validationError}
        />
      ) : null}
      </section>
      {isVersionPanelOpen ? (
        <VersionHistoryPanel
          detail={selectedVersionQuery.data}
          detailLoading={selectedVersionQuery.isLoading}
          onClose={() => setIsVersionPanelOpen(false)}
          onRestore={handleRestoreVersion}
          onSelectVersion={setSelectedVersionId}
          restorePending={isRestoringVersion}
          selectedVersionId={selectedVersionId}
          versions={versionsQuery.data?.versions ?? []}
          versionsLoading={versionsQuery.isLoading}
        />
      ) : null}
      {isImportDrawerOpen ? (
        <ImportYamlDrawer
          onClose={() => setIsImportDrawerOpen(false)}
          onOpenFile={handleOpenImportPicker}
          onPastePreview={handlePasteYamlPreview}
          onPastedYamlChange={setPastedYaml}
          pastedYaml={pastedYaml}
        />
      ) : null}
    </div>
  );
}

// Re-export the Join type for callers that need to type candidate join
// objects (kept here so the types stay close to the table editor that
// composes them).
export type { Join };
