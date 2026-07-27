import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../../lib/apiClient";
import type { CreateTokenResponse } from "../../lib/types";

/**
 * Default MCP endpoint advertised in client snippets. The plaintext token
 * is only embedded in the snippet at generation time and never persisted.
 */
const MCP_URL = "http://localhost:7879/mcp";

type ClientId = "hermes" | "claude-code" | "codex" | "generic";

type ClientSnippet = {
  id: ClientId;
  label: string;
  language: "json" | "bash" | "env" | "toml";
  description: string;
  build: (token: string) => string;
};

/**
 * Build the four canonical client snippets for a freshly generated token.
 * This helper is pure: callers can pass any plaintext token to render the
 * corresponding ready-to-paste configuration fragment.
 */
export function buildClientSnippets(token: string): Record<ClientId, string> {
  return {
    hermes: JSON.stringify(
      {
        mcpServers: {
          lucy: {
            type: "http",
            url: MCP_URL,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    ),
    "claude-code": JSON.stringify(
      {
        mcpServers: {
          lucy: {
            type: "http",
            url: MCP_URL,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    ),
    codex: [
      "# In ~/.codex/config.toml",
      "[mcp_servers.lucy]",
      `url = "${MCP_URL}"`,
      "type = \"http\"",
      `headers = { Authorization = "Bearer ${token}" }`
    ].join("\n"),
    generic: JSON.stringify(
      {
        mcpServers: {
          lucy: {
            type: "http",
            url: MCP_URL,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    )
  };
}

const CLIENT_TABS: Array<{ id: ClientId; label: string; description: string }> = [
  { id: "hermes", label: "Hermes", description: "MCP JSON 配置（兼容 OpenAI Hermes）" },
  { id: "claude-code", label: "Claude Code", description: ".mcp.json，可直接放入 ~/.claude.json" },
  { id: "codex", label: "Codex", description: "config.toml 片段，配合环境变量使用" },
  { id: "generic", label: "Generic MCP", description: "通用 MCP over HTTP 客户端" }
];

export function NewToken() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  // plaintext token is only held in memory, never stored
  const [generatedToken, setGeneratedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<ClientId>("hermes");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: { label: string; expires_at?: string | null }) =>
      apiPost<CreateTokenResponse>(`/api/admin/agents/${userId}/tokens`, body),
    onSuccess: (data) => {
      setGeneratedToken(data);
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  function handleGenerate() {
    if (!label.trim()) {
      toast.error("Token 标签不能为空");
      return;
    }
    mutation.mutate({
      label: label.trim(),
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
    navigate(`/admin/agents/${userId}`);
  }

  const snippets = generatedToken ? buildClientSnippets(generatedToken.token) : null;
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
      <div className="grid gap-6 max-w-2xl">
        <div>
          <h1 className="text-xl font-semibold">Token 已生成</h1>
          <p className="text-sm text-warning-strong mt-1">⚠ 关闭后无法再次查看 token 明文。请立即复制保存，或将下方配置交给 Agent 使用者。</p>
        </div>

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
            <span>标签：{generatedToken.label}</span>
            {" · "}
            <span>创建：{generatedToken.created}</span>
            {generatedToken.expires_at && <><span>{" · 过期："}{generatedToken.expires_at}</span></>}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">选择客户端，将以下配置交给 Agent 使用者：</p>
            <button
              type="button"
              className="pl-btn pl-btn--secondary text-sm"
              onClick={handleCopySnippet}
              aria-label="复制当前选中的配置"
            >
              {copiedSnippet ? "已复制" : "复制当前配置"}
            </button>
          </div>
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

  return (
    <div className="grid gap-6 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold">为 {userId} 创建新 Token</h1>
        <p className="text-sm text-fg-muted mt-1">一旦关闭生成页面，将无法再看到 token 明文。请立即复制保存。</p>
      </div>

      <div className="pl-card grid gap-4">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Token 标签 <span className="text-danger">*</span></span>
          <input
            className="pl-input"
            placeholder="例：hermes-laptop"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">过期时间（可选，留空 = 永不过期）</span>
          <input
            className="pl-input"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="pl-btn pl-btn--ghost" onClick={() => navigate(`/admin/agents/${userId}`)}>
          取消
        </button>
        <button
          type="button"
          className="pl-btn pl-btn--primary"
          onClick={handleGenerate}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "生成中…" : "生成 Token"}
        </button>
      </div>
    </div>
  );
}
