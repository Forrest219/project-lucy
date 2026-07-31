import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import { toast } from "sonner";
import type {
  ChangedFilesResponse,
  SemanticAssetManualReindexResponse,
  ValidateChangedResponse
} from "../../lib/types";
import {
  SemanticAssetExportButton,
  SemanticAssetPublishDrawer
} from "../../components/semantic-assets";

function tableNameFromPath(filePath: string) {
  return filePath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? filePath;
}

const boundaryChecklistRules: Array<{ pattern: RegExp; prompt: string }> = [
  {
    pattern: /^webui\/src\/pages\/connections\//,
    prompt: "检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。"
  },
  {
    pattern: /^webui\/src\/components\/catalog\//,
    prompt: "检查上传文案是否明确 Schema Manifest，且目标路径由系统计算。"
  },
  {
    pattern: /^webui\/src\/pages\/TableEditor\.tsx$/,
    prompt: "检查语义层维护是否只处理业务语义和 overlay。"
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
  | { state: "pending" } // 有 pending files 但还没有 validate / 空 results / 校验未通过
  | { state: "ready" }; // pending > 0 且 validate gate 通过

function derivePublishGate(
  pendingFiles: number,
  validate: ValidateChangedResponse | null | undefined
): PublishGate {
  if (pendingFiles === 0) return { state: "empty" };
  if (!validate) return { state: "pending" };
  // Empty results is a real fail-closed case: `/api/diff` may include files
  // (e.g. wiki edits) that `/api/validate-changed` does not cover. Treat the
  // absence of validation rows the same as a failed gate so the workbench
  // never lights up the publish CTA on unvalidated files.
  if (validate.results.length === 0) return { state: "pending" };
  if (validate.results.some((row) => !row.validation.ok)) return { state: "pending" };
  return { state: "ready" };
}

export function PublishWorkbench() {
  const [selected, setSelected] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const diffQuery = useQuery({
    queryKey: queryKeys.diff,
    queryFn: () => apiGet<ChangedFilesResponse>("/api/diff")
  });
  const validateMutation = useMutation({
    mutationFn: () => apiPost<ValidateChangedResponse>("/api/validate-changed", {}),
    onSuccess: (data) => {
      const failed = data.results.filter((item) => !item.validation.ok).length;
      if (failed === 0) {
        toast.success(`校验通过：${data.results.length} 张表全部 OK`);
      } else {
        toast.error(`校验失败：${failed} / ${data.results.length} 张表未通过`);
      }
    },
    onError: (error) => {
      toast.error(`校验失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });
  const reindexMutation = useMutation({
    mutationFn: () => apiPost<SemanticAssetManualReindexResponse>("/api/semantic-assets/reindex", { force: false }),
    onSuccess: (data) => {
      if (data.reindex.ok) {
        toast.success("KTX 索引重建完成");
      } else {
        toast.error(`KTX 索引重建失败：exit ${data.reindex.exitCode}`);
      }
    },
    onError: (error) => {
      toast.error(`KTX 索引重建失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const files = diffQuery.data?.files ?? [];
  const boundaryChecklist = boundaryChecklistForChangedFiles(files.map((file) => file.filePath));
  const active = files.find((file) => file.filePath === (selected ?? files[0]?.filePath));
  const failedCount = validateMutation.data?.results.filter((item) => !item.validation.ok).length ?? 0;
  const publishGate = derivePublishGate(files.length, validateMutation.data);
  function validationForFile(filePath: string) {
    const tableName = tableNameFromPath(filePath);
    return validateMutation.data?.results.find((item) => item.table === tableName)?.validation;
  }

  const publishCtaDisabled = publishGate.state !== "ready";
  const publishCtaLabel =
    reindexMutation.isPending || validateMutation.isPending
      ? "处理中…"
      : "发布并重建索引";

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="发布工作台"
        breadcrumbs={["语义发布", "发布工作台"]}
        description="查看并发布当前待生效的语义资产，系统将在发布后自动重建 KTX 索引。"
        badges={
          <>
            <span data-testid="workbench-pending-count">
              {files.length > 0
                ? `${files.length} 个待发布文件`
                : "暂无待发布变更"}
            </span>
            {validateMutation.data ? (
              <span>
                {failedCount > 0
                  ? `校验失败 ${failedCount} 张`
                  : `校验通过 ${validateMutation.data.results.length} 张`}
              </span>
            ) : null}
          </>
        }
        actions={
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
              className="pl-btn pl-btn--secondary"
              onClick={() => reindexMutation.mutate()}
              disabled={reindexMutation.isPending}
              data-testid="workbench-reindex"
            >
              {reindexMutation.isPending ? "重建中…" : "强制重建索引"}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => setPublishOpen(true)}
              data-testid="workbench-upload-semantic-asset"
            >
              上传语义资产
            </button>
            <button
              type="button"
              className={clsx(
                "pl-btn",
                publishGate.state === "ready" ? "pl-btn--primary" : "pl-btn--secondary",
                publishGate.state === "ready" && "pl-btn--cta"
              )}
              onClick={() => setPublishOpen(true)}
              disabled={publishCtaDisabled}
              data-testid="workbench-publish-and-reindex"
              data-gate={publishGate.state}
              aria-disabled={publishCtaDisabled}
            >
              {publishCtaLabel}
            </button>
            <Link className="pl-btn pl-btn--ghost" to="/">
              表目录
            </Link>
            <SemanticAssetExportButton
              label="导出当前快照 (.zip)"
              variant="ghost"
              testId="workbench-export-snapshot"
            />
          </>
        }
      />

      <div className="pl-review-layout" data-testid="publish-workbench-layout">
        <aside className="pl-review-sidebar">
          <p className="pl-panel-title mb-2">待发布变更</p>
          {diffQuery.isLoading ? <p className="pl-notice">正在加载变更…</p> : null}
          {diffQuery.error ? (
            <p className="pl-error">
              变更加载失败：
              {diffQuery.error instanceof Error ? diffQuery.error.message : "未知错误"}
            </p>
          ) : null}
          {files.length === 0 && !diffQuery.isLoading ? (
            <div className="pl-notice" data-testid="workbench-empty-state">
              <p className="font-medium">暂无待发布变更</p>
              <p className="mt-1">
                你仍可以上传语义资产，或在已有 YAML 由 CLI / Git 更新后强制重建索引。
              </p>
            </div>
          ) : null}
          <div className="pl-file-list">
            {files.map((file) => (
              <button
                className={clsx(
                  "pl-file-button",
                  active?.filePath === file.filePath && "pl-file-button--active"
                )}
                key={file.filePath}
                type="button"
                onClick={() => setSelected(file.filePath)}
              >
                <span>{file.status}</span>
                <span className="truncate">{file.filePath}</span>
                {validationForFile(file.filePath)?.ok === false ? (
                  <small>校验失败</small>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        <section className="pl-review-main">
          <div className="pl-review-main-header">
            <p className="pl-panel-title mb-1">{active?.filePath ?? "变更详情"}</p>
            <p className="pl-notice">
              {active ? `状态：${active.status}` : "请选择左侧文件查看 diff。"}
            </p>
          </div>
          <DiffViewer diff={active?.diff || "该文件暂无可展示的补丁内容。"} />
        </section>

        <aside className="pl-review-sidebar">
          {boundaryChecklist.length > 0 ? (
            <section
              className="grid gap-3 notranslate"
              translate="no"
              data-testid="review-boundary-checklist"
            >
              <p className="pl-panel-title">边界检查</p>
              <ul className="pl-boundary-checklist">
                {boundaryChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-3">
            <p className="pl-panel-title">校验变更</p>
            {validateMutation.data ? (
              <div className="grid gap-2">
                <div
                  className={
                    failedCount > 0
                      ? "pl-validation-banner pl-validation-banner--danger"
                      : "pl-validation-banner pl-validation-banner--success"
                  }
                >
                  {failedCount > 0
                    ? `${failedCount} 张表未通过`
                    : `${validateMutation.data.results.length} 张表全部通过`}
                </div>
                {validateMutation.data.results.map((item) => (
                  <div
                    className={clsx(
                      "pl-validation-row",
                      item.validation.ok
                        ? "pl-validation-row--ok"
                        : "pl-validation-row--failed"
                    )}
                    key={`${item.conn}/${item.schema}/${item.table}`}
                  >
                    <div>
                      <strong>{item.conn}/{item.schema}/{item.table}</strong>
                      <span>退出码 {item.validation.exitCode}</span>
                    </div>
                    <span>{item.validation.ok ? "OK" : "FAIL"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pl-notice">对本次服务会话中保存过的表运行校验。</p>
            )}
          </section>

          <section className="grid gap-3">
            <p className="pl-panel-title">KTX 索引</p>
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
              <p className="pl-notice">让 Agent / MCP 检索读取最新语义资产。</p>
            )}
          </section>

          <section className="grid gap-3">
            <p className="pl-panel-title">建议命令</p>
            <pre className="pl-yaml-preview">git diff{"\n"}git status --short</pre>
          </section>
        </aside>
      </div>
      <SemanticAssetPublishDrawer
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
      />
    </div>
  );
}
