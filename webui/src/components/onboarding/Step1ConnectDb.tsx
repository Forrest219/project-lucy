import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { apiPost } from "../../lib/apiClient";
import { defaultPortForDriver, validateConnectionId } from "../../lib/connectionId";
import { validateSchemaName } from "../../lib/schemas";
import type { CreateConnectionResult, ProbeConnectionResult } from "../../lib/types";

export type Step1ConnectDbProps = {
  initialValues?: {
    id?: string;
    driver?: "mysql" | "postgres";
    engine?: string;
    host?: string;
    port?: string;
    database?: string;
    username?: string;
    schema?: string;
  };
  existingIds?: string[];
  onSuccess: (result: { connectionId: string; schema: string }) => void;
};

export function Step1ConnectDb({
  initialValues,
  existingIds = [],
  onSuccess
}: Step1ConnectDbProps) {
  const [id, setId] = useState(initialValues?.id || "");
  const [driver, setDriver] = useState<"mysql" | "postgres">(initialValues?.driver || "mysql");
  const [engine, setEngine] = useState(initialValues?.engine || "");
  const [host, setHost] = useState(initialValues?.host || "");
  const [port, setPort] = useState(initialValues?.port || String(defaultPortForDriver("mysql")));
  const [database, setDatabase] = useState(initialValues?.database || "");
  const [username, setUsername] = useState(initialValues?.username || "");
  const [password, setPassword] = useState("");
  const [schema, setSchema] = useState(initialValues?.schema || "");
  const [showPassword, setShowPassword] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeConnectionResult | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const idIssue = validateConnectionId(id, existingIds);
  const schemaIssue = schema.trim() ? validateSchemaName(schema.trim()) : null;
  const portNum = Number(port);
  const portIssue =
    !Number.isInteger(portNum) || portNum < 1 || portNum > 65535
      ? "端口须为 1–65535 的整数"
      : null;

  const canProbe = Boolean(
    host.trim() && !portIssue && database.trim() && username.trim() && password.length > 0
  );

  const canSubmit = Boolean(
    id.trim() &&
      !idIssue &&
      canProbe &&
      (!schema.trim() || !schemaIssue)
  );

  const probeMutation = useMutation({
    mutationFn: () =>
      apiPost<ProbeConnectionResult>("/api/connections/probe", {
        driver,
        ...(engine.trim() ? { engine: engine.trim() } : {}),
        host: host.trim(),
        port: portNum,
        database: database.trim(),
        username: username.trim(),
        password,
        ...(schema.trim() ? { schema: schema.trim() } : {})
      }),
    onSuccess: (res) => {
      setProbeResult(res);
      setSubmitError(null);
    },
    onError: (err) => {
      setProbeResult({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionResult>("/api/connections", {
        id: id.trim(),
        driver,
        ...(engine.trim() ? { engine: engine.trim() } : {}),
        readonly: true,
        host: host.trim(),
        port: portNum,
        database: database.trim(),
        username: username.trim(),
        password,
        schemas: schema.trim() ? [schema.trim()] : [database.trim()],
        dryRun: false
      }),
    onSuccess: (res) => {
      const createdSchema = schema.trim() || database.trim();
      onSuccess({
        connectionId: res.connection.id,
        schema: createdSchema
      });
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  });

  const handleDriverChange = (nextDriver: "mysql" | "postgres") => {
    setDriver(nextDriver);
    setPort(String(defaultPortForDriver(nextDriver)));
  };

  return (
    <div className="space-y-6" data-testid="setup-step-1">
      <div className="bg-bg-subtle p-4 rounded-lg border border-border-default space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              连接 ID <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="如：mysql-prod"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setTouched(true);
              }}
              data-testid="setup-conn-id"
            />
            {touched && idIssue ? (
              <p className="text-xs text-danger mt-1">{idIssue.message}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              数据库类型
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs rounded border transition-colors notranslate ${
                  driver === "mysql"
                    ? "bg-bg-surface border-primary text-primary font-medium shadow-sm"
                    : "border-border-default text-fg-muted hover:bg-bg-surface"
                }`}
                translate="no"
                onClick={() => handleDriverChange("mysql")}
              >
                MySQL / Doris / StarRocks
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 text-xs rounded border transition-colors notranslate ${
                  driver === "postgres"
                    ? "bg-bg-surface border-primary text-primary font-medium shadow-sm"
                    : "border-border-default text-fg-muted hover:bg-bg-surface"
                }`}
                translate="no"
                onClick={() => handleDriverChange("postgres")}
              >
                PostgreSQL
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-fg-default mb-1">
              主机地址 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="127.0.0.1 或 db.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              data-testid="setup-host"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              端口 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              data-testid="setup-port"
            />
            {portIssue ? <p className="text-xs text-danger mt-1">{portIssue}</p> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              数据库名 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="如：analytics_db"
              value={database}
              onChange={(e) => {
                setDatabase(e.target.value);
                if (!schema) setSchema(e.target.value);
              }}
              data-testid="setup-database"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1 notranslate" translate="no">
              初始 Schema (可选)
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder={database || "留空默认同数据库名"}
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              data-testid="setup-schema"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              用户名 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="root / readonly_user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="setup-username"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-default mb-1">
              数据库密码 <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="pl-input w-full pr-8 notranslate"
                translate="no"
                placeholder="安全密码（一次性写入）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="setup-password"
              />
              <button
                type="button"
                className="absolute right-2 top-2 text-fg-muted hover:text-fg-default"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg border border-border-default">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="pl-btn pl-btn--outline text-xs"
            disabled={!canProbe || probeMutation.isPending}
            onClick={() => probeMutation.mutate()}
            data-testid="setup-probe-btn"
          >
            {probeMutation.isPending ? "正在探测..." : "测试连接"}
          </button>
          {probeMutation.isPending ? (
            <span className="text-xs text-fg-muted">正在进行连通探测...</span>
          ) : probeResult ? (
            probeResult.status === "ok" ? (
              <span className="flex items-center gap-1.5 text-xs text-success-strong font-medium">
                <CheckCircle2 className="w-4 h-4 text-success" />
                连通测试成功 {probeResult.latencyMs != null ? `(${probeResult.latencyMs} ms)` : ""}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-danger">
                <AlertCircle className="w-4 h-4" />
                连通失败：{probeResult.message}
              </span>
            )
          ) : (
            <span className="text-xs text-fg-muted">建议先进行连通测试以验证网络与凭据。</span>
          )}
        </div>

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          data-testid="setup-step1-next"
        >
          {createMutation.isPending ? "正在创建..." : "继续：挂载资产清单 →"}
        </button>
      </div>

      {submitError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger" role="alert">
          {submitError}
        </div>
      ) : null}
    </div>
  );
}
