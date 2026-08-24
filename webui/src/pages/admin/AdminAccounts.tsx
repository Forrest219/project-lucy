import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/apiClient";
import { useAuth } from "../../lib/auth";

type AdminRole = "owner" | "operator";

type AdminRow = {
  id: string;
  displayName: string;
  role: AdminRole;
  enabled: boolean;
  createdAt: string | null;
};

type AdminsResponse = {
  mode: string;
  admins: AdminRow[];
};

function roleLabel(role: AdminRole): string {
  return role === "owner" ? "所有者" : "运维";
}

export function AdminAccounts() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const [adminId, setAdminId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("operator");
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => apiGet<AdminsResponse>("/api/admin/admins")
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ admin: AdminRow }>("/api/admin/admins", {
        adminId,
        displayName: displayName || undefined,
        password,
        role
      }),
    onSuccess: async () => {
      setAdminId("");
      setDisplayName("");
      setPassword("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "创建失败");
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

  function onCreate(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="pl-page">
      <PageHeader
        title="登录账户"
        description="管理 WebUI 登录账户。所有者负责账户治理；运维负责连接、语义、Eval、Agent Role 等日常工作。Agent Token 与此无关。"
        backAction={
          <Link to="/admin/agents" className="pl-page-header-back">
            ‹ 返回访问治理
          </Link>
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

      <div className="pl-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted border-b border-[var(--pl-border)]">
              <th className="py-2 pr-3">账户 id</th>
              <th className="py-2 pr-3">显示名</th>
              <th className="py-2 pr-3">角色</th>
              <th className="py-2 pr-3">状态</th>
              {isOwner && authRequired && <th className="py-2">操作</th>}
            </tr>
          </thead>
          <tbody>
            {(query.data?.admins ?? []).map((row) => (
              <tr key={row.id} className="border-b border-[var(--pl-border)]/60">
                <td className="py-2 pr-3 font-mono notranslate" translate="no">
                  {row.id}
                </td>
                <td className="py-2 pr-3">{row.displayName}</td>
                <td className="py-2 pr-3">{roleLabel(row.role)}</td>
                <td className="py-2 pr-3">{row.enabled ? "启用" : "已禁用"}</td>
                {isOwner && authRequired && (
                  <td className="py-2 flex flex-wrap gap-2">
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
                        if (window.confirm(`确定删除账户 ${row.id}？`)) {
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

      {isOwner && authRequired && (
        <form className="pl-card grid gap-3 p-4" onSubmit={onCreate}>
          <h2 className="text-base font-semibold">添加登录账户</h2>
          <label className="grid gap-1">
            <span className="text-sm font-medium">账户 id</span>
            <input
              className="pl-input notranslate"
              translate="no"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
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
          <label className="grid gap-1">
            <span className="text-sm font-medium">角色</span>
            <select
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
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">初始密码</span>
            <input
              className="pl-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
            />
          </label>
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
    </div>
  );
}
