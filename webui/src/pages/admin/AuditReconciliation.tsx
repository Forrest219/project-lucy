import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";
import {
  RECONCILIATION_DIFFERENCE_LABELS,
  RECONCILIATION_DIFFERENCE_ORDER,
  formatReconciliationCount,
  formatReconciliationRatio,
  type ReconciliationDifferenceId,
  type ReconciliationExportResponse,
  type ReconciliationUsageResponse
} from "../../lib/auditReconciliation";

/**
 * P0-4（L25-02 / L25-03）只读对账 —— 使用概况。
 *
 * 消费三个只读端点：
 *   - GET /api/admin/audit/reconciliation/usage       → Token 对账 + 完整使用明细
 *   - GET /api/admin/audit/reconciliation/export      → 对账证据包（CSV + manifest）
 *   - GET /api/admin/audit/reconciliation/inquiries/:turnId → 单问询对账详情
 *
 * 展示纪律（Spec §2.4 / §4.4）：
 *   - 规模为 null 一律显示「不可观测 + 原因」，**不得**显示 0；
 *   - 比率同时给出 N／D；分母不可观测或为 0 时不显示 0% / 100%；
 *   - 「活跃数 > 配置数」**不自动等于数据异常**；
 *   - 正式模式（mode=complete）在 as-of S 不可证明时后端 409，本页显式披露
 *     该失败而不是静默换用较新数据。
 */

type RangePreset = "24h" | "7d" | "30d";

const RANGE_LABELS: Record<RangePreset, string> = {
  "24h": "近 24 小时",
  "7d": "近 7 天",
  "30d": "近 30 天"
};

const RANGE_HOURS: Record<RangePreset, number> = { "24h": 24, "7d": 168, "30d": 720 };

export function AuditReconciliation() {
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * ★ 伴生缺陷 C-1（Spec §5.4）：输入框存**原文**。
   * 旧写法 `setTurnId(e.target.value.trim())` 让 state ≠ DOM 值 ⇒ React 回写
   * `node.value` ⇒ IME 组合可被打断；且用户输入的首尾空格被静默抹除。
   * 规范化只发生在下游消费点（发起查询前再 trim）。
   */
  const [turnIdDraft, setTurnIdDraft] = useState(searchParams.get("turnId") ?? "");
  /** 消费点规范化：发请求前 trim（SC-18）。 */
  const turnId = turnIdDraft.trim();

  const range = (searchParams.get("range") as RangePreset) ?? "7d";
  const hours = RANGE_HOURS[range] ?? 168;

  const usageQuery = useQuery({
    queryKey: ["admin", "audit", "reconciliation", "usage", range],
    queryFn: () =>
      apiGet<ReconciliationUsageResponse>(
        `/api/admin/audit/reconciliation/usage?hours=${hours}`
      ),
    retry: false
  });

  const inquiryQuery = useQuery({
    queryKey: ["admin", "audit", "reconciliation", "inquiry", turnId, range],
    queryFn: () =>
      apiGet<{ data: { inquiry: Record<string, unknown> } }>(
        `/api/admin/audit/reconciliation/inquiries/${encodeURIComponent(turnId)}?hours=${hours}`
      ),
    enabled: Boolean(turnId),
    retry: false
  });

  const usageData = usageQuery.data;
  const token = usageData?.tokenReconciliation;
  const configured = token?.configuredSnapshot;
  const differences = useMemo(() => {
    const byId = new Map(token?.differences.map((d) => [d.id, d]) ?? []);
    return RECONCILIATION_DIFFERENCE_ORDER.map((id) => byId.get(id)).filter(
      (d): d is NonNullable<typeof d> => Boolean(d)
    );
  }, [token]);

  function setRange(next: RangePreset) {
    const params = new URLSearchParams(searchParams);
    params.set("range", next);
    setSearchParams(params);
  }

  const exportHref = `/api/admin/audit/reconciliation/export?hours=${hours}`;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="审计对账 · 使用概况"
        description={
          <>
            <span className="notranslate" translate="no">Token</span> 对账、完整使用明细与差异集合。不可观测的量显示原因，不显示 0。
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={exportHref}
              download
              className="pl-btn pl-btn--secondary text-sm"
              data-testid="reconciliation-export"
              title="导出对账证据包（CSV + 对账清单）"
            >
              导出对账证据包
            </a>
            <Link
              to="/admin/audit"
              className="pl-inline-link"
              data-testid="reconciliation-back-to-audit"
            >
              返回访问日志
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="pl-segmented-control pl-segmented-control--auto"
          data-testid="reconciliation-range"
          role="group"
          aria-label="时间范围"
        >
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`pl-segmented-control-item${range === preset ? " pl-segmented-control-item--active" : ""}`}
              data-testid={`reconciliation-range-${preset}`}
              aria-pressed={range === preset}
              onClick={() => setRange(preset)}
            >
              {RANGE_LABELS[preset]}
            </button>
          ))}
        </div>
        {usageData ? (
          <span className="text-xs text-fg-muted" data-testid="reconciliation-context">
            账本上界 S = {usageData.reconciliationContext.watermarkSeq} · 快照{" "}
            <span className="notranslate" translate="no">{usageData.reconciliationContext.snapshotId}</span> · 单位{" "}
            {usageData.reconciliationContext.metricUnit}
          </span>
        ) : null}
      </div>

      {usageQuery.isLoading ? <div className="pl-notice">加载中…</div> : null}
      {usageQuery.error ? (
        <div className="pl-notice pl-status-validation_failed" data-testid="reconciliation-error">
          {(usageQuery.error as Error).message}
        </div>
      ) : null}

      {usageQuery.data && !usageQuery.data.asOfProof?.ok ? (
        <div className="pl-notice pl-status-validation_failed" data-testid="reconciliation-asof-incomplete">
          无法证明本次读取可按账本上界 S 精确重建（正式模式已失败关闭）。本页展示的是
          <strong>诊断视图</strong>，不作为完整对账结论。
        </div>
      ) : null}

      {usageData && token ? (
        <>
          <section className="pl-card grid gap-3" data-testid="reconciliation-token-card">
            <h3 className="text-sm font-semibold text-fg-default">
              <span className="notranslate" translate="no">Token</span> 对账
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-xs text-fg-muted">配置数（已下发凭证）</div>
                <div className="text-lg font-mono" data-testid="reconciliation-configured-total">
                  {formatReconciliationCount(configured?.total ?? null, configured?.unavailableReason).text}
                </div>
                <div className="text-xs text-fg-muted">
                  启用 {formatReconciliationCount(configured?.enabled ?? null).text} · 停用{" "}
                  {formatReconciliationCount(configured?.disabled ?? null).text} · 过期{" "}
                  {formatReconciliationCount(configured?.expired ?? null).text}
                </div>
                {!configured?.available ? (
                  <div className="text-xs pl-status-partial" data-testid="reconciliation-config-unavailable">
                    配置快照不可观测：{configured?.unavailableReason ?? "未知"}。此时三个依赖配置的差异集合
                    不可观测，**不**等于「没有差异」。
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-xs text-fg-muted">活跃数（窗口内有独立工具调用）</div>
                <div className="text-lg font-mono" data-testid="reconciliation-active-count">
                  {token.activeWindow.identityCount}
                </div>
                <div className="text-xs text-fg-muted">
                  工具调用 {token.activeWindow.toolCallCount} · 已排除协议事件{" "}
                  {token.activeWindow.protocolEventsExcluded}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">活跃率</div>
                <div className="text-lg font-mono" data-testid="reconciliation-active-rate">
                  {formatReconciliationRatio(
                    token.completeness.ratio,
                    token.completeness.denominator,
                    token.completeness.ratioNullReason
                  )}
                </div>
                <div className="text-xs text-fg-muted">
                  N={token.completeness.numerator ?? "不可观测"} / D=
                  {token.completeness.denominator ?? "不可观测"}
                </div>
              </div>
            </div>
            {token.anomaly.activeGreaterThanConfigured ? (
              <div className="text-xs pl-status-partial" data-testid="reconciliation-anomaly">
                活跃身份数超过配置数。{token.anomaly.flagged
                  ? `已标记为对账失败：${token.anomaly.reason}`
                  : "尚未判定为数据异常（身份／窗口／快照口径未同时一致），请看下方差异集合。"}
              </div>
            ) : null}
            {token.unknownIdentity.count > 0 ? (
              <div className="text-xs text-fg-muted" data-testid="reconciliation-unknown-identity">
                身份未核验调用 {token.unknownIdentity.count} 次；这些调用**不计入**活跃身份分母。
              </div>
            ) : null}
          </section>

          <section className="pl-card grid gap-3" data-testid="reconciliation-differences">
            <h3 className="text-sm font-semibold text-fg-default">差异集合</h3>
            <div className="overflow-x-auto">
              <table className="pl-data-grid pl-data-table w-full">
                <thead>
                  <tr>
                    <th>差异类型</th>
                    <th className="whitespace-nowrap">规模</th>
                    <th>身份（最多 20 个）</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((difference) => {
                    const count = formatReconciliationCount(difference.count, difference.nullReason);
                    return (
                      <tr key={difference.id} data-testid={`reconciliation-difference-${difference.id}`}>
                        <td>
                          {RECONCILIATION_DIFFERENCE_LABELS[difference.id as ReconciliationDifferenceId] ??
                            difference.label}
                        </td>
                        <td className="font-mono" data-observable={String(count.observable)}>
                          {count.text}
                        </td>
                        <td className="notranslate font-mono text-xs" translate="no">
                          {difference.identities.slice(0, 20).join(", ") || "—"}
                          {difference.identities.length > 20 ? ` …共 ${difference.identities.length} 个` : ""}
                        </td>
                        <td className="text-xs text-fg-muted">{difference.reasons.join("；") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pl-card grid gap-3" data-testid="reconciliation-usage-rows">
            <h3 className="text-sm font-semibold text-fg-default">完整使用明细</h3>
            <div className="overflow-x-auto">
              <table className="pl-data-grid pl-data-table w-full">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>工具</th>
                    <th>问询 ID</th>
                    <th>
                      <span className="notranslate" translate="no">Token</span> 身份
                    </th>
                    <th>身份来源</th>
                    <th>协议事件</th>
                  </tr>
                </thead>
                <tbody>
                  {usageData.calls.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-fg-muted">
                        本窗口没有可展示的使用明细
                      </td>
                    </tr>
                  ) : (
                    usageData.calls.items.map((row) => (
                      <tr key={row.unitId} data-testid={`reconciliation-usage-row-${row.unitId}`}>
                        <td className="notranslate font-mono text-xs" translate="no">{row.ts}</td>
                        <td className="notranslate" translate="no">{row.tool}</td>
                        <td className="notranslate font-mono text-xs" translate="no">{row.turnId ?? "—"}</td>
                        <td className="notranslate font-mono text-xs" translate="no">{row.tokenIdentity ?? "—"}</td>
                        <td className="text-xs">{row.tokenIdentityKind ?? "—"}</td>
                        <td className="text-xs">{row.protocol ? "是" : "否"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-fg-muted" data-testid="reconciliation-usage-paging">
              已返回 {usageData.calls.returned} / 匹配 {usageData.calls.totalMatched}
              {usageData.calls.nextCursor ? " · 还有更多（按游标分页）" : " · 已到末页"}
            </div>
          </section>

          <section className="pl-card grid gap-3" data-testid="reconciliation-inquiry">
            <h3 className="text-sm font-semibold text-fg-default">单问询对账</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="pl-input w-72 notranslate"
                translate="no"
                placeholder="问询 ID（turn id）"
                aria-label="问询 ID"
                value={turnIdDraft}
                onChange={(e) => setTurnIdDraft(e.target.value)}
                data-testid="reconciliation-inquiry-input"
              />
            </div>
            {inquiryQuery.isLoading ? <div className="pl-notice">加载中…</div> : null}
            {inquiryQuery.error ? (
              <div className="pl-notice pl-status-validation_failed" data-testid="reconciliation-inquiry-error">
                {(inquiryQuery.error as Error).message}
              </div>
            ) : null}
            {inquiryQuery.data ? (
              <pre
                className="pl-code-block overflow-auto text-xs notranslate"
                translate="no"
                data-testid="reconciliation-inquiry-detail"
              >
                {JSON.stringify(inquiryQuery.data.data.inquiry, null, 2)}
              </pre>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

export default AuditReconciliation;
