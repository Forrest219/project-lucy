import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../components/DiffViewer";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type { ChangedFilesResponse, ValidateChangedResponse } from "../lib/types";
import { SemanticAssetExportButton, SemanticAssetPublishDrawer } from "../components/semantic-assets";

function tableNameFromPath(filePath: string) {
  return filePath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? filePath;
}

export function Review() {
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

  const files = diffQuery.data?.files ?? [];
  const semanticLayerChanges = files.filter((f) => f.filePath.startsWith("semantic-layer/"));
  const active = files.find((file) => file.filePath === (selected ?? files[0]?.filePath));
  const failedCount = validateMutation.data?.results.filter((item) => !item.validation.ok).length ?? 0;
  function validationForFile(filePath: string) {
    const tableName = tableNameFromPath(filePath);
    return validateMutation.data?.results.find((item) => item.table === tableName)?.validation;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="变更审阅与校验"
        breadcrumbs={["审阅与校验", "变更审阅"]}
        description="集中查看可编辑目录中的文件变更，并对本次保存过的语义对象运行校验。WebUI 不执行 git commit。"
        badges={
          <>
            <span>{files.length} 个待审阅文件</span>
            {validateMutation.data ? (
              <span>{failedCount > 0 ? `校验失败 ${failedCount} 张` : `校验通过 ${validateMutation.data.results.length} 张`}</span>
            ) : null}
          </>
        }
        actions={
          <>
            <button type="button" className="pl-btn pl-btn--primary" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
              {validateMutation.isPending ? "校验中..." : "Validate changed"}
            </button>
            {semanticLayerChanges.length > 0 ? (
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => setPublishOpen(true)}
                data-testid="review-publish-and-reindex"
              >
                发布并 reindex
              </button>
            ) : null}
            <Link className="pl-btn pl-btn--secondary" to="/">表目录</Link>
          </>
        }
      />

      <div className="pl-review-layout">
        <aside className="pl-review-sidebar">
          <p className="pl-panel-title mb-2">文件</p>
          {diffQuery.isLoading ? <p className="pl-notice">正在加载变更...</p> : null}
          {diffQuery.error ? <p className="pl-error">变更加载失败：{diffQuery.error instanceof Error ? diffQuery.error.message : "未知错误"}</p> : null}
          {files.length === 0 && !diffQuery.isLoading ? <p className="pl-notice">可编辑目录中暂无变更文件。</p> : null}
          <div className="pl-file-list">
            {files.map((file) => (
              <button
                className={clsx("pl-file-button", active?.filePath === file.filePath && "pl-file-button--active")}
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
            <p className="pl-notice">{active ? `状态：${active.status}` : "请选择左侧文件查看 diff。"}</p>
          </div>
          <DiffViewer diff={active?.diff || "该文件暂无可展示的补丁内容。"} />
        </section>

        <aside className="pl-review-sidebar">
          <section className="grid gap-3">
            <p className="pl-panel-title">Validate changed</p>
            {validateMutation.data ? (
              <div className="grid gap-2">
                <div className={failedCount > 0 ? "pl-validation-banner pl-validation-banner--danger" : "pl-validation-banner pl-validation-banner--success"}>
                  {failedCount > 0 ? `${failedCount} 张表未通过` : `${validateMutation.data.results.length} 张表全部通过`}
                </div>
                {validateMutation.data.results.map((item) => (
                  <div className={clsx("pl-validation-row", item.validation.ok ? "pl-validation-row--ok" : "pl-validation-row--failed")} key={`${item.conn}/${item.schema}/${item.table}`}>
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
            <p className="pl-panel-title">建议命令</p>
            <pre className="pl-yaml-preview">git diff{"\n"}git status --short</pre>
          </section>
        </aside>
      </div>
    </div>
  );
}
