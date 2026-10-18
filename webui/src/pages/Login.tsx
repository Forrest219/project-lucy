import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/apiClient";
import { BrandMark } from "../components/BrandMark";
import { useBranding } from "../lib/useBranding";

export function LoginPage() {
  const { status, loading, login, bootstrap } = useAuth();
  const { data: branding } = useBranding();
  const location = useLocation();
  const [adminId, setAdminId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const productTitle = branding?.productTitle ?? "Lucy WebUI";
  const tagline = branding?.tagline ?? "可信 Agent 数据层";
  const logoUrl = branding?.logoUrl ?? null;

  if (!loading && status?.mode === "open") {
    return <Navigate to="/overview" replace />;
  }
  if (!loading && status?.mode === "required" && status.me) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/overview";
    return <Navigate to={redirectTo} replace />;
  }

  const isBootstrap = status?.mode === "bootstrap";
  const configUnavailable = status?.mode === "unavailable";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (isBootstrap) {
        await bootstrap({ adminId, displayName: displayName || undefined, password, bootstrapToken: bootstrapToken || undefined });
      } else {
        await login(adminId, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pl-login-page">
      <div className="w-full max-w-md pl-card grid gap-5 p-6">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <BrandMark productTitle={productTitle} logoUrl={logoUrl} />
            <div className="grid gap-0.5">
              <strong className="text-lg notranslate" translate="no" data-testid="login-brand-title">
                {productTitle}
              </strong>
              <span className="text-xs text-fg-muted notranslate" translate="no">
                {tagline}
              </span>
            </div>
          </div>
          <h1 className="text-xl font-semibold">
            {isBootstrap ? "创建首个所有者" : "登录"}
          </h1>
          {isBootstrap && (
            <p className="text-sm text-fg-muted">
              当前实例要求登录。请创建首个所有者账户；之后可在「登录账户」页添加运维人员，负责连接、语义、<span className="notranslate" translate="no">Eval</span> 与 <span className="notranslate" translate="no">Agent Role</span> 等日常工作。
            </p>
          )}
        </div>

        {configUnavailable && (
          <p className="text-sm text-danger" role="alert" data-testid="login-config-unavailable">
            管理员配置不可用，暂时无法登录。请联系部署人员修复管理员配置后重试。
          </p>
        )}

        <form className="grid gap-3" onSubmit={onSubmit} hidden={configUnavailable}>
          <label className="grid gap-1">
            <span className="text-sm font-medium">账户 id</span>
            <input
              className="pl-input notranslate"
              translate="no"
              autoComplete="username"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              placeholder="例：xingchen"
              required
            />
          </label>
          {isBootstrap && (
            <label className="grid gap-1">
              <span className="text-sm font-medium">引导密钥</span>
              <input
                className="pl-input"
                type="password"
                autoComplete="off"
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder="由部署人员提供"
                data-testid="login-bootstrap-token"
              />
              <span className="text-xs text-fg-muted">
                客户部署必填；仅保存在当前页面内存中，不会写入浏览器存储。
              </span>
            </label>
          )}
          {isBootstrap && (
            <label className="grid gap-1">
              <span className="text-sm font-medium">显示名（可选）</span>
              <input
                className="pl-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例：星尘"
              />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-sm font-medium">密码</span>
            <input
              className="pl-input"
              type="password"
              autoComplete={isBootstrap ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
            />
            {isBootstrap && (
              <span className="text-xs text-fg-muted">至少 10 个字符</span>
            )}
          </label>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="pl-btn pl-btn--primary" disabled={pending || loading}>
            {pending ? "提交中…" : isBootstrap ? "创建并登录" : "登录"}
          </button>
        </form>

        <p className="text-sm text-fg-muted">
          无法登录？{" "}
          <Link
            className="underline underline-offset-2"
            to="/help?section=admin-break-glass"
          >
            查看系统手册
          </Link>
        </p>
      </div>
    </div>
  );
}
