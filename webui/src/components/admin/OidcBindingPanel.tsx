/**
 * L25-06 OIDC 身份绑定 —— 读侧工具与「一个账户的」绑定分组。
 *
 * 这一版不再有页面级的整块绑定面板：登录账户页（lucy-20261030-login-accounts）
 * 把名册收成主画布，绑定分组改为在单个账户的抽屉里渲染（`OidcBindingSection`）。
 * 读侧工具（`readLoginMethods` / `readBinding`）保持原位不变。
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, apiDelete, apiPut } from "../../lib/apiClient";
import {
  OIDC_BINDING_GENERIC_COPY,
  OIDC_BUSINESS_ERROR_CODES,
  OIDC_FIXED_ERROR_COPY
} from "./OidcMessages";

/** Identity detail of one OIDC 身份绑定（identity source issuer / subject / contact email）。 */
export type OidcBindingDetail = {
  issuer?: string;
  sub?: string;
  email?: string;
};

type RawAdminRow = {
  id?: unknown;
  displayName?: unknown;
  role?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  loginMethods?: unknown;
  login_methods?: unknown;
  oidcBinding?: unknown;
  oidc_bindings?: unknown;
  oidcBindings?: unknown;
  bindings?: unknown;
};

/**
 * The backend owns the exact field names of the owner-only account view
 * (Spec §5.3 guarantees `loginMethods`; the binding detail field name is not
 * fixed yet). Read the known candidates defensively instead of assuming one:
 * a missing value means "not bound", never a crash.
 */
export function readLoginMethods(row: RawAdminRow): string[] | null {
  const raw = row.loginMethods ?? row.login_methods;
  if (!Array.isArray(raw)) return null;
  const methods = raw.filter((item): item is string => typeof item === "string");
  return methods.length ? methods : [];
}

export function readBinding(row: RawAdminRow): OidcBindingDetail | null {
  const candidates: unknown[] = [row.oidcBinding];
  for (const list of [row.oidc_bindings, row.oidcBindings, row.bindings]) {
    if (Array.isArray(list)) candidates.push(...list);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const detail = candidate as OidcBindingDetail;
    if (typeof detail.issuer === "string" && detail.issuer.trim()) return detail;
  }
  return null;
}

/**
 * Binding write failures: business-rule codes carry a user-safe Chinese message
 * written by the backend (Spec §9) and are shown as-is; anything else falls
 * back to fixed copy so a stack or IdP response never reaches the user.
 */
function readBindingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (OIDC_BUSINESS_ERROR_CODES.includes(error.code)) return error.message;
    const fixed = OIDC_FIXED_ERROR_COPY[error.code];
    if (fixed) return fixed;
  }
  return OIDC_BINDING_GENERIC_COPY;
}

/**
 * Spec §5.4 身份绑定 — the binding group of one 登录账户, rendered inside the
 * account drawer (one account at a time). It replaced the former page-level
 * panel that listed every account under the roster.
 *
 * - A bound account shows the identity source / subject / contact email read-only.
 * - An unbound account shows 「未绑定单点登录身份。」and nothing else.
 * - While 单点登录 is not enabled the group shows the not-enabled notice and
 *   offers no write control at all — an existing binding stays visible, it is
 *   never described as absent.
 */
export function OidcBindingSection({
  accountId,
  binding,
  oidcEnabled,
  onChanged
}: {
  accountId: string;
  /** The account's OIDC 身份绑定; `null` when the account is not bound. */
  binding: OidcBindingDetail | null;
  /** Whether the deployment currently exposes the OIDC login method. */
  oidcEnabled: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bindingMutation = useMutation({
    mutationFn: (input: { issuer: string; sub: string; email: string }) =>
      apiPut(`/api/admin/admins/${accountId}/oidc-binding`, {
        issuer: input.issuer,
        sub: input.sub,
        email: input.email
      }),
    onSuccess: async () => {
      setEditing(false);
      setIssuer("");
      setSubject("");
      setEmail("");
      setError(null);
      await onChanged();
    },
    onError: (err) => setError(readBindingError(err))
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { issuer: string }) =>
      apiDelete(
        `/api/admin/admins/${accountId}/oidc-binding?issuer=${encodeURIComponent(input.issuer)}`
      ),
    onSuccess: async () => {
      setError(null);
      await onChanged();
    },
    onError: (err) => setError(readBindingError(err))
  });

  const bindingIssuer = binding?.issuer ?? "";

  function openForm() {
    setError(null);
    setEditing(true);
    setIssuer("");
    setSubject("");
    setEmail("");
  }

  return (
    <div className="grid gap-2" data-testid={`oidc-binding-section-${accountId}`}>
      {binding ? (
        <dl className="grid gap-1 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-fg-muted">
              身份源<span className="notranslate" translate="no">（issuer）</span>
            </dt>
            <dd>
              <code className="notranslate" translate="no" data-testid="oidc-binding-issuer">
                {bindingIssuer || "—"}
              </code>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-fg-muted">
              主体<span className="notranslate" translate="no">（sub）</span>
            </dt>
            <dd>
              <code className="notranslate" translate="no" data-testid="oidc-binding-sub">
                {binding.sub || "—"}
              </code>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-fg-muted">
              联系邮箱<span className="notranslate" translate="no">（email）</span>
            </dt>
            <dd>
              <code className="notranslate" translate="no" data-testid="oidc-binding-email">
                {binding.email || "—"}
              </code>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-fg-muted">未绑定单点登录身份。</p>
      )}

      {!oidcEnabled && (
        <p className="text-xs text-fg-muted" data-testid="admin-oidc-bindings-disabled">
          当前未启用单点登录；新增或替换绑定需要先启用身份源配置。
        </p>
      )}

      {error && (
        <p className="text-sm text-danger" role="alert" data-testid="admin-oidc-binding-error">
          {error}
        </p>
      )}

      {oidcEnabled && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={openForm}
            data-testid={`oidc-binding-edit-${accountId}`}
          >
            新增／替换绑定
          </button>
          {bindingIssuer && (
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `确定删除登录账户 ${accountId} 的单点登录身份绑定？该操作会先撤销该账户的既有会话。`
                  )
                ) {
                  deleteMutation.mutate({ issuer: bindingIssuer });
                }
              }}
              data-testid={`oidc-binding-delete-${accountId}`}
            >
              删除绑定
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="grid gap-2" data-testid={`oidc-binding-form-${accountId}`}>
          <label className="grid gap-1">
            <span className="text-sm font-medium">
              身份源<span className="notranslate" translate="no">（issuer）</span>
            </span>
            <input
              className="pl-input notranslate"
              translate="no"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://idp.example.com"
              data-testid="oidc-binding-issuer-input"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">
              主体<span className="notranslate" translate="no">（sub）</span>
            </span>
            <input
              className="pl-input notranslate"
              translate="no"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="oidc-binding-sub-input"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">
              联系邮箱<span className="notranslate" translate="no">（email）</span>
            </span>
            <input
              className="pl-input notranslate"
              translate="no"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="oidc-binding-email-input"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              disabled={bindingMutation.isPending}
              onClick={() =>
                bindingMutation.mutate({
                  issuer: issuer.trim(),
                  sub: subject.trim(),
                  email: email.trim()
                })
              }
              data-testid="oidc-binding-save"
            >
              保存绑定
            </button>
            <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
