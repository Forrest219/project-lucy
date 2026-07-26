import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { DiffViewer } from "./DiffViewer";
import { schemaFieldLabel, validateSchemaName } from "../lib/schemas";
import type { AddSchemaPreview, AddSchemaResult, ConnectionInfo, IngestResult } from "../lib/types";

type Step = "input" | "preview" | "submitting" | "success" | "fatal";

export type AddSchemaDrawerProps = {
  connection: ConnectionInfo;
  open: boolean;
  onClose: () => void;
};

export function AddSchemaDrawer({ connection, open, onClose }: AddSchemaDrawerProps) {
  const queryClient = useQueryClient();
  const fieldLabel = schemaFieldLabel(connection.engine);
  const [schema, setSchema] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [preview, setPreview] = useState<AddSchemaPreview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const trimmed = schema.trim();
  const issue = useMemo(() => validateSchemaName(trimmed), [trimmed]);
  const canPreview = trimmed.length > 0 && !issue;

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<AddSchemaPreview>(
        `/api/connections/${encodeURIComponent(connection.id)}/schemas`,
        { schema: trimmed, dryRun: true }
      ),
    onSuccess: (data) => {
      setPreview(data);
      setStep("preview");
      setSubmitError(null);
    },
    onError: (err) => {
      handleSubmitError(setStep, setSubmitError, err);
    }
  });

  const writeMutation = useMutation({
    mutationFn: () =>
      apiPost<AddSchemaResult>(
        `/api/connections/${encodeURIComponent(connection.id)}/schemas`,
        { schema: trimmed, dryRun: false }
      ),
    onSuccess: () => {
      setStep("success");
      setSubmitError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connection.id) });
      toast.success(`已添加 schema: ${trimmed}`);
    },
    onError: (err) => {
      handleSubmitError(setStep, setSubmitError, err);
    }
  });

  const ingestMutation = useMutation({
    mutationFn: () =>
      apiPost<IngestResult>(
        `/api/connections/${encodeURIComponent(connection.id)}/ingest`,
        {}
      ),
    onSuccess: (data) => {
      if (data.exitCode === 0) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.project }),
          queryClient.invalidateQueries({ queryKey: queryKeys.connections }),
          queryClient.invalidateQueries({ queryKey: queryKeys.sources }),
          queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connection.id) })
        ]);
        toast.success(`ingest ${connection.id} 完成`);
      } else {
        toast.warning(`ingest ${connection.id} 退出码 ${data.exitCode}`);
      }
    },
    onError: (err) => {
      toast.error(`ingest 启动失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  function reset() {
    setSchema("");
    setStep("input");
    setPreview(null);
    setSubmitError(null);
    previewMutation.reset();
    writeMutation.reset();
    ingestMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="pl-modal-backdrop" role="dialog" aria-modal="true" aria-label="添加 schema">
      <div className="pl-modal-panel" data-testid="add-schema-drawer">
        <header className="pl-section-heading">
          <div>
            <p className="pl-eyebrow">数据库接入</p>
            <h2 className="pl-panel-title">添加 schema 到 {connection.id}</h2>
            <p className="pl-notice">
              全程在本地完成：测连通 → 写 ktx.yaml → 触发 ingest。不会触碰凭据。
            </p>
          </div>
          <button className="pl-btn pl-btn--ghost" onClick={close}>
            关闭
          </button>
        </header>

        <ol className="flex items-center gap-2 text-xs text-fg-muted" aria-label="步骤">
          {["输入", "预览", "确认"].map((label, idx) => {
            const active =
              (idx === 0 && step === "input") ||
              (idx === 1 && (step === "preview" || step === "submitting")) ||
              (idx === 2 && step === "success");
            return (
              <li
                key={label}
                className={active ? "font-semibold text-fg-default" : ""}
                data-step={idx}
              >
                {idx + 1}. {label}
              </li>
            );
          })}
        </ol>

        {step === "input" && (
          <section className="grid gap-3 mt-4" aria-label="输入 schema 名">
            <label className="grid gap-1.5 text-sm">
              <span>{fieldLabel} 名</span>
              <input
                className="pl-input"
                placeholder="例如 finance_mart"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                aria-invalid={issue ? true : undefined}
                data-testid="add-schema-input"
              />
              {issue && (
                <span className="text-xs text-danger" data-testid="add-schema-input-error">
                  {issue.message}
                </span>
              )}
              <span className="text-xs text-fg-muted">
                须以字母或下划线开头，仅含字母、数字、下划线，最多 63 字符。
              </span>
            </label>
            <p className="text-xs text-fg-muted">
              添加前会自动调用 <code>ktx connection test {connection.id}</code>。
            </p>
            <div className="flex justify-end gap-2">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                取消
              </button>
              <button
                className="pl-btn pl-btn--primary"
                disabled={!canPreview || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
                data-testid="add-schema-preview-btn"
              >
                {previewMutation.isPending ? "生成预览..." : "下一步"}
              </button>
            </div>
            {previewMutation.error && (
              <ErrorPanel error={previewMutation.error} />
            )}
          </section>
        )}

        {step === "preview" && preview && (
          <section className="grid gap-3 mt-4" aria-label="预览变更">
            <p className="text-sm">ktx.yaml 计划变更（unified diff）：</p>
            <DiffViewer diff={preview.diff} />
            <p className="text-xs text-fg-muted">
              旧 schemas：<code>{preview.oldSchemas.join(", ") || "（空）"}</code> → 新：{" "}
              <code>{preview.newSchemas.join(", ")}</code>
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="pl-btn pl-btn--ghost"
                onClick={() => setStep("input")}
                disabled={writeMutation.isPending}
              >
                返回修改
              </button>
              <button
                className="pl-btn pl-btn--primary"
                onClick={() => {
                  setStep("submitting");
                  writeMutation.mutate();
                }}
                disabled={writeMutation.isPending}
                data-testid="add-schema-confirm-btn"
              >
                {writeMutation.isPending ? "写入中..." : "确认写入"}
              </button>
            </div>
            {writeMutation.error && <ErrorPanel error={writeMutation.error} />}
          </section>
        )}

        {step === "submitting" && (
          <section className="grid gap-3 mt-4" aria-label="写入中">
            <p className="text-sm">正在写入 ktx.yaml...</p>
            {writeMutation.error && <ErrorPanel error={writeMutation.error} />}
            <div className="flex justify-end gap-2">
              <button
                className="pl-btn pl-btn--ghost"
                onClick={() => setStep("preview")}
                disabled={writeMutation.isPending}
              >
                返回预览
              </button>
            </div>
          </section>
        )}

        {step === "success" && (
          <section className="grid gap-3 mt-4" aria-label="完成">
            <p className="text-sm font-semibold text-green-700">
              ✓ 已添加 schema：{trimmed}
            </p>
            <p className="text-xs text-fg-muted">
              接下来执行 <code>ktx ingest {connection.id}</code> 把新 schema 的表同步到语义层。
            </p>
            <div className="flex justify-end gap-2">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                稍后
              </button>
              <button
                className="pl-btn pl-btn--primary"
                onClick={() => ingestMutation.mutate()}
                disabled={ingestMutation.isPending}
              >
                {ingestMutation.isPending ? "ingest 中..." : "现在 ingest"}
              </button>
            </div>
            {ingestMutation.error && <ErrorPanel error={ingestMutation.error} />}
          </section>
        )}

        {step === "fatal" && (
          <section className="grid gap-3 mt-4" aria-label="致命错误">
            <p className="text-sm font-semibold text-danger-strong">
              {submitError ?? "ktx.yaml 无法解析，请在终端检查。"}
            </p>
            <div className="flex justify-end gap-2">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                关闭
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  let code = "UNKNOWN";
  let message = error instanceof Error ? error.message : String(error);
  let detail: unknown = undefined;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    code = (error as { code: string }).code;
  }
  if (
    error &&
    typeof error === "object" &&
    "detail" in error
  ) {
    detail = (error as { detail: unknown }).detail;
  }

  if (code === "CONNECTION_TEST_FAILED") {
    return (
      <div className="text-xs text-danger" role="alert">
        <p className="font-semibold">连接测试失败（CONNECTION_TEST_FAILED）</p>
        {detail !== undefined && detail !== null && (
          <pre className="whitespace-pre-wrap text-danger mt-1">
            {JSON.stringify(detail, null, 2) ?? String(detail)}
          </pre>
        )}
      </div>
    );
  }
  if (code === "KTX_YAML_PARSE_ERROR") {
    return (
      <div className="text-xs text-danger" role="alert">
        <p className="font-semibold">ktx.yaml 解析失败</p>
        <p>请在终端检查 ktx.yaml，修正后再回来重试。</p>
        <p className="text-fg-muted">{message}</p>
      </div>
    );
  }
  return (
    <div className="text-xs text-danger" role="alert">
      <p className="font-semibold">{code}</p>
      <p>{message}</p>
    </div>
  );
}

function handleSubmitError(
  setStep: (step: Step) => void,
  setSubmitError: (msg: string | null) => void,
  err: unknown
) {
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "UNKNOWN";
  if (code === "KTX_YAML_PARSE_ERROR") {
    setStep("fatal");
    setSubmitError(err instanceof Error ? err.message : String(err));
    return;
  }
  // Stay on current step for recoverable errors; toast for awareness.
  toast.error(`${code}: ${err instanceof Error ? err.message : String(err)}`);
}
