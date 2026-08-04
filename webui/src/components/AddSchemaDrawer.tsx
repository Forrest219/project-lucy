import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { DiffViewer } from "./DiffViewer";
import { CatalogAssetUploadButton, CatalogReloadButton } from "./catalog";
import { schemaFieldHelper, schemaFieldLabel, validateSchemaName } from "../lib/schemas";
import type { AddSchemaPreview, AddSchemaResult, ConnectionInfo } from "../lib/types";

type Step = "input" | "preview" | "submitting" | "success" | "fatal";

export type AddSchemaDrawerProps = {
  connection: ConnectionInfo;
  open: boolean;
  onClose: () => void;
};

const STEP_LABELS = ["输入 Schema", "测试连接", "确认并完成"];

export function AddSchemaDrawer({ connection, open, onClose }: AddSchemaDrawerProps) {
  const queryClient = useQueryClient();
  const fieldLabel = schemaFieldLabel();
  const fieldHelper = schemaFieldHelper(connection.engine, connection.driver);
  const [schema, setSchema] = useState("");
  const [schemaTouched, setSchemaTouched] = useState(false);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [preview, setPreview] = useState<AddSchemaPreview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const trimmed = schema.trim();
  const issue = useMemo(() => validateSchemaName(trimmed), [trimmed]);
  const canPreview = trimmed.length > 0 && !issue;
  const showSchemaIssue = Boolean(issue && (schemaTouched || previewAttempted));

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
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      toast.success(`已添加 Schema: ${trimmed}`);
    },
    onError: (err) => {
      handleSubmitError(setStep, setSubmitError, err);
    }
  });

  function reset() {
    setSchema("");
    setSchemaTouched(false);
    setPreviewAttempted(false);
    setStep("input");
    setPreview(null);
    setSubmitError(null);
    previewMutation.reset();
    writeMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="添加 Schema"
      translate="no"
      data-testid="add-schema-drawer-backdrop"
    >
      <div
        className="pl-drawer-panel"
        data-testid="add-schema-drawer"
      >
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">添加 Schema 到 {connection.id}</h2>
            <p className="pl-notice notranslate" translate="no">
              添加后会写入 <code className="notranslate" translate="no">ktx.yaml</code>；下一步将先验证连接权限。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={close}
            aria-label="关闭"
            data-testid="add-schema-close"
          >
            关闭
          </button>
        </header>

        <ol className="pl-steps" aria-label="步骤">
          {STEP_LABELS.map((label, idx) => {
            const activeIndex =
              step === "success" ? 2 : step === "preview" || step === "submitting" ? 1 : 0;
            const state = idx < activeIndex ? "complete" : idx === activeIndex ? "active" : "upcoming";
            return (
              <li
                key={label}
                className={`pl-step pl-step--${state}`}
                data-step={idx}
                aria-current={state === "active" ? "step" : undefined}
              >
                <span className="pl-step-index">{state === "complete" ? "✓" : idx + 1}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        {step === "input" && (
          <section className="pl-drawer-body notranslate" aria-label="输入 Schema 名" translate="no">
            <label className="grid gap-1.5 text-sm">
              <span>{fieldLabel}</span>
              <input
                className="pl-input"
                placeholder="例如 finance_mart"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                onBlur={() => setSchemaTouched(true)}
                aria-invalid={showSchemaIssue ? true : undefined}
                data-testid="add-schema-input"
              />
              {showSchemaIssue && issue && (
                <span className="text-xs text-danger" data-testid="add-schema-input-error">
                  {issue.message}
                </span>
              )}
              <span className="text-xs text-fg-muted">
                须以字母或下划线开头，仅含字母、数字、下划线，最多 63 字符。
              </span>
              <span className="text-xs text-fg-muted">{fieldHelper}</span>
            </label>
            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                取消
              </button>
              <button
                className="pl-btn pl-btn--primary"
                disabled={!canPreview || previewMutation.isPending}
                onClick={() => {
                  setPreviewAttempted(true);
                  if (!canPreview) return;
                  previewMutation.mutate();
                }}
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
          <section className="pl-drawer-body" aria-label="预览变更">
            <p className="text-sm notranslate" translate="no">ktx.yaml 计划变更（unified diff）：</p>
            <DiffViewer diff={preview.diff} />
            <p className="text-xs text-fg-muted">
              旧 schemas：<code>{preview.oldSchemas.join(", ") || "（空）"}</code> → 新：{" "}
              <code>{preview.newSchemas.join(", ")}</code>
            </p>
            <div className="pl-drawer-footer">
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
          <section className="pl-drawer-body" aria-label="写入中">
            <p className="text-sm notranslate" translate="no">正在写入 ktx.yaml...</p>
            {writeMutation.error && <ErrorPanel error={writeMutation.error} />}
            <div className="pl-drawer-footer">
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
          <section className="pl-drawer-body" aria-label="完成">
            <p className="text-sm font-semibold text-green-700 notranslate" translate="no" data-testid="add-schema-success-message">
              ✓ 已添加 Schema：{trimmed}
            </p>
            <p className="text-sm">
              <code>{trimmed}</code> 已添加到 <code>{connection.id}</code>。
            </p>
            <p className="text-xs text-fg-muted notranslate" translate="no" data-testid="add-schema-static-loading-hint">
              WebUI 不会自动扫描物理数据库。若你已有该 Schema 的 <code className="notranslate" translate="no">semantic-layer</code>{" "}
              Manifest YAML，可以现在上传；否则稍后由离线流程生成后上传，或在清单页直接编辑白名单。
            </p>
            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                完成
              </button>
              <CatalogReloadButton
                connectionId={connection.id}
                schema={trimmed}
                label="同步配置变更"
                pendingLabel="正在同步配置变更..."
                variant="secondary"
                testId="add-schema-reload-catalog"
              />
              <CatalogAssetUploadButton
                connectionId={connection.id}
                schema={trimmed}
                label="上传 Schema Manifest"
                variant="primary"
                testId="add-schema-upload-yaml"
              />
            </div>
          </section>
        )}

        {step === "fatal" && (
          <section className="pl-drawer-body" aria-label="致命错误">
            <p className="text-sm font-semibold text-danger-strong">
              {submitError ?? "ktx.yaml 无法解析，请在终端检查。"}
            </p>
            <div className="pl-drawer-footer">
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
      <ConnectionTestFailedPanel code={code} message={message} detail={detail} />
    );
  }
  if (code === "KTX_YAML_PARSE_ERROR") {
    return (
      <div className="pl-drawer-error" role="alert" data-testid="add-schema-fatal-error">
        <p className="font-semibold notranslate" translate="no">ktx.yaml 解析失败</p>
        <p className="notranslate" translate="no">请在终端检查 ktx.yaml，修正后再回来重试。</p>
        <p className="text-fg-muted">{message}</p>
      </div>
    );
  }
  return (
    <div className="pl-drawer-error" role="alert">
      <p className="font-semibold">{code}</p>
      <p>{message}</p>
    </div>
  );
}

function ConnectionTestFailedPanel({
  code,
  message,
  detail
}: {
  code: string;
  message: string;
  detail: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailText =
    detail === undefined || detail === null ? null : JSON.stringify(detail, null, 2) ?? String(detail);

  return (
    <div className="pl-drawer-error" role="alert" data-testid="add-schema-connection-test-failed">
      <p className="font-semibold">连接测试失败（{code}）</p>
      <p>{message}</p>
      {detailText !== null ? (
        <div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-testid="toggle-ktx-output"
          >
            {expanded ? "Hide ktx output" : "Show ktx output"}
          </button>
          {expanded ? <pre data-testid="ktx-output-detail">{detailText}</pre> : null}
        </div>
      ) : null}
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
