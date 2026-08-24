import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiPost } from "../lib/apiClient";
import {
  CONNECTION_ID_PATTERN,
  defaultPortForDriver,
  validateConnectionId
} from "../lib/connectionId";
import { queryKeys } from "../lib/queryKeys";
import { SCHEMA_NAME_PATTERN, validateSchemaName } from "../lib/schemas";
import type { CreateConnectionPreview, CreateConnectionResult } from "../lib/types";
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
  driver: "mysql" | "postgres";
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
  driver: "mysql",
  engine: "",
  wireProtocol: "",
  readonly: true,
  host: "",
  port: String(defaultPortForDriver("mysql")),
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
      return `${err.message}（已回滚连接配置与密码文件）`;
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
  const [step, setStep] = useState<Step>("input");
  const [preview, setPreview] = useState<CreateConnectionPreview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const idIssue = useMemo(
    () => validateConnectionId(form.id, existingIds),
    [form.id, existingIds]
  );
  const schemasParsed = useMemo(() => parseSchemas(form.schemasText), [form.schemasText]);
  const portNumber = Number(form.port);
  const portIssue =
    !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
      ? "端口须为 1–65535 的整数"
      : null;
  const hostIssue = form.host.trim() ? null : "host 为必填项";
  const databaseIssue = form.database.trim() ? null : "database 为必填项";
  const usernameIssue = form.username.trim() ? null : "username 为必填项";
  const passwordIssue = form.password.length > 0 ? null : "数据库密码为必填项";

  const canPreview =
    !idIssue &&
    !hostIssue &&
    !portIssue &&
    !databaseIssue &&
    !usernameIssue &&
    !passwordIssue &&
    !schemasParsed.issue;

  const show = (field: string) => Boolean(touched[field] || previewAttempted);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionPreview>("/api/connections", {
        id: form.id.trim(),
        driver: form.driver,
        ...(form.engine.trim() ? { engine: form.engine.trim() } : {}),
        ...(form.wireProtocol.trim() ? { wireProtocol: form.wireProtocol.trim() } : {}),
        readonly: form.readonly,
        host: form.host.trim(),
        port: portNumber,
        database: form.database.trim(),
        username: form.username.trim(),
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

  const writeMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionResult>("/api/connections", {
        id: form.id.trim(),
        driver: form.driver,
        ...(form.engine.trim() ? { engine: form.engine.trim() } : {}),
        ...(form.wireProtocol.trim() ? { wireProtocol: form.wireProtocol.trim() } : {}),
        readonly: form.readonly,
        host: form.host.trim(),
        port: portNumber,
        database: form.database.trim(),
        username: form.username.trim(),
        password: form.password,
        schemas: schemasParsed.schemas,
        dryRun: false
      }),
    onSuccess: (data) => {
      setStep("success");
      setSubmitError(null);
      setForm((prev) => ({ ...prev, password: "" }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      toast.success(`连接已创建：${data.connection.id}`);
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

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "driver" && (value === "mysql" || value === "postgres")) {
        const prevDefault = String(defaultPortForDriver(prev.driver));
        if (!prev.port.trim() || prev.port === prevDefault) {
          next.port = String(defaultPortForDriver(value));
        }
      }
      return next;
    });
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
            <p className="pl-notice notranslate" translate="no">
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
                label="连接 ID"
                error={show("id") ? idIssue?.message : null}
                hint={`须匹配 ${CONNECTION_ID_PATTERN}`}
              >
                <input
                  className="pl-input notranslate"
                  translate="no"
                  value={form.id}
                  onChange={(e) => patchForm("id", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, id: true }))}
                  placeholder="例如 demo-mysql"
                  data-testid="create-connection-id"
                  aria-invalid={show("id") && idIssue ? true : undefined}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="driver">
                  <select
                    className="pl-input notranslate"
                    translate="no"
                    value={form.driver}
                    onChange={(e) =>
                      patchForm("driver", e.target.value === "postgres" ? "postgres" : "mysql")
                    }
                    data-testid="create-connection-driver"
                  >
                    <option value="mysql">mysql</option>
                    <option value="postgres">postgres</option>
                  </select>
                </Field>
                <Field label="只读账号意图">
                  <label className="flex items-center gap-2 text-sm py-2">
                    <input
                      type="checkbox"
                      checked={form.readonly}
                      onChange={(e) => patchForm("readonly", e.target.checked)}
                      data-testid="create-connection-readonly"
                    />
                    <span>readonly（默认开启）</span>
                  </label>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="engine（可选）" hint="如 doris / starrocks">
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.engine}
                    onChange={(e) => patchForm("engine", e.target.value)}
                    data-testid="create-connection-engine"
                  />
                </Field>
                <Field label="wire_protocol（可选）" hint="OLAP MySQL wire 填 mysql">
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.wireProtocol}
                    onChange={(e) => patchForm("wireProtocol", e.target.value)}
                    data-testid="create-connection-wire-protocol"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="host" error={show("host") ? hostIssue : null}>
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.host}
                    onChange={(e) => patchForm("host", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, host: true }))}
                    data-testid="create-connection-host"
                  />
                </Field>
                <Field label="port" error={show("port") ? portIssue : null}>
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.port}
                    onChange={(e) => patchForm("port", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, port: true }))}
                    data-testid="create-connection-port"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="database" error={show("database") ? databaseIssue : null}>
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.database}
                    onChange={(e) => patchForm("database", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, database: true }))}
                    data-testid="create-connection-database"
                  />
                </Field>
                <Field label="username" error={show("username") ? usernameIssue : null}>
                  <input
                    className="pl-input notranslate"
                    translate="no"
                    value={form.username}
                    onChange={(e) => patchForm("username", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                    data-testid="create-connection-username"
                  />
                </Field>
              </div>

              <Field
                label="数据库密码"
                error={show("password") ? passwordIssue : null}
                hint="仅本次提交使用；成功后不会回显"
              >
                <input
                  type="password"
                  className="pl-input"
                  value={form.password}
                  onChange={(e) => patchForm("password", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  autoComplete="new-password"
                  data-testid="create-connection-password"
                />
              </Field>

              <Field
                label="初始 Schema（可选）"
                error={schemasParsed.issue}
                hint={`多个用逗号或空格分隔；须匹配 ${SCHEMA_NAME_PATTERN}`}
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
            </div>

            <div className="pl-drawer-footer">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={close}>
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                disabled={previewMutation.isPending}
                onClick={() => {
                  setPreviewAttempted(true);
                  if (!canPreview) return;
                  previewMutation.mutate();
                }}
                data-testid="create-connection-preview-btn"
              >
                {previewMutation.isPending ? "生成预览..." : "下一步：新建预览"}
              </button>
            </div>
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
            <p className="text-xs text-fg-muted notranslate" translate="no">
              将写入密码文件：
              <code className="notranslate" translate="no">
                {preview.secretRelPath}
              </code>
            </p>
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
            <p className="text-sm notranslate" translate="no">
              正在写入密码文件与 ktx.yaml，并执行连通测试…
            </p>
          </section>
        )}

        {step === "success" && preview && (
          <section className="pl-drawer-body" aria-label="创建成功" data-testid="create-connection-success">
            <p className="text-sm notranslate" translate="no">
              连接{" "}
              <code className="notranslate" translate="no">
                {preview.connection.id}
              </code>{" "}
              已创建。可在连接卡片中继续添加 Schema、维护启用表范围。
            </p>
            <div className="pl-drawer-footer">
              <button type="button" className="pl-btn pl-btn--primary" onClick={close}>
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

function Field({
  label,
  children,
  error,
  hint
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span>{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      {!error && hint ? <span className="text-xs text-fg-muted notranslate" translate="no">{hint}</span> : null}
    </label>
  );
}
