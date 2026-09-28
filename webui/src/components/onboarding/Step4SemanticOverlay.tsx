import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";

export type Step4SemanticOverlayProps = {
  connectionId: string;
  enabledTables: string[];
  onSuccess: () => void;
  onBack: () => void;
};

export function Step4SemanticOverlay({
  connectionId,
  enabledTables,
  onSuccess,
  onBack
}: Step4SemanticOverlayProps) {
  const hasEnabledTables = enabledTables.length > 0;

  return (
    <div className="space-y-6" data-testid="setup-step-4">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <span className="text-xs font-semibold text-fg-default">暂不补充业务语义</span>
          <span className="text-xs text-fg-muted bg-fg-muted/10 px-2 py-0.5 rounded">
            可选步骤
          </span>
        </div>

        <div className="p-6 bg-bg-surface rounded-lg border border-border-default text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-fg-default">暂不补充业务语义，使用数据库字段信息继续</h4>
            <p className="text-xs text-fg-muted max-w-md mx-auto mt-1 notranslate" translate="no">
              当前选中 {enabledTables.length} 张数据表。此操作不会生成未经确认的业务指标；您可稍后在「语义资产」中补充指标、维度与关联关系。
            </p>
          </div>
          <p className="text-xs text-fg-muted max-w-md mx-auto" data-testid="setup-step4-overlay-guidance">
            单表请在表详情导入 YAML。多文件请上传语义资产。本步不写入
            <span className="notranslate" translate="no"> semantic overlay</span>
            ，字段仍来自
            <span className="notranslate" translate="no"> Schema Manifest</span>
            。路径：
            <code className="notranslate" translate="no">
              semantic-layer/{connectionId}/&lt;table&gt;.yaml
            </code>
          </p>
          <div className="flex justify-center gap-2 text-xs text-success-strong">
            <CheckCircle2 className="w-4 h-4" />
            <span>数据库字段信息可用于后续运行时检查</span>
          </div>
        </div>
      </div>

      {!hasEnabledTables ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger flex items-start gap-2" role="alert" data-testid="setup-step4-table-guard">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>尚未启用任何数据表。请返回上一步至少选择一张表。</span>
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

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          onClick={() => {
            if (hasEnabledTables) onSuccess();
          }}
          disabled={!hasEnabledTables}
          data-testid="setup-step4-next"
        >
          暂不补充业务语义，使用数据库字段信息继续
        </button>
      </div>
    </div>
  );
}
