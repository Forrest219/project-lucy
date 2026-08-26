import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { DecisionReasonCell } from "../../components/DecisionReasonCell";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent } from "../../lib/types";

type AgentsResponse = { agents: Agent[] };
type McpToolsResponse = { tools: Array<{ name: string; description?: string }> };

type AclPreviewData = {
  allowed: boolean;
  decisionReason: string;
  decisionReasonLabel: string;
  decisionReasonDetail?: string;
  roleIds: string[];
  remediation: {
    primary: { label: string; href: string };
    secondary: Array<{ label: string; href: string }>;
  };
  effectivePermissions: {
    tools: string[];
    connections: string[];
    tableSample: string[];
    tableSampleTruncated: boolean;
  };
};

type LiveSmokeData = {
  httpStatus: number;
  decisionReason: string;
  decisionReasonLabel: string;
  result: unknown;
  auditHref?: string;
};

export function McpPlayground() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agentId, setAgentId] = useState(() => searchParams.get("agentId") ?? "");
  const [tool, setTool] = useState(() => searchParams.get("tool") ?? "lucy_query");
  const [mode, setMode] = useState<"dry-run" | "live-smoke">(
    searchParams.get("mode") === "live-smoke" ? "live-smoke" : "dry-run"
  );
  const [argsText, setArgsText] = useState(() => {
    const raw = searchParams.get("args");
    if (!raw) return "{\n  \n}";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return "{\n  \n}";
    }
  });
  const [bearerToken, setBearerToken] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents")
  });
  const toolsQuery = useQuery({
    queryKey: ["admin", "mcp-tools"],
    queryFn: () => apiGet<McpToolsResponse>("/api/admin/mcp-tools")
  });

  const agents = agentsQuery.data?.agents ?? [];
  const selectedAgent = agents.find((a) => a.id === agentId);
  const toolOptions = useMemo(() => {
    const names = new Set((toolsQuery.data?.tools ?? []).map((t) => t.name));
    if (tool) names.add(tool);
    return Array.from(names).sort();
  }, [toolsQuery.data, tool]);

  const previewMutation = useMutation({
    mutationFn: (body: { agentId: string; tool: string; arguments: unknown }) =>
      apiPost<AclPreviewData>("/api/admin/mcp-playground/acl-preview", body)
  });

  const liveMutation = useMutation({
    mutationFn: (body: { agentId: string; tool: string; bearerToken: string }) =>
      apiPost<LiveSmokeData>("/api/admin/mcp-playground/live-smoke", body)
  });

  function syncQuery(next: { agentId?: string; tool?: string; mode?: string }) {
    const params = new URLSearchParams(searchParams);
    if (next.agentId !== undefined) {
      if (next.agentId) params.set("agentId", next.agentId);
      else params.delete("agentId");
    }
    if (next.tool !== undefined) {
      if (next.tool) params.set("tool", next.tool);
      else params.delete("tool");
    }
    if (next.mode !== undefined) params.set("mode", next.mode);
    setSearchParams(params, { replace: true });
  }

  function parseArgs(): unknown | null {
    try {
      const value = JSON.parse(argsText);
      setParseError(null);
      return value;
    } catch {
      setParseError("参数必须是合法 JSON");
      return null;
    }
  }

  async function runPreview() {
    if (!agentId || !tool) return;
    const args = parseArgs();
    if (args === null) return;
    syncQuery({ agentId, tool, mode: "dry-run" });
    await previewMutation.mutateAsync({ agentId, tool, arguments: args });
  }

  async function runLive() {
    if (!agentId || !bearerToken.trim()) return;
    setConfirmLive(false);
    syncQuery({ agentId, tool: "tools/list", mode: "live-smoke" });
    await liveMutation.mutateAsync({
      agentId,
      tool: "tools/list",
      bearerToken: bearerToken.trim()
    });
  }

  const preview = previewMutation.data;
  const live = liveMutation.data;

  return (
    <div className="pl-page-stack" data-testid="mcp-playground-page">
      <PageHeader
        title={<span className="notranslate" translate="no">MCP 调试台</span>}
        description={
          <>
            预览 <span className="notranslate" translate="no">Agent</span> 的{" "}
            <span className="notranslate" translate="no">MCP</span> 工具权限裁决，并执行受控接入试调。
          </>
        }
      />

      <section className="pl-panel">
        <div className="grid gap-4 grid-cols-3">
          <label className="grid gap-1.5 text-sm">
            <span className="notranslate" translate="no">Agent</span>
            <select
              className="pl-input notranslate"
              translate="no"
              value={agentId}
              data-testid="mcp-playground-agent"
              onChange={(e) => {
                setAgentId(e.target.value);
                syncQuery({ agentId: e.target.value });
              }}
            >
              <option value="" className="notranslate" translate="no">
                选择 Agent
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name || agent.id} ({agent.id})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span>模式</span>
            <select
              className="pl-input"
              value={mode}
              data-testid="mcp-playground-mode"
              onChange={(e) => {
                const next = e.target.value === "live-smoke" ? "live-smoke" : "dry-run";
                setMode(next);
                syncQuery({ mode: next });
              }}
            >
              <option value="dry-run">ACL 裁决预览</option>
              <option value="live-smoke">受控试调</option>
            </select>
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="notranslate" translate="no">Role</span>
            <div className="pl-input bg-bg-muted text-fg-muted notranslate" translate="no" data-testid="mcp-playground-role">
              {selectedAgent?.role || "—"}
            </div>
          </div>
        </div>

        {mode === "dry-run" ? (
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span>工具</span>
              <select
                className="pl-input notranslate"
                translate="no"
                value={tool}
                data-testid="mcp-playground-tool"
                onChange={(e) => {
                  setTool(e.target.value);
                  syncQuery({ tool: e.target.value });
                }}
              >
                {toolOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>参数（JSON）</span>
              <textarea
                className="pl-input min-h-32 font-mono text-xs notranslate"
                translate="no"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                data-testid="mcp-playground-args"
              />
            </label>
            {parseError ? <p className="pl-error text-sm">{parseError}</p> : null}
            <div>
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                disabled={!agentId || previewMutation.isPending}
                onClick={() => void runPreview()}
                data-testid="mcp-playground-run-preview"
              >
                {previewMutation.isPending ? "运行中..." : "运行裁决预览"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            <p className="pl-notice text-sm">
              受控试调仅允许 <span className="notranslate" translate="no">tools/list</span>；
              <span className="notranslate" translate="no">Token</span> 仅保存在本次会话，不会落盘。
              请求会写入访问日志，并标记为受控试调。
            </p>
            <label className="grid gap-1.5 text-sm">
              <span className="notranslate" translate="no">Bearer Token</span>
              <input
                type="password"
                className="pl-input notranslate"
                translate="no"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="粘贴 Bearer Token，仅本次会话使用"
                data-testid="mcp-playground-token"
              />
            </label>
            <div>
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                disabled={!agentId || !bearerToken.trim() || liveMutation.isPending}
                onClick={() => setConfirmLive(true)}
                data-testid="mcp-playground-run-live"
              >
                运行受控试调
              </button>
            </div>
          </div>
        )}
      </section>

      {previewMutation.isError ? (
        <p className="pl-error" data-testid="mcp-playground-preview-error">
          {(previewMutation.error as Error).message}
        </p>
      ) : null}

      {preview ? (
        <section className="pl-panel" data-testid="mcp-playground-preview-result">
          <h2 className="pl-panel-title mb-3">裁决结果</h2>
          <p className="mb-3">
            {preview.allowed ? (
              <span className="pl-status-badge pl-status-done">允许</span>
            ) : (
              <span className="pl-status-badge pl-status-validation_failed">拒绝</span>
            )}
          </p>
          <DecisionReasonCell
            code={preview.decisionReason}
            label={preview.decisionReasonLabel}
            detail={preview.decisionReasonDetail}
          />
          <div className="mt-4 text-sm text-fg-muted">
            生效权限快照：工具 {preview.effectivePermissions.tools.length} · 连接{" "}
            {preview.effectivePermissions.connections.length} · 表样例{" "}
            {preview.effectivePermissions.tableSample.length}
            {preview.effectivePermissions.tableSampleTruncated ? "+" : ""}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={preview.remediation.primary.href} className="pl-card-cta notranslate" translate="no">
              {preview.remediation.primary.label} ↗
            </Link>
            {preview.remediation.secondary.map((item) => (
              <Link key={item.href} to={item.href} className="pl-card-cta notranslate" translate="no">
                {item.label} ↗
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {live ? (
        <section className="pl-panel" data-testid="mcp-playground-live-result">
          <h2 className="pl-panel-title mb-3">试调结果</h2>
          <DecisionReasonCell code={live.decisionReason} label={live.decisionReasonLabel} />
          <p className="mt-2 text-sm text-fg-muted">
            HTTP <span className="notranslate" translate="no">{live.httpStatus}</span>
          </p>
          {live.auditHref ? (
            <Link to={live.auditHref} className="pl-card-cta mt-3 inline-block">
              查看访问日志 ↗
            </Link>
          ) : null}
        </section>
      ) : null}

      {confirmLive ? (
        <div className="pl-modal-backdrop" role="dialog" aria-modal="true" data-testid="mcp-playground-live-confirm">
          <div className="pl-panel max-w-md">
            <h3 className="pl-panel-title">确认受控试调</h3>
            <p className="pl-notice mt-2">
              将向本机 Lucy <span className="notranslate" translate="no">MCP</span> Proxy 发送一次真实{" "}
              <span className="notranslate" translate="no">tools/list</span> 请求并写入访问日志。
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => setConfirmLive(false)}>
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                disabled={liveMutation.isPending}
                onClick={() => void runLive()}
                data-testid="mcp-playground-confirm-live"
              >
                {liveMutation.isPending ? "试调中..." : "确认运行"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
