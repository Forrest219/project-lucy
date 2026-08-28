import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Copy, Check, Terminal, ExternalLink, Sparkles, CheckCircle2 } from "lucide-react";
import { apiGet } from "../../lib/apiClient";
import { buildClientConfigs, buildHelloWorldPrompt, type ClientType } from "../../lib/setupAssistant";
import type { ProjectInfo } from "../../lib/types";

export type Step6ConnectAgentProps = {
  connectionId: string;
  defaultTable?: string;
  onFinish: () => void;
};

export function Step6ConnectAgent({
  connectionId,
  defaultTable,
  onFinish
}: Step6ConnectAgentProps) {
  const [activeTab, setActiveTab] = useState<ClientType>("cursor");
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const { data: projectData } = useQuery({
    queryKey: ["project"],
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });

  const endpointUrl = projectData?.mcpEndpoint?.url || "http://127.0.0.1:7879/mcp";
  const configs = buildClientConfigs(endpointUrl, "<YOUR_LUCY_AGENT_TOKEN>", connectionId);
  const currentConfig = configs[activeTab];
  const helloPrompt = buildHelloWorldPrompt(connectionId, defaultTable);

  const copyToClipboard = async (text: string, isPrompt = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isPrompt) {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
      } else {
        setCopiedSnippet(true);
        setTimeout(() => setCopiedSnippet(false), 2000);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-6" data-testid="setup-step-6">
      <div className="p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
        <div className="text-xs">
          <span className="font-semibold text-fg-default">
            数据库 <span className="notranslate" translate="no">{connectionId}</span> 已接入就绪！
          </span>
          <p className="text-fg-muted mt-0.5 notranslate" translate="no">
            Schema Manifest 与语义资产已完成索引同步，随时可接受 AI 问答。
          </p>
        </div>
      </div>

      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg-default notranslate" translate="no">
            选择您的 AI 客户端配置 MCP：
          </span>
          <div className="flex gap-1 bg-bg-surface p-1 rounded border border-border-default">
            {(["cursor", "claude_code", "codex", "json"] as ClientType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={`text-xs py-1 px-2.5 rounded transition-colors notranslate ${
                  activeTab === type
                    ? "bg-primary text-white font-medium shadow-sm"
                    : "text-fg-muted hover:text-fg-default hover:bg-bg-subtle"
                }`}
                translate="no"
                onClick={() => setActiveTab(type)}
                data-testid={`setup-mcp-tab-${type}`}
              >
                {configs[type].label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span className="notranslate" translate="no">{currentConfig.filenameHint}</span>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs py-1 px-2 flex items-center gap-1 text-primary hover:text-primary-hover"
              onClick={() => copyToClipboard(currentConfig.snippet, false)}
              data-testid="setup-copy-config-btn"
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSnippet ? "已复制配置" : "复制配置"}</span>
            </button>
          </div>

          <pre className="p-3 bg-bg-surface rounded border border-border-default font-mono text-xs overflow-x-auto text-fg-default max-h-40 notranslate" translate="no">
            <code>{currentConfig.snippet}</code>
          </pre>
        </div>

        <div className="pt-3 border-t border-border-default space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg-default">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>体验您的第一条问答 (Hello World)：</span>
            </div>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs py-1 px-2 flex items-center gap-1 text-primary hover:text-primary-hover"
              onClick={() => copyToClipboard(helloPrompt, true)}
              data-testid="setup-copy-prompt-btn"
            >
              {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedPrompt ? "已复制提示词" : "复制提示词"}</span>
            </button>
          </div>

          <div className="p-3 bg-bg-surface rounded border border-border-default text-xs text-fg-default flex items-center justify-between">
            <span className="notranslate" translate="no">{helloPrompt}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg border border-border-default">
        <Link
          to="/admin/mcp-playground"
          className="pl-btn pl-btn--outline text-xs flex items-center gap-1.5 notranslate"
          translate="no"
          onClick={onFinish}
          data-testid="setup-goto-playground"
        >
          <span className="notranslate" translate="no">在 MCP 调试台中体验</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          onClick={onFinish}
          data-testid="setup-finish-btn"
        >
          完成并进入控制台
        </button>
      </div>
    </div>
  );
}
