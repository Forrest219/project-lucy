import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Layers, FileUp, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { apiPost } from "../../lib/apiClient";
import type { CatalogAssetUploadResponse } from "../../lib/types";

export type Step4SemanticOverlayProps = {
  connectionId: string;
  enabledTables: string[];
  onSuccess: () => void;
  onSkip: () => void;
  onBack: () => void;
};

export function Step4SemanticOverlay({
  connectionId,
  enabledTables,
  onSuccess,
  onSkip,
  onBack
}: Step4SemanticOverlayProps) {
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [selectedTable, setSelectedTable] = useState<string>(enabledTables[0] || "");
  const [customYaml, setCustomYaml] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: () => {
      const pureTable = selectedTable.includes(".") ? selectedTable.split(".").pop()! : selectedTable;
      return apiPost<CatalogAssetUploadResponse>("/api/catalog/assets", {
        connectionId,
        table: pureTable,
        assetKind: "semantic_overlay",
        filename: `${pureTable}.yaml`,
        content: customYaml
      });
    },
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
    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomYaml(String(event.target?.result || ""));
      setUploadError(null);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6" data-testid="setup-step-4">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-fg-default">配置模式：</span>
            <div className="flex gap-2">
              <button
                type="button"
                className={`py-1 px-3 text-xs rounded border transition-colors ${
                  mode === "auto"
                    ? "bg-bg-surface border-primary text-primary font-medium"
                    : "border-border-default text-fg-muted"
                }`}
                onClick={() => setMode("auto")}
                data-testid="setup-overlay-mode-auto"
              >
                极简模式（一键采用默认指标）
              </button>
              <button
                type="button"
                className={`py-1 px-3 text-xs rounded border transition-colors notranslate ${
                  mode === "custom"
                    ? "bg-bg-surface border-primary text-primary font-medium"
                    : "border-border-default text-fg-muted"
                }`}
                translate="no"
                onClick={() => setMode("custom")}
                data-testid="setup-overlay-mode-custom"
              >
                高级模式（上传 Table YAML）
              </button>
            </div>
          </div>

          <span className="text-xs text-fg-muted bg-fg-muted/10 px-2 py-0.5 rounded">
            可选步骤
          </span>
        </div>

        {mode === "auto" ? (
          <div className="p-6 bg-bg-surface rounded-lg border border-border-default text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-fg-default">默认业务指标已就绪</h4>
              <p className="text-xs text-fg-muted max-w-md mx-auto mt-1 notranslate" translate="no">
                系统已为选中的 {enabledTables.length} 张数据表自动生成基础聚合统计与维度映射。您可随时在「语义资产」控制台中进行二次深度建模。
              </p>
            </div>
            <div className="flex justify-center gap-2 text-xs text-success-strong">
              <CheckCircle2 className="w-4 h-4" />
              <span>零配置即可直接开启数据问答</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg-default mb-1">
                目标数据表
              </label>
              <select
                className="pl-input w-full notranslate"
                translate="no"
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                data-testid="setup-overlay-table-select"
              >
                {enabledTables.map((t) => (
                  <option key={t} value={t} className="notranslate" translate="no">
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="border border-dashed border-border-default rounded-lg p-4 text-center bg-bg-surface">
              <FileUp className="w-6 h-6 text-fg-muted mx-auto mb-1" />
              <p className="text-xs text-fg-default mb-2">选择单表语义 Overlay 文件</p>
              <label className="pl-btn pl-btn--outline text-xs cursor-pointer inline-block notranslate" translate="no">
                <span className="notranslate" translate="no">浏览 .yaml 文件</span>
                <input
                  type="file"
                  accept=".yaml,.yml"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-default mb-1 notranslate" translate="no">
                或直接编辑 Table YAML：
              </label>
              <textarea
                className="pl-input w-full font-mono text-xs h-32 notranslate"
                translate="no"
                placeholder={`measures:\n  - name: total_count\n    expr: count(*)\n    description: 总记录数`}
                value={customYaml}
                onChange={(e) => {
                  setCustomYaml(e.target.value);
                  setUploadError(null);
                }}
                data-testid="setup-overlay-textarea"
              />
            </div>
          </div>
        )}
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
          onClick={onBack}
        >
          ← 上一步
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            onClick={onSkip}
            data-testid="setup-step4-skip"
          >
            跳过此步
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            onClick={() => {
              if (mode === "custom" && customYaml.trim()) {
                uploadMutation.mutate();
              } else {
                onSuccess();
              }
            }}
            disabled={mode === "custom" && customYaml.trim().length > 0 && uploadMutation.isPending}
            data-testid="setup-step4-next"
          >
            {uploadMutation.isPending ? "正在保存..." : "继续：注入业务知识 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
