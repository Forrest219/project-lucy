import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { Agent, CreateTokenResponse, McpEndpointInfo, ProjectInfo } from "../../lib/types";
import { buildCodexMcpToml, buildMcpConfig } from "../../lib/mcpEndpoint";
import { PageHeader } from "../../components/PageHeader";

type ClientId = "hermes" | "claude-code" | "codex" | "generic";

type ClientSnippet = {
  id: ClientId;
  label: string;
  language: "json" | "bash" | "env" | "toml";
  description: string;
  build: (token: string) => string;
};

export function buildClientSnippets(token: string, endpoint: string): Record<ClientId, string> {
  return {
    hermes: buildMcpConfig(endpoint, token),
    "claude-code": buildMcpConfig(endpoint, token),
    codex: buildCodexMcpToml(endpoint, token),
    generic: buildMcpConfig(endpoint, token)
  };
}

const CLIENT_TABS: Array<{ id: ClientId; label: string; description: string }> = [
  { id: "hermes", label: "Hermes", description: "MCP JSON 配置（兼容 OpenAI Hermes），放入 ~/.hermes/config.json 或项目 mcp.json" },
  { id: "claude-code", label: "Claude Code", description: ".mcp.json，可直接放入项目根目录或 ~/.claude.json" },
  { id: "codex", label: "Codex", description: "config.toml 片段，配合环境变量使用" },
  { id: "generic", label: "通用客户端", description: "任意支持 MCP over HTTP 的客户端（标准 JSON 配置）" }
];

function EndpointFallbackNotice({ endpointInfo }: { endpointInfo?: McpEndpointInfo }) {
  if (endpointInfo?.status !== "fallback") return null;
  return (
    <div className="pl-notice" data-testid="mcp-fallback-notice">
      当前为本地开发 <span className="notranslate" translate="no">fallback</span>，不可用于客户交付。请配置{" "}
      <code className="notranslate" translate="no">LUCY_PUBLIC_MCP_URL</code> 为{" "}
      <span className="notranslate" translate="no">Agent</span> 可达的对外{" "}
      <span className="notranslate" translate="no">MCP</span> <span className="notranslate" translate="no">Endpoint</span>
      （须与宿主发布端口或反向代理 URL 一致）。
    </div>
  );
}

function computePresetDate(days: number): string {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

export function NewToken() {
  const { userId: routeUserId } = useParams<{ userId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedUserId, setSelectedUserId] = useState(routeUserId ?? "");
  const [label, setLabel] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [generatedToken, setGeneratedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<ClientId>("hermes");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const targetUserId = routeUserId || selectedUserId;

  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<{ agents: Agent[] }>("/api/admin/agents"),
    enabled: !routeUserId
  });
  const agents = agentsQuery.data?.agents ?? [];

  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });
  const endpointInfo: McpEndpointInfo | undefined = projectQuery.data?.mcpEndpoint;
  const endpoint = endpointInfo?.url ?? null;

  const mutation = useMutation({
    mutationFn: (body: { label: string; device_name?: string | null; expires_at?: string | null }) =>
      apiPost<CreateTokenResponse>(`/api/admin/agents/${encodeURIComponent(targetUserId)}/tokens`, body),
    onSuccess: (data) => {
      setGeneratedToken(data);
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tokens"] });
      if (targetUserId) {
        void queryClient.invalidateQueries({ queryKey: ["admin", "agent", targetUserId] });
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  function handleGenerate() {
    if (!targetUserId) {
      toast.error("请先选择所属 Agent");
      return;
    }
    if (!label.trim()) {
      toast.error("Token 标签不能为空");
      return;
    }
    mutation.mutate({
      label: label.trim(),
      device_name: deviceName.trim() || null,
      expires_at: expiresAt || null
    });
  }

  function handleCopyToken() {
    if (!generatedToken) return;
    void navigator.clipboard.writeText(generatedToken.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleClose() {
    setGeneratedToken(null);
    if (routeUserId) {
      navigate(`/admin/agents/${routeUserId}`);
    } else {
      navigate("/admin/tokens");
    }
  }

  const snippets = generatedToken && endpoint ? buildClientSnippets(generatedToken.token, endpoint) : null;
  const activeSnippetContent = snippets ? snippets[activeSnippet] : "";

  function handleCopySnippet() {
    if (!activeSnippetContent) return;
    void navigator.clipboard.writeText(activeSnippetContent).then(() => {
      setCopiedSnippet(true);
      toast.success("客户端配置已复制");
      setTimeout(() => setCopiedSnippet(false), 2000);
    });
  }

  if (generatedToken && snippets) {
    return (
      <div className="pl-page-stack max-w-2xl">
        <PageHeader
          title="Token 已生成"
          backAction={
            targetUserId ? (
              <Link to={`/admin/agents/${targetUserId}`} className="pl-page-header-back">
                ‹ 返回 Agent 详情
              </Link>
            ) : (
              <Link to="/admin/tokens" className="pl-page-header-back">
                ‹ 返回 Token 凭据
              </Link>
            )
          }
          description={
            <>
              <span className="notranslate" translate="no">⚠</span> 关闭后无法再次查看 token 明文。请立即复制保存，或将下方配置交给 <span className="notranslate" translate="no">Agent</span> 使用者。
            </>
          }
        />

        <div className="pl-card grid gap-3">
          <div className="flex items-center gap-2">
            <code
              className="flex-1 font-mono text-sm bg-bg-muted rounded px-3 py-2 break-all select-all"
              data-testid="plaintext-token"
            >
              {generatedToken.token}
            </code>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm shrink-0"
              onClick={handleCopyToken}
              aria-label="复制 token 明文"
            >
              {copied ? "已复制" : "复制 Token"}
            </button>
          </div>
          <div className="text-xs text-fg-muted">
            <span>所属 <span className="notranslate" translate="no">Agent</span>：<span className="font-mono notranslate" translate="no">{targetUserId}</span></span>
            {" · "}
            <span>标签：{generatedToken.label}</span>
            {generatedToken.device_name ? (
              <>
                {" · "}
                <span>
                  设备备注：
                  <span className="notranslate" translate="no">{generatedToken.device_name}</span>
                </span>
              </>
            ) : null}
            {" · "}
            <span>创建：{generatedToken.created}</span>
            {generatedToken.expires_at && <><span>{" · 过期："}{generatedToken.expires_at}</span></>}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">选择客户端，将以下配置交给 <span className="notranslate" translate="no">Agent</span> 使用者：</p>
            <button
              type="button"
              className="pl-btn pl-btn--secondary text-sm"
              onClick={handleCopySnippet}
              aria-label="复制当前选中的配置"
            >
              {copiedSnippet ? "已复制" : "复制当前配置"}
            </button>
          </div>
          <EndpointFallbackNotice endpointInfo={endpointInfo} />
          <div
            role="tablist"
            aria-label="客户端接入配置"
            className="flex flex-wrap gap-1 border-b border-border-default"
          >
            {CLIENT_TABS.map((tab) => {
              const selected = activeSnippet === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`pl-admin-tab ${selected ? "pl-admin-tab--active" : ""}`}
                  onClick={() => setActiveSnippet(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-fg-muted">
            {CLIENT_TABS.find((tab) => tab.id === activeSnippet)?.description}
          </p>
          <pre
            className="pl-diff-viewer text-xs max-h-72 overflow-auto"
            data-testid="snippet-active"
            data-snippet-id={activeSnippet}
          >
            {activeSnippetContent}
          </pre>
        </div>

        <div className="flex justify-end">
          <button type="button" className="pl-btn pl-btn--primary" onClick={handleClose}>
            我已保存，关闭
          </button>
        </div>
      </div>
    );
  }

  if (generatedToken && !snippets) {
    const endpointDiagnostic =
      endpointInfo?.diagnostics.length
        ? endpointInfo.diagnostics
        : [
            {
              code: "MCP_ENDPOINT_UNAVAILABLE",
              message: projectQuery.error instanceof Error
                ? `无法加载 Lucy MCP endpoint：${projectQuery.error.message}`
                : "无法加载 Lucy MCP endpoint，请刷新后重试。"
            }
          ];
    return (
      <div className="pl-page-stack max-w-2xl">
        <PageHeader
          title="Token 已生成"
          backAction={
            targetUserId ? (
              <Link to={`/admin/agents/${targetUserId}`} className="pl-page-header-back">
                ‹ 返回 Agent 详情
              </Link>
            ) : (
              <Link to="/admin/tokens" className="pl-page-header-back">
                ‹ 返回 Token 凭据
              </Link>
            )
          }
          description={
            <>
              <span className="notranslate" translate="no">⚠</span> Token 已生成，但 Lucy <span className="notranslate" translate="no">MCP</span> <span className="notranslate" translate="no">Endpoint</span> 当前不可用，无法生成可复制的客户端配置片段。
            </>
          }
        />
        <div className="pl-card grid gap-3">
          <code
            className="font-mono text-sm bg-bg-muted rounded px-3 py-2 break-all select-all"
            data-testid="plaintext-token"
          >
            {generatedToken.token}
          </code>
          <div className="pl-error" data-testid="mcp-endpoint-diagnostic">
            {endpointDiagnostic.map((d, i) => (
              <div key={`${d.code}-${i}`}>{d.message}</div>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" className="pl-btn pl-btn--primary" onClick={handleClose}>
            我已保存，关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pl-page-stack max-w-xl">
      <PageHeader
        title={routeUserId ? <>为 {routeUserId} 创建新 <span className="notranslate" translate="no">Token</span></> : <>签发新 <span className="notranslate" translate="no">Token</span></>}
        backAction={
          routeUserId ? (
            <Link to={`/admin/agents/${routeUserId}`} className="pl-page-header-back">
              ‹ 返回 Agent 详情
            </Link>
          ) : (
            <Link to="/admin/tokens" className="pl-page-header-back">
              ‹ 返回 Token 凭据
            </Link>
          )
        }
        description={
          <>
            推荐一台客户端安装使用一个 <span className="notranslate" translate="no">Token</span>
            。一旦关闭生成页面，将无法再看到 <span className="notranslate" translate="no">token</span>{" "}
            明文。请立即复制保存。
          </>
        }
      />

      <div className="pl-card grid gap-4">
        {!routeUserId && (
          <label className="grid gap-1">
            <span className="text-sm font-medium">所属 <span className="notranslate" translate="no">Agent</span> <span className="text-danger">*</span></span>
            <select
              className="pl-input notranslate"
              translate="no"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              aria-label="选择所属 Agent"
            >
              <option value="" disabled className="notranslate" translate="no">请选择 Agent</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.id})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="grid gap-1">
          <span className="text-sm font-medium"><span className="notranslate" translate="no">Token</span> 标签 <span className="text-danger">*</span></span>
          <input
            className="pl-input notranslate"
            translate="no"
            aria-label="Token 标签"
            placeholder="例：cursor-laptop-xingchen"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">设备名备注（可选）</span>
          <input
            className="pl-input notranslate"
            translate="no"
            placeholder="例：xingchen-mbp（仅备注，不参与鉴权）"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            aria-label="设备名备注"
          />
          <span className="text-xs text-fg-muted">
            仅用于管理员标识设备或用途（如：张三的 MacBook），不参与权限校验。可留空。
          </span>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">过期时间（可选；到期后 Proxy 立即拒绝）</span>
          <input
            className="pl-input"
            aria-label="过期时间"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-fg-muted mr-1">快捷预设：</span>
            <button
              type="button"
              className="pl-badge hover:bg-bg-muted cursor-pointer transition-colors text-xs"
              onClick={() => setExpiresAt(computePresetDate(30))}
            >
              30 天
            </button>
            <button
              type="button"
              className="pl-badge hover:bg-bg-muted cursor-pointer transition-colors text-xs"
              onClick={() => setExpiresAt(computePresetDate(90))}
            >
              90 天
            </button>
            <button
              type="button"
              className="pl-badge hover:bg-bg-muted cursor-pointer transition-colors text-xs"
              onClick={() => setExpiresAt(computePresetDate(180))}
            >
              180 天
            </button>
            <button
              type="button"
              className="pl-badge hover:bg-bg-muted cursor-pointer transition-colors text-xs"
              onClick={() => setExpiresAt(computePresetDate(365))}
            >
              1 年
            </button>
            <button
              type="button"
              className="pl-badge hover:bg-bg-muted cursor-pointer transition-colors text-xs"
              onClick={() => setExpiresAt("")}
            >
              永不过期
            </button>
          </div>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="pl-btn pl-btn--ghost"
          onClick={() => {
            if (routeUserId) navigate(`/admin/agents/${routeUserId}`);
            else navigate("/admin/tokens");
          }}
        >
          取消
        </button>
        <button
          type="button"
          className="pl-btn pl-btn--primary"
          onClick={handleGenerate}
          disabled={mutation.isPending || (!routeUserId && !selectedUserId)}
        >
          {mutation.isPending ? "生成中…" : "生成 Token"}
        </button>
      </div>
    </div>
  );
}
