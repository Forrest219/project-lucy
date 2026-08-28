import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, FileUp, CheckCircle2, AlertCircle } from "lucide-react";
import { apiPost } from "../../lib/apiClient";

export type Step5BusinessWikiProps = {
  connectionId: string;
  onSuccess: () => void;
  onSkip: () => void;
  onBack: () => void;
};

export function Step5BusinessWiki({
  connectionId,
  onSuccess,
  onSkip,
  onBack
}: Step5BusinessWikiProps) {
  const [wikiPath, setWikiPath] = useState(`${connectionId || "business"}/指标口径说明.md`);
  const [content, setContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/wiki", {
        path: wikiPath.trim(),
        content
      }),
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWikiPath(`${connectionId || "business"}/${file.name}`);
    const reader = new FileReader();
    reader.onload = (event) => {
      setContent(String(event.target?.result || ""));
      setSaveError(null);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6" data-testid="setup-step-5">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-fg-default notranslate" translate="no">
              业务 Wiki 文档 (Markdown)
            </span>
          </div>

          <span className="text-xs text-fg-muted bg-fg-muted/10 px-2 py-0.5 rounded">
            可选步骤
          </span>
        </div>

        <div className="border-2 border-dashed border-border-default hover:border-primary/50 rounded-lg p-5 text-center bg-bg-surface transition-colors">
          <FileUp className="w-7 h-7 text-fg-muted mx-auto mb-1" />
          <p className="text-xs font-medium text-fg-default mb-1">
            拖拽或选择本地 <span translate="no" className="notranslate">.md</span> 业务文档
          </p>
          <p className="text-xs text-fg-muted mb-2 notranslate" translate="no">
            例如业务名词解释、GMV 口径定义或行业缩写说明
          </p>
          <label className="pl-btn pl-btn--outline text-xs cursor-pointer inline-block notranslate" translate="no">
            <span>选择 Markdown 文件</span>
            <input
              type="file"
              accept=".md,.markdown"
              className="hidden"
              onChange={handleFileChange}
              data-testid="setup-wiki-file-input"
            />
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              文档相对路径
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              value={wikiPath}
              onChange={(e) => setWikiPath(e.target.value)}
              data-testid="setup-wiki-path"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              或直接编写业务文档内容：
            </label>
            <textarea
              className="pl-input w-full font-mono text-xs h-32 notranslate"
              translate="no"
              placeholder={`# 核心指标口径说明\n\n- 活跃用户：近 30 天产生至少一次有效访问的用户。\n- 净收入：订单总额扣除退款与折扣。`}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setSaveError(null);
              }}
              data-testid="setup-wiki-textarea"
            />
          </div>
        </div>
      </div>

      {saveError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger flex items-start gap-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{saveError}</span>
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
            className="pl-btn pl-btn--ghost text-xs notranslate"
            translate="no"
            onClick={onSkip}
            data-testid="setup-step5-skip"
          >
            稍后在“业务 Wiki”中设置
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={content.trim().length > 0 && saveMutation.isPending}
            onClick={() => {
              if (content.trim()) {
                saveMutation.mutate();
              } else {
                onSuccess();
              }
            }}
            data-testid="setup-step5-next"
          >
            {saveMutation.isPending ? "正在保存..." : "继续：连接 AI 客户端 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
