import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, apiDelete, apiPatch, apiPut } from "../../lib/apiClient";
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

/** One 登录账户 as seen by the owner-only binding view. */
export type OidcAccountView = {
  id: string;
  displayName: string;
  role: "owner" | "operator";
  enabled: boolean;
  /** Login methods reported by the backend; `null` when the backend did not report them. */
  loginMethods: string[] | null;
  /** The account's OIDC 身份绑定; `null` when the account is not bound. */
  binding: OidcBindingDetail | null;
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
export function readBindingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (OIDC_BUSINESS_ERROR_CODES.includes(error.code)) return error.message;
    const fixed = OIDC_FIXED_ERROR_COPY[error.code];
    if (fixed) return fixed;
  }
  return OIDC_BINDING_GENERIC_COPY;
}

function loginMethodText(methods: string[] | null, hasBinding: boolean): string {
  if (!methods) return hasBinding ? "单点登录" : "本地账户登录";
  const parts: string[] = [];
  if (methods.includes("local")) parts.push("本地账户登录");
  if (methods.includes("oidc")) parts.push("单点登录");
  return parts.length ? parts.join(" · ") : "无可用登录方式";
}

/**
 * Owner-only OIDC 身份绑定 maintenance (Spec §3.3 / §5.3):
 * view 登录方式, add / replace a binding, delete a binding, remove the local
 * password. Operators never get these write controls — the panel is rendered
 * by the accounts page for owners only.
 */
export function OidcBindingPanel({
  accounts,
  oidcEnabled,
  onChanged
}: {
  accounts: OidcAccountView[];
  /** Whether the deployment currently exposes the OIDC login method. */
  oidcEnabled: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [issuer, setIssuer] = useState("");
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bindingMutation = useMutation({
    mutationFn: (input: { id: string; issuer: string; sub: string; email: string }) =>
      apiPut(`/api/admin/admins/${input.id}/oidc-binding`, {
        issuer: input.issuer,
        sub: input.sub,
        email: input.email
      }),
    onSuccess: async () => {
      setEditingId(null);
      setIssuer("");
      setSubject("");
      setEmail("");
      setError(null);
      await onChanged();
    },
    onError: (err) => setError(readBindingError(err))
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { id: string; issuer: string }) =>
      apiDelete(
        `/api/admin/admins/${input.id}/oidc-binding?issuer=${encodeURIComponent(input.issuer)}`
      ),
    onSuccess: async () => {
      setError(null);
      await onChanged();
    },
    onError: (err) => setError(readBindingError(err))
  });

  const removePasswordMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/admin/admins/${id}`, { removeLocalPassword: true }),
    onSuccess: async () => {
      setError(null);
      await onChanged();
    },
    onError: (err) => setError(readBindingError(err))
  });

  function openForm(accountId: string) {
    setError(null);
    setEditingId(accountId);
    setIssuer("");
    setSubject("");
    setEmail("");
  }

  return (
    <section className="pl-card grid gap-3 p-4" data-testid="admin-oidc-bindings">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">
          <span className="notranslate" translate="no">OIDC</span> 身份绑定
        </h2>
        <p className="text-xs text-fg-muted">
          单点登录的唯一匹配键是
          <span className="notranslate" translate="no">（身份源 issuer, 主体 sub）</span>
          ；邮箱仅作所有者维护的联系信息，不参与登录匹配。
        </p>
        {!oidcEnabled && (
          <p className="text-xs text-fg-muted" data-testid="admin-oidc-bindings-disabled">
            当前未启用单点登录；新增或替换绑定需要先启用身份源配置。
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-danger" role="alert" data-testid="admin-oidc-binding-error">
          {error}
        </p>
      )}

      {accounts.map((account) => {
        const methods = account.loginMethods;
        // A backend that does not report login methods yet still has local
        // passwords on every account (creation requires one), so the local
        // password control stays available until the backend reports it.
        const hasLocalPassword = methods ? methods.includes("local") : true;
        const bindingIssuer = account.binding?.issuer ?? "";
        return (
          <div
            key={account.id}
            className="grid gap-2 border-t border-border-default pt-3"
            data-testid={`oidc-binding-row-${account.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono notranslate" translate="no">
                {account.id}
              </span>
              <span className="text-sm text-fg-muted">{account.displayName}</span>
              <span className="text-xs text-fg-muted">
                登录方式：{loginMethodText(methods, account.binding != null)}
              </span>
            </div>

            {account.binding ? (
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
                      {account.binding.sub || "—"}
                    </code>
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <dt className="text-fg-muted">
                    联系邮箱<span className="notranslate" translate="no">（email）</span>
                  </dt>
                  <dd>
                    <code className="notranslate" translate="no" data-testid="oidc-binding-email">
                      {account.binding.email || "—"}
                    </code>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-fg-muted">未绑定单点登录身份。</p>
            )}

            <div className="flex flex-wrap gap-2">
              {oidcEnabled && (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => openForm(account.id)}
                  data-testid={`oidc-binding-edit-${account.id}`}
                >
                  新增／替换绑定
                </button>
              )}
              {bindingIssuer && (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `确定删除登录账户 ${account.id} 的单点登录身份绑定？该操作会先撤销该账户的既有会话。`
                      )
                    ) {
                      deleteMutation.mutate({ id: account.id, issuer: bindingIssuer });
                    }
                  }}
                  data-testid={`oidc-binding-delete-${account.id}`}
                >
                  删除绑定
                </button>
              )}
              {hasLocalPassword && (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  disabled={removePasswordMutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `确定移除登录账户 ${account.id} 的本地密码？该账户将只能使用单点登录登录。`
                      )
                    ) {
                      removePasswordMutation.mutate(account.id);
                    }
                  }}
                  data-testid={`oidc-password-remove-${account.id}`}
                >
                  移除本地密码
                </button>
              )}
            </div>

            {editingId === account.id && (
              <div className="grid gap-2" data-testid={`oidc-binding-form-${account.id}`}>
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
                        id: account.id,
                        issuer: issuer.trim(),
                        sub: subject.trim(),
                        email: email.trim()
                      })
                    }
                    data-testid="oidc-binding-save"
                  >
                    保存绑定
                  </button>
                  <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setEditingId(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
