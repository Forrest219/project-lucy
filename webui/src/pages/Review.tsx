import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../components/DiffViewer";
import { apiGet, apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { ChangedFilesResponse, ValidateChangedResponse } from "../lib/types";

export function Review() {
  const [selected, setSelected] = useState<string | null>(null);
  const diffQuery = useQuery({
    queryKey: queryKeys.diff,
    queryFn: () => apiGet<ChangedFilesResponse>("/api/diff")
  });
  const validateMutation = useMutation({
    mutationFn: () => apiPost<ValidateChangedResponse>("/api/validate-changed", {})
  });

  const files = diffQuery.data?.files ?? [];
  const active = files.find((file) => file.filePath === (selected ?? files[0]?.filePath));

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">审阅与校验</p>
          <h1>变更审阅与校验</h1>
        </div>
        <Link className="back-link" to="/">表目录</Link>
      </div>
      <p className="page-intro">集中查看本次可编辑目录中的文件变更，并对本次保存过的语义对象运行校验。</p>

      <div className="review-layout">
        <aside className="read-panel review-list">
          <h2>文件</h2>
          {diffQuery.isLoading ? <p className="notice">正在加载变更...</p> : null}
          {diffQuery.error ? <p className="error">{diffQuery.error instanceof Error ? diffQuery.error.message : "变更加载失败"}</p> : null}
          {files.length === 0 && !diffQuery.isLoading ? <p className="notice">可编辑目录中暂无变更文件。</p> : null}
          {files.map((file) => (
            <button
              className={active?.filePath === file.filePath ? "file-button active" : "file-button"}
              key={file.filePath}
              type="button"
              onClick={() => setSelected(file.filePath)}
            >
              <span>{file.status}</span>
              {file.filePath}
            </button>
          ))}
        </aside>

        <div className="review-detail">
          <section className="read-panel">
            <div className="review-actions">
              <h2>校验</h2>
              <button type="button" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
                校验本次变更
              </button>
            </div>
            {validateMutation.data ? (
              <div className="validation-list">
                {validateMutation.data.results.map((item) => (
                  <div className={item.validation.ok ? "validation-row ok" : "validation-row failed"} key={`${item.conn}/${item.schema}/${item.table}`}>
                    <strong>{item.conn}/{item.schema}/{item.table}</strong>
                    <span>退出码 {item.validation.exitCode}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="notice">对本次服务会话中保存过的表运行校验。</p>
            )}
            {validateMutation.error ? <p className="error">{validateMutation.error instanceof Error ? validateMutation.error.message : "校验失败"}</p> : null}
          </section>

          <section className="read-panel">
            <h2>{active?.filePath ?? "变更详情"}</h2>
            <DiffViewer diff={active?.diff || "该文件暂无可展示的补丁内容。"} />
          </section>

          <section className="read-panel">
            <h2>建议命令</h2>
            <pre className="command-list">git diff{"\n"}git status --short</pre>
          </section>
        </div>
      </div>
    </section>
  );
}
