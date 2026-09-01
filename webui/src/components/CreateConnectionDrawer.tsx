import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiPost } from "../lib/apiClient";
import {
  CONNECTION_ID_RULE_HINT,
  DATABASE_TYPES,
  getDatabaseTypeConfig,
  validateConnectionId,
  type DatabaseType
} from "../lib/connectionId";
import { queryKeys } from "../lib/queryKeys";
import { SCHEMA_NAME_RULE_HINT, validateSchemaName } from "../lib/schemas";
import { formatConnectionProbeMessage, classifyConnectionError } from "../lib/connectionErrors";
import type {
  CreateConnectionPreview,
  CreateConnectionResult,
  ProbeConnectionResult
} from "../lib/types";
import { DiffViewer } from "./DiffViewer";

type Step = "input" | "preview" | "submitting" | "success" | "fatal";

export type CreateConnectionDrawerProps = {
  open: boolean;
  onClose: () => void;
  existingIds?: string[];
};

const STEP_LABELS = ["输入连接信息", "新建预览", "确认创建"];

type FormState = {
  id: string;
  databaseType: DatabaseType;
  driver: "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite";
  engine: string;
  wireProtocol: string;
  readonly: boolean;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  schemasText: string;
};

const INITIAL_FORM: FormState = {
  id: "",
  databaseType: "mysql",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readonly: true,
  host: "",
  port: "3306",
  database: "",
  username: "",
  password: "",
  schemasText: ""
};

function parseSchemas(text: string): { schemas: string[]; issue: string | null } {
  const parts = text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const schema of parts) {
    const issue = validateSchemaName(schema);
    if (issue) {
      return {
        schemas: parts,
        issue: `初始 Schema「${schema}」无效：${issue.message}`
      };
    }
  }
  return { schemas: parts, issue: null };
}

function mapCreateErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : String(err);
  }
  switch (err.code) {
    case "CONNECTION_ALREADY_EXISTS":
      return "连接 ID 已存在";
    case "CONNECTION_ID_INVALID":
      return "连接 ID 不符合命名规则";
    case "SECRET_ALREADY_EXISTS":
      return "密码文件已存在，请更换连接 ID 或由运维清理后重试";
    case "CONNECTION_TEST_FAILED":
      return err.message;
    case "CONNECTION_PASSWORD_REQUIRED":
      return "数据库密码为必填项";
    case "FORBIDDEN_PATH":
      return "无法写入连接配置或密码文件";
    default:
      return err.message;
  }
}

export function CreateConnectionDrawer({
  open,
  onClose,
  existingIds = []
}: CreateConnectionDrawerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [probeAttempted, setProbeAttempted] = useState(false);
  const [probeOverride, setProbeOverride] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeConnectionResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [preview, setPreview] = useState<CreateConnectionPreview | null>(null);
  const [created, setCreated] = useState<CreateConnectionResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isSqlite = form.databaseType === "sqlite" || form.driver === "sqlite";
  const currentConfig = useMemo(
    () => getDatabaseTypeConfig(form.databaseType),
    [form.databaseType]
  );

  const idIssue = useMemo(
    () => validateConnectionId(form.id, existingIds),
    [form.id, existingIds]
  );
  const schemasParsed = useMemo(() => parseSchemas(form.schemasText), [form.schemasText]);
  const portNumber = Number(form.port);
  const portIssue = isSqlite
    ? null
    : !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
      ? "端口须为 1–65535 的整数"
      : null;
  const hostIssue = isSqlite || form.host.trim() ? null : "主机为必填项";
  const databaseIssue = form.database.trim()
    ? null
    : isSqlite
      ? "数据库文件路径为必填项"
      : "数据库为必填项";
  const usernameIssue = isSqlite || form.username.trim() ? null : "用户名为必填项";
  const passwordIssue = isSqlite || form.password.length > 0 ? null : "数据库密码为必填项";

  const canPreview =
    !idIssue &&
    !hostIssue &&
    !portIssue &&
    !databaseIssue &&
    !usernameIssue &&
    !passwordIssue &&
    !schemasParsed.issue;
  const probeFailed = probeAttempted && probeResult?.status === "error";
  const canPreviewWithProbe = canPreview && (!probeFailed || probeOverride);
  const canProbe = isSqlite
    ? !databaseIssue
    : !hostIssue && !portIssue && !databaseIssue && !usernameIssue && !passwordIssue;

  const show = (field: string) => Boolean(touched[field] || previewAttempted || probeAttempted);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionPreview>("/api/connections", {
        id: form.id.trim(),
        driver: form.driver,
        ...(form.engine.trim() ? { engine: form.engine.trim() } : {}),
        ...(form.wireProtocol.trim() ? { wireProtocol: form.wireProtocol.trim() } : {}),
        readonly: isSqlite ? false : form.readonly,
        ...(isSqlite
          ? {}
          : {
              host: form.host.trim(),
              port: portNumber,
              username: form.username.trim()
            }),
        database: form.database.trim(),
        schemas: schemasParsed.schemas,
        dryRun: true
      }),
    onSuccess: (data) => {
      setPreview(data);
      setStep("preview");
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(mapCreateErrorMessage(err));
      toast.error(mapCreateErrorMessage(err));
    }
  });

  const probeMutation = useMutation({
    mutationFn: () =>
      apiPost<ProbeConnectionResult>("/api/connections/probe", {
        driver: form.driver,
        ...(form.engine.trim() ? { engine: form.engine.trim() } : {}),
        ...(form.wireProtocol.trim() ? { wireProtocol: form.wireProtocol.trim() } : {}),
        readonly: isSqlite ? false : form.readonly,
        ...(isSqlite
          ? {}
          : {
              host: form.host.trim(),
              port: portNumber,
              username: form.username.trim()
            }),
        database: form.database.trim(),
        ...(form.password ? { password: form.password } : {})
      }),
    onSuccess: (data) => {
      setProbeResult(
        data.status === "error"
          ? { ...data, message: formatConnectionProbeMessage(data.message) }
          : data
      );
    },
    onError: (err) => {
      const raw = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setProbeResult({
        status: "error",
        message: formatConnectionProbeMessage(raw)
      });
    }
  });

  const writeMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionResult>("/api/connections", {
        id: form.id.trim(),
        driver: form.driver,
        ...(form.engine.trim() ? { engine: form.engine.trim() } : {}),
        ...(form.wireProtocol.trim() ? { wireProtocol: form.wireProtocol.trim() } : {}),
        readonly: isSqlite ? false : form.readonly,
        ...(isSqlite
          ? {}
          : {
              host: form.host.trim(),
              port: portNumber,
              username: form.username.trim()
            }),
        database: form.database.trim(),
        ...(form.password ? { password: form.password } : {}),
        schemas: schemasParsed.schemas,
        dryRun: false
      }),
    onSuccess: (data) => {
      setCreated(data);
      setStep("success");
      setSubmitError(null);
      setForm((prev) => ({ ...prev, password: "" }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      toast.success(
        data.test.status === "error"
          ? `连接已创建：${data.connection.id}（连通测试未通过，配置已保存）`
          : `连接已创建：${data.connection.id}`
      );
    },
    onError: (err) => {
      const message = mapCreateErrorMessage(err);
      setSubmitError(message);
      setStep("preview");
      toast.error(message);
    }
  });

  function reset() {
    setForm(INITIAL_FORM);
    setTouched({});
    setPreviewAttempted(false);
    setProbeAttempted(false);
    setProbeOverride(false);
    setProbeResult(null);
    setShowPassword(false);
    setStep("input");
    setPreview(null);
    setCreated(null);
    setSubmitError(null);
    previewMutation.reset();
    writeMutation.reset();
    probeMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (open) {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close() is recreated each render; bind to the current open/onClose pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  useEffect(() => {
    setProbeResult(null);
    setProbeOverride(false);
  }, [
    form.driver,
    form.databaseType,
    form.engine,
    form.wireProtocol,
    form.host,
    form.port,
    form.database,
    form.username,
    form.password
  ]);

  function handleDatabaseTypeChange(nextKey: DatabaseType) {
    const config = getDatabaseTypeConfig(nextKey);
    setForm((prev) => {
      const prevConfig = getDatabaseTypeConfig(prev.databaseType);
      const prevDefaultPort = prevConfig.defaultPort != null ? String(prevConfig.defaultPort) : "";
      const nextDefaultPort = config.defaultPort != null ? String(config.defaultPort) : "";

      let nextPort = prev.port;
      if (!prev.port.trim() || prev.port === prevDefaultPort) {
        nextPort = nextDefaultPort;
      }

      return {
        ...prev,
        databaseType: nextKey,
        driver: config.driver,
        engine: config.engine,
        wireProtocol: config.wireProtocol,
        port: nextPort
      };
    });
  }

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (!open) return null;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="新建连接"
      translate="no"
      data-testid="create-connection-drawer-backdrop"
    >
      <div className="pl-drawer-panel" data-testid="create-connection-drawer">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">
              新建连接
            </h2>
            <div
              className="pl-secret-banner notranslate"
              role="note"
              data-testid="create-connection-secret-banner"
              translate="no"
            >
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                密码仅提交一次，写入{" "}
                <code className="notranslate" translate="no">
                  .ktx/secrets/&lt;连接 ID&gt;-password
                </code>
                ；<code className="notranslate" translate="no">ktx.yaml</code> 只保存{" "}
                <code className="notranslate" translate="no">
                  file:
                </code>{" "}
                引用。
              </p>
            </div>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={close}
            aria-label="关闭"
            data-testid="create-connection-close"
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
          <section className="pl-drawer-body notranslate" aria-label="输入连接信息" translate="no">
            <div className="grid gap-3">
              <Field
                label="连接标识 (ID)"
                required
                error={show("id") ? idIssue?.message : null}
                hint={CONNECTION_ID_RULE_HINT}
              >
                <input
                  className="pl-input notranslate"
                  translate="no"
                  value={form.id}
                  onChange={(e) => patchForm("id", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, id: true }))}
                  placeholder={`例如 ${currentConfig.placeholderId}`}
                  data-testid="create-connection-id"
                  aria-invalid={show("id") && idIssue ? true : undefined}
                />
              </Field>

              <FieldPair>
                <Field label="数据库类型" required pair>
                  <select
                    className="pl-input notranslate"
                    translate="no"
                    value={form.databaseType}
                    onChange={(e) =>
                      handleDatabaseTypeChange(e.target.value as DatabaseType)
                    }
                    data-testid="create-connection-driver"
                  >
                    {DATABASE_TYPES.map((dt) => (
                      <option key={dt.key} value={dt.key}>
                        {dt.label}
                      </option>
                    ))}
                  </select>
                  {form.databaseType === "starrocks" || form.databaseType === "doris" ? (
                    <p className="mt-1 text-xs text-fg-muted" data-testid="create-connection-engine-hint">
                      底层走 MySQL 协议；超时策略与原生 MySQL 不同，请优先选此类型而非 MySQL。
                    </p>
                  ) : null}
                </Field>
                {!isSqlite ? (
                  <Field label="只读账号意图（可选）" pair>
                    <span className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.readonly}
                        onChange={(e) => patchForm("readonly", e.target.checked)}
                        data-testid="create-connection-readonly"
                      />
                      <span>默认开启</span>
                    </span>
                  </Field>
                ) : (
                  <div className="hidden md:block" />
                )}
              </FieldPair>

              {!isSqlite ? (
                <>
                  <FieldPair>
                    <Field label="主机" required error={show("host") ? hostIssue : null} pair>
                      <input
                        className="pl-input notranslate"
                        translate="no"
                        value={form.host}
                        onChange={(e) => patchForm("host", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, host: true }))}
                        data-testid="create-connection-host"
                      />
                    </Field>
                    <Field label="端口" required error={show("port") ? portIssue : null} pair>
                      <input
                        className="pl-input notranslate"
                        translate="no"
                        value={form.port}
                        onChange={(e) => patchForm("port", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, port: true }))}
                        data-testid="create-connection-port"
                      />
                    </Field>
                  </FieldPair>

                  <Field
                    label="数据库"
                    required
                    error={show("database") ? databaseIssue : null}
                    hint="连接时使用的默认数据库名称，与下方初始 Schema 不是同一项"
                  >
                    <input
                      className="pl-input notranslate"
                      translate="no"
                      value={form.database}
                      onChange={(e) => patchForm("database", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, database: true }))}
                      data-testid="create-connection-database"
                    />
                  </Field>

                  <FieldPair>
                    <Field label="用户名" required error={show("username") ? usernameIssue : null} pair>
                      <input
                        className="pl-input notranslate"
                        translate="no"
                        value={form.username}
                        onChange={(e) => patchForm("username", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                        data-testid="create-connection-username"
                      />
                    </Field>
                    <Field
                      label="数据库密码"
                      required
                      error={show("password") ? passwordIssue : null}
                      hint="仅本次提交使用；成功后不会回显"
                      pair
                    >
                      <div className="relative w-full">
                        <input
                          type={showPassword ? "text" : "password"}
                          className="pl-input pr-10"
                          value={form.password}
                          onChange={(e) => patchForm("password", e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                          autoComplete="new-password"
                          data-testid="create-connection-password"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-fg-muted hover:text-fg-default"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? "隐藏密码" : "显示密码"}
                          aria-pressed={showPassword}
                          data-testid="create-connection-password-toggle"
                        >
                          {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                        </button>
                      </div>
                    </Field>
                  </FieldPair>
                </>
              ) : (
                <Field
                  label="数据库文件路径"
                  required
                  error={show("database") ? databaseIssue : null}
                  hint="相对于项目根目录的 SQLite 数据库文件路径，例如 db/analytics.sqlite"
                >
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.database}
                    onChange={(e) => patchForm("database", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, database: true }))}
                    placeholder="例如 db/analytics.sqlite"
                    data-testid="create-connection-database"
                  />
                </Field>
              )}

              <Field
                label="初始 Schema（可选）"
                error={schemasParsed.issue}
                hint={`多个用逗号或空格分隔；${SCHEMA_NAME_RULE_HINT}`}
              >
                <input
                  className="pl-input notranslate"
                  translate="no"
                  value={form.schemasText}
                  onChange={(e) => patchForm("schemasText", e.target.value)}
                  placeholder="例如 analytics"
                  data-testid="create-connection-schemas"
                />
              </Field>

              <details
                className="rounded-md border border-border-default bg-bg-base px-3 py-2"
                data-testid="create-connection-advanced"
              >
                <summary className="cursor-pointer text-sm text-fg-muted">高级配置（可选）</summary>
                <div className="pt-3">
                  <FieldPair>
                    <Field label="引擎（可选）" hint="自定义底层方言引擎代码" pair>
                      <input
                        className="pl-input notranslate"
                        translate="no"
                        value={form.engine}
                        onChange={(e) => patchForm("engine", e.target.value)}
                        data-testid="create-connection-engine"
                      />
                    </Field>
                    <Field label="传输协议（可选）" hint="自定义底层传输协议" pair>
                      <input
                        className="pl-input notranslate"
                        translate="no"
                        value={form.wireProtocol}
                        onChange={(e) => patchForm("wireProtocol", e.target.value)}
                        data-testid="create-connection-wire-protocol"
                      />
                    </Field>
                  </FieldPair>
                </div>
              </details>
            </div>

            <div className="pl-drawer-footer">
              <button
                type="button"
                className="pl-btn pl-btn--ghost mr-auto"
                disabled={probeMutation.isPending}
                onClick={() => {
                  setProbeAttempted(true);
                  if (!canProbe) return;
                  probeMutation.mutate();
                }}
                data-testid="create-connection-test-btn"
              >
                {probeMutation.isPending ? "测试中..." : "测试连接"}
              </button>
              <button type="button" className="pl-btn pl-btn--ghost" onClick={close}>
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                disabled={previewMutation.isPending || (probeFailed && !probeOverride)}
                onClick={() => {
                  setPreviewAttempted(true);
                  if (!canPreviewWithProbe) return;
                  previewMutation.mutate();
                }}
                data-testid="create-connection-preview-btn"
              >
                {previewMutation.isPending ? "生成预览..." : "下一步：新建预览"}
              </button>
            </div>
            {probeMutation.isPending ? (
              <p className="text-xs text-fg-muted" role="status" data-testid="create-connection-probe-result">
                正在测试连接...
              </p>
            ) : probeResult ? (
              <div
                className={
                  probeResult.status === "ok" ? "text-sm text-success-strong" : "text-sm text-danger"
                }
                role="status"
                data-testid="create-connection-probe-result"
              >
                {probeResult.status === "ok"
                  ? `连接成功${probeResult.latencyMs != null ? `，${probeResult.latencyMs} ms` : ""}`
                  : `连接失败：${probeResult.message}`}
                {probeFailed ? (
                  <label className="mt-2 flex items-start gap-2 text-fg-default">
                    <input
                      type="checkbox"
                      checked={probeOverride}
                      onChange={(e) => setProbeOverride(e.target.checked)}
                      data-testid="create-connection-probe-override"
                    />
                    <span>
                      我了解连通测试未通过，仍要创建（后续 catalog / 查数可能不可用）
                    </span>
                  </label>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-fg-muted">
                建议先测试连接。未通过时将无法进入下一步，除非勾选确认仍要创建。
              </p>
            )}
            {submitError ? (
              <p className="text-sm text-danger" role="alert" data-testid="create-connection-error">
                {submitError}
              </p>
            ) : null}
          </section>
        )}

        {step === "preview" && preview && (
          <section className="pl-drawer-body" aria-label="新建预览">
            <p className="text-sm notranslate" translate="no">
              ktx.yaml 计划变更（unified diff；密码仅为 file: 引用）：
            </p>
            <DiffViewer diff={preview.diff} />
            {preview.secretRelPath && (
              <p className="text-xs text-fg-muted notranslate" translate="no">
                将写入密码文件：
                <code className="notranslate" translate="no">
                  {preview.secretRelPath}
                </code>
              </p>
            )}
            <div className="pl-drawer-footer">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => setStep("input")}
                disabled={writeMutation.isPending}
              >
                返回修改
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => {
                  setStep("submitting");
                  writeMutation.mutate();
                }}
                disabled={writeMutation.isPending}
                data-testid="create-connection-confirm-btn"
              >
                {writeMutation.isPending ? "创建中..." : "确认创建"}
              </button>
            </div>
            {submitError ? (
              <p className="text-sm text-danger" role="alert" data-testid="create-connection-error">
                {submitError}
              </p>
            ) : null}
          </section>
        )}

        {step === "submitting" && (
          <section className="pl-drawer-body" aria-label="创建中">
            <p className="text-sm text-fg-muted">正在写入配置与密码文件，并执行连通测试...</p>
          </section>
        )}

        {step === "success" && created && (
          <section className="pl-drawer-body notranslate" aria-label="创建完成" translate="no">
            <div className="rounded-md border border-success-strong/40 bg-success-soft/30 p-3">
              <p className="text-sm font-medium text-success-strong" data-testid="create-connection-success">
                连接已成功创建并保存
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                连接 ID：<strong className="notranslate" translate="no">{created.connection.id}</strong>
              </p>
              {created.secretRelPath && (
                <p className="text-xs text-fg-muted">
                  密码文件：<code className="notranslate" translate="no">{created.secretRelPath}</code>
                </p>
              )}
              <p className="mt-2 text-xs">
                连通测试：
                {created.test.status === "ok" ? (
                  <span className="text-success-strong">
                    测试通过{created.test.durationMs != null ? `（${created.test.durationMs} ms）` : ""}
                  </span>
                ) : (
                  <span className="text-danger" data-testid="create-connection-test-warning">
                    连通测试未通过（{created.test.message || "连接失败"}），配置已保存
                  </span>
                )}
              </p>
            </div>
            <div className="pl-drawer-footer">
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={close}
                data-testid="create-connection-done-btn"
              >
                完成
              </button>
            </div>
          </section>
        )}

        {step === "fatal" && (
          <section className="pl-drawer-body" aria-label="无法继续">
            <p className="text-sm text-danger" role="alert">
              {submitError ?? "无法继续创建连接"}
            </p>
            <div className="pl-drawer-footer">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={close}>
                关闭
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function FieldPair({ children }: { children: ReactNode }) {
  return <div className="pl-connection-field-pair">{children}</div>;
}

function Field({
  label,
  children,
  error,
  hint,
  pair = false,
  required = false
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
  hint?: string;
  pair?: boolean;
  required?: boolean;
}) {
  const message = error ? (
    <span className="text-danger">{error}</span>
  ) : hint ? (
    <span className="text-fg-muted notranslate" translate="no">
      {hint}
    </span>
  ) : null;
  return (
    <label className={pair ? "pl-connection-field pl-connection-field--pair" : "pl-connection-field"}>
      <span className="flex items-center gap-1">
        <span>{label}</span>
        {required && <span className="text-danger select-none" aria-hidden="true">*</span>}
      </span>
      <div className="pl-connection-field-control">{children}</div>
      <span className="pl-connection-field-message">{message}</span>
    </label>
  );
}
