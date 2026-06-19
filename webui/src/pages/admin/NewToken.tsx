import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../../lib/apiClient";
import type { CreateTokenResponse } from "../../lib/types";

export function NewToken() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  // plaintext token is only held in memory, never stored
  const [generatedToken, setGeneratedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);

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

  function handleCopy() {
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

  const mcpJson = generatedToken
    ? JSON.stringify(
        {
          mcpServers: {
            lucy: {
              url: "http://localhost:7879/mcp",
              headers: { Authorization: `Bearer ${generatedToken.token}` }
            }
          }
        },
        null,
        2
      )
    : "";

  if (generatedToken) {
    return (
      <div className="grid gap-6 max-w-xl">
        <div>
          <h1 className="text-xl font-semibold">Token 已生成</h1>
          <p className="text-sm text-amber-600 mt-1">一旦关闭本页面，将无法再看到 token 明文。请立即复制保存。</p>
        </div>

        <div className="pl-card grid gap-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-bg-muted rounded px-3 py-2 break-all select-all">
              {generatedToken.token}
            </code>
            <button type="button" className="pl-btn pl-btn--ghost text-sm shrink-0" onClick={handleCopy}>
              {copied ? "已复制" : "复制"}
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
          <p className="text-sm text-fg-muted">将以下配置写入 Agent 客户端的 .mcp.json：</p>
          <pre className="pl-diff-viewer text-xs">{mcpJson}</pre>
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
          <span className="text-sm font-medium">Token 标签 <span className="text-red-500">*</span></span>
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
