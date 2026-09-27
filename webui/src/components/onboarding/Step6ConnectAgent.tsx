import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Copy, Check, ExternalLink, Sparkles, CheckCircle2, Key, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import {
  buildClientConfigs,
  buildHelloWorldPrompt,
  deriveSetupReadiness,
  type ClientType
} from "../../lib/setupAssistant";
import { queryKeys } from "../../lib/queryKeys";
import type {
  Agent,
  ConnectionTestResult,
  CreateTokenResponse,
  McpRuntimeStatus,
  ProjectInfo,
  SourcesResponse
} from "../../lib/types";

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
  const [copiedToken, setCopiedToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<CreateTokenResponse | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [broadScopeAcknowledged, setBroadScopeAcknowledged] = useState(false);

  const { data: projectData } = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const runtimeQuery = useQuery({
    queryKey: queryKeys.mcpRuntime,
    queryFn: () => apiGet<McpRuntimeStatus>("/api/admin/mcp-runtime/status")
  });

  const healthQuery = useQuery({
    queryKey: queryKeys.connectionHealth(connectionId),
    queryFn: () =>
      apiPost<ConnectionTestResult>(
        `/api/connections/${encodeURIComponent(connectionId)}/test`,
        {}
      ),
    enabled: Boolean(connectionId),
    retry: false
  });

  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<{ agents: Agent[] }>("/api/admin/agents")
  });

  const agents = agentsQuery.data?.agents ?? [];

  const defaultAgent = useMemo(() => {
    if (agents.length === 0) return null;
    const enabledAgent = agents.find(
      (a) => a.enabled !== false && a.role?.toLowerCase() !== "admin" && !a.id.toLowerCase().includes("admin")
    );
    return enabledAgent || agents[0];
  }, [agents]);

  const activeAgentId = selectedAgentId || defaultAgent?.id || (agents[0]?.id ?? "");
  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;
  const hasBroadScope = Boolean(
    activeAgent &&
      (activeAgent.role?.toLowerCase() === "admin" ||
        activeAgent.id.toLowerCase().includes("admin") ||
        activeAgent.allow?.tables?.includes("*") ||
        activeAgent.allow?.tools?.includes("*"))
  );

  const tokenMutation = useMutation({
    mutationFn: (agentId: string) => {
      const randomSuffix = Math.random().toString(36).slice(2, 6);
      const label = `onboard-${connectionId || "admin"}-${randomSuffix}`;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return apiPost<CreateTokenResponse>(`/api/admin/agents/${encodeURIComponent(agentId)}/tokens`, {
        label,
        device_name: "接入向导体验",
        expires_at: expiresAt
      });
    },
    onSuccess: (data) => {
      setGeneratedToken(data);
      toast.success("体验 Token 已签发，并自动注入下方配置。");
    },
    onError: (err: Error) => {
      toast.error(`生成 Token 失败: ${err.message}`);
    }
  });

  const handleGenerateToken = () => {
    if (!activeAgentId) {
      toast.error("未找到可用的 Agent，请先在 Agent 管理中创建");
      return;
    }
    if (hasBroadScope && !broadScopeAcknowledged) {
      toast.error("请先确认该 Agent 的高权限范围。");
      return;
    }
    tokenMutation.mutate(activeAgentId);
  };

  const endpointInfo = projectData?.mcpEndpoint;
  // Only consume the backend Advertise URL. Never invent localhost / 127.0.0.1.
  const endpointUrl = endpointInfo?.url ?? "";
  const activeToken = generatedToken?.token || "<YOUR_LUCY_AGENT_TOKEN>";
  const configs = buildClientConfigs(endpointUrl, activeToken, connectionId);
  const currentConfig = configs[activeTab];
  const helloPrompt = buildHelloWorldPrompt(connectionId, defaultTable);
  const endpointFallback = endpointInfo?.status === "fallback";
  const endpointInvalid = endpointInfo?.status === "invalid" || (!endpointUrl && Boolean(projectData));
  const connection = projectData?.connections.find((item) => item.id === connectionId) ?? null;
  const probeStatus = healthQuery.isLoading
    ? "pending"
    : healthQuery.data?.status ?? "unknown";
  const readiness = deriveSetupReadiness({
    connection,
    sources: sourcesQuery.data,
    runtime: runtimeQuery.data,
    probeStatus,
    endpointReady: Boolean(endpointUrl) && !endpointInvalid && !endpointFallback,
    credentialReady: Boolean(generatedToken)
  });

  const copyToClipboard = async (text: string, isPrompt = false, isToken = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isPrompt) {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
      } else if (isToken) {
        setCopiedToken(true);
        toast.success("已复制 Token 明文");
        setTimeout(() => setCopiedToken(false), 2000);
      } else {
        setCopiedSnippet(true);
        if (!generatedToken) {
          toast.info("已复制配置（当前包含占位符，可点击上方「一键签发」获取真实 Token）");
        } else {
          toast.success("已复制即用 MCP 配置");
        }
        setTimeout(() => setCopiedSnippet(false), 2000);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-6" data-testid="setup-step-6">
      <div
        className={`p-4 rounded-lg flex items-start gap-3 border ${
          readiness.serviceReady
            ? "bg-success/10 border-success/30"
            : "bg-warning/10 border-warning/30"
        }`}
        role={readiness.serviceReady ? "status" : "alert"}
        data-testid="setup-readiness-summary"
      >
        {readiness.serviceReady ? (
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
        ) : (
          <RefreshCw className={`w-5 h-5 text-warning shrink-0 ${healthQuery.isLoading ? "animate-spin" : ""}`} />
        )}
        <div className="text-xs">
          <span className="font-semibold text-fg-default">
            {readiness.serviceReady ? (
              <>数据库 <span className="notranslate" translate="no">{connectionId}</span> 的服务链路已就绪</>
            ) : (
              <>数据库 <span className="notranslate" translate="no">{connectionId}</span> 尚未完成运行时检查</>
            )}
          </span>
          {readiness.serviceReady ? (
            <p className="text-fg-muted mt-0.5">服务端已可用；签发凭据后即可完成客户端接入。</p>
          ) : (
            <ul className="text-fg-muted mt-1 space-y-0.5 list-disc list-inside" data-testid="setup-readiness-issues">
              {readiness.issues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Admin Token Section */}
      <div
        className="bg-bg-subtle p-4 rounded-lg border border-border-default space-y-3"
        data-testid="setup-token-card"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-fg-default notranslate" translate="no">
              MCP 客户端凭据 (Bearer Token)
            </span>
          </div>
          {generatedToken ? (
            <span
              className="text-[11px] bg-success/15 text-success font-medium px-2 py-0.5 rounded-full notranslate"
              translate="no"
            >
              ✓ Token 已注入
            </span>
          ) : (
            <span
              className="text-[11px] bg-warning/15 text-warning font-medium px-2 py-0.5 rounded-full notranslate"
              translate="no"
            >
              待签发
            </span>
          )}
        </div>

        {generatedToken ? (
          <div className="space-y-3 bg-bg-surface p-3.5 rounded border border-success/30">
            <div className="flex items-center justify-between text-xs">
              <span className="text-fg-muted notranslate" translate="no">
                已为 <span className="font-semibold text-fg-default notranslate" translate="no">{activeAgentId}</span> 签发体验 Token
                {generatedToken.expires_at ? `（有效期至 ${generatedToken.expires_at}）` : ""}：
              </span>
              <button
                type="button"
                className="text-xs text-primary hover:text-primary-hover flex items-center gap-1 disabled:opacity-50"
                onClick={handleGenerateToken}
                disabled={tokenMutation.isPending || !activeAgentId}
                data-testid="setup-regenerate-token-btn"
              >
                <RefreshCw className={`w-3 h-3 ${tokenMutation.isPending ? "animate-spin" : ""}`} />
                <span>重新生成</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <code
                className="flex-1 font-mono text-xs bg-bg-muted rounded px-2.5 py-2 break-all select-all text-fg-default notranslate"
                translate="no"
                data-testid="setup-active-token"
              >
                {generatedToken.token}
              </code>
              <button
                type="button"
                className="pl-btn pl-btn--ghost text-xs py-1.5 px-2.5 shrink-0 flex items-center gap-1 text-primary notranslate"
                translate="no"
                onClick={() => copyToClipboard(generatedToken.token, false, true)}
                data-testid="setup-copy-token-btn"
              >
                {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="notranslate" translate="no">{copiedToken ? "已复制" : "复制 Token"}</span>
              </button>
            </div>

            <p className="text-[11px] text-success flex items-center gap-1 notranslate" translate="no">
              <Check className="w-3.5 h-3.5" />
              <span className="notranslate" translate="no">真实 Token 已自动替换下方所有客户端配置中的占位符，可直接复制配置使用。</span>
            </p>
          </div>
        ) : (
          <div className="bg-bg-surface p-3.5 rounded border border-border-default space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs text-fg-default font-medium notranslate" translate="no">
                  签发短期体验 Token
                </p>
                <p className="text-[11px] text-fg-muted notranslate" translate="no">
                  凭据继承所选 Agent 的 Role 与数据范围。默认有效期 7 天，请遵循最小权限原则。
                </p>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <select
                    className="pl-input text-xs py-1 px-2 h-8 notranslate"
                    translate="no"
                    value={activeAgentId}
                    onChange={(e) => {
                      setSelectedAgentId(e.target.value);
                      setBroadScopeAcknowledged(false);
                    }}
                    aria-label="选择所属 Agent"
                    data-testid="setup-agent-select"
                    disabled={agents.length === 0}
                  >
                    {agents.length === 0 ? <option value="" className="notranslate" translate="no">暂无可用 Agent</option> : null}
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id} className="notranslate" translate="no">
                        {ag.name || ag.id} ({ag.role || "未绑定 Role"})
                      </option>
                    ))}
                  </select>

                  <select
                    className="pl-input text-xs py-1 px-2 h-8 notranslate"
                    translate="no"
                    value={expiresInDays}
                    onChange={(event) => setExpiresInDays(Number(event.target.value))}
                    aria-label="Token 有效期"
                    data-testid="setup-token-expiry"
                  >
                    <option value={1}>1 天</option>
                    <option value={7}>7 天</option>
                    <option value={30}>30 天</option>
                  </select>

                  <button
                    type="button"
                    className="pl-btn pl-btn--primary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0 notranslate"
                    translate="no"
                    onClick={handleGenerateToken}
                    disabled={tokenMutation.isPending || !activeAgentId || (hasBroadScope && !broadScopeAcknowledged)}
                    data-testid="setup-generate-token-btn"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${tokenMutation.isPending ? "animate-spin" : ""}`} />
                    <span className="notranslate" translate="no">{tokenMutation.isPending ? "签发中..." : "签发体验 Token"}</span>
                  </button>
                </div>
                {activeAgent ? (
                  <p className="text-[11px] text-fg-muted">
                    当前 Role：<span className="font-medium text-fg-default notranslate" translate="no">{activeAgent.role || "未绑定"}</span>
                  </p>
                ) : null}
              </div>
            </div>
            {hasBroadScope ? (
              <label className="flex items-start gap-2 p-2.5 rounded border border-warning/40 bg-warning/10 text-xs text-fg-default">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={broadScopeAcknowledged}
                  onChange={(event) => setBroadScopeAcknowledged(event.target.checked)}
                  data-testid="setup-token-broad-ack"
                />
                <span className="notranslate" translate="no">该 Agent 具有管理员或通配权限。我已确认这是本次体验所需的最小权限范围。</span>
              </label>
            ) : null}
          </div>
        )}
      </div>

      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg-default notranslate" translate="no">
            选择您的 Agent 客户端并配置 MCP：
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
                aria-pressed={activeTab === type}
                data-testid={`setup-mcp-tab-${type}`}
              >
                {configs[type].label}
              </button>
            ))}
          </div>
        </div>

        {endpointFallback ? (
          <div className="pl-notice text-xs" data-testid="setup-mcp-fallback-notice">
            当前为本地开发 <span className="notranslate" translate="no">fallback</span>
            ，不可用于客户交付。请配置{" "}
            <code className="notranslate" translate="no">
              LUCY_PUBLIC_MCP_URL
            </code>{" "}
            为 <span className="notranslate" translate="no">Agent</span> 可达的对外{" "}
            <span className="notranslate" translate="no">MCP</span>{" "}
            <span className="notranslate" translate="no">Endpoint</span>。
          </div>
        ) : null}
        {endpointInvalid ? (
          <div className="pl-error text-xs" data-testid="setup-mcp-endpoint-diagnostic">
            {(endpointInfo?.diagnostics?.length
              ? endpointInfo.diagnostics.map((d) => d.message)
              : ["无法加载 Lucy MCP Endpoint，请配置 LUCY_PUBLIC_MCP_URL 后重试。"]
            ).map((message, i) => (
              <div key={`${message}-${i}`}>{message}</div>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span className="notranslate" translate="no">{currentConfig.filenameHint}</span>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs py-1 px-2 flex items-center gap-1 text-primary hover:text-primary-hover notranslate"
              translate="no"
              onClick={() => copyToClipboard(currentConfig.snippet, false)}
              data-testid="setup-copy-config-btn"
              disabled={!endpointUrl || endpointInvalid}
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="notranslate" translate="no">{copiedSnippet ? "已复制配置" : "复制配置"}</span>
            </button>
          </div>

          <pre
            className="p-3 bg-bg-surface rounded border border-border-default font-mono text-xs overflow-x-auto text-fg-default max-h-40 notranslate"
            translate="no"
            data-testid="setup-mcp-config-snippet"
          >
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
          to={
            generatedToken && activeAgentId
              ? `/admin/mcp-playground?agentId=${encodeURIComponent(activeAgentId)}&mode=live-smoke`
              : "/admin/mcp-playground"
          }
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
