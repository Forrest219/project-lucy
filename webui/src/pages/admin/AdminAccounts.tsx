import { FormEvent, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import { PageHeader } from "../../components/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/apiClient";
import { useAuth } from "../../lib/auth";
import {
  OidcBindingSection,
  readBinding,
  readLoginMethods
} from "../../components/admin/OidcBindingPanel";

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

/** The three protections of Spec §6 that block a write on the account roster. */
export type GuardAction = "disable" | "delete" | "demote";

export const CURRENT_LOGIN_DISABLE_REASON = "无法禁用当前登录账户";
export const CURRENT_LOGIN_DELETE_REASON = "无法删除当前登录账户";
export const ENABLED_OWNER_FLOOR_REASON = "至少保留一名启用中的所有者";
export const LOCAL_OWNER_FLOOR_REASON = "至少保留一名可使用本地密码登录的启用中所有者";

/**
 * Spec §6 / D16 — a missing `loginMethods` field means the account still has a
 * local password; an empty array means it does not.
 */
export function treatsAsLocalPassword(row: AdminRow): boolean {
  const methods = readLoginMethods(row);
  if (methods === null) return true;
  return methods.includes("local");
}

/**
 * Spec §6 「核心流程（伪代码）」`guard` — the reasons one action on one row may
 * not run. The order is fixed: 当前登录, then 启用所有者底线, then 本地密码底线.
 * The count is taken from the roster already on screen; no extra request.
 */
export function guardReasons(
  row: AdminRow,
  action: GuardAction,
  meId: string | undefined,
  rows: AdminRow[]
): string[] {
  const reasons: string[] = [];
  const owners = rows.filter((item) => item.enabled && item.role === "owner");
  const localOwners = owners.filter(treatsAsLocalPassword);
  if (action === "disable" && row.id === meId) reasons.push(CURRENT_LOGIN_DISABLE_REASON);
  if (action === "delete" && row.id === meId) reasons.push(CURRENT_LOGIN_DELETE_REASON);
  if (row.role === "owner" && row.enabled) {
    if (owners.length === 1) reasons.push(ENABLED_OWNER_FLOOR_REASON);
    if (treatsAsLocalPassword(row) && localOwners.length === 1) {
      reasons.push(LOCAL_OWNER_FLOOR_REASON);
    }
  }
  return reasons;
}

/** The reasons read as one sentence — the order is the order of `guardReasons`. */
export function joinReasons(reasons: string[]): string {
  return reasons.length ? `${reasons.join("。")}。` : "";
}

/**
 * Spec §6 / D18 — the delete confirmation compares the typed id after
 * removing the leading and trailing whitespace only (space, tab, CR, LF).
 * The case is significant and no character in the middle is removed.
 */
export function trimEdges(value: string): string {
  return value.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

/**
 * Spec §6 — the interface copy for the codes the account endpoints answer
 * with. It is the wording the backend itself returns (see
 * `server/auth/routes.ts`), kept here so the page never invents its own.
 */
const ACCOUNT_ERROR_COPY: Readonly<Record<string, string>> = {
  LAST_OWNER_REQUIRED: ENABLED_OWNER_FLOOR_REASON,
  LOCAL_OWNER_REQUIRED: LOCAL_OWNER_FLOOR_REASON,
  AUTH_CREDENTIAL_REQUIRED: "登录账户至少需要一种可用登录方式"
};

function accountErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    const fixed = ACCOUNT_ERROR_COPY[error.code];
    if (fixed) return fixed;
    return error.message;
  }
  return "操作失败，请稍后重试";
}

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

/**
 * A button blocked by a protection stays on the page with
 * `aria-disabled="true"` instead of the native `disabled`, so it can still be
 * focused and can show the reason on hover and on focus. The reason node lives
 * in the DOM even while the tooltip is closed, and the tooltip repeats the
 * very same sentence.
 */
function GuardedButton({
  label,
  reasons,
  variant = "ghost",
  testId
}: {
  label: string;
  reasons: string[];
  variant?: "ghost" | "danger";
  testId: string;
}) {
  const reasonId = useId();
  const text = joinReasons(reasons);
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={`pl-btn pl-btn--${variant}`}
            aria-disabled="true"
            aria-describedby={reasonId}
            data-testid={testId}
            onClick={(event) => {
              // A blocked action never reaches the interface.
              event.preventDefault();
            }}
            onKeyDown={(event) => {
              // Enter and Space would otherwise synthesize a click.
              if (event.key === "Enter" || event.key === " ") event.preventDefault();
            }}
          >
            {label}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="pl-tooltip-content"
            side="top"
            sideOffset={8}
            collisionPadding={8}
            data-testid={`${testId}-tooltip`}
          >
            <p className="m-0">{text}</p>
            <Tooltip.Arrow className="pl-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <span id={reasonId} className="sr-only" data-testid={`${testId}-reason`}>
        {text}
      </span>
    </Tooltip.Provider>
  );
}

export function AdminAccounts() {
  const { status } = useAuth();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [managedId, setManagedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => apiGet<AdminsResponse>("/api/admin/admins")
  });

  const rows = useMemo<AdminRow[]>(() => query.data?.admins ?? [], [query.data]);

  const isOwner = status?.me?.role === "owner";
  const authRequired = status?.mode === "required";
  // 单点登录 binding writes only make sense while the deployment exposes the
  // OIDC login method; the view stays visible either way.
  const oidcEnabled = (status?.methods ?? []).includes("oidc");
  const meId = status?.me?.id;
  // 运维 and 开放模式 see a read-only roster of four columns.
  const ownerView = Boolean(isOwner && authRequired);

  const managedRow = managedId ? rows.find((row) => row.id === managedId) ?? null : null;
  const confirmRow = confirmDeleteId ? rows.find((row) => row.id === confirmDeleteId) ?? null : null;

  const patchMutation = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) =>
      apiPatch(`/api/admin/admins/${input.id}`, input.body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/admins/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    }
  });

  function patchAccount(id: string, body: Record<string, unknown>, onDone?: () => void) {
    patchMutation.mutate(
      { id, body },
      { onSuccess: () => onDone?.() }
    );
  }

  function forgetAccountErrors() {
    // D15: a rejection stays on the drawer or confirm that produced it.
    // Leaving that account drops the message so the next account starts clean.
    patchMutation.reset();
    deleteMutation.reset();
  }

  function openDrawer(id: string) {
    if (id !== managedId) forgetAccountErrors();
    setCreateOpen(false);
    setManagedId(id);
    setConfirmDeleteId(null);
  }

  function closeDrawer() {
    setManagedId(null);
    setConfirmDeleteId(null);
    forgetAccountErrors();
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="登录账户"
        description={
          <>
            管理 <span className="notranslate" translate="no">WebUI</span> 登录账户，并配置所有者或运维角色。
          </>
        }
        actions={
          ownerView ? (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={() => {
                setManagedId(null);
                setConfirmDeleteId(null);
                forgetAccountErrors();
                setCreateOpen(true);
              }}
              data-testid="admin-account-create-open"
            >
              新建账户
            </button>
          ) : undefined
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

      {ownerView && !oidcEnabled && (
        <p className="text-xs text-fg-muted" data-testid="admin-accounts-oidc-disabled-notice">
          当前未启用单点登录；新增或替换绑定需要先启用身份源配置。
        </p>
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
                {ownerView && <th>登录方式</th>}
                {ownerView && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`admin-account-row-${row.id}`}>
                  <td className="font-mono notranslate" translate="no">
                    {row.id}
                    {row.id === meId ? (
                      <span
                        className="ml-2 rounded-sm bg-bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
                        data-testid={`admin-account-current-${row.id}`}
                      >
                        当前登录
                      </span>
                    ) : null}
                  </td>
                  <td>{row.displayName}</td>
                  <td>{roleLabel(row.role)}</td>
                  <td>{row.enabled ? "启用" : "已禁用"}</td>
                  {ownerView && (
                    <td data-testid={`admin-login-methods-${row.id}`}>{loginMethodLabel(row)}</td>
                  )}
                  {ownerView && (
                    <td>
                      <button
                        type="button"
                        className="pl-btn pl-btn--ghost"
                        onClick={() => openDrawer(row.id)}
                        data-testid={`admin-account-manage-${row.id}`}
                      >
                        管理
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen ? (
        <CreateAccountDialog
          oidcEnabled={oidcEnabled}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
          }}
        />
      ) : null}

      {managedRow ? (
        <AccountDrawer
          row={managedRow}
          rows={rows}
          meId={meId}
          oidcEnabled={oidcEnabled}
          error={
            patchMutation.isError && patchMutation.variables?.id === managedRow.id
              ? accountErrorCopy(patchMutation.error)
              : null
          }
          onClose={closeDrawer}
          onOpenDeleteConfirm={() => setConfirmDeleteId(managedRow.id)}
          onPatch={(body, onDone) => patchAccount(managedRow.id, body, onDone)}
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
          }}
        />
      ) : null}

      {confirmRow ? (
        <DeleteAccountConfirm
          row={confirmRow}
          error={
            deleteMutation.isError && deleteMutation.variables === confirmRow.id
              ? accountErrorCopy(deleteMutation.error)
              : null
          }
          onCancel={() => {
            deleteMutation.reset();
            setConfirmDeleteId(null);
          }}
          onConfirm={() => {
            deleteMutation.mutate(confirmRow.id, {
              onSuccess: () => {
                setConfirmDeleteId(null);
                setManagedId(null);
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Spec §5.3 — the create dialog. 单点登录 not enabled means no binding fields
 * at all; enabled means the binding appears only behind 「同时绑定单点登录」.
 */
function CreateAccountDialog({
  oidcEnabled,
  onClose,
  onCreated
}: {
  oidcEnabled: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [adminId, setAdminId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("operator");
  const [bindChecked, setBindChecked] = useState(false);
  const [bindingIssuer, setBindingIssuer] = useState("");
  const [bindingSub, setBindingSub] = useState("");
  const [bindingEmail, setBindingEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // The binding only travels when 「同时绑定单点登录」is checked: unchecking the
  // box must drop a binding that was already typed (Spec §5.3).
  const bindingDraft =
    oidcEnabled &&
    bindChecked &&
    bindingIssuer.trim() !== "" &&
    bindingSub.trim() !== "" &&
    bindingEmail.trim() !== ""
      ? { issuer: bindingIssuer.trim(), sub: bindingSub.trim(), email: bindingEmail.trim() }
      : null;

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ admin: AdminRow }>("/api/admin/admins", {
        adminId,
        displayName: displayName || undefined,
        password: password || undefined,
        role,
        ...(bindingDraft ? { oidcBinding: bindingDraft } : {})
      }),
    onSuccess: async () => {
      setFormError(null);
      await onCreated();
    },
    onError: (err) => setFormError(accountErrorCopy(err))
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="pl-modal-backdrop">
      <div
        className="pl-modal-panel flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden"
        data-testid="admin-account-create-modal"
      >
        <h2 className="mb-4 shrink-0 text-lg font-semibold">新建账户</h2>
        <form className="grid min-h-0 gap-4 overflow-y-auto" onSubmit={onCreate}>
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
              required={!(oidcEnabled && bindChecked)}
            />
            {oidcEnabled && bindChecked && (
              <span className="text-xs text-fg-muted">
                已填写单点登录身份绑定，本地密码可以留空（仅单点登录登录方式）。
              </span>
            )}
          </label>
          {oidcEnabled && (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={bindChecked}
                  onChange={(e) => setBindChecked(e.target.checked)}
                  data-testid="admin-create-bind-toggle"
                />
                同时绑定单点登录
              </label>
              {bindChecked && (
                <>
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
                      required
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
                      required
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
                      required
                      data-testid="admin-create-binding-email"
                    />
                  </label>
                  <span className="text-xs text-fg-muted">
                    三个字段需要一起填写；邮箱仅作所有者维护的联系信息，不参与登录匹配。
                  </span>
                </>
              )}
            </div>
          )}
          {formError && (
            <p className="text-sm text-danger" role="alert" data-testid="admin-account-create-error">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="pl-btn pl-btn--primary"
              disabled={createMutation.isPending}
              data-testid="admin-account-create-submit"
            >
              {createMutation.isPending ? "创建中…" : "创建账户"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Spec §5.4 — the account drawer. One account at a time; the role, the status,
 * the local password, the identity binding and the delete entry live here.
 */
function AccountDrawer({
  row,
  rows,
  meId,
  oidcEnabled,
  error,
  onClose,
  onOpenDeleteConfirm,
  onPatch,
  onChanged
}: {
  row: AdminRow;
  rows: AdminRow[];
  meId: string | undefined;
  oidcEnabled: boolean;
  error: string | null;
  onClose: () => void;
  onOpenDeleteConfirm: () => void;
  onPatch: (body: Record<string, unknown>, onDone?: () => void) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const roleReasonId = useId();

  const disableReasons = row.enabled ? guardReasons(row, "disable", meId, rows) : [];
  const deleteReasons = guardReasons(row, "delete", meId, rows);
  const demoteReasons = guardReasons(row, "demote", meId, rows);
  const demoteBlocked = demoteReasons.length > 0;

  const owners = rows.filter((item) => item.enabled && item.role === "owner");
  const localOwners = owners.filter(treatsAsLocalPassword);
  const showRemoveLocalPassword =
    oidcEnabled &&
    readBinding(row) !== null &&
    treatsAsLocalPassword(row) &&
    !(row.role === "owner" && row.enabled && localOwners.length === 1);

  function onRoleChange(next: AdminRole) {
    if (next === "operator" && demoteBlocked) {
      // The 运维 option is disabled; a blocked change never reaches the interface.
      return;
    }
    onPatch({ role: next });
  }

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label={row.id}
      translate="no"
      data-testid={`admin-account-drawer-${row.id}`}
    >
      <div className="pl-drawer-panel">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no" data-testid="admin-account-drawer-title">
              {row.id}
            </h2>
            <p className="pl-notice">
              显示名：{row.displayName || "—"}（只读）
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onClose}
            aria-label="关闭"
            data-testid="admin-account-drawer-close"
          >
            关闭
          </button>
        </header>

        {error && (
          <p className="text-sm text-danger" role="alert" data-testid="admin-account-drawer-error">
            {error}
          </p>
        )}

        <div className="pl-drawer-body">
          <section className="grid gap-1">
            <label className="text-sm font-medium" htmlFor={`admin-account-role-${row.id}`}>
              角色
            </label>
            <select
              id={`admin-account-role-${row.id}`}
              className="pl-input"
              value={row.role}
              aria-describedby={demoteBlocked ? roleReasonId : undefined}
              onChange={(e) => onRoleChange(e.target.value as AdminRole)}
              data-testid={`admin-account-role-select-${row.id}`}
            >
              <option value="operator" disabled={demoteBlocked}>
                运维
              </option>
              <option value="owner">所有者</option>
            </select>
            {demoteBlocked ? (
              <span
                id={roleReasonId}
                className="text-xs text-fg-muted"
                data-testid={`admin-account-role-reason-${row.id}`}
              >
                {joinReasons(demoteReasons)}
              </span>
            ) : null}
          </section>

          <section className="grid gap-1">
            <span className="text-sm font-medium">状态</span>
            {row.enabled ? (
              disableReasons.length > 0 ? (
                <GuardedButton
                  label="禁用"
                  reasons={disableReasons}
                  testId={`admin-account-toggle-${row.id}`}
                />
              ) : (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => onPatch({ enabled: false })}
                  data-testid={`admin-account-toggle-${row.id}`}
                >
                  禁用
                </button>
              )
            ) : (
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => onPatch({ enabled: true })}
                data-testid={`admin-account-toggle-${row.id}`}
              >
                启用
              </button>
            )}
          </section>

          <section className="grid gap-1">
            <span className="text-sm font-medium">本地密码</span>
            <input
              className="pl-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordSaved(false);
              }}
              aria-label="新密码"
              data-testid={`admin-account-password-input-${row.id}`}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => {
                  setPasswordSaved(false);
                  onPatch({ password }, () => {
                    setPassword("");
                    setPasswordSaved(true);
                  });
                }}
                data-testid={`admin-account-password-save-${row.id}`}
              >
                保存密码
              </button>
              {showRemoveLocalPassword ? (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        `确定移除登录账户 ${row.id} 的本地密码？该账户之后使用单点登录登录。`
                      )
                    ) {
                      onPatch({ removeLocalPassword: true });
                    }
                  }}
                  data-testid={`oidc-password-remove-${row.id}`}
                >
                  移除本地密码
                </button>
              ) : null}
            </div>
            {passwordSaved ? (
              <p className="text-xs text-fg-muted" data-testid="admin-account-password-saved">
                本地密码已更新。
              </p>
            ) : null}
          </section>

          <section className="grid gap-1">
            <span className="text-sm font-medium">身份绑定</span>
            <OidcBindingSection
              accountId={row.id}
              binding={readBinding(row)}
              oidcEnabled={oidcEnabled}
              onChanged={onChanged}
            />
          </section>
        </div>

        <footer className="flex justify-end">
          {deleteReasons.length > 0 ? (
            <GuardedButton
              label="删除账户"
              variant="danger"
              reasons={deleteReasons}
              testId={`admin-account-delete-${row.id}`}
            />
          ) : (
            <button
              type="button"
              className="pl-btn pl-btn--danger"
              onClick={onOpenDeleteConfirm}
              data-testid={`admin-account-delete-${row.id}`}
            >
              删除账户
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Spec §5.5 — the delete confirmation. The 「删除账户」 button stays inert
 * until the typed 登录账户 id equals the account id after the leading and
 * trailing whitespace is removed.
 */
function DeleteAccountConfirm({
  row,
  error,
  onCancel,
  onConfirm
}: {
  row: AdminRow;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = trimEdges(typed) === row.id;

  return (
    <div className="pl-modal-backdrop">
      <div className="pl-modal-panel" role="dialog" aria-modal="true" aria-label="删除登录账户" data-testid="admin-account-delete-modal">
        <h2 className="mb-2 text-lg font-semibold">删除登录账户</h2>
        <p className="text-sm text-fg-muted">
          输入该登录账户以确认删除。此操作不可撤销。
        </p>
        <label className="mt-3 grid gap-1">
          <span className="text-sm font-medium">登录账户</span>
          {/* A textarea, not a single-line input: the comparison of Spec §5.5
              trims the leading and trailing whitespace (space, tab, CR, LF) and
              keeps every character in the middle. A text input silently drops
              CR and LF, so a pasted id that still carries a newline would be
              mangled before the comparison ever runs. */}
          <textarea
            className="pl-input notranslate"
            translate="no"
            rows={1}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-testid="admin-account-delete-input"
          />
        </label>
        {error && (
          <p className="mt-2 text-sm text-danger" role="alert" data-testid="admin-account-delete-error">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="pl-btn pl-btn--ghost" onClick={onCancel} data-testid="admin-account-delete-cancel">
            取消
          </button>
          {matches ? (
            <button
              type="button"
              className="pl-btn pl-btn--danger"
              onClick={onConfirm}
              data-testid="admin-account-delete-confirm"
            >
              删除账户
            </button>
          ) : (
            <GuardedButton
              label="删除账户"
              variant="danger"
              reasons={["请输入该登录账户 id 以确认删除。"]}
              testId="admin-account-delete-confirm"
            />
          )}
        </div>
      </div>
    </div>
  );
}
