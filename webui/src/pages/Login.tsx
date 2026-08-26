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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const productTitle = branding?.productTitle ?? "Lucy WebUI";
  const logoUrl = branding?.logoUrl ?? null;

  if (!loading && status?.mode === "open") {
    return <Navigate to="/overview" replace />;
  }
  if (!loading && status?.mode === "required" && status.me) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/overview";
    return <Navigate to={redirectTo} replace />;
  }

  const isBootstrap = status?.mode === "bootstrap";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (isBootstrap) {
        await bootstrap({ adminId, displayName: displayName || undefined, password });
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
    <div className="min-h-screen flex items-center justify-center bg-[var(--pl-bg)] px-4">
      <div className="w-full max-w-md pl-card grid gap-5 p-6">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <BrandMark productTitle={productTitle} logoUrl={logoUrl} />
            <strong className="text-lg notranslate" translate="no" data-testid="login-brand-title">
              {productTitle}
            </strong>
          </div>
          <h1 className="text-xl font-semibold">
            {isBootstrap ? "创建首个所有者" : "登录"}
          </h1>
          <p className="text-sm text-fg-muted">
            {isBootstrap
              ? "当前实例要求登录。请创建首个所有者账户；之后可在「登录账户」页添加运维人员，负责连接、语义、Eval 与 Agent Role 等日常工作。"
              : "使用账户 id 与密码登录。运维与所有者共用此入口；Agent Token 不能用于 WebUI 登录。"}
          </p>
        </div>

        <form className="grid gap-3" onSubmit={onSubmit}>
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
          无法登录时仍可{" "}
          <Link
            className="underline underline-offset-2"
            to="/help?section=webui-admin-break-glass"
          >
            查看系统手册
          </Link>
          （无需登录），含凭据丢失时的 break-glass 恢复说明。
        </p>
      </div>
    </div>
  );
}
