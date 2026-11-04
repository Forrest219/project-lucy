import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionInfo } from "../../lib/types";
import { DiffViewer } from "../DiffViewer";

type Step = "input" | "preview" | "submitting";

export type EditConnectionDialogProps = {
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

export function EditConnectionDialog({ open, connection, onClose }: EditConnectionDialogProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>("input");
  const [host, setHost] = useState(connection.host ?? "");
  const [port, setPort] = useState(connection.port ?? "3306");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ackShared, setAckShared] = useState(false);
  const [preview, setPreview] = useState<EndpointPreview | null>(null);
  const [gateError, setGateError] = useState<{ message: string; reason?: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const submitting = step === "submitting";

  function requestClose() {
    if (submitting) return;
    onClose();
  }

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

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusTarget =
      panel?.querySelector<HTMLElement>("input:not([disabled]),button:not([disabled])") ?? panel;
    focusTarget?.focus();
  }, [open, loadError]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (submitting) return;
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onClose]);

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

  const showSavePrimary = (step === "preview" || step === "submitting") && preview && !gateError;
  const currentHostPort =
    connection.host && connection.port ? `${connection.host}:${connection.port}` : connection.host ?? "";

  return (
    <div
      className="pl-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="edit-connection-dialog"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        className="pl-modal-panel max-w-xl"
        data-testid="edit-connection-dialog-panel"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-fg-default">
              编辑连接
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              切换服务器地址。连接 ID、
              <span className="notranslate" translate="no">
                Schema
              </span>{" "}
              与启用表范围保持不变。
            </p>
            {currentHostPort ? (
              <p className="mt-1 text-xs text-fg-muted">
                当前：
                <code className="notranslate ml-1" translate="no">
                  {currentHostPort}
                </code>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            data-testid="edit-connection-close"
            onClick={requestClose}
            disabled={submitting}
          >
            关闭
          </button>
        </header>

        <div className="grid gap-3">
          {loadError ? <p className="pl-notice pl-notice--danger">{loadError}</p> : null}
          <label className="pl-connection-field">
            <span>连接 ID</span>
            <div className="pl-connection-field-control">
              <input
                className="pl-input notranslate"
                translate="no"
                value={connection.id}
                readOnly
                disabled
                data-testid="edit-connection-id"
              />
            </div>
          </label>
          <label className="pl-connection-field">
            <span>服务器地址</span>
            <div className="pl-connection-field-control">
              <input
                className="pl-input notranslate"
                translate="no"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                data-testid="edit-connection-host"
                disabled={submitting}
              />
            </div>
          </label>
          <label className="pl-connection-field">
            <span>端口</span>
            <div className="pl-connection-field-control">
              <input
                className="pl-input notranslate"
                translate="no"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                data-testid="edit-connection-port"
                disabled={submitting}
              />
            </div>
          </label>
          <label className="pl-connection-field">
            <span>用户名</span>
            <div className="pl-connection-field-control">
              <input
                className="pl-input notranslate"
                translate="no"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                data-testid="edit-connection-username"
                disabled={submitting}
              />
            </div>
          </label>
          <label className="pl-connection-field">
            <span>数据库密码</span>
            <div className="pl-connection-field-control">
              <input
                className="pl-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="留空则保留原密码"
                data-testid="edit-connection-password"
                disabled={submitting}
              />
            </div>
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
              <p className="pl-muted text-sm">
                密码操作：{preview.passwordAction === "keep" ? "保留原密码" : "覆盖密码"}
              </p>
              <DiffViewer diff={preview.diff || "(无变更)"} />
            </div>
          ) : null}
        </div>

        <footer className="mt-6 flex justify-end gap-2" data-testid="edit-connection-actions">
          {showSavePrimary ? (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              data-testid="edit-connection-confirm-btn"
              disabled={commitMutation.isPending || submitting}
              onClick={() => {
                setStep("submitting");
                commitMutation.mutate();
              }}
            >
              {submitting ? "保存中…" : "保存"}
            </button>
          ) : (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              data-testid="edit-connection-preview-btn"
              disabled={previewMutation.isPending || Boolean(loadError) || submitting}
              onClick={() => previewMutation.mutate()}
            >
              预览变更
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
