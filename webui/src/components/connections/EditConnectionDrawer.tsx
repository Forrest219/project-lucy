import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionInfo } from "../../lib/types";
import { DiffViewer } from "../DiffViewer";

type Step = "input" | "preview" | "submitting";

export type EditConnectionDrawerProps = {
  open: boolean;
  connection: ConnectionInfo;
  onClose: () => void;
};

type EndpointPreview = {
  diff: string;
  proposedYaml: string;
  current: { host: string; port: number; username: string };
  passwordAction: "keep" | "replace";
};

type EndpointResult = {
  written: true;
  current: { host: string; port: number; username: string };
  test: { status: "ok"; message?: string };
  presence: {
    status: "ok" | "missing" | "not_completed";
    missingEnabledTables?: string[];
    reason?: string;
  };
  executionRuntimePending: true;
};

export function EditConnectionDrawer({ open, connection, onClose }: EditConnectionDrawerProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("input");
  const [host, setHost] = useState(connection.host ?? "");
  const [port, setPort] = useState(connection.port ?? "3306");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ackShared, setAckShared] = useState(false);
  const [preview, setPreview] = useState<EndpointPreview | null>(null);
  const [gateError, setGateError] = useState<{ message: string; reason?: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("input");
    setPassword("");
    setAckShared(false);
    setPreview(null);
    setGateError(null);
    setLoadError(null);
    const portNumber = Number(connection.port);
    void apiPost<EndpointPreview>(`/api/connections/${encodeURIComponent(connection.id)}/endpoint`, {
      host: connection.host ?? "localhost",
      port: Number.isFinite(portNumber) && portNumber > 0 ? portNumber : 3306,
      username: "__hydrate__",
      dryRun: true
    })
      .then((data) => {
        setHost(data.current.host);
        setPort(String(data.current.port));
        setUsername(data.current.username);
      })
      .catch((error) => {
        setLoadError(error instanceof ApiError ? error.message : "无法读取当前连接");
      });
  }, [open, connection.id, connection.host, connection.port]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const portNumber = Number(port);
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error("端口须为 1–65535 的整数");
      }
      return apiPost<EndpointPreview>(`/api/connections/${encodeURIComponent(connection.id)}/endpoint`, {
        host: host.trim(),
        port: portNumber,
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        dryRun: true,
        ...(ackShared ? { acknowledgeSharedEndpoint: true } : {})
      });
    },
    onSuccess: (data) => {
      setGateError(null);
      setPreview(data);
      setStep("preview");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "ENDPOINT_EDIT_CONFLICT") {
        const detail = error.detail as { reason?: string } | undefined;
        setGateError({ message: error.message, reason: detail?.reason });
        return;
      }
      toast.error(error instanceof Error ? error.message : "预览失败");
    }
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const portNumber = Number(port);
      return apiPost<EndpointResult>(`/api/connections/${encodeURIComponent(connection.id)}/endpoint`, {
        host: host.trim(),
        port: portNumber,
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        dryRun: false,
        ...(ackShared ? { acknowledgeSharedEndpoint: true } : {})
      });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      if (data.presence.status === "missing") {
        toast.warning(
          `服务器地址已更新；部分启用表未在新库找到：${(data.presence.missingEnabledTables ?? []).join("、")}`
        );
      } else if (data.presence.status === "not_completed") {
        toast.warning("服务器地址已更新；启用表存在性抽检未完成");
      } else {
        toast.success("服务器地址已更新");
      }
      onClose();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "写入失败");
      setStep("preview");
    }
  });

  if (!open) return null;

  return (
    <div className="pl-drawer-root" data-testid="edit-connection-drawer">
      <div className="pl-drawer-backdrop" onClick={onClose} />
      <aside className="pl-drawer" role="dialog" aria-labelledby="edit-connection-title">
        <header className="pl-drawer-header">
          <h2 id="edit-connection-title">编辑连接</h2>
          <p className="pl-muted">
            切换服务器地址。连接 ID、
            <span className="notranslate" translate="no">
              Schema
            </span>{" "}
            与启用表范围保持不变。
          </p>
          <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="pl-drawer-body">
          {loadError ? <p className="pl-notice pl-notice--danger">{loadError}</p> : null}
          <label className="pl-field">
            <span>连接 ID</span>
            <input className="notranslate" translate="no" value={connection.id} readOnly disabled data-testid="edit-connection-id" />
          </label>
          <label className="pl-field">
            <span>服务器地址</span>
            <input
              className="notranslate"
              translate="no"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              data-testid="edit-connection-host"
              disabled={step === "submitting"}
            />
          </label>
          <label className="pl-field">
            <span>端口</span>
            <input
              className="notranslate"
              translate="no"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              data-testid="edit-connection-port"
              disabled={step === "submitting"}
            />
          </label>
          <label className="pl-field">
            <span>用户名</span>
            <input
              className="notranslate"
              translate="no"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              data-testid="edit-connection-username"
              disabled={step === "submitting"}
            />
          </label>
          <label className="pl-field">
            <span>数据库密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="留空则保留原密码"
              data-testid="edit-connection-password"
              disabled={step === "submitting"}
            />
          </label>
          {gateError ? (
            <div className="pl-notice pl-notice--warning" data-testid="edit-connection-conflict">
              <p>{gateError.message}</p>
              <label className="pl-checkbox">
                <input
                  type="checkbox"
                  checked={ackShared}
                  onChange={(event) => setAckShared(event.target.checked)}
                  data-testid="edit-connection-ack-shared"
                />
                <span>仍要改到相同端点</span>
              </label>
            </div>
          ) : null}
          {step === "preview" && preview ? (
            <div data-testid="edit-connection-preview">
              <p className="pl-muted">
                密码操作：{preview.passwordAction === "keep" ? "保留原密码" : "覆盖密码"}
              </p>
              <DiffViewer diff={preview.diff || "(无变更)"} />
            </div>
          ) : null}
        </div>
        <footer className="pl-drawer-footer">
          {step === "input" || gateError ? (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              data-testid="edit-connection-preview-btn"
              disabled={previewMutation.isPending || Boolean(loadError)}
              onClick={() => previewMutation.mutate()}
            >
              预览变更
            </button>
          ) : (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              data-testid="edit-connection-confirm-btn"
              disabled={commitMutation.isPending}
              onClick={() => {
                setStep("submitting");
                commitMutation.mutate();
              }}
            >
              确认写入
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
