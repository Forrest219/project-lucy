import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUp, CheckCircle2, AlertCircle, FileCode } from "lucide-react";
import { apiPost } from "../../lib/apiClient";
import type { CatalogAssetUploadResponse } from "../../lib/types";

export type Step2UploadManifestProps = {
  connectionId: string;
  schema: string;
  onSuccess: () => void;
  onSkip: () => void;
};

export function Step2UploadManifest({
  connectionId,
  schema,
  onSuccess,
  onSkip
}: Step2UploadManifestProps) {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState(`${schema || "schema"}.yaml`);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: () =>
      apiPost<CatalogAssetUploadResponse>("/api/catalog/assets", {
        connectionId,
        schema,
        assetKind: "manifest",
        filename,
        content
      }),
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      setContent(String(event.target?.result || ""));
      setUploadError(null);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6" data-testid="setup-step-2">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <div className="text-xs text-fg-muted">
            目标连接：
            <code className="text-fg-default font-semibold ml-1 notranslate" translate="no">
              {connectionId}
            </code>
            <span className="mx-2">·</span>
            目标 <span translate="no" className="notranslate">Schema</span>：
            <code className="text-fg-default font-semibold ml-1 notranslate" translate="no">
              {schema}
            </code>
          </div>
          <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded notranslate" translate="no">
            Schema Manifest
          </span>
        </div>

        <div className="border-2 border-dashed border-border-default hover:border-primary/50 rounded-lg p-6 text-center bg-bg-surface transition-colors">
          <FileUp className="w-8 h-8 text-fg-muted mx-auto mb-2" />
          <p className="text-xs font-medium text-fg-default mb-1">
            拖拽或选择本地 <span translate="no" className="notranslate">.yaml</span> 清单文件
          </p>
          <p className="text-xs text-fg-muted mb-3 notranslate" translate="no">
            通常由 ddl-export 工具生成，描述该 Schema 的表结构与字段定义
          </p>
          <label className="pl-btn pl-btn--outline text-xs cursor-pointer inline-flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5" />
            <span>选择本地 YAML 文件</span>
            <input
              type="file"
              accept=".yaml,.yml"
              className="hidden"
              onChange={handleFileChange}
              data-testid="setup-manifest-file-input"
            />
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-default mb-1">
            或直接粘贴 <span translate="no" className="notranslate">YAML</span> 内容：
          </label>
          <textarea
            className="pl-input w-full font-mono text-xs h-36 notranslate"
            translate="no"
            placeholder={`version: 1\nschema: ${schema}\ntables:\n  - name: example_table\n    columns:\n      - name: id\n        type: string`}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setUploadError(null);
            }}
            data-testid="setup-manifest-textarea"
          />
        </div>
      </div>

      {uploadError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger flex items-start gap-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{uploadError}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg border border-border-default">
        <button
          type="button"
          className="pl-btn pl-btn--ghost text-xs"
          onClick={onSkip}
          data-testid="setup-step2-skip"
        >
          稍后挂载清单（跳过）
        </button>

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          disabled={!content.trim() || uploadMutation.isPending}
          onClick={() => uploadMutation.mutate()}
          data-testid="setup-step2-next"
        >
          {uploadMutation.isPending ? "正在上传..." : "上传并继续：选择启用表 →"}
        </button>
      </div>
    </div>
  );
}
