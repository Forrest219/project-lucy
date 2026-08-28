import { useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiDelete } from "../../lib/apiClient";
import type { TokensResponse, TokenInventoryItem } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";
import { formatLastSeen } from "./AgentList";
import { Code2, Terminal, ExternalLink, Key, Trash2 } from "lucide-react";

export function Tokens() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const search = searchParams.get("search") ?? "";
  const filterAgent = searchParams.get("agent") ?? "all";
  const filterStatus = searchParams.get("status") ?? "all";

  const [revokingToken, setRevokingToken] = useState<{ userId: string; label: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "tokens", { search, agent: filterAgent, status: filterStatus }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterAgent !== "all") params.set("userId", filterAgent);
      if (filterStatus !== "all") params.set("status", filterStatus);
      const qs = params.toString();
      return apiGet<TokensResponse>(`/api/admin/tokens${qs ? `?${qs}` : ""}`);
    }
  });

  const revokeMutation = useMutation({
    mutationFn: ({ userId, label }: { userId: string; label: string }) =>
      apiDelete<{ written: boolean; revokedAt: string }>(
        `/api/admin/agents/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(label)}`
      ),
    onSuccess: () => {
      toast.success("Token 凭据已成功吊销");
      setRevokingToken(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "tokens"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
    },
    onError: (err: Error) => {
      toast.error(`吊销失败：${err.message}`);
    }
  });

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  };

  const tokens = data?.tokens ?? [];
  const stats = data?.stats ?? {
    totalTokens: 0,
    availableTokens: 0,
    activeLast7dTokens: 0,
    expiringSoonTokens: 0,
    expiredTokens: 0
  };

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tokens) {
      if (!map.has(t.agent.id)) {
        map.set(t.agent.id, t.agent.name || t.agent.id);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tokens]);

  function getExpiryDisplay(expiresAt: string | null, status: TokenInventoryItem["status"]) {
    if (!expiresAt) {
      return { text: "永不过期", badgeClass: "text-fg-muted", isExpired: false };
    }
    const ts = Date.parse(expiresAt);
    if (Number.isNaN(ts)) {
      return { text: expiresAt, badgeClass: "text-fg-muted", isExpired: false };
    }
    const now = Date.now();
    const diff = ts - now;
    const isExpired = diff <= 0;
    const daysLeft = Math.ceil(diff / (24 * 60 * 60 * 1000));

    if (isExpired || status === "expired") {
      return { text: `已过期 (${new Date(ts).toLocaleDateString("zh-CN")})`, badgeClass: "text-danger font-medium", isExpired: true };
    }
    if (daysLeft <= 30) {
      return { text: `${daysLeft} 天后到期 (${new Date(ts).toLocaleDateString("zh-CN")})`, badgeClass: "text-warning font-medium", isExpired: false };
    }
    return { text: new Date(ts).toLocaleDateString("zh-CN"), badgeClass: "text-fg-body", isExpired: false };
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={<><span className="notranslate" translate="no">Token</span> 凭据</>}
        breadcrumbs={["访问治理", "Token 凭据"]}
        description={
          <>
            全局查看、签发与定向吊销 <span className="notranslate" translate="no">Agent</span> 访问凭据。推荐一台客户端安装使用一个 <span className="notranslate" translate="no">Token</span>。
          </>
        }
        actions={
          <Link
            to="/admin/tokens/new"
            className="pl-btn pl-btn--primary"
            data-testid="create-token-btn"
          >
            签发新 <span className="notranslate" translate="no">Token</span>
          </Link>
        }
      />

      {/* Quickstart Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="pl-card flex items-start gap-3 p-4 border border-border-default hover:border-brand/40 transition-colors">
          <div className="p-2.5 rounded-lg bg-bg-muted text-brand shrink-0">
            <Code2 className="size-5" />
          </div>
          <div className="grid gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">客户端接入配置</span>
              <span className="pl-badge text-xs"><span className="notranslate" translate="no">MCP</span> 协议</span>
            </div>
            <p className="text-xs text-fg-muted leading-relaxed">
              支持一键配置 <span className="notranslate" translate="no">Hermes</span>、<span className="notranslate" translate="no">Claude Code</span>、<span className="notranslate" translate="no">Codex</span> 或任意标准 <span className="notranslate" translate="no">MCP</span> 客户端。
            </p>
            <div className="pt-1">
              <Link to="/admin/tokens/new" className="text-xs text-brand hover:underline inline-flex items-center gap-1 font-medium">
                前往生成客户端配置片段 →
              </Link>
            </div>
          </div>
        </div>

        <div className="pl-card flex items-start gap-3 p-4 border border-border-default hover:border-brand/40 transition-colors">
          <div className="p-2.5 rounded-lg bg-bg-muted text-accent shrink-0">
            <Terminal className="size-5" />
          </div>
          <div className="grid gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">调用流水与排障</span>
              <span className="pl-badge text-xs">实时审计</span>
            </div>
            <p className="text-xs text-fg-muted leading-relaxed">
              追溯各 <span className="notranslate" translate="no">Token</span> 的实际调用、来源 <span className="notranslate" translate="no">IP</span>、客户端版本与权限裁决结果。
            </p>
            <div className="pt-1">
              <Link to="/admin/audit" className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-medium">
                查看访问日志流水 <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 notranslate" translate="no" data-testid="token-kpis">
        <MetricCard
          helpId="kpi-available-tokens"
          label={<span>可用 <span className="notranslate" translate="no">Token</span></span>}
          labelText="可用 Token"
          value={stats.availableTokens}
          help={<span>当前处于启用状态且尚未过期的 <span className="notranslate" translate="no">Token</span> 总数。</span>}
          subValue={`全系统共配置 ${stats.totalTokens} 个`}
        />
        <MetricCard
          helpId="kpi-active-tokens"
          label={<span>近 7 天活跃</span>}
          labelText="近 7 天活跃"
          value={stats.activeLast7dTokens}
          help={<span>最近 7 天内至少有一次 <span className="notranslate" translate="no">MCP</span> 调用记录的 <span className="notranslate" translate="no">Token</span> 数量。</span>}
          subValue="基于访问日志实时统计"
        />
        <MetricCard
          helpId="kpi-expiring-tokens"
          label={<span>30 天内到期</span>}
          labelText="30 天内到期"
          value={stats.expiringSoonTokens}
          help={<span>即将于 30 天内到期的可用 <span className="notranslate" translate="no">Token</span>，建议提前准备换签。</span>}
          tone={stats.expiringSoonTokens > 0 ? "warning" : undefined}
          subValue={stats.expiringSoonTokens > 0 ? "需关注换签" : "无近期到期"}
        />
        <MetricCard
          helpId="kpi-expired-tokens"
          label={<span>已过期 / 停用</span>}
          labelText="已过期 / 停用"
          value={stats.expiredTokens}
          help={<span>已过期的 <span className="notranslate" translate="no">Token</span> 凭据（<span className="notranslate" translate="no">Proxy</span> 会自动拒绝访问）。</span>}
          tone={stats.expiredTokens > 0 ? "danger" : undefined}
          subValue="已自动阻止访问"
        />
      </div>

      {/* Search and Filters */}
      <div className="pl-card grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <input
              type="search"
              className="pl-input max-w-xs text-sm notranslate"
              translate="no"
              placeholder="搜索 Token 标签、备注、Agent、客户端…"
              value={search}
              onChange={(e) => updateParam("search", e.target.value)}
              aria-label="搜索 Token"
            />
            {agentOptions.length > 0 && (
              <select
                className="pl-input max-w-[180px] text-sm notranslate"
                translate="no"
                value={filterAgent}
                onChange={(e) => updateParam("agent", e.target.value)}
                aria-label="按 Agent 筛选"
              >
                <option value="all" className="notranslate" translate="no">全部 Agent</option>
                {agentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id} className="notranslate" translate="no">
                    {opt.name} ({opt.id})
                  </option>
                ))}
              </select>
            )}
            <select
              className="pl-input max-w-[150px] text-sm notranslate"
              translate="no"
              value={filterStatus}
              onChange={(e) => updateParam("status", e.target.value)}
              aria-label="按状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="available">可用</option>
              <option value="expired">已过期</option>
              <option value="agent_disabled" className="notranslate" translate="no">Agent 已停用</option>
            </select>
          </div>
          <span className="text-xs text-fg-muted shrink-0">
            共 {tokens.length} 条凭据
          </span>
        </div>

        {/* High Density Token Inventory Table */}
        <div className="pl-data-grid-frame overflow-x-auto">
          <table className="pl-table w-full text-left border-collapse" data-testid="tokens-table">
            <thead>
              <tr className="border-b border-border-default bg-bg-muted/50 text-xs font-semibold text-fg-muted">
                <th className="py-2.5 px-3"><span className="notranslate" translate="no">Token</span> 标签 / 备注</th>
                <th className="py-2.5 px-3">所属 <span className="notranslate" translate="no">Agent</span></th>
                <th className="py-2.5 px-3"><span className="notranslate" translate="no">Token</span> 前缀</th>
                <th className="py-2.5 px-3">生效角色</th>
                <th className="py-2.5 px-3">最近活跃</th>
                <th className="py-2.5 px-3">过期时间</th>
                <th className="py-2.5 px-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-fg-muted text-sm">
                    加载中…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-danger text-sm">
                    加载失败：{error instanceof Error ? error.message : "未知错误"}
                  </td>
                </tr>
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-fg-muted">
                    <div className="grid gap-2 justify-center">
                      <Key className="size-8 mx-auto text-fg-muted/60" />
                      <p className="text-sm font-medium">暂无匹配的 <span className="notranslate" translate="no">Token</span> 凭据</p>
                      <p className="text-xs text-fg-muted">
                        您可以为 <span className="notranslate" translate="no">Agent</span> 签发新的访问 <span className="notranslate" translate="no">Token</span>，用于各类 <span className="notranslate" translate="no">MCP</span> 客户端连接。
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                tokens.map((token) => {
                  const lastSeen = formatLastSeen(token.last_used);
                  const expiry = getExpiryDisplay(token.expires_at, token.status);

                  return (
                    <tr
                      key={`${token.agent.id}-${token.label}`}
                      className="hover:bg-bg-muted/40 transition-colors"
                      data-testid={`token-row-${token.label}`}
                    >
                      {/* Name & Remark */}
                      <td className="py-3 px-3">
                        <div className="grid gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-fg-default notranslate" translate="no">
                              {token.label}
                            </span>
                            {token.status === "available" && (
                              <span className="pl-status-badge pl-status-done text-[10px] py-0 px-1.5">
                                可用
                              </span>
                            )}
                            {token.status === "expired" && (
                              <span className="pl-status-badge pl-status-failed text-[10px] py-0 px-1.5">
                                已过期
                              </span>
                            )}
                            {token.status === "agent_disabled" && (
                              <span className="pl-status-badge pl-status-neutral text-[10px] py-0 px-1.5">
                                <span className="notranslate" translate="no">Agent</span> 停用
                              </span>
                            )}
                          </div>
                          {token.device_name ? (
                            <span className="text-xs text-fg-muted notranslate" translate="no">
                              备注：{token.device_name}
                            </span>
                          ) : (
                            <span className="text-xs text-fg-muted">创建于 {token.created}</span>
                          )}
                        </div>
                      </td>

                      {/* Agent */}
                      <td className="py-3 px-3">
                        <div className="grid gap-0.5">
                          <Link
                            to={`/admin/agents/${encodeURIComponent(token.agent.id)}`}
                            className="font-medium text-brand hover:underline notranslate"
                            translate="no"
                          >
                            {token.agent.name}
                          </Link>
                          <span className="text-xs text-fg-muted font-mono notranslate" translate="no">
                            {token.agent.id}
                          </span>
                        </div>
                      </td>

                      {/* Token Prefix */}
                      <td className="py-3 px-3">
                        <code className="text-xs font-mono bg-bg-muted px-1.5 py-0.5 rounded text-fg-muted notranslate" translate="no">
                          {token.hashPrefix ? `${token.hashPrefix}…` : "—"}
                        </code>
                      </td>

                      {/* Scope / Roles */}
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          {token.agent.roles.length > 0 ? (
                            token.agent.roles.map((r) => (
                              <span
                                key={r}
                                className="pl-badge text-xs font-mono notranslate"
                                translate="no"
                              >
                                {r}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-fg-muted">—</span>
                          )}
                        </div>
                      </td>

                      {/* Last Seen & Device Context */}
                      <td className="py-3 px-3">
                        <div className="grid gap-0.5">
                          <span className="text-xs font-medium text-fg-default" title={lastSeen.title}>
                            {lastSeen.label}
                          </span>
                          {(token.last_client || token.last_device_name_seen) && (
                            <span className="text-xs text-fg-muted truncate max-w-[160px] notranslate" translate="no">
                              {token.last_client
                                ? `${token.last_client}${token.last_client_version ? ` ${token.last_client_version}` : ""}`
                                : token.last_device_name_seen}
                            </span>
                          )}
                          {token.last_ip && (
                            <span className="text-[11px] text-fg-muted font-mono notranslate" translate="no">
                              IP: {token.last_ip}
                              {token.distinct_ips_7d && token.distinct_ips_7d > 1 ? (
                                <span className="text-warning ml-1">({token.distinct_ips_7d} IPs)</span>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Expiry */}
                      <td className="py-3 px-3">
                        <span className={`text-xs ${expiry.badgeClass} notranslate`} translate="no">
                          {expiry.text}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/admin/audit?search=${encodeURIComponent(token.label)}`}
                            className="pl-btn pl-btn--ghost text-xs p-1 notranslate"
                            translate="no"
                            title="查看调用流水"
                            aria-label={`查看 ${token.label} 审计日志`}
                          >
                            日志
                          </Link>
                          <button
                            type="button"
                            className="pl-btn pl-btn--ghost text-xs text-danger p-1 notranslate"
                            translate="no"
                            onClick={() => setRevokingToken({ userId: token.agent.id, label: token.label })}
                            aria-label={`吊销 ${token.label}`}
                            title="定向吊销"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revoke Confirmation Modal */}
      {revokingToken && (
        <div className="pl-modal-backdrop" role="dialog" aria-modal="true">
          <div className="pl-modal-panel max-w-md">
            <h3 className="text-lg font-semibold text-fg-default mb-2">
              确认吊销 <span className="notranslate font-mono" translate="no">{revokingToken.label}</span>？
            </h3>
            <p className="text-sm text-fg-muted mb-4 leading-relaxed">
              吊销后，使用此 <span className="notranslate" translate="no">Token</span> 的客户端请求将立即被 <span className="notranslate" translate="no">MCP Proxy</span> 拒绝（返回 401）。此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => setRevokingToken(null)}
                disabled={revokeMutation.isPending}
              >
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--danger"
                onClick={() => revokeMutation.mutate(revokingToken)}
                disabled={revokeMutation.isPending}
              >
                {revokeMutation.isPending ? "吊销中…" : "确认吊销"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
