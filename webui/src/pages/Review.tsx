import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../components/DiffViewer";
import { apiGet, apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type { ChangedFilesResponse, ValidateChangedResponse } from "../lib/types";

export function Review() {
  const [selected, setSelected] = useState<string | null>(null);
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
  const active = files.find((file) => file.filePath === (selected ?? files[0]?.filePath));

  return (
    <section className="pl-panel">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">审阅与校验</p>
          <h1 className="text-xl font-semibold">变更审阅与校验</h1>
        </div>
        <Link className="pl-btn pl-btn--ghost" to="/">表目录</Link>
      </div>
      <p className="pl-page-intro">集中查看本次可编辑目录中的文件变更，并对本次保存过的语义对象运行校验。</p>

      <div className="pl-review-layout">
        <aside className="pl-panel">
          <h2 className="pl-panel-title">文件</h2>
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
              </button>
            ))}
          </div>
        </aside>

        <div className="grid gap-4">
          <section className="pl-panel">
            <div className="flex items-center justify-between mb-3">
              <h2 className="pl-panel-title">校验</h2>
              <button type="button" className="pl-btn pl-btn--primary" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
                校验本次变更
              </button>
            </div>
            {validateMutation.data ? (
              <div className="grid gap-2">
                {validateMutation.data.results.map((item) => (
                  <div className={clsx("flex items-center justify-between rounded-md border px-3 py-2 text-sm", item.validation.ok ? "border-border-default bg-bg-surface" : "border-[#fecaca] bg-[#fef2f2]")} key={`${item.conn}/${item.schema}/${item.table}`}>
                    <strong>{item.conn}/{item.schema}/{item.table}</strong>
                    <span className="text-fg-muted">退出码 {item.validation.exitCode}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pl-notice">对本次服务会话中保存过的表运行校验。</p>
            )}
            </section>

          <section className="pl-panel">
            <h2 className="pl-panel-title">{active?.filePath ?? "变更详情"}</h2>
            <DiffViewer diff={active?.diff || "该文件暂无可展示的补丁内容。"} />
          </section>

          <section className="pl-panel">
            <h2 className="pl-panel-title">建议命令</h2>
            <pre className="pl-yaml-preview">git diff{"\n"}git status --short</pre>
          </section>
        </div>
      </div>
    </section>
  );
}