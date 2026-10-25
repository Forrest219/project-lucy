import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/apiClient";
import { useAuth } from "../../lib/auth";
import {
  OidcAccountView,
  OidcBindingPanel,
  readBinding,
  readLoginMethods
} from "../../components/admin/OidcBindingPanel";
import {
  OIDC_BUSINESS_ERROR_CODES,
  OIDC_FIXED_ERROR_COPY
} from "../../components/admin/OidcMessages";

type AdminRole = "owner" | "operator";

type AdminRow = {
  id: string;
  displayName: string;
  role: AdminRole;
  enabled: boolean;
  createdAt: string | null;
  /**
   * Owner-only view fields (L25-06). The backend owns the exact field names
   * (`loginMethods` is fixed by Spec §5.3; the binding detail field name is
   * not), so they are read defensively: a missing value means "not bound"
   * instead of breaking the page.
   */
  loginMethods?: unknown;
  login_methods?: unknown;
  oidcBinding?: unknown;
  oidc_bindings?: unknown;
  oidcBindings?: unknown;
  bindings?: unknown;
};

type AdminsResponse = {
  mode: string;
  admins: AdminRow[];
};

function roleLabel(role: AdminRole): string {
  return role === "owner" ? "所有者" : "运维";
}

function loginMethodLabel(row: AdminRow): string {
  const methods = readLoginMethods(row);
  const binding = readBinding(row);
  if (!methods) return binding ? "单点登录" : "本地账户登录";
  const parts: string[] = [];
  if (methods.includes("local")) parts.push("本地账户登录");
  if (methods.includes("oidc")) parts.push("单点登录");
  return parts.length ? parts.join(" · ") : "无可用登录方式";
}

function toAccountView(row: AdminRow): OidcAccountView {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    enabled: row.enabled,
    loginMethods: readLoginMethods(row),
    binding: readBinding(row)
  };
}

/**
 * Account creation may carry an OIDC 身份绑定 (Spec §5.3): with a binding the
 * local password may be omitted (OIDC-only account) or kept (dual credential).
 */
function createErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    if (OIDC_BUSINESS_ERROR_CODES.includes(error.code)) return error.message;
    const fixed = OIDC_FIXED_ERROR_COPY[error.code];
    if (fixed) return fixed;
  }
  return error instanceof ApiError ? error.message : "创建失败";
}

export function AdminAccounts() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const [adminId, setAdminId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("operator");
  const [bindingIssuer, setBindingIssuer] = useState("");
  const [bindingSub, setBindingSub] = useState("");
  const [bindingEmail, setBindingEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => apiGet<AdminsResponse>("/api/admin/admins")
  });

  // An OIDC 身份绑定 draft is all-or-nothing: the identity source issuer, the
  // subject and the contact email always travel together (Spec §5.3).
  const bindingDraftStarted =
    bindingIssuer.trim() !== "" || bindingSub.trim() !== "" || bindingEmail.trim() !== "";
  const oidcBindingDraft =
    bindingIssuer.trim() !== "" && bindingSub.trim() !== "" && bindingEmail.trim() !== ""
      ? { issuer: bindingIssuer.trim(), sub: bindingSub.trim(), email: bindingEmail.trim() }
      : null;

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ admin: AdminRow }>("/api/admin/admins", {
        adminId,
        displayName: displayName || undefined,
        password: password || undefined,
        role,
        ...(oidcBindingDraft ? { oidcBinding: oidcBindingDraft } : {})
      }),
    onSuccess: async () => {
      setAdminId("");
      setDisplayName("");
      setPassword("");
      setBindingIssuer("");
      setBindingSub("");
      setBindingEmail("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    },
    onError: (err) => {
      setFormError(createErrorCopy(err));
    }
  });

  const patchMutation = useMutation({
    mutationFn: (input: { id: string; enabled?: boolean; role?: AdminRole }) =>
      apiPatch<{ admin: AdminRow }>(`/api/admin/admins/${input.id}`, {
        enabled: input.enabled,
        role: input.role
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete<{ deleted: string }>(`/api/admin/admins/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    }
  });

  const isOwner = status?.me?.role === "owner";
  const authRequired = status?.mode === "required";
  // 单点登录 binding writes only make sense while the deployment exposes the
  // OIDC login method; the view stays visible either way.
  const oidcEnabled = (status?.methods ?? []).includes("oidc");
  const accountViews = (query.data?.admins ?? []).map(toAccountView);

  function onCreate(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="pl-page">
      <PageHeader
        title="登录账户"
        description={
          <>
            管理 <span className="notranslate" translate="no">WebUI</span> 登录账户，并配置所有者或运维角色。
          </>
        }
      />

      {!authRequired && (
        <div className="pl-card p-4 text-sm text-fg-muted">
          当前为开放模式（尚未配置登录账户）。设置环境变量{" "}
          <code className="notranslate" translate="no">
            LUCY_WEBUI_AUTH=required
          </code>{" "}
          并打开{" "}
          <Link to="/login" className="underline">
            登录页
          </Link>{" "}
          创建首个所有者后，即可添加运维账户。若丢失全部登录凭据，见系统手册「丢失管理员账号或密码时如何恢复（break-glass）」——自托管不提供邮箱找回。
        </div>
      )}

      <section className="pl-data-grid-frame" data-testid="admin-accounts-grid-frame">
        <div className="pl-data-grid-scroll" data-testid="admin-accounts-grid-scroll">
        <table className="pl-data-grid pl-data-table w-full" data-testid="admin-accounts-table">
          <thead>
            <tr>
              <th>登录账户</th>
              <th>显示名</th>
              <th>角色</th>
              <th>状态</th>
              {isOwner && authRequired && <th>登录方式</th>}
              {isOwner && authRequired && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(query.data?.admins ?? []).map((row) => (
              <tr key={row.id}>
                <td className="font-mono notranslate" translate="no">
                  {row.id}
                </td>
                <td>{row.displayName}</td>
                <td>{roleLabel(row.role)}</td>
                <td>{row.enabled ? "启用" : "已禁用"}</td>
                {isOwner && authRequired && (
                  <td data-testid={`admin-login-methods-${row.id}`}>{loginMethodLabel(row)}</td>
                )}
                {isOwner && authRequired && (
                  <td className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost"
                      disabled={patchMutation.isPending}
                      onClick={() =>
                        patchMutation.mutate({ id: row.id, enabled: !row.enabled })
                      }
                    >
                      {row.enabled ? "禁用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`确定删除登录账户 ${row.id}？`)) {
                          deleteMutation.mutate(row.id);
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {isOwner && authRequired && (
        <form className="pl-card grid gap-3 p-4" onSubmit={onCreate}>
          <h2 className="text-base font-semibold">添加登录账户</h2>
          <label className="grid gap-1">
            <span className="text-sm font-medium">登录账户</span>
            <input
              className="pl-input notranslate"
              translate="no"
              autoComplete="username"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              placeholder="请输入登录账户"
              required
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">显示名</span>
            <input
              className="pl-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          {/* The role select must NOT stay inside the <label>: a label's text content
              also captures the control's own option text and the help text below it, so
              the accessible name of the select became the whole sentence
              ("角色运维所有者运维：连接、语义、Wiki、发布、Eval、Agent / Role / Token 。所有者：另含登录账户治理。").
              A screen reader announced that blob instead of "角色", and a substring
              label lookup ("登录账户") matched the select as well as the account
              input. The label now names the control through htmlFor, and the help
              text is a sibling. */}
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="admin-new-role">
              角色
            </label>
            <select
              id="admin-new-role"
              className="pl-input"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
            >
              <option value="operator">运维</option>
              <option value="owner">所有者</option>
            </select>
            <span className="text-xs text-fg-muted">
              运维：连接、语义、Wiki、发布、Eval、
              <span className="notranslate" translate="no">
                Agent
              </span>
              {" / "}
              <span className="notranslate" translate="no">
                Role
              </span>
              {" / "}
              <span className="notranslate" translate="no">
                Token
              </span>
              。所有者：另含登录账户治理。
            </span>
          </div>
          <label className="grid gap-1">
            <span className="text-sm font-medium">初始密码</span>
            <input
              className="pl-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required={!bindingDraftStarted}
            />
            {bindingDraftStarted && (
              <span className="text-xs text-fg-muted">
                已填写单点登录身份绑定，本地密码可以留空（仅单点登录登录方式）。
              </span>
            )}
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium">
              <span className="notranslate" translate="no">OIDC</span> 身份绑定（可选）
            </span>
            <label className="grid gap-1">
              <span className="text-xs text-fg-muted">
                身份源<span className="notranslate" translate="no">（issuer）</span>
              </span>
              <input
                className="pl-input notranslate"
                translate="no"
                value={bindingIssuer}
                onChange={(e) => setBindingIssuer(e.target.value)}
                placeholder="https://idp.example.com"
                data-testid="admin-create-binding-issuer"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-fg-muted">
                主体<span className="notranslate" translate="no">（sub）</span>
              </span>
              <input
                className="pl-input notranslate"
                translate="no"
                value={bindingSub}
                onChange={(e) => setBindingSub(e.target.value)}
                data-testid="admin-create-binding-sub"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-fg-muted">
                联系邮箱<span className="notranslate" translate="no">（email）</span>
              </span>
              <input
                className="pl-input notranslate"
                translate="no"
                value={bindingEmail}
                onChange={(e) => setBindingEmail(e.target.value)}
                data-testid="admin-create-binding-email"
              />
            </label>
            <span className="text-xs text-fg-muted">
              三个字段需要一起填写；留空表示不创建绑定。邮箱仅作所有者维护的联系信息，不参与登录匹配。
            </span>
          </div>
          {formError && (
            <p className="text-sm text-danger" role="alert">
              {formError}
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" className="pl-btn pl-btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "创建中…" : "创建账户"}
            </button>
          </div>
        </form>
      )}

      {isOwner && authRequired && (
        <OidcBindingPanel
          accounts={accountViews}
          oidcEnabled={oidcEnabled}
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
          }}
        />
      )}
    </div>
  );
}
