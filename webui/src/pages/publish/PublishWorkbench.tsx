import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import { toast } from "sonner";
import type {
  ChangedFilesResponse,
  SemanticAssetManualReindexResponse,
  SourcesResponse,
  SourceSummary,
  ValidateChangedResponse,
  ValidationResult
} from "../../lib/types";
import {
  formatValidationFailureToast,
  isNoiseValidationLine,
  listValidationIssueMessages,
  primaryValidationIssue
} from "../semantic/validation-utils";

function tableNameFromPath(filePath: string) {
  return filePath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? filePath;
}

function WorkbenchValidationRow({
  conn,
  schema,
  table,
  validation
}: {
  conn: string;
  schema: string;
  table: string;
  validation: ValidationResult;
}) {
  const issueMessages = listValidationIssueMessages(validation).filter(
    (message) => !isNoiseValidationLine(message)
  );
  return (
    <div
      className={clsx(
        "pl-validation-row",
        validation.ok ? "pl-validation-row--ok" : "pl-validation-row--failed"
      )}
      data-testid={`workbench-validation-row-${table}`}
    >
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="notranslate" translate="no">
            {conn}/{schema}/{table}
          </strong>
          <span>{validation.ok ? "通过" : "未通过"}</span>
        </div>
        {!validation.ok && issueMessages.length > 0 ? (
          <div data-testid="workbench-validation-issues">
            <p className="text-xs font-medium mb-1">校验问题</p>
            <ul className="pl-validation-issues list-none p-0 m-0 grid gap-1">
              {issueMessages.map((message) => (
                <li key={message} className="text-xs notranslate" translate="no">
                  {message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!validation.ok ? (
          <details className="text-xs" data-testid="workbench-validation-tech-details">
            <summary>技术详情</summary>
            <p className="mt-1">退出码 {validation.exitCode}</p>
            {(validation.stderr || validation.stdout) && (
              <pre className="pl-yaml-preview mt-1 notranslate" translate="no">
                {`${validation.stderr}\n${validation.stdout}`.trim()}
              </pre>
            )}
          </details>
        ) : null}
      </div>
    </div>
  );
}

export type ClassifiedSemanticChange =
  | { kind: "schema-manifest"; conn: string; schema: string; filePath: string }
  | { kind: "table-overlay"; conn: string; table: string; filePath: string }
  | { kind: "other"; filePath: string };

const SCHEMA_MANIFEST_PATH =
  /^semantic-layer\/([^/]+)\/_schema\/([^/]+)\.ya?ml$/i;
const TABLE_OVERLAY_PATH = /^semantic-layer\/([^/]+)\/([^/]+)\.ya?ml$/i;

export function classifyChangedSemanticFile(filePath: string): ClassifiedSemanticChange {
  const schemaMatch = filePath.match(SCHEMA_MANIFEST_PATH);
  if (schemaMatch) {
    return {
      kind: "schema-manifest",
      conn: schemaMatch[1],
      schema: schemaMatch[2],
      filePath
    };
  }
  const tableMatch = filePath.match(TABLE_OVERLAY_PATH);
  if (tableMatch && tableMatch[2] !== "_schema") {
    return {
      kind: "table-overlay",
      conn: tableMatch[1],
      table: tableMatch[2],
      filePath
    };
  }
  return { kind: "other", filePath };
}

export function classifyChangedSemanticFiles(filePaths: string[]): ClassifiedSemanticChange[] {
  return filePaths.map(classifyChangedSemanticFile);
}

/**
 * Table-level overlays only. Schema Manifest paths must not appear as table names.
 */
export function impactedTableNames(filePaths: string[]): string[] {
  const seen = new Set<string>();
  for (const classified of classifyChangedSemanticFiles(filePaths)) {
    if (classified.kind === "table-overlay") {
      seen.add(classified.table);
    }
  }
  return [...seen].sort();
}

export function fileChangeStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "w" || normalized === "m" || normalized === "modified") return "已修改";
  if (normalized === "a" || normalized === "added") return "新增";
  if (normalized === "d" || normalized === "deleted") return "已删除";
  if (normalized === "r" || normalized === "renamed") return "已重命名";
  return "已变更";
}

function findSourceForTable(
  sources: SourceSummary[],
  tableName: string
): SourceSummary | null {
  return sources.find((source) => source.table === tableName) ?? null;
}

const boundaryChecklistRules: Array<{ pattern: RegExp; prompt: string }> = [
  {
    pattern: /^webui\/src\/pages\/connections\//,
    prompt: "检查数据接入是否只处理 Connection / Schema / Manifest / Catalog / 启用表范围 / 连通测试。"
  },
  {
    pattern: /^webui\/src\/components\/catalog\//,
    prompt: "检查上传文案是否明确 Schema Manifest，且目标路径由系统计算。"
  },
  {
    pattern: /^webui\/src\/pages\/TableEditor\.tsx$/,
    prompt: "检查语义建模是否只处理业务语义和 overlay。"
  },
  {
    pattern: /^webui\/server\/catalog-assets\.ts$/,
    prompt: "检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。"
  },
  {
    pattern: /^webui\/server\/semantic-assets\.ts$/,
    prompt: "检查资产包分类、secret hard block 和 Validate Gate。"
  },
  {
    pattern: /^webui\/src\/components\/semantic-assets\//,
    prompt: "检查资产包分类、secret hard block 和 Validate Gate。"
  }
];

export function boundaryChecklistForChangedFiles(files: string[]): string[] {
  const prompts = new Set<string>();
  for (const file of files) {
    for (const rule of boundaryChecklistRules) {
      if (rule.pattern.test(file)) {
        prompts.add(rule.prompt);
      }
    }
  }
  return [...prompts];
}

type PublishGate =
  | { state: "empty" }
  | { state: "pending" }
  | { state: "ready" };

function derivePublishGate(
  pendingFiles: number,
  validate: ValidateChangedResponse | null | undefined
): PublishGate {
  if (pendingFiles === 0) return { state: "empty" };
  if (!validate) return { state: "pending" };
  if (validate.results.length === 0) return { state: "pending" };
  if (validate.results.some((row) => !row.validation.ok)) return { state: "pending" };
  return { state: "ready" };
}

function gateNextStepCopy(gate: PublishGate, failedCount: number, hasValidate: boolean): string {
  if (gate.state === "empty") {
    return "暂无待同步变更。可直接同步索引，或在「更多」中全量重建。";
  }
  if (!hasValidate) {
    return "下一步：校验变更。";
  }
  if (failedCount > 0) {
    return `${failedCount} 张表校验未通过，同步已被阻断。`;
  }
  if (gate.state === "pending") {
    return "当前变更无可校验对象或校验未通过，同步已阻断。";
  }
  return "校验已通过，可使用顶部「同步索引并生效」。";
}

export function countDiffLines(diff?: string): { added: number; deleted: number } {
  if (!diff) return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deleted++;
    }
  }
  return { added, deleted };
}

export function PublishWorkbench() {
  const [selected, setSelected] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [showValidationDetails, setShowValidationDetails] = useState(false);
  const autoValidatedSignature = useRef<string | null>(null);

  const diffQuery = useQuery({
    queryKey: queryKeys.diff,
    queryFn: () => apiGet<ChangedFilesResponse>("/api/diff")
  });
  const validateMutation = useMutation({
    mutationFn: () => apiPost<ValidateChangedResponse>("/api/validate-changed", {}),
    onSuccess: (data) => {
      const failed = data.results.filter((item) => !item.validation.ok).length;
      if (failed === 0) {
        if (data.results.length === 0) {
          toast.message("校验完成：本次无可校验的表变更", { id: "workbench-validation" });
        } else {
          toast.success(`校验通过：${data.results.length} 张表全部通过`, { id: "workbench-validation" });
        }
      } else {
        const firstFailed = data.results.find((item) => !item.validation.ok);
        const primary = firstFailed ? primaryValidationIssue(firstFailed.validation) : null;
        if (primary) {
          const detail = formatValidationFailureToast(firstFailed!.validation).replace(
            /^校验未通过：?/,
            ""
          );
          toast.error(`校验未通过（${failed}/${data.results.length}）：${detail}`, { id: "workbench-validation" });
        } else {
          toast.error(`校验未通过：${failed} / ${data.results.length} 张表未通过`, { id: "workbench-validation" });
        }
      }
    },
    onError: (error) => {
      toast.error(`校验失败：${error instanceof Error ? error.message : "未知错误"}`, { id: "workbench-validation" });
    }
  });
  const reindexMutation = useMutation({
    mutationFn: (opts?: { force?: boolean }) =>
      apiPost<SemanticAssetManualReindexResponse>("/api/semantic-assets/reindex", {
        force: opts?.force === true
      }),
    onSuccess: (data) => {
      if (data.reindex.ok) {
        toast.success("KTX 索引重建完成", { id: "workbench-reindex" });
      } else {
        toast.error(`KTX 索引重建失败：exit ${data.reindex.exitCode}`, { id: "workbench-reindex" });
      }
    },
    onError: (error) => {
      toast.error(`KTX 索引重建失败：${error instanceof Error ? error.message : "未知错误"}`, { id: "workbench-reindex" });
    }
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const files = diffQuery.data?.files ?? [];
  const fileSignature = files.map((file) => file.filePath).join("\n");
  const hasPendingFiles = files.length > 0;
  const boundaryChecklist = boundaryChecklistForChangedFiles(files.map((file) => file.filePath));
  const active = selected ? files.find((file) => file.filePath === selected) ?? null : null;
  const failedCount = validateMutation.data?.results.filter((item) => !item.validation.ok).length ?? 0;
  const publishGate = derivePublishGate(files.length, validateMutation.data);
  const publishCtaDisabled = publishGate.state !== "ready";
  const classified = useMemo(
    () => classifyChangedSemanticFiles(files.map((file) => file.filePath)),
    [files]
  );
  const schemaManifests = classified.filter(
    (item): item is Extract<ClassifiedSemanticChange, { kind: "schema-manifest" }> =>
      item.kind === "schema-manifest"
  );
  const impactedTables = useMemo(
    () => impactedTableNames(files.map((file) => file.filePath)),
    [files]
  );
  const otherChanges = classified.filter((item) => item.kind === "other");
  const impactedTableRefs = useMemo(() => {
    const sources = sourcesQuery.data?.tables ?? [];
    return impactedTables.map((tableName) => ({
      tableName,
      source: findSourceForTable(sources, tableName)
    }));
  }, [impactedTables, sourcesQuery.data]);
  const postPublishEvalDomains = impactedTables.length > 0 ? impactedTables : ["all"];
  const reindexSucceeded = reindexMutation.data?.reindex.ok === true;
  const reindexFinished = reindexSucceeded && publishGate.state !== "ready";
  const reindexFailed = reindexMutation.data ? !reindexMutation.data.reindex.ok : false;
  const showPostPublishPrompt = reindexSucceeded && files.length > 0 && !publishCtaDisabled;

  const runValidate = validateMutation.mutate;
  const validatePending = validateMutation.isPending;

  useEffect(() => {
    if (!hasPendingFiles) {
      autoValidatedSignature.current = null;
      return;
    }
    if (diffQuery.isLoading || diffQuery.error || validatePending) return;
    if (autoValidatedSignature.current === fileSignature) return;
    autoValidatedSignature.current = fileSignature;
    runValidate();
  }, [
    hasPendingFiles,
    fileSignature,
    diffQuery.isLoading,
    diffQuery.error,
    validatePending,
    runValidate
  ]);

  useEffect(() => {
    if (!detailOpen && !confirmPublishOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (confirmPublishOpen) setConfirmPublishOpen(false);
      else if (detailOpen) setDetailOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, confirmPublishOpen]);

  function validationForFile(filePath: string) {
    const tableName = tableNameFromPath(filePath);
    return validateMutation.data?.results.find((item) => item.table === tableName)?.validation;
  }

  const publishCtaLabel =
    reindexMutation.isPending || validateMutation.isPending
      ? "处理中…"
      : hasPendingFiles
        ? "同步索引并生效"
        : "同步索引";

  const nextStepCopy = gateNextStepCopy(
    publishGate,
    failedCount,
    Boolean(validateMutation.data)
  );

  const stepReviewDone = hasPendingFiles;
  const stepValidateDone = publishGate.state === "ready";
  const stepValidateActive = hasPendingFiles && publishGate.state === "pending";
  const stepPublishActive = publishGate.state === "ready";

  function submitConfirmPublish() {
    reindexMutation.mutate(
      { force: false },
      {
        onSuccess: (data) => {
          if (data.reindex.ok) setConfirmPublishOpen(false);
        }
      }
    );
  }

  function renderMoreMenu() {
    return (
      <details className="relative" data-testid="workbench-more-menu">
        <summary className="pl-btn pl-btn--ghost cursor-pointer list-none">更多</summary>
        <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-md border border-border-default bg-bg-surface p-2 shadow-lg">
          <button
            type="button"
            className="pl-btn pl-btn--secondary w-full justify-start text-sm"
            onClick={() => reindexMutation.mutate({ force: true })}
            disabled={reindexMutation.isPending}
            data-testid="workbench-reindex"
            title="清空后全量重建，较慢"
          >
            {reindexMutation.isPending ? "重建中…" : "全量重建索引"}
          </button>
          <p className="mt-2 px-1 text-xs text-fg-muted">清空后重建，较慢；日常请用「同步索引」。</p>
        </div>
      </details>
    );
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="发布工作台"
        description={
          <>
            审阅并校验语义与 <span className="notranslate" translate="no">Wiki</span> 变更，同步索引后使其对{" "}
            <span className="notranslate" translate="no">Agent</span> 生效。
          </>
        }
        badges={
          <>
            <span data-testid="workbench-pending-count">
              {files.length > 0
                ? `${files.length} 个待同步文件`
                : "暂无待同步变更"}
            </span>
            {validateMutation.data ? (
              <span>
                {failedCount > 0
                  ? `校验失败 ${failedCount} 张`
                  : validateMutation.data.results.length === 0
                    ? "无可校验表"
                    : `校验通过 ${validateMutation.data.results.length} 张`}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {hasPendingFiles ? (
              <>
                <button
                  type="button"
                  className="pl-btn pl-btn--secondary"
                  onClick={() => validateMutation.mutate()}
                  disabled={validateMutation.isPending}
                  data-testid="workbench-validate"
                >
                  {validateMutation.isPending ? "校验中…" : "校验变更"}
                </button>
                <button
                  type="button"
                  className={clsx(
                    "pl-btn",
                    publishGate.state === "ready" ? "pl-btn--primary" : "pl-btn--secondary",
                    publishGate.state === "ready" && "pl-btn--cta"
                  )}
                  onClick={() => {
                    setDetailOpen(false);
                    setConfirmPublishOpen(true);
                  }}
                  disabled={publishCtaDisabled}
                  data-testid="workbench-publish-and-reindex"
                  data-gate={publishGate.state}
                  aria-disabled={publishCtaDisabled}
                >
                  {publishCtaLabel}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={() => reindexMutation.mutate({ force: false })}
                disabled={reindexMutation.isPending}
                data-testid="workbench-sync-index"
              >
                {reindexMutation.isPending ? "同步中…" : "同步索引"}
              </button>
            )}
            {renderMoreMenu()}
          </>
        }
      />

      <div className="pl-review-layout" data-testid="publish-workbench-layout">
        <aside className="pl-review-sidebar" data-testid="workbench-pending-panel">
          <p className="pl-panel-title mb-2">本次将同步的变更</p>
          {diffQuery.isLoading ? <p className="pl-notice">正在加载变更…</p> : null}
          {diffQuery.error ? (
            <p className="pl-error">
              变更加载失败：
              {diffQuery.error instanceof Error ? diffQuery.error.message : "未知错误"}
            </p>
          ) : null}
          {files.length === 0 && !diffQuery.isLoading ? (
            <div className="pl-notice" data-testid="workbench-empty-state">
              <p className="font-medium">暂无待同步变更</p>
              <p className="mt-1">
                磁盘语义已是最新时可直接同步索引；CLI / Git 大改后可用「更多」中的全量重建。
              </p>
            </div>
          ) : null}
          {files.length > 0 ? (
            <p className="pl-notice text-xs mb-2" data-testid="workbench-batch-sync-hint">
              本批一并同步 {files.length} 项（不可分文件勾选）。点击文件查看变更详情。
            </p>
          ) : null}
          <div className="pl-file-list">
            {files.map((file) => {
              const diffStats = countDiffLines(file.diff);
              return (
                <button
                  className={clsx(
                    "pl-file-button",
                    detailOpen && active?.filePath === file.filePath && "pl-file-button--active"
                  )}
                  key={file.filePath}
                  type="button"
                  onClick={() => {
                    setSelected(file.filePath);
                    setDetailOpen(true);
                  }}
                >
                  <span>{fileChangeStatusLabel(file.status)}</span>
                  <span className="truncate notranslate font-mono text-xs" translate="no">
                    {file.filePath}
                  </span>
                  <span className="flex items-center gap-1 text-xs shrink-0">
                    {diffStats.added > 0 ? (
                      <span className="pl-diff-stat pl-diff-stat--add">+{diffStats.added}</span>
                    ) : null}
                    {diffStats.deleted > 0 ? (
                      <span className="pl-diff-stat pl-diff-stat--del">-{diffStats.deleted}</span>
                    ) : null}
                  </span>
                  {validationForFile(file.filePath)?.ok === false ? (
                    <small>校验失败</small>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section
          className="pl-review-main grid gap-4"
          data-testid="publish-gate-panel"
        >
          <section
            className="grid gap-3"
            data-testid="publish-change-impact"
            data-impact-state={
              files.length === 0
                ? "empty"
                : validateMutation.data && failedCount > 0
                  ? "validation-failed"
                  : validateMutation.data
                    ? "validated"
                    : "pending"
            }
          >
            <p className="pl-panel-title">生效准备</p>

            <ol
              className="pl-pipeline-stepper"
              data-testid="publish-flow-steps"
              aria-label="生效步骤"
            >
              {/* Step 1: 审阅变更 */}
              <li
                className={clsx(
                  "pl-pipeline-step",
                  stepReviewDone ? "pl-pipeline-step--success" : "pl-pipeline-step--pending"
                )}
              >
                <div className="pl-pipeline-step__icon">
                  {stepReviewDone ? "✓" : "1"}
                </div>
                <div className="pl-pipeline-step__text">
                  <span
                    className={clsx(
                      "pl-pipeline-step__title",
                      stepReviewDone && "text-fg-default font-medium"
                    )}
                  >
                    审阅变更
                  </span>
                  <span className="pl-pipeline-step__sub">
                    {files.length > 0 ? `${files.length} 项待同步` : "当前无变更"}
                  </span>
                </div>
              </li>

              <li className="pl-pipeline-step__divider" aria-hidden="true">
                →
              </li>

              {/* Step 2: 校验 */}
              <li
                className={clsx(
                  "pl-pipeline-step",
                  validateMutation.isPending
                    ? "pl-pipeline-step--running"
                    : validateMutation.data
                      ? failedCount > 0
                        ? "pl-pipeline-step--failed"
                        : "pl-pipeline-step--success"
                      : stepValidateActive
                        ? "pl-pipeline-step--ready"
                        : "pl-pipeline-step--pending"
                )}
              >
                <div className="pl-pipeline-step__icon">
                  {validateMutation.isPending ? "⋯" : validateMutation.data ? (failedCount > 0 ? "✕" : "✓") : "2"}
                </div>
                <div className="pl-pipeline-step__text">
                  <span
                    className={clsx(
                      "pl-pipeline-step__title",
                      (stepValidateActive || stepValidateDone) && "text-fg-default font-medium"
                    )}
                  >
                    校验
                  </span>
                  <span className="pl-pipeline-step__sub">
                    {validateMutation.isPending
                      ? "校验中…"
                      : validateMutation.data
                        ? failedCount > 0
                          ? `${failedCount} 项阻断`
                          : `${validateMutation.data.results.length}/${validateMutation.data.results.length} 通过`
                        : "待校验"}
                  </span>
                </div>
              </li>

              <li className="pl-pipeline-step__divider" aria-hidden="true">
                →
              </li>

              {/* Step 3: 同步索引 */}
              <li
                className={clsx(
                  "pl-pipeline-step",
                  reindexMutation.isPending
                    ? "pl-pipeline-step--running"
                    : reindexMutation.data?.reindex.ok
                      ? "pl-pipeline-step--success"
                      : reindexFailed
                        ? "pl-pipeline-step--failed"
                        : stepPublishActive
                          ? "pl-pipeline-step--ready"
                          : "pl-pipeline-step--pending"
                )}
              >
                <div className="pl-pipeline-step__icon">
                  {reindexMutation.isPending ? "⋯" : reindexMutation.data?.reindex.ok ? "✓" : "3"}
                </div>
                <div className="pl-pipeline-step__text">
                  <span
                    className={clsx(
                      "pl-pipeline-step__title",
                      stepPublishActive && "text-fg-default font-medium"
                    )}
                  >
                    同步索引
                  </span>
                  <span className="pl-pipeline-step__sub">
                    {reindexMutation.isPending
                      ? "同步中…"
                      : reindexMutation.data?.reindex.ok
                        ? "已生效"
                        : reindexFailed
                          ? "同步失败"
                          : stepPublishActive
                            ? "可生效"
                            : "待就绪"}
                  </span>
                </div>
              </li>
            </ol>

            <p className="text-sm" data-testid="publish-gate-next-step">
              {nextStepCopy}
            </p>

            {files.length === 0 ? null : (
              <div className="grid gap-2">
                {schemaManifests.length > 0 ? (
                  <div className="grid gap-1.5">
                    <div className="text-xs text-fg-muted">
                      <span className="notranslate" translate="no">
                        Schema Manifest
                      </span>{" "}
                      变更 · {schemaManifests.length}
                    </div>
                    <ul className="grid gap-1 text-sm" data-testid="publish-impact-schema-list">
                      {schemaManifests.map((item) => (
                        <li key={item.filePath} className="flex items-center justify-between gap-2">
                          <span className="notranslate" translate="no">
                            {item.conn}/{item.schema}
                          </span>
                          <span className="text-xs text-fg-muted notranslate" translate="no">
                            Schema Manifest
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {impactedTables.length > 0 ? (
                  <div className="grid gap-1.5">
                    <div className="text-xs text-fg-muted">
                      表语义变更 · 共影响 {impactedTables.length} 张表
                    </div>
                    <ul className="grid gap-1.5 text-sm" data-testid="publish-change-impact-list">
                      {impactedTableRefs.map(({ tableName, source }) => (
                        <li key={tableName} className="flex items-center justify-between gap-2">
                          {source ? (
                            <Link
                              to={buildObjectDetailSearch({
                                kind: "table",
                                conn: source.conn,
                                schema: source.schema,
                                table: source.table
                              })}
                              className="pl-inline-link notranslate"
                              translate="no"
                              data-testid={`publish-impact-table-${tableName}`}
                            >
                              {tableName}
                            </Link>
                          ) : (
                            <span
                              className="text-fg-default notranslate"
                              translate="no"
                              data-testid={`publish-impact-table-${tableName}`}
                            >
                              {tableName}
                            </span>
                          )}
                          <span className="text-xs text-fg-muted">
                            {source ? `${source.conn}/${source.schema}` : "未在 Catalog 中"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : schemaManifests.length === 0 && otherChanges.length === 0 ? (
                  <p className="pl-notice text-xs">暂无表级语义变更。</p>
                ) : null}

                {otherChanges.length > 0 ? (
                  <p className="text-xs text-fg-muted" data-testid="publish-impact-other-count">
                    其它变更 {otherChanges.length} 项（不计入表影响）
                  </p>
                ) : null}

                {failedCount > 0 ? (
                  <p className="pl-error text-xs" data-testid="publish-change-impact-blocked">
                    {failedCount} 张表校验未通过，同步已被阻断。
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <p className="pl-panel-title mb-0">校验摘要</p>
              {validateMutation.data && validateMutation.data.results.length > 2 && failedCount === 0 ? (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost text-xs px-2 py-0.5"
                  onClick={() => setShowValidationDetails((prev) => !prev)}
                >
                  {showValidationDetails ? "收起明细 ▲" : "展开明细 ▼"}
                </button>
              ) : null}
            </div>
            {validateMutation.isPending && !validateMutation.data ? (
              <p className="pl-notice">正在校验变更…</p>
            ) : validateMutation.data ? (
              <div className="grid gap-2">
                <div
                  className={
                    failedCount > 0
                      ? "pl-validation-banner pl-validation-banner--danger"
                      : validateMutation.data.results.length === 0
                        ? "pl-validation-banner"
                        : "pl-validation-banner pl-validation-banner--success flex items-center justify-between"
                  }
                >
                  <div className="flex items-center gap-2">
                    {failedCount === 0 && validateMutation.data.results.length > 0 ? (
                      <span className="text-success-strong font-bold">✓</span>
                    ) : null}
                    <span>
                      {failedCount > 0
                        ? `${failedCount} 张表未通过`
                        : validateMutation.data.results.length === 0
                          ? "无可校验的表变更"
                          : `${validateMutation.data.results.length} 张表全部通过`}
                    </span>
                  </div>
                </div>
                {(failedCount > 0 || showValidationDetails || validateMutation.data.results.length <= 4) &&
                  validateMutation.data.results.map((item) => (
                    <WorkbenchValidationRow
                      key={`${item.conn}/${item.schema}/${item.table}`}
                      conn={item.conn}
                      schema={item.schema}
                      table={item.table}
                      validation={item.validation}
                    />
                  ))}
              </div>
            ) : (
              <p className="pl-notice">校验结果将显示在这里。</p>
            )}
          </section>

          <details className="grid gap-2" data-testid="publish-boundary-and-index">
            <summary className="pl-panel-title cursor-pointer">索引与边界</summary>
            <div className="grid gap-3 pt-1">
              {boundaryChecklist.length > 0 ? (
                <section
                  className="grid gap-2 notranslate"
                  translate="no"
                  data-testid="review-boundary-checklist"
                >
                  <p className="text-xs text-fg-muted">边界检查</p>
                  <ul className="pl-boundary-checklist">
                    {boundaryChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="grid gap-2">
                <p className="text-xs text-fg-muted">
                  <span className="notranslate" translate="no">
                    KTX
                  </span>{" "}
                  索引结果
                </p>
                {reindexMutation.data ? (
                  <div
                    className={
                      reindexMutation.data.reindex.ok
                        ? "pl-validation-banner pl-validation-banner--success"
                        : "pl-validation-banner pl-validation-banner--danger"
                    }
                    data-testid="workbench-reindex-result"
                  >
                    {reindexMutation.data.reindex.ok
                      ? `reindex 完成，退出码 ${reindexMutation.data.reindex.exitCode}`
                      : `reindex 失败，退出码 ${reindexMutation.data.reindex.exitCode}`}
                  </div>
                ) : reindexMutation.error ? (
                  <div
                    className="pl-validation-banner pl-validation-banner--danger"
                    data-testid="workbench-reindex-error"
                  >
                    {reindexMutation.error instanceof Error
                      ? reindexMutation.error.message
                      : "reindex 失败"}
                  </div>
                ) : (
                  <p className="pl-notice text-xs">
                    同步索引并生效后结果将显示在这里；全量重建请用顶部「更多」。
                  </p>
                )}
              </section>
            </div>
          </details>

          {showPostPublishPrompt ? (
            <section className="grid gap-3" data-testid="publish-post-eval-prompt">
              <p className="pl-panel-title">
                下一步 · 触发相关 Domain 的评测{" "}
                <span className="notranslate" translate="no">
                  Run
                </span>
              </p>
              <p className="text-xs text-fg-muted">
                同步已完成{" "}
                <span className="notranslate" translate="no">
                  KTX
                </span>{" "}
                索引。建议立即触发相关 domain 的{" "}
                <span className="notranslate" translate="no">
                  eval run
                </span>
                ，确认语义变更没有引入回归。
              </p>
              <div className="flex flex-wrap gap-2">
                {postPublishEvalDomains.map((domain) => (
                  <Link
                    key={domain}
                    to={`/eval/runs?domain=${encodeURIComponent(domain)}`}
                    className="pl-btn pl-btn--secondary text-sm notranslate"
                    translate="no"
                    data-testid={`publish-post-eval-${domain}`}
                  >
                    触发 {domain} Run →
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {reindexFailed ? (
            <section className="grid gap-3" data-testid="publish-post-eval-blocked">
              <p className="pl-panel-title">下一步</p>
              <p className="text-xs text-fg-muted">
                <span className="notranslate" translate="no">
                  KTX
                </span>{" "}
                索引重建失败，请先解决索引问题后再触发 eval。
              </p>
            </section>
          ) : null}

          {(reindexFinished || reindexFailed) && !showPostPublishPrompt && !reindexFailed ? (
            <section className="grid gap-3">
              <p className="pl-panel-title">下一步</p>
              <p className="text-xs text-fg-muted">
                没有待同步变更，
                <span className="notranslate" translate="no">
                  KTX
                </span>{" "}
                索引已生效。
              </p>
            </section>
          ) : null}
        </section>
      </div>

      {detailOpen && active ? (
        <div
          className="pl-drawer-backdrop notranslate"
          data-testid="workbench-change-detail-drawer"
          role="presentation"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="pl-drawer-panel pl-drawer-panel--change-detail"
            role="dialog"
            aria-modal="true"
            aria-label="变更详情"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pl-drawer-header">
              <div className="min-w-0 grid gap-1">
                <p className="pl-panel-title mb-0">变更详情</p>
                <p className="pl-notice notranslate truncate text-sm" translate="no">
                  {active.filePath}
                </p>
                <p className="pl-notice text-xs" data-testid="workbench-file-status">
                  {fileChangeStatusLabel(active.status)}
                </p>
              </div>
              <button
                type="button"
                className="pl-btn pl-btn--ghost pl-drawer-close pl-drawer-close--prominent"
                onClick={() => setDetailOpen(false)}
                aria-label="关闭变更详情"
              >
                关闭
              </button>
            </header>
            <div className="pl-drawer-body min-h-0 flex-1 overflow-auto">
              <DiffViewer diff={active.diff || "该文件暂无可展示的补丁内容。"} />
            </div>
          </div>
        </div>
      ) : null}

      {confirmPublishOpen ? (
        <div
          className="pl-drawer-backdrop notranslate"
          data-testid="workbench-publish-confirm-drawer"
          role="presentation"
          onClick={() => setConfirmPublishOpen(false)}
        >
          <div
            className="pl-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="确认同步索引并生效"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pl-drawer-header">
              <div className="min-w-0 grid gap-1">
                <p className="pl-panel-title mb-0">确认同步索引并生效</p>
                <p className="pl-notice text-sm">
                  将同步{" "}
                  <span className="notranslate" translate="no">
                    KTX
                  </span>{" "}
                  索引，使{" "}
                  <span className="notranslate" translate="no">
                    Agent
                  </span>{" "}
                  检索到磁盘上的最新语义与 Wiki。
                </p>
              </div>
              <button
                type="button"
                className="pl-btn pl-btn--ghost pl-drawer-close pl-drawer-close--prominent"
                onClick={() => setConfirmPublishOpen(false)}
                aria-label="关闭确认同步"
              >
                关闭
              </button>
            </header>
            <div className="pl-drawer-body grid gap-3">
              <p className="text-sm" data-testid="workbench-publish-confirm-summary">
                本批一并同步 {files.length} 项
                {schemaManifests.length > 0
                  ? ` · Schema Manifest ${schemaManifests.length}`
                  : ""}
                {impactedTables.length > 0 ? ` · 表语义变更 ${impactedTables.length} 张` : ""}
                {otherChanges.length > 0 ? ` · 其它 ${otherChanges.length} 项` : ""}
              </p>
              {schemaManifests.length > 0 ? (
                <ul className="grid gap-1 text-sm">
                  {schemaManifests.slice(0, 8).map((item) => (
                    <li key={item.filePath} className="notranslate" translate="no">
                      {item.conn}/{item.schema}
                    </li>
                  ))}
                </ul>
              ) : null}
              {impactedTables.length > 0 ? (
                <ul className="grid gap-1 text-sm">
                  {impactedTables.slice(0, 8).map((tableName) => (
                    <li key={tableName} className="notranslate" translate="no">
                      {tableName}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <footer className="pl-drawer-footer">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => setConfirmPublishOpen(false)}
                disabled={reindexMutation.isPending}
              >
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary pl-btn--cta"
                onClick={submitConfirmPublish}
                disabled={reindexMutation.isPending}
                data-testid="workbench-publish-confirm-submit"
              >
                {reindexMutation.isPending ? "处理中…" : "同步索引并生效"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
