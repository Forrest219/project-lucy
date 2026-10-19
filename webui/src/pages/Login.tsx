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
  const [passwordVisible, setPasswordVisible] = useState(false);
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
          {isBootstrap && <h1 className="text-xl font-semibold">创建首个所有者</h1>}
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

        <form className="grid gap-4" onSubmit={onSubmit} hidden={configUnavailable}>
          <label className="grid gap-1">
            <span className="text-sm font-medium">登录账户</span>
            <input
              className="pl-input min-h-11 notranslate"
              translate="no"
              autoComplete="username"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              placeholder="例：lucy"
              required
            />
          </label>
          {isBootstrap && (
            <label className="grid gap-1">
              <span className="text-sm font-medium">引导密钥</span>
              <input
                className="pl-input min-h-11"
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
                className="pl-input min-h-11"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例：星尘"
              />
            </label>
          )}
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="login-password">密码</label>
            <div className="relative">
              <input
                id="login-password"
                className="pl-input min-h-11 pr-11"
                type={passwordVisible ? "text" : "password"}
                autoComplete={isBootstrap ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-fg-muted hover:text-fg-default"
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                aria-pressed={passwordVisible}
                data-testid="login-password-toggle"
                onClick={() => setPasswordVisible((visible) => !visible)}
              >
                {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {isBootstrap && (
              <span className="text-xs text-fg-muted">至少 10 个字符</span>
            )}
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="pl-btn pl-btn--primary mt-2 min-h-11" disabled={pending || loading}>
            {pending ? "提交中…" : isBootstrap ? "创建并登录" : "登录"}
          </button>
        </form>

        <p className="text-xs text-fg-muted">
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

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9M6.1 6.3C4.2 7.6 2.8 9.5 2 12c1.2 2.2 4.2 6 10 6 1.6 0 3-.3 4.2-.9M10.6 6.1A11 11 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-3.2 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
