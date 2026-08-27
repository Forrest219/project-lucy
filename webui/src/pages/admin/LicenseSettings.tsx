import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPost, ApiError } from "../../lib/apiClient";
import {
  LICENSE_QUERY_KEY,
  licenseStatusLabel,
  licenseTierLabel,
  type LicenseSnapshot
} from "../../lib/license";

export function LicenseSettings() {
  const queryClient = useQueryClient();
  const [activationCode, setActivationCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: LICENSE_QUERY_KEY,
    queryFn: () => apiGet<LicenseSnapshot>("/api/admin/license")
  });

  const activateMutation = useMutation({
    mutationFn: () =>
      apiPost<LicenseSnapshot>("/api/admin/license/activate", {
        activationCode
      }),
    onSuccess: (data) => {
      setFormError(null);
      setActivationCode("");
      queryClient.setQueryData(LICENSE_QUERY_KEY, data);
      toast.success("部署许可已激活");
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "激活失败");
    }
  });

  const snapshot = query.data;
  const entitlement = snapshot?.entitlement ?? null;
  const statusLabel = snapshot ? licenseStatusLabel(snapshot.status, snapshot.mode) : "加载中…";

  function onActivate(event: FormEvent) {
    event.preventDefault();
    if (!activationCode.trim()) {
      setFormError("请输入激活码");
      return;
    }
    activateMutation.mutate();
  }

  return (
    <div className="pl-page">
      <PageHeader
        title="部署许可"
        description="输入厂商提供的激活码，启用本实例的 Agent 席位与有效期。与访问治理中的数据授权无关。"
        breadcrumbs={["系统设置"]}
      />

      {query.isError && (
        <div className="pl-card p-4 text-sm text-danger" role="alert">
          {query.error instanceof ApiError ? query.error.message : "加载部署许可状态失败"}
        </div>
      )}

      {formError && (
        <div className="pl-card p-4 text-sm text-danger" role="alert" data-testid="license-form-error">
          {formError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <section className="pl-card grid gap-4 p-5" data-testid="license-activation-section">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold">激活码</h2>
            <p className="text-sm text-fg-muted">
              激活码由厂商离线签发。粘贴完整字符串后点击激活；不会再次显示完整激活码。
            </p>
          </div>
          <form className="grid gap-3" onSubmit={onActivate}>
            <label className="grid gap-1">
              <span className="text-sm font-medium">激活码</span>
              <textarea
                className="pl-input min-h-28 font-mono text-sm notranslate"
                translate="no"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="LUCY-1...."
                data-testid="license-activation-code"
                aria-describedby="license-activation-help"
              />
              <p className="text-xs text-fg-muted" id="license-activation-help">
                仅所有者账户可激活或更换部署许可。
              </p>
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                className="pl-btn pl-btn--primary"
                disabled={activateMutation.isPending || !activationCode.trim()}
                data-loading={activateMutation.isPending ? "true" : undefined}
                aria-busy={activateMutation.isPending}
              >
                {activateMutation.isPending ? "激活中…" : "激活部署许可"}
              </button>
            </div>
          </form>
        </section>

        <aside className="pl-card grid h-fit gap-4 p-5" data-testid="license-status-card">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold">当前状态</h2>
            <p className="text-sm text-fg-muted">展示 enforcement 模式、席位用量与到期时间。</p>
          </div>
          <dl className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <dt className="text-fg-muted">状态</dt>
              <dd data-testid="license-status-label">{statusLabel}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-fg-muted">Enforcement 模式</dt>
              <dd className="notranslate" translate="no" data-testid="license-mode">
                {snapshot?.mode ?? "—"}
              </dd>
            </div>
            {entitlement && (
              <>
                <div className="grid gap-1">
                  <dt className="text-fg-muted">客户标识</dt>
                  <dd className="notranslate" translate="no" data-testid="license-customer-id">
                    {entitlement.customer_id}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-fg-muted">套餐</dt>
                  <dd data-testid="license-tier">{licenseTierLabel(entitlement.tier)}</dd>
                </div>
              </>
            )}
            <div className="grid gap-1">
              <dt className="text-fg-muted">
                <span className="notranslate" translate="no">
                  Agent
                </span>{" "}
                席位
              </dt>
              <dd data-testid="license-seat-usage">
                {snapshot
                  ? snapshot.usage.maxAgents != null
                    ? `${snapshot.usage.agents} / ${snapshot.usage.maxAgents}`
                    : `${snapshot.usage.agents}`
                  : "—"}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-fg-muted">到期时间</dt>
              <dd data-testid="license-expires-at">
                {snapshot?.expiresAt ?? (snapshot?.status === "active" ? "永久" : "—")}
              </dd>
            </div>
            {snapshot?.daysRemaining != null && (
              <div className="grid gap-1">
                <dt className="text-fg-muted">剩余天数</dt>
                <dd data-testid="license-days-remaining">{snapshot.daysRemaining}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}
